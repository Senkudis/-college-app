const router = require("express").Router();
const StudentSubmission = require("../models/StudentSubmission");
const Assignment = require("../models/Assignment");
const Subject = require("../models/Subject");
const User = require("../models/User");

const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const upload = require("../config/multer");
const { removeUploadedFile } = require("../config/multer");
const path = require("path");
// ملف التسليم المستبدل أو الملغى كان يبقى على القرص إلى الأبد
const removeSubmissionFile = name => { if (name) removeUploadedFile(path.join("uploads", "submissions", path.basename(name))); };
// multer يحفظ الملف قبل فحوص المسار؛ إن رُفض الطلب (متأخر، مكرر…) نحذفه
const dropFileIfRejected = (req, res, next) => { res.on("finish", () => { if (res.statusCode >= 400 && req.file) removeSubmissionFile(req.file.filename); }); next(); };
const { uploadLimiter } = require("../middleware/rateLimiter");
const mongoose = require("mongoose");
const { success, fail, notFound, serverError } = require("../utils/response");
const { logActivity } = require("../utils/activityLogger");

const { resolveDueDateTime } = require("../utils/dueDate");

async function canManageAssignment(user, assignment) {
  if (user.roles.includes("dean") || user.roles.includes("admin")) return true;
  if (!user.roles.includes("doctor")) return false;

  const subjectId = assignment?.subject?._id || assignment?.subject;
  const subject = assignment?.subject?.doctor
    ? assignment.subject
    : await Subject.findById(subjectId).select("doctor batches").lean();
  if (!subject) return false;

  const subjectDoctor = subject.doctor?._id || subject.doctor;
  if (!subjectDoctor || String(subjectDoctor) !== String(user.id)) return false;

  const doctor = await User.findById(user.id).select("batches").lean();
  const assignedBatches = new Set((doctor?.batches || []).map(String));
  const assignmentBatches = Array.isArray(assignment.batches) ? assignment.batches.map(String) : [];
  const subjectBatches = Array.isArray(subject.batches) ? subject.batches.map(String) : [];
  const scopedBatches = assignmentBatches.length > 0 ? assignmentBatches : subjectBatches;
  return scopedBatches.some(batchId => assignedBatches.has(batchId));
}

// نطاق التكليف = دفعاته، وإن لم تُحدَّد فدفعات المادة
async function assignmentBatchScope(assignment) {
  if (Array.isArray(assignment.batches) && assignment.batches.length) {
    return assignment.batches.map(b => String(b?._id || b));
  }
  const subjectId = assignment?.subject?._id || assignment?.subject;
  const subject = assignment?.subject?.batches
    ? assignment.subject
    : await Subject.findById(subjectId).select("batches").lean();
  return (subject?.batches || []).map(b => String(b?._id || b));
}

async function studentInAssignmentScope(userId, assignment) {
  const student = await User.findById(userId).select("batch").lean();
  if (!student?.batch) return false;
  const scope = await assignmentBatchScope(assignment);
  return scope.includes(String(student.batch));
}

// ============ مسارات الطلاب ============

// تسليم واجب جديد (الطلاب والليدر)
router.post("/submit", auth, role("student", "leader"), uploadLimiter, upload.single("file"), dropFileIfRejected, async (req, res) => {
  try {
    if (!req.file) {
      return fail(res, "يجب رفع ملف التسليم");
    }

    const { assignmentId, submissionType, notes } = req.body;

    // التحقق من صحة معرف التكليف
    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      return fail(res, "معرف التكليف غير صالح");
    }

    // جلب بيانات التكليف مع الدفعات
    const assignment = await Assignment.findById(assignmentId).populate("subject");
    if (!assignment) {
      return notFound(res, "التكليف غير موجود");
    }

    // التحقق من أن الطالب في دفعة مسموح لها بالتكليف — طالب بلا دفعة كان
    // يتخطى الفحص كله ويسلّم لأي تكليف في الكلية
    if (!(await studentInAssignmentScope(req.user.id, assignment))) {
      return fail(res, "هذا التكليف غير متاح لدفعتك", 403);
    }

    // التحقق من موعد التسليم (بـ UTC)
    const now = new Date();

    // حماية من غياب dueDate أو dueTime
    if (!assignment.dueDate) {
      return fail(res, "لم يتم تحديد موعد تسليم لهذا التكليف", 400);
    }

    const dueDateTime = resolveDueDateTime(assignment);
    const isLate = now > dueDateTime;

    // منع التسليم بعد انتهاء الموعد
    if (isLate) {
      return fail(res, "انتهى موعد التسليم. لا يمكن تسليم الواجب بعد الموعد المحدد.", 400, { dueDateTime });
    }

    // التحقق من عدم تسليم الطالب للتكليف مسبقاً
    const existingSubmission = await StudentSubmission.findOne({
      assignment: assignmentId,
      student: req.user.id
    });

    if (existingSubmission) {
      return fail(res, "لقد قمت بتسليم هذا التكليف مسبقاً");
    }

    // التحقق من تطابق نوع التسليم مع نوع التكليف
    if (submissionType && submissionType !== assignment.type) {
      return fail(res, `نوع التسليم يجب أن يكون: ${assignment.type}`);
    }

    // تحديد نوع الملف
    let fileType = "document";
    if (req.file.mimetype.startsWith("image/")) {
      fileType = "image";
    } else if (req.file.mimetype === "application/pdf") {
      fileType = "pdf";
    }

    // إنشاء التسليم الجديد
    const submission = await StudentSubmission.create({
      assignment: assignmentId,
      student: req.user.id,
      submissionType: assignment.type,
      file: req.file.filename,
      fileType: fileType,
      notes: notes,
      /* التسليم هنا يكون دائماً في الموعد (المتأخر مرفوض أعلاه)، لكن
         تثبيت false كان يجعل الحقل بلا معنى بينما تعرضه الواجهة كحالة.
         نكتب القيمة المحسوبة كي يبقى الحقل صادقاً — وتصير إعادة التسليم
         بعد الموعد هي الحالة الوحيدة التي تضبطه على true. */
      isLate,
      submissionDate: now
    });

    // ملء البيانات المرجعية
    await submission.populate("assignment student");

    // إشعار الدكاترة والليدر بوجود تسليم جديد
    try {
      const Notification = require("../models/Notification");
      const assignmentTitle = assignment.title || "التكليف";
      const studentName = req.user.name || "طالب";
      /* كان target:"doctors" + دفعات التكليف يُرسل الإشعار لكل دكاترة الدفعة
         عن مواد لا يدرّسونها. المعني هو دكتور المادة وحده. */
      const subjectDoctor = assignment.subject?.doctor;
      if (subjectDoctor) {
        await Notification.create({
          title: "تسليم واجب جديد",
          message: `قام ${studentName} بتسليم واجب "${assignmentTitle}"`,
          type: "normal",
          target: "doctors",
          recipients: [subjectDoctor],
          createdBy: req.user.id
        });
      }
    } catch (notifErr) {
      console.error("Failed to trigger submission notification:", notifErr.message);
    }

    logActivity(req.user.id, "ASSIGNMENT_SUBMITTED", { assignmentId: assignment._id, title: assignment.title });
    try {
      const { recordActivity } = require("../services/kedySmartNotification.service");
      recordActivity(req.user.id);
    } catch(e) {}

    success(res, { submission }, "تم تسليم الواجب بنجاح", 201);
  } catch (err) {
    console.error("Error submitting assignment:", err);
    serverError(res, err, "تسليم واجب");
  }
});

// الغاء التسليم (للطلاب فقط، قبل انتهاء الموعد وقبل التقييم)
router.delete("/:id/undo", auth, role("student", "leader"), async (req, res) => {
  try {
    const submission = await StudentSubmission.findById(req.params.id).populate("assignment");
    if (!submission) return notFound(res, "التسليم غير موجود");

    if (submission.student.toString() !== req.user.id) {
      return fail(res, "ليس لديك صلاحية لإلغاء هذا التسليم", 403);
    }

    if (submission.status === "graded" || submission.grade !== undefined) {
      return fail(res, "لا يمكن إلغاء التسليم بعد أن تم تقييمه");
    }

    const now = new Date();
    const dueDateTime = resolveDueDateTime(submission.assignment);

    if (dueDateTime && now > dueDateTime) {
      return fail(res, "انتهى وقت التسليم، لا يمكن إلغاء التسليم الآن");
    }

    await StudentSubmission.findByIdAndDelete(req.params.id);
    removeSubmissionFile(submission.file);
    success(res, null, "تم إلغاء التسليم بنجاح، يمكنك رفع ملف جديد");
  } catch (err) {
    serverError(res, err, "إلغاء التسليم");
  }
});

// إعادة تسليم بعد التقييم (الطلاب والليدر) — فقط إذا لم يكن مقبولاً بالكامل
router.post("/:id/resubmit", auth, role("student", "leader"), uploadLimiter, upload.single("file"), dropFileIfRejected, async (req, res) => {
  try {
    const submission = await StudentSubmission.findById(req.params.id)
      .populate("assignment");

    if (!submission) {
      return notFound(res, "التسليم غير موجود");
    }

    // التحقق من الملكية
    if (submission.student.toString() !== req.user.id) {
      return fail(res, "ليس لديك صلاحية لإعادة تسليم هذا الواجب", 403);
    }

    // السماح بإعادة التسليم فقط إذا كان التقييم < 60 أو الحالة pending/reviewed
    if (submission.grade !== undefined && submission.grade >= 60 && submission.status === "graded") {
      return fail(res, "لا يمكن إعادة التسليم: تم قبول الواجب بدرجة 60 أو أعلى");
    }

    if (!req.file) {
      return fail(res, "يجب رفع ملف التسليم الجديد");
    }

    const assignment = await Assignment.findById(submission.assignment);
    if (!assignment) {
      return notFound(res, "التكليف غير موجود");
    }

    /* نافذة إصلاح محدودة بعد الموعد لا باب مفتوح إلى الأبد.
       لم يكن هنا أي فحص للتاريخ إطلاقاً، فيكفي رفع ملف فارغ قبل الموعد
       والحصول على درجة دون 60 ثم رفع العمل الحقيقي بعد أسابيع — وهو ما
       يُفرغ منع التسليم المتأخر من مضمونه. */
    const RESUBMIT_GRACE_DAYS = Number(process.env.RESUBMIT_GRACE_DAYS || 7);
    const dueDateTime = resolveDueDateTime(assignment);
    const now = new Date();
    let isLateResubmission = false;

    if (dueDateTime) {
      isLateResubmission = now > dueDateTime;
      const graceEnds = new Date(dueDateTime.getTime() + RESUBMIT_GRACE_DAYS * 24 * 60 * 60 * 1000);
      if (now > graceEnds) {
        return fail(
          res,
          `انتهت مهلة إعادة التسليم (${RESUBMIT_GRACE_DAYS} أيام بعد الموعد المحدد)`,
          400,
          { dueDateTime, graceEnds }
        );
      }
    }

    // التحقق من أن الطالب لا يزال في الدفعة المسموح بها
    if (!(await studentInAssignmentScope(req.user.id, assignment))) {
      return fail(res, "هذا التكليف لم يعد متاحاً لدفعتك", 403);
    }

    // تحديد نوع الملف
    let fileType = "document";
    if (req.file.mimetype.startsWith("image/")) fileType = "image";
    else if (req.file.mimetype === "application/pdf") fileType = "pdf";

    // تحديث التسليم
    const previousFile = submission.file;
    submission.file = req.file.filename;
    submission.fileType = fileType;
    submission.notes = req.body.notes || submission.notes;
    submission.submissionDate = now;
    submission.isLate = isLateResubmission; // يظهر للمقيّم أن هذه النسخة جاءت بعد الموعد
    submission.status = "pending";
    submission.grade = undefined;
    submission.feedback = undefined;
    submission.reviewedBy = undefined;
    submission.reviewDate = undefined;

    await submission.save();
    if (previousFile !== submission.file) removeSubmissionFile(previousFile);
    await submission.populate("assignment student");

    success(res, { submission }, "تم إعادة التسليم بنجاح");
  } catch (err) {
    serverError(res, err, "إعادة تسليم");
  }
});

// جلب تسليمات الطالب (أو قائمة فارغة للدكاترة/الإدارة دون أخطاء 403)
router.get("/my-submissions", auth, role("student", "leader", "doctor", "dean", "admin"), async (req, res) => {
  try {
    const isStudentOrLeader = req.user.roles.includes("student") || req.user.roles.includes("leader");
    if (!isStudentOrLeader) {
      return success(res, { submissions: [] });
    }

    const submissions = await StudentSubmission.find({ student: req.user.id })
      .populate("assignment")
      .sort({ submissionDate: -1 });

    success(res, { submissions });
  } catch (err) {
    serverError(res, err, "جلب تسليمات الطالب");
  }
});

// جلب تفاصيل تسليم واحد
router.get("/:id", auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, "معرف التسليم غير صالح");
    }

    const submission = await StudentSubmission.findById(req.params.id)
      .populate("assignment")
      .populate("student", "name email")
      .populate("reviewedBy", "name");

    if (!submission) {
      return notFound(res, "التسليم غير موجود");
    }

    // التحقق من الصلاحية (الطالب صاحب التسليم أو الدكتور/العميد/الليدر)
    const isOwner = req.user.id === submission.student._id.toString();
    const isStaff = req.user.roles.some(r => ["dean", "doctor", "admin"].includes(r));
    
    if (!isOwner && !isStaff) {
      return fail(res, "ليس لديك صلاحية للوصول إلى هذا التسليم", 403);
    }
    if (!isOwner && req.user.roles.includes("doctor") && !(await canManageAssignment(req.user, submission.assignment))) {
      return fail(res, "ليس لديك صلاحية للوصول إلى هذا التسليم", 403);
    }

    success(res, { submission });

  } catch (err) {
    serverError(res, err, "جلب تفاصيل تسليم");
  }
});

// ============ مسارات الدكاترة والعمداء والأدمن ============

// جلب جميع التسليمات لتكليف معين (مع Pagination)
router.get("/assignment/:assignmentId/submissions", auth, role("dean", "doctor", "admin"), async (req, res) => {
  try {
    const { assignmentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      return fail(res, "معرف التكليف غير صالح");
    }

    const assignment = await Assignment.findById(assignmentId);
    if (!assignment) {
      return notFound(res, "التكليف غير موجود");
    }
    if (!(await canManageAssignment(req.user, assignment))) {
      return fail(res, "ليس لديك صلاحية للوصول إلى تسليمات هذا التكليف", 403);
    }

    // Pagination
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [submissions, total] = await Promise.all([
      StudentSubmission.find({ assignment: assignmentId })
        .populate("student", "name email batch")
        .populate("reviewedBy", "name")
        .sort({ submissionDate: -1 })
        .skip(skip)
        .limit(limit),
      StudentSubmission.countDocuments({ assignment: assignmentId })
    ]);

    success(res, {
      submissions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasMore: page * limit < total
      }
    });
  } catch (err) {
    serverError(res, err, "جلب تسليمات التكليف");
  }
});

// جلب الطلاب الذين لم يسلموا التكليف (مفلترة حسب الدفعة)
router.get("/assignment/:assignmentId/not-submitted", auth, role("dean", "doctor", "admin"), async (req, res) => {
  try {
    const { assignmentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      return fail(res, "معرف التكليف غير صالح");
    }

    const assignment = await Assignment.findById(assignmentId).populate("subject");
    if (!assignment) {
      return notFound(res, "التكليف غير موجود");
    }
    if (!(await canManageAssignment(req.user, assignment))) {
      return fail(res, "ليس لديك صلاحية للوصول إلى تسليمات هذا التكليف", 403);
    }

    // جلب جميع التسليمات للتكليف
    const submissions = await StudentSubmission.find({ assignment: assignmentId });
    const submittedStudentIds = submissions.map(s => s.student.toString());

    // جلب جميع الطلاب وتصفية من لم يسلموا
    // بلا نطاق دفعات كان الاستعلام يُرجع كل طلاب الكلية كـ"لم يسلّموا"
    const scope = await assignmentBatchScope(assignment);
    const query = { roles: { $in: ["student", "leader"] }, batch: { $in: scope } };

    const allStudents = await User.find(query, "name email batch").populate("batch", "name code");
    const notSubmittedStudents = allStudents.filter(
      student => !submittedStudentIds.includes(student._id.toString())
    );

    success(res, {
      assignment: { _id: assignment._id, title: assignment.title, type: assignment.type },
      notSubmitted: notSubmittedStudents,
      totalStudents: allStudents.length,
      submitted: submissions.length
    });
  } catch (err) {
    serverError(res, err, "جلب من لم يسلموا");
  }
});

// تقييم التسليم (الدكتور/العميد/الأدمن)
router.put("/:id/grade", auth, role("dean", "doctor", "admin"), async (req, res) => {
  try {
    const { feedback } = req.body;
    const grade = Number(req.body.grade);

    // التحقق من صحة التقييم (يرفض النصوص وNaN أيضاً)
    if (req.body.grade === undefined || !Number.isFinite(grade) || grade < 0 || grade > 100) {
      return fail(res, "التقييم يجب أن يكون رقماً بين 0 و 100");
    }

    const submission = await StudentSubmission.findById(req.params.id).populate("assignment");
    if (!submission) {
      return notFound(res, "التسليم غير موجود");
    }
    if (!(await canManageAssignment(req.user, submission.assignment))) {
      return fail(res, "ليس لديك صلاحية لتقييم هذا التسليم", 403);
    }

    submission.grade = grade;
    submission.feedback = feedback;
    submission.status = "graded";
    submission.reviewedBy = req.user.id;
    submission.reviewDate = new Date();
    await submission.save();
    await submission.populate("student", "name email");

    // إضافة نقاط للطالب (نظام Leaderboard) مرة واحدة فقط عند اجتياز الواجب
    if (grade >= 60 && !submission.pointsAwarded) {
      submission.pointsAwarded = true;
      await submission.save();
      await User.findByIdAndUpdate(submission.student._id, { $inc: { points: 10 } });
    }

    // Trigger notification
    try {
      const Notification = require("../models/Notification");
      const assignmentTitle = submission.assignment ? submission.assignment.title : "التكليف";
      await Notification.create({
        title: "تم رصد درجة التكليف",
        message: `تم تقييم تسليمك للواجب "${assignmentTitle}". الدرجة: ${grade}/100`,
        type: "normal",
        target: "students",
        recipients: [submission.student._id],
        createdBy: req.user.id
      });
    } catch (notifErr) {
      console.error("Failed to trigger grading notification:", notifErr);
    }

    // ===== Socket.io Emit =====
    const io = req.app.get('io');
    if (io && submission.student) {
      io.to(`user:${submission.student._id}`).emit('submission:graded', {
        grade: grade,
        assignmentTitle: submission.assignment ? submission.assignment.title : "التكليف"
      });
    }

    success(res, { submission }, "تم تقييم التسليم بنجاح");
  } catch (err) {
    serverError(res, err, "تقييم تسليم");
  }
});

/* تحديث حالة التسليم — العميد/الدكتور/الأدمن.
   كان "leader" مذكوراً هنا بينما canManageAssignment تُرجع false له دائماً
   (تشترط dean/admin أو doctor مالك المادة)، فالنتيجة 403 مضمونة: صلاحية
   معلنة ومستحيلة التنفيذ. و"admin" كان ناقصاً رغم أن الدالة تقبله. */
router.put("/:id/status", auth, role("dean", "doctor", "admin"), async (req, res) => {
  try {
    const { status } = req.body;

    if (!["pending", "reviewed", "graded"].includes(status)) {
      return fail(res, "حالة غير صحيحة. القيم المسموحة: pending, reviewed, graded");
    }

    const submission = await StudentSubmission.findById(req.params.id).populate("assignment");
    if (!submission) {
      return notFound(res, "التسليم غير موجود");
    }
    if (!(await canManageAssignment(req.user, submission.assignment))) {
      return fail(res, "ليس لديك صلاحية لتحديث حالة هذا التسليم", 403);
    }

    submission.status = status;
    await submission.save();
    success(res, { submission }, "تم تحديث الحالة");

  } catch (err) {
    serverError(res, err, "تحديث حالة تسليم");
  }
});

module.exports = router;
