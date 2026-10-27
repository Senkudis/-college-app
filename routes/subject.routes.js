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

    const isDeanOrAdmin = req.user.roles.includes("dean") || req.user.roles.includes("admin");
    if (!isDeanOrAdmin && targetBatches.some(batchId => !doctorBatches.map(String).includes(String(batchId)))) {
      return fail(res, "لا يمكنك ربط المادة بدفعة غير مخصصة لك", 403);
    }

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

    // إذا كان طالب، فلترة المواد حسب دفعته — وبلا دفعة لا شيء (كان يرى مواد الكلية كلها)
    if (req.user.roles.includes("student") || req.user.roles.includes("leader")) {
      const student = await User.findById(req.user.id).select("batch");
      if (student?.batch) {
        filter.batches = student.batch;
      } else {
        filter._id = null;
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

    const isDeanOrAdmin = req.user.roles.includes("dean") || req.user.roles.includes("admin");
    if (!isDeanOrAdmin && req.user.roles.includes("doctor")) {
      const doctorId = subject.doctor?._id || subject.doctor;
      if (!doctorId || String(doctorId) !== String(req.user.id)) {
        return fail(res, "غير مصرح لك بعرض هذه المادة", 403);
      }
    }

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

    /* كان req.body يُمرَّر كما هو: الدكتور يستطيع نقل المادة لدكتور آخر أو
       ربطها بأي دفعة في الكلية. نقبل حقولاً محددة فقط وبصلاحيات واضحة. */
    const isDeanOrAdmin = req.user.roles.includes("dean") || req.user.roles.includes("admin");
    const update = {};
    if (req.body.name !== undefined) {
      const name = String(req.body.name || "").trim();
      if (!name) return fail(res, "اسم المادة لا يمكن أن يكون فارغاً");
      update.name = name;
    }
    if (req.body.level !== undefined) {
      const level = String(req.body.level || "").trim();
      if (!level) return fail(res, "المستوى لا يمكن أن يكون فارغاً");
      update.level = level;
    }
    if (req.body.doctor !== undefined) {
      if (!isDeanOrAdmin) return fail(res, "تغيير أستاذ المادة من صلاحيات العميد", 403);
      const target = mongoose.Types.ObjectId.isValid(req.body.doctor)
        ? await User.findById(req.body.doctor).select("roles").lean() : null;
      if (!target || !target.roles?.includes("doctor")) return fail(res, "الدكتور المحدد غير موجود");
      update.doctor = req.body.doctor;
    }
    if (req.body.batches !== undefined) {
      if (!Array.isArray(req.body.batches) || req.body.batches.some(b => !mongoose.Types.ObjectId.isValid(b))) {
        return fail(res, "قائمة الدفعات غير صالحة");
      }
      if (!isDeanOrAdmin) {
        const me = await User.findById(req.user.id).select("batches").lean();
        const mine = new Set((me?.batches || []).map(String));
        if (req.body.batches.some(b => !mine.has(String(b)))) {
          return fail(res, "لا يمكنك ربط المادة بدفعة غير مخصصة لك", 403);
        }
      }
      update.batches = req.body.batches;
    }

    const subject = await Subject.findByIdAndUpdate(id, { $set: update }, { returnDocument: 'after', runValidators: true })
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

    /* حذف مادة تحتوي محاضرات وتكليفات يترك كل ذلك يتيماً (مادة null في
       الواجهات وتسليمات الطلاب). للدكتور: نرفض ما دام فيها محتوى؛ العميد يقرر. */
    const isDeanOrAdmin = req.user.roles.includes("dean") || req.user.roles.includes("admin");
    if (!isDeanOrAdmin) {
      const Lecture = require("../models/Lecture");
      const Assignment = require("../models/Assignment");
      const Quiz = require("../models/Quiz");
      const [lec, asg, qz] = await Promise.all([
        Lecture.countDocuments({ subject: id }),
        Assignment.countDocuments({ subject: id }),
        Quiz.countDocuments({ subject: id })
      ]);
      if (lec + asg + qz > 0) {
        return fail(res, `لا يمكن حذف المادة لأنها تحتوي ${lec} محاضرة و${asg} تكليف و${qz} اختبار — احذف المحتوى أولاً أو تواصل مع العميد`, 409);
      }
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

        const isDeanOrAdmin = req.user.roles.includes("dean") || req.user.roles.includes("admin");
    const filter = { batches: batchId };

    if (!isDeanOrAdmin) {
      const account = await User.findById(req.user.id).select("batch batches").lean();
      const ownedBatches = new Set([
        ...(account?.batches || []).map(String),
        account?.batch && String(account.batch)
      ].filter(Boolean));

      if (req.user.roles.includes("doctor")) {
        filter.doctor = req.user.id;
      } else if (req.user.roles.includes("student") || req.user.roles.includes("leader")) {
        if (!ownedBatches.has(String(batchId))) {
          return fail(res, "غير مصرح لك بعرض مواد هذه الدفعة", 403);
        }
      } else {
        return fail(res, "غير مصرح لك بعرض مواد هذه الدفعة", 403);
      }
    }

    const subjects = await Subject.find(filter)
      .populate("doctor", "name email")
      .populate("batches", "name code")
      .sort({ createdAt: -1 });

    success(res, { subjects });

  } catch (err) {
    serverError(res, err, "جلب مواد الدفعة");
  }
});

// استنساخ أو نقل مواد من دفعة لدفعة أخرى مع خيار استبدال المقررات القديمة
const handleCopyBatchSubjects = async (req, res) => {
  try {
    const { fromBatchId, toBatchId, replaceExisting = true } = req.body;

    if (!fromBatchId || !toBatchId) {
      return fail(res, "يجب تحديد الدفعة المصدر والدفعة الهدف");
    }
    if (!mongoose.Types.ObjectId.isValid(fromBatchId) || !mongoose.Types.ObjectId.isValid(toBatchId)) {
      return fail(res, "معرف الدفعة غير صالح");
    }

    if (fromBatchId.toString() === toBatchId.toString()) {
      return fail(res, "لا يمكن استيراد المقررات من نفس الدفعة");
    }

    // جلب جميع المواد الخاصة بالدفعة المصدر (دعم الحقلين batches و batch)
    const sourceSubjects = await Subject.find({
      $or: [{ batches: fromBatchId }, { batch: fromBatchId }]
    });
    if (sourceSubjects.length === 0) {
      return fail(res, "لا توجد مواد في الدفعة المصدر");
    }

    // إذا طُلب استبدال المقررات القديمة (إزالة مواد السمستر السابق من الدفعة)
    let removedCount = 0;
    if (replaceExisting) {
      const currentSubjects = await Subject.find({
        $or: [{ batches: toBatchId }, { batch: toBatchId }]
      });
      for (const curSub of currentSubjects) {
        if (Array.isArray(curSub.batches)) {
          curSub.batches = curSub.batches.filter(b => b.toString() !== toBatchId.toString());
        }
        if (curSub.batch && curSub.batch.toString() === toBatchId.toString()) {
          curSub.batch = null;
        }
        await curSub.save();
        removedCount++;
      }
    }

    // إضافة الدفعة الهدف إلى قائمة دفعات مواد الدفعة المصدر
    let updatedCount = 0;
    for (const sub of sourceSubjects) {
      if (!Array.isArray(sub.batches)) {
        sub.batches = sub.batch ? [sub.batch] : [];
      }
      if (!sub.batches.some(b => b.toString() === toBatchId.toString())) {
        sub.batches.push(toBatchId);
        await sub.save();
        updatedCount++;
      }
    }

    clearCache('/api/subjects');
    const msg = replaceExisting 
      ? `تمت إزالة المقررات القديمة واعتماد ${updatedCount} مقرر جديد للدفعة بنجاح`
      : `تم ربط ${updatedCount} مقرر بنجاح للدفعة الجديدة`;
    success(res, { updatedCount, removedCount }, msg);
  } catch (err) {
    serverError(res, err, "نقل مواد الدفعة");
  }
};

/* حُذف المسار المكرر "copy-bwtch-subjects" — خطأ مطبعي كان مثبّتاً في الـAPI
   للتوافق الخلفي، ولا تستدعيه أي صفحة في الواجهة. */
router.post("/copy-batch-subjects", auth, role("dean", "admin"), handleCopyBatchSubjects);

module.exports = router;

