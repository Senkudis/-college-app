const router = require("express").Router();
const Subject = require("../models/Subject");
const User = require("../models/User");
const auth = require("../middleware/auth.middleware");
const mongoose = require("mongoose");
const { success, fail, notFound, serverError } = require("../utils/response");
const { verifySubjectAccess } = require("../middleware/ownership.middleware");
const { cacheRoute, clearCache } = require("../middleware/cache.middleware");
const role = require("../middleware/role.middleware");

// إنشاء مادة (عميد أو دكتور)
router.post("/", auth, role("dean", "doctor", "admin"), async (req, res) => {
  try {
    const { name, level, doctor } = req.body;

    if (!name || !level) {
      return fail(res, "اسم المادة والمستوى مطلوبان");
    }

    // إذا كان دكتور، استخدم موقعه؛ إذا عميد، استخدم doctor من body أو موقعه
    let subjectDoctor = req.user.id;
    if ((req.user.roles.includes("dean") || req.user.roles.includes("admin")) && doctor) {
      const targetDoctor = await User.findById(doctor);
      if (!targetDoctor || !targetDoctor.roles.includes("doctor")) {
        return fail(res, "الدكتور المحدد غير موجود");
      }
      subjectDoctor = doctor;
    }

    // جلب دفعات الدكتور لربط المادة بها تلقائياً في حال لم يتم تحديد دفعات
    const subjectDoctorUser = await User.findById(subjectDoctor).select("batches");
    const doctorBatches = subjectDoctorUser?.batches || [];
    
    // استخدام الدفعات المرسلة من الواجهة، وإلا استخدام دفعات الدكتور
    const targetBatches = (req.body.batches && Array.isArray(req.body.batches)) 
      ? req.body.batches 
      : doctorBatches;

    const subject = await Subject.create({
      name: name.trim(),
      level: level.trim(),
      doctor: subjectDoctor,
      batches: targetBatches
    });

    await subject.populate("doctor", "name email");

    clearCache('/api/subjects'); // مسح الكاش لتحديث القائمة

    success(res, { subject }, "تم إنشاء المادة بنجاح", 201);
  } catch (err) {
    serverError(res, err, "إنشاء مادة");
  }
});

// جلب كل المواد (أي مستخدم مسجّل) - مع Pagination
router.get("/", auth, cacheRoute(120), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 30));
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.doctor) filter.doctor = req.query.doctor;
    if (req.query.level) filter.level = req.query.level;
    if (req.query.batch) filter.batches = req.query.batch;

    // إذا كان طالب، فلترة المواد حسب دفعته
    if (req.user.roles.includes("student") || req.user.roles.includes("leader")) {
      const student = await User.findById(req.user.id).select("batch");
      if (student?.batch) {
        filter.batches = student.batch;
      }
    }
    
    // إذا كان دكتور (وليس عميداً)، فلترة المواد الخاصة به فقط
    if (req.user.roles.includes("doctor") && !req.user.roles.includes("dean") && !req.user.roles.includes("admin")) {
      filter.doctor = req.user.id;
    }

    const [subjects, total] = await Promise.all([
      Subject.find(filter)
        .populate("doctor", "name email")
        .populate("batches", "name code")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Subject.countDocuments(filter)
    ]);

    success(res, {
      subjects,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasMore: page * limit < total
      }
    });
  } catch (err) {
    serverError(res, err, "جلب المواد");
  }
});

// جلب مادة واحدة
router.get("/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || id === "null" || id === "undefined" || !mongoose.Types.ObjectId.isValid(id)) {
      return fail(res, "معرف المادة غير صالح");
    }

    const subject = await Subject.findById(id)
      .populate("doctor", "name email")
      .populate("batches", "name code themeColor");

    if (!subject) return notFound(res, "المادة غير موجودة");

    // تحقق من انتماء الطالب للمادة
    if (req.user.roles.includes("student") || req.user.roles.includes("leader")) {
      const student = await User.findById(req.user.id).select("batch");
      if (!student || !student.batch || !subject.batches.some(b => b._id.toString() === student.batch.toString())) {
        return fail(res, "غير مصرح لك بعرض هذه المادة", 403);
      }
    }

    success(res, { subject });
  } catch (err) {
    serverError(res, err, "جلب مادة");
  }
});

// تحديث مادة (عميد أو دكتور)
router.put("/:id", auth, role("dean", "doctor", "admin"), verifySubjectAccess, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || id === "null" || id === "undefined" || !mongoose.Types.ObjectId.isValid(id)) {
      return fail(res, "معرف المادة غير صالح");
    }

    const subject = await Subject.findByIdAndUpdate(id, req.body, { returnDocument: 'after' })
      .populate("doctor", "name email")
      .populate("batches", "name code");

    if (!subject) return notFound(res, "المادة غير موجودة");

    clearCache('/api/subjects');

    success(res, { subject }, "تم تحديث المادة");
  } catch (err) {
    serverError(res, err, "تحديث مادة");
  }
});

// حذف مادة (عميد أو دكتور)
router.delete("/:id", auth, role("dean", "doctor", "admin"), verifySubjectAccess, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || id === "null" || id === "undefined" || !mongoose.Types.ObjectId.isValid(id)) {
      return fail(res, "معرف المادة غير صالح");
    }

    const subject = await Subject.findByIdAndDelete(id);
    if (!subject) return notFound(res, "المادة غير موجودة");

    clearCache('/api/subjects');

    success(res, null, "تم حذف المادة بنجاح");
  } catch (err) {
    serverError(res, err, "حذف مادة");
  }
});

// جلب مواد حسب الدفعة
router.get("/by-batch/:batchId", auth, async (req, res) => {
  try {
    const { batchId } = req.params;

    if (!batchId || !mongoose.Types.ObjectId.isValid(batchId)) {
      return fail(res, "معرف الدفعة غير صالح");
    }

    const subjects = await Subject.find({ batches: batchId })
      .populate("doctor", "name email")
      .populate("batches", "name code")
      .sort({ createdAt: -1 });

    success(res, { subjects });
  } catch (err) {
    serverError(res, err, "جلب مواد الدفعة");
  }
});

module.exports = router;

