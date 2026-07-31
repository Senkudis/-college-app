const router = require("express").Router();
const StudentSubmission = require("../models/StudentSubmission");
const Assignment = require("../models/Assignment");
const User = require("../models/User");
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const upload = require("../config/multer");
const mongoose = require("mongoose");
const { success, fail, notFound, serverError } = require("../utils/response");
const { logActivity } = require("../utils/activityLogger");

// ============ مسارات الطلاب ============

// تسليم واجب جديد (الطلاب والليدر)
router.post("/submit", auth, role("student", "leader"), upload.single("file"), async (req, res) => {
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

    // التحقق من أن الطالب في دفعة مسموح لها بالتكليف
    const student = await User.findById(req.user.id).select("batch");
    if (student.batch && assignment.batches && assignment.batches.length > 0) {
      const studentBatchId = student.batch.toString();
      const assignmentBatches = assignment.batches.map(b => b.toString());
      if (!assignmentBatches.includes(studentBatchId)) {
        return fail(res, "هذا التكليف غير متاح لدفعتك", 403);
      }
    }

    // التحقق من موعد التسليم (بـ UTC)
    const now = new Date();

    // ✅ حماية من غياب dueDate أو dueTime
    if (!assignment.dueDate) {
      return fail(res, "لم يتم تحديد موعد تسليم لهذا التكليف", 400);
    }

    const dueDateTime = new Date(assignment.dueDate);
    
    // تعيين الوقت المحدد للتسليم
    if (assignment.dueTime && typeof assignment.dueTime === 'string') {
      const [hours, minutes] = assignment.dueTime.split(":").map(Number);
      if (!isNaN(hours) && !isNaN(minutes)) {
        dueDateTime.setUTCHours(hours, minutes, 0, 0);
      }
    }

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
      submissionType: assignment.type, // استخدام نوع التكليف وليس نوع التسليم المرسل
      file: req.file.filename,
      fileType: fileType,
      notes: notes,
      isLate: false,
      submissionDate: now
    });

    // ملء البيانات المرجعية
    await submission.populate("assignment student");

    // إشعار الدكاترة والليدر بوجود تسليم جديد
    try {
      const Notification = require("../models/Notification");
      const assignmentTitle = assignment.title || "التكليف";
      const studentName = req.user.name || "طالب";
      await Notification.create({
        title: "تسليم واجب جديد",
        message: `قام ${studentName} بتسليم واجب "${assignmentTitle}"`,
        type: "normal",
        target: "doctors",
        batches: assignment.batches || [],
        createdBy: req.user.id
      });
    } catch (notifErr) {
      console.error("Failed to trigger submission notification:", notifErr.message);
    }

    logActivity(req.user.id, "ASSIGNMENT_SUBMITTED", { assignmentId: assignment._id, title: assignment.title });

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
    let dueDateTime = new Date(submission.assignment.dueDate);
    if (submission.assignment.dueTime) {
      const [hours, minutes] = submission.assignment.dueTime.split(":").map(Number);
      if (!isNaN(hours) && !isNaN(minutes)) dueDateTime.setUTCHours(hours, minutes, 0, 0);
    }

    if (now > dueDateTime) {
      return fail(res, "انتهى وقت التسليم، لا يمكن إلغاء التسليم الآن");
    }

    await StudentSubmission.findByIdAndDelete(req.params.id);
    success(res, null, "تم إلغاء التسليم بنجاح، يمكنك رفع ملف جديد");
  } catch (err) {
    serverError(res, err, "إلغاء التسليم");
  }
});

// إعادة تسليم بعد التقييم (الطلاب والليدر) — فقط إذا لم يكن مقبولاً بالكامل
router.post("/:id/resubmit", auth, role("student", "leader"), upload.single("file"), async (req, res) => {
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

    // التحقق من موعد التسليم (يسمح بإعادة التسليم بعد الموعد الأصلي كاستثناء)
    const assignment = await Assignment.findById(submission.assignment);
    if (!assignment) {
      return notFound(res, "التكليف غير موجود");
    }

    // التحقق من أن الطالب لا يزال في الدفعة المسموح بها
    const student = await User.findById(req.user.id).select("batch");
    if (student.batch && assignment.batches && assignment.batches.length > 0) {
      const studentBatchId = student.batch.toString();
      const assignmentBatches = assignment.batches.map(b => b.toString());
      if (!assignmentBatches.includes(studentBatchId)) {
        return fail(res, "هذا التكليف لم يعد متاحاً لدفعتك", 403);
      }
    }

    // تحديد نوع الملف
    let fileType = "document";
    if (req.file.mimetype.startsWith("image/")) fileType = "image";
    else if (req.file.mimetype === "application/pdf") fileType = "pdf";

    // تحديث التسليم
    submission.file = req.file.filename;
    submission.fileType = fileType;
    submission.notes = req.body.notes || submission.notes;
    submission.submissionDate = new Date();
    submission.status = "pending";
    submission.grade = undefined;
    submission.feedback = undefined;
    submission.reviewedBy = undefined;
    submission.reviewDate = undefined;

    await submission.save();
    await submission.populate("assignment student");

    success(res, { submission }, "تم إعادة التسليم بنجاح");
  } catch (err) {
    serverError(res, err, "إعادة تسليم");
  }
});

// جلب تسليمات الطالب (أو قائمة فارغة للدكاترة/الإدارة دون أخطاء 403)
router.get("/my-submissions", auth, role("student", "leader", "doctor", "dean"), async (req, res) => {
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

    success(res, { submission });
  } catch (err) {
    serverError(res, err, "جلب تفاصيل تسليم");
  }
});

// ============ مسارات الدكاترة والعمداء والليدر ============

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

    // جلب جميع التسليمات للتكليف
    const submissions = await StudentSubmission.find({ assignment: assignmentId });
    const submittedStudentIds = submissions.map(s => s.student.toString());

    // جلب جميع الطلاب وتصفية من لم يسلموا
    // تصفية حسب دفعة التكليف إن وجدت
    let query = { roles: { $in: ["student", "leader"] } };
    if (assignment.batches && assignment.batches.length > 0) {
      query.batch = { $in: assignment.batches };
    }

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

// تقييم التسليم (الدكتور/العميد/الليدر)
router.put("/:id/grade", auth, role("dean", "doctor", "admin"), async (req, res) => {
  try {
    const { feedback } = req.body;
    const grade = Number(req.body.grade);

    // التحقق من صحة التقييم (يرفض النصوص وNaN أيضاً)
    if (req.body.grade === undefined || !Number.isFinite(grade) || grade < 0 || grade > 100) {
      return fail(res, "التقييم يجب أن يكون رقماً بين 0 و 100");
    }

    const submission = await StudentSubmission.findByIdAndUpdate(
      req.params.id,
      {
        grade: grade,
        feedback: feedback,
        status: "graded",
        reviewedBy: req.user.id,
        reviewDate: new Date()
      },
      { returnDocument: 'after' }
    ).populate("student", "name email").populate("assignment");

    if (!submission) {
      return notFound(res, "التسليم غير موجود");
    }

    // إضافة نقاط للطالب (نظام Leaderboard)
    if (grade >= 60) {
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

// تحديث حالة التسليم
router.put("/:id/status", auth, role("dean", "doctor", "leader"), async (req, res) => {
  try {
    const { status } = req.body;

    if (!["pending", "reviewed", "graded"].includes(status)) {
      return fail(res, "حالة غير صحيحة. القيم المسموحة: pending, reviewed, graded");
    }

    const submission = await StudentSubmission.findByIdAndUpdate(
      req.params.id,
      { status: status },
      { returnDocument: 'after' }
    );

    if (!submission) {
      return notFound(res, "التسليم غير موجود");
    }

    success(res, { submission }, "تم تحديث الحالة");
  } catch (err) {
    serverError(res, err, "تحديث حالة تسليم");
  }
});

module.exports = router;
