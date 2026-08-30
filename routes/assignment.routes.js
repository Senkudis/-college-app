const router = require("express").Router();
const Assignment = require("../models/Assignment");
const User = require("../models/User");
const Subject = require("../models/Subject");
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const upload = require("../config/multer");
const { uploadLimiter } = require("../middleware/rateLimiter");
const mongoose = require("mongoose");
const { success, fail, notFound, serverError } = require("../utils/response");

async function canAccessAssignment(user, assignment) {
  if (user.roles.includes("dean") || user.roles.includes("admin")) return true;

  const subjectId = assignment?.subject?._id || assignment?.subject;
  const subject = assignment?.subject?.doctor
    ? assignment.subject
    : await Subject.findById(subjectId).select("doctor batches").lean();
  if (!subject) return false;

  const subjectDoctor = subject.doctor?._id || subject.doctor;
  if (user.roles.includes("doctor")) {
    if (!subjectDoctor || String(subjectDoctor) !== String(user.id)) return false;
    const doctor = await User.findById(user.id).select("batches").lean();
    const assigned = new Set((doctor?.batches || []).map(String));
    const assignmentBatches = Array.isArray(assignment.batches) ? assignment.batches.map(String) : [];
    const subjectBatches = Array.isArray(subject.batches) ? subject.batches.map(String) : [];
    const scope = assignmentBatches.length ? assignmentBatches : subjectBatches;
    return scope.some(batchId => assigned.has(batchId));
  }

  if (user.roles.includes("student") || user.roles.includes("leader")) {
    const account = await User.findById(user.id).select("batch").lean();
    const batchId = account?.batch && String(account.batch);
    if (!batchId) return false;
    const scope = Array.isArray(assignment.batches) && assignment.batches.length
      ? assignment.batches
      : (subject.batches || []);
    return scope.some(candidate => String(candidate?._id || candidate) === batchId);
  }

  return false;
}

// إضافة تكليف جديد (عميد، دكتور، ليدر)
router.post("/", auth, role("dean", "doctor", "leader", "admin"), uploadLimiter, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return fail(res, "يجب رفع ملف التكليف");
    }

    const { title, description, type, subject, dueDate, dueTime, batches } = req.body;

    if (!title || !type || !subject || !dueDate) {
      return fail(res, "العنوان، النوع، المادة، وتاريخ التسليم مطلوبة");
    }

    // التحقق من المادة
    const subjectDoc = await Subject.findById(subject);
    if (!subjectDoc) return notFound(res, "المادة غير موجودة");

    if (req.user.roles.includes("doctor")) {
      const subjectDoctor = subjectDoc.doctor?._id || subjectDoc.doctor;
      if (!subjectDoctor || String(subjectDoctor) !== String(req.user.id)) {
        return fail(res, "لا يمكنك إنشاء تكليف لهذه المادة", 403);
      }
    }

    // Auto-assign batches: للدكتور تربط دفعاته تلقائياً، للعميد/ليدر يستخدم المحدد أو دفعات المادة
    let assignmentBatches = [];
    if (req.user.roles.includes("doctor")) {
      const doctorUser = await User.findById(req.user.id).select("batches");
      const doctorBatches = doctorUser?.batches || [];
      const subjectBatches = subjectDoc.batches || [];
      assignmentBatches = doctorBatches.filter(batchId =>
        !subjectBatches.length || subjectBatches.some(subjectBatch => String(subjectBatch) === String(batchId))
      );
      if (!assignmentBatches.length) {
        return fail(res, "لا توجد دفعة مشتركة مخصصة لك مع هذه المادة", 403);
      }
    } else if (batches) {
      assignmentBatches = Array.isArray(batches) ? batches : batches.split(',').map(s => s.trim());
    } else {
      assignmentBatches = subjectDoc.batches || [];
    }

    const assignment = await Assignment.create({
      title: title.trim(),
      description: (description || "").trim(),
      type,
      subject,
      file: req.file.filename,
      dueDate,
      dueTime: dueTime || "23:59",
      addedBy: req.user.id,
      batches: assignmentBatches
    });

    // Trigger notification
    try {
      const Notification = require("../models/Notification");
      await Notification.create({
        title: `تكليف جديد: ${assignment.title}`,
        message: `تم إضافة واجب جديد لمادة ${subjectDoc.name}. تاريخ التسليم النهائي: ${assignment.dueDate}`,
        type: "normal",
        target: "students",
        batches: assignment.batches,
        createdBy: req.user.id
      });
    } catch (notifErr) {
      console.error("Failed to trigger assignment notification:", notifErr);
    }

    // Socket.io Emit
    const io = req.app.get('io');
    if (io && assignment.batches && assignment.batches.length > 0) {
      assignment.batches.forEach(bId => io.to(`batch:${bId}`).emit('assignment:new', {
        title: assignment.title,
        subject: subjectDoc.name,
        dueDate: assignment.dueDate
      }));
    }

    await assignment.populate("subject", "name");
    success(res, { assignment }, "تم إنشاء التكليف بنجاح", 201);
  } catch (err) {
    console.error("Error creating assignment:", err);
    serverError(res, err, "إنشاء التكليف");
  }
});

// جلب التكاليف حسب النوع (تمارين، بحوث، مشاريع) — مع Pagination
router.get("/type/:type", auth, async (req, res) => {
  try {
    const { type } = req.params;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter = { type };
    if (req.user.roles.includes("student") || req.user.roles.includes("leader")) {
      const user = await User.findById(req.user.id).select("batch").lean();
      if (user?.batch) filter.batches = user.batch;
      else filter._id = null;
    } else if (req.user.roles.includes("doctor") && !req.user.roles.includes("dean") && !req.user.roles.includes("admin")) {
      const mySubjects = await Subject.find({ doctor: req.user.id }).select("_id").lean();
      filter.subject = { $in: mySubjects.map(s => s._id) };
    }

    const [assignments, total] = await Promise.all([
      Assignment.find(filter)
        .populate("subject", "name")
        .populate("addedBy", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Assignment.countDocuments(filter)
    ]);

    success(res, {
      assignments,
      pagination: { page, limit, total, pages: Math.ceil(total / limit), hasMore: page * limit < total }
    });
  } catch (err) {
    serverError(res, err, "جلب التكاليف حسب النوع");
  }
});

// جلب التكاليف لمادة معينة حسب النوع
router.get("/by-subject/:subjectId/:type", auth, async (req, res) => {
  try {
    const { subjectId, type } = req.params;

    if (!mongoose.Types.ObjectId.isValid(subjectId)) {
      return fail(res, "معرف المادة غير صالح");
    }

    const filter = {
      subject: subjectId,
      type: type
    };
    
    if (req.user.roles.includes("student") || req.user.roles.includes("leader")) {
      const user = await User.findById(req.user.id).select("batch").lean();
      if (user?.batch) filter.batches = user.batch;
      else filter._id = null;
    } else if (req.user.roles.includes("doctor") && !req.user.roles.includes("dean") && !req.user.roles.includes("admin")) {
      const mySubjects = await Subject.find({ doctor: req.user.id }).select("_id").lean();
      filter.subject = { $in: mySubjects.map(s => s._id), $eq: subjectId };
    }

    const assignments = await Assignment.find(filter).populate("addedBy", "name").sort({ createdAt: -1 });

    success(res, { assignments });
  } catch (err) {
    serverError(res, err, "جلب تكاليف المادة");
  }
});

// جلب تكليف واحد
router.get("/:id", auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, "معرف التكليف غير صالح");
    }

    const assignment = await Assignment.findById(req.params.id)
      .populate("subject", "name level")
      .populate("addedBy", "name")
      .populate("batches", "name code");

    if (!assignment) return notFound(res, "التكليف غير موجود");
    if (!(await canAccessAssignment(req.user, assignment))) {
      return fail(res, "غير مصرح لك بعرض هذا التكليف", 403);
    }

    success(res, { assignment });
  } catch (err) {
    serverError(res, err, "جلب التكليف");
  }
});

// تحديث تكليف (الذي أضافه أو العميد)
router.put("/:id", auth, role("dean", "doctor", "leader", "admin"), upload.single("file"), async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) return notFound(res, "التكليف غير موجود");

    // التحقق من الصلاحية: العميد/المسؤول دائماً، وغيرهما فقط لتكليفه هو وضمن نطاقه
    const canManage = (await canAccessAssignment(req.user, assignment)) && (
      req.user.roles.includes("dean") || req.user.roles.includes("admin")
      || assignment.addedBy.toString() === req.user.id
    );
    if (!canManage) {
      return fail(res, "ليس لديك صلاحية لتحديث هذا التكليف", 403);
    }

    const { title, description, type, subject, dueDate, dueTime, batches } = req.body;

    if (title) assignment.title = title.trim();
    if (description !== undefined) assignment.description = (description || "").trim();
    if (type) assignment.type = type;
    if (subject) {
      const subj = await Subject.findById(subject);
      if (!subj) return fail(res, "المادة المحددة غير موجودة");
      assignment.subject = subject;
    }
    if (dueDate) assignment.dueDate = dueDate;
    if (dueTime) assignment.dueTime = dueTime;
    if (batches) assignment.batches = Array.isArray(batches) ? batches : batches.split(',').map(s => s.trim());

    if (req.file) assignment.file = req.file.filename;

    await assignment.save();
    await assignment.populate("subject", "name");

    success(res, { assignment }, "تم تحديث التكليف");
  } catch (err) {
    serverError(res, err, "تحديث التكليف");
  }
});

// حذف تكليف (الذي أضافه أو العميد)
router.delete("/:id", auth, role("dean", "doctor", "leader", "admin"), async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) return notFound(res, "التكليف غير موجود");

    const canManage = (await canAccessAssignment(req.user, assignment)) && (
      req.user.roles.includes("dean") || req.user.roles.includes("admin")
      || assignment.addedBy.toString() === req.user.id
    );
    if (!canManage) {
      return fail(res, "ليس لديك صلاحية لحذف هذا التكليف", 403);
    }

    await Assignment.findByIdAndDelete(req.params.id);
    success(res, null, "تم حذف التكليف بنجاح");
  } catch (err) {
    serverError(res, err, "حذف التكليف");
  }
});

// جلب جميع التكليفات (مع فلترة دفعات للمستخدم الحالي)
router.get("/", auth, async (req, res) => {
  try {
    const filter = {};
    
    // إذا كان طالب أو ليدر، فلترة حسب دفعته
    if (req.user.roles.includes("student") || req.user.roles.includes("leader")) {
      const student = await User.findById(req.user.id).select("batch");
      if (student?.batch) {
        filter.batches = student.batch;
      }
    } else if (req.user.roles.includes("doctor") && !req.user.roles.includes("dean") && !req.user.roles.includes("admin")) {
      const Subject = require("../models/Subject");
      const mySubjects = await Subject.find({ doctor: req.user.id }).select("_id");
      filter.subject = { $in: mySubjects.map(s => s._id) };
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [assignments, total] = await Promise.all([
      Assignment.find(filter)
        .populate("subject", "name")
        .populate("addedBy", "name")
        .populate("batches", "name code")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Assignment.countDocuments(filter)
    ]);

    success(res, {
      assignments,
      pagination: { page, limit, total, pages: Math.ceil(total / limit), hasMore: page * limit < total }
    });
  } catch (err) {
    serverError(res, err, "جلب التكليفات");
  }
});

module.exports = router;

