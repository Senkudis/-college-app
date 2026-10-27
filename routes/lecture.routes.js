const router = require("express").Router();
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Lecture = require("../models/Lecture");
const Subject = require("../models/Subject");
const User = require("../models/User");
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const upload = require("../config/multer");
const { uploadLimiter } = require("../middleware/rateLimiter");
const { clearCache } = require("../middleware/cache.middleware");
const { success, fail, notFound, serverError } = require("../utils/response");

// الروابط تُعرض كـ <a href> — نقبل http/https فقط (لا javascript: ولا data:)
function cleanVideoUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return { ok: true, value: null };
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return { ok: false };
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

// ملف رُفع ثم رُفض الطلب لا يجب أن يبقى يتيماً على القرص
function discardUpload(req) {
  if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
}

// النص المستخرج من PDF قد يبلغ مئات الكيلوبايت لكل محاضرة — يخص المساعد الذكي لا القوائم
const LIST_FIELDS = "-extractedText";

async function getAccessibleSubjectFilter(user) {
  if (user.roles.includes("dean") || user.roles.includes("admin")) return {};
  if (user.roles.includes("doctor")) return { doctor: user.id };
  if (user.roles.includes("student") || user.roles.includes("leader")) {
    const account = await User.findById(user.id).select("batch").lean();
    return account?.batch ? { batches: account.batch } : { _id: null };
  }
  return { _id: null };
}

/* من يدير (يعدّل/يحذف) محاضرة — قاعدة واحدة يستخدمها التعديل والحذف والعرض.
   كانت القاعدة "من رفعها فقط"، فالليدر لا يحذف محاضرة رفعها الدكتور أو ليدر
   سابق في مواد دفعته (حتى الملف المكرر أو الخاطئ)، والدكتور لا يحذف ما رفعه
   الليدر في مادته — بينما يُسمح للليدر بإعادة ترتيبها كلها.
   - العميد/المسؤول: الكل
   - رافع المحاضرة: محاضرته
   - الدكتور: كل محاضرات المواد التي يدرّسها
   - الليدر: كل محاضرات مواد دفعته */
const { getManageScope, canManageSubjectContent } = require("../utils/contentPermissions");

// subject: كائن المادة (doctor, batches) أو null
function canManageLecture(scope, lecture, subject) {
  return canManageSubjectContent(scope, { ownerId: lecture.uploadedBy, subject });
}

// رفع محاضرة (يجب أن يكون العميد أو الدكتور أو الليدر)
router.post("/", auth, role("dean", "doctor", "leader", "admin"), uploadLimiter, upload.single("file"), async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const subjectId = req.body.subject;
    if (!title || !subjectId || !mongoose.Types.ObjectId.isValid(subjectId)) {
      discardUpload(req);
      return fail(res, "عنوان المحاضرة والمقرر الصحيح مطلوبان", 400);
    }

    const subject = await Subject.findById(subjectId).select("doctor batches");
    if (!subject) { discardUpload(req); return notFound(res, "المقرر غير موجود"); }

    const video = cleanVideoUrl(req.body.videoUrl);
    if (!video.ok) { discardUpload(req); return fail(res, "رابط الفيديو غير صالح", 400); }
    const videoUrl = video.value;
    if (!req.file && !videoUrl) {
      return fail(res, "أرفق ملف المحاضرة أو رابط فيديو", 400);
    }

    const isDean = req.user.roles.includes("dean") || req.user.roles.includes("admin");
    const isDoctor = req.user.roles.includes("doctor");
    const isLeader = req.user.roles.includes("leader");
    let permitted = isDean;

    // Doctors may upload only to their own subjects. Leaders may upload only
    // to subjects that belong to their assigned batch.
    if (!permitted && isDoctor) {
      permitted = Boolean(subject.doctor && subject.doctor.toString() === String(req.user.id));
    }
    if (!permitted && isLeader) {
      const leader = await User.findById(req.user.id).select("batch");
      permitted = Boolean(
        leader?.batch &&
        Array.isArray(subject.batches) &&
        subject.batches.some(batch => batch && batch.toString() === leader.batch.toString())
      );
    }
    if (!permitted) { discardUpload(req); return fail(res, "غير مصرح لك بالرفع لهذا المقرر", 403); }

    let extractedText = '';
    let fileHash = undefined;
    if (req.file) {
      const fileBuffer = fs.readFileSync(req.file.path);
      fileHash = crypto.createHash("md5").update(fileBuffer).digest("hex");

      const existingLecture = await Lecture.findOne({ subject: subjectId, fileHash });
      if (existingLecture) {
        fs.unlinkSync(req.file.path);
        return fail(res, `هذا الملف تم رفعه مسبقاً في هذا المقرر باسم: ${existingLecture.title}`, 400);
      }

      // استخراج نص الـ PDF تلقائياً ليتمكن المساعد الذكي من قراءته
      if (req.file.mimetype === 'application/pdf' || req.file.originalname?.toLowerCase().endsWith('.pdf')) {
        try {
          // pdf-parse@2 لا يُصدّر دالة؛ الاستدعاء المباشر كان يفشل صامتاً
          const { extractPdfText } = require('../utils/pdfText');
          extractedText = await extractPdfText(fileBuffer);
          console.log(`[Lecture] تم استخراج ${extractedText.length} حرف من الـ PDF: ${title}`);
        } catch (pdfErr) {
          console.warn('[Lecture] تعذّر قراءة الـ PDF:', pdfErr.message);
        }
      }
    }

    const lecture = await Lecture.create({
      title,
      subject: subjectId,
      videoUrl: videoUrl || null,
      file: req.file ? req.file.filename : null,
      fileHash,
      extractedText,
      uploadedBy: req.user.id
    });
    clearCache('/api/lectures');
    const out = lecture.toObject();
    delete out.extractedText;
    return success(res, out);
  } catch (err) {
    discardUpload(req);
    console.error("Lecture upload error:", err);
    return serverError(res, err, "رفع المحاضرة");
  }
});


// إعادة ترتيب المحاضرات (Bulk Reorder)
router.post("/reorder", auth, role("dean", "doctor", "leader", "admin"), async (req, res) => {
  try {
    const { lectureIds } = req.body;
    if (!Array.isArray(lectureIds) || !lectureIds.length) {
      return fail(res, "قائمة معرّفات المحاضرات مطلوبة", 400);
    }
    if (lectureIds.some(id => !mongoose.Types.ObjectId.isValid(id))) {
      return fail(res, "قائمة المعرّفات تحتوي قيمة غير صالحة", 400);
    }

    const lectures = await Lecture.find({ _id: { $in: lectureIds } }).select("subject");
    if (lectures.length !== lectureIds.length) {
      return fail(res, "بعض المحاضرات غير موجودة", 404);
    }

    /* الترتيب رقم داخل المادة الواحدة. السماح بترتيب محاضرات من مواد مختلفة
       في نداء واحد كان ينتج أرقاماً متداخلة بلا معنى، ولذلك نرفضه صراحةً. */
    const subjectIds = [...new Set(lectures.map(l => l.subject.toString()))];
    if (subjectIds.length > 1) {
      return fail(res, "لا يمكن ترتيب محاضرات من مواد مختلفة معاً — اختر مادة واحدة", 400);
    }

    /* التحقق من الصلاحية: المسار كان يسمح لأي دكتور أو ليدر بإعادة ترتيب
       محاضرات أي مادة، حتى مادة لا يُدرّسها. */
    const subjectFilter = await getAccessibleSubjectFilter(req.user);
    const allowed = await Subject.findOne({ ...subjectFilter, _id: subjectIds[0] }).select("_id");
    if (!allowed) return fail(res, "غير مصرح لك بترتيب محاضرات هذه المادة", 403);

    await Promise.all(
      lectureIds.map((id, index) => Lecture.findByIdAndUpdate(id, { order: index }))
    );
    clearCache('/api/lectures');
    return success(res, null, "تم ترتيب المحاضرات بنجاح");
  } catch (err) {
    return serverError(res, err, "إعادة ترتيب المحاضرات");
  }
});

// تعديل أو إعادة تسمية محاضرة
router.put("/:id", auth, role("dean", "doctor", "leader", "admin"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return fail(res, "معرّف غير صالح", 400);

    const lecture = await Lecture.findById(id);
    if (!lecture) return notFound(res, "المحاضرة غير موجودة");

    const subject = await Subject.findById(lecture.subject).select("doctor batches").lean();
    if (!canManageLecture(await getManageScope(req.user), lecture, subject)) {
      return fail(res, "لا تملك صلاحية تعديل هذه المحاضرة", 403);
    }

    const { title, videoUrl, order } = req.body;
    if (title !== undefined) {
      const cleanTitle = String(title || "").trim();
      if (!cleanTitle) return fail(res, "عنوان المحاضرة لا يمكن أن يكون فارغاً", 400);
      lecture.title = cleanTitle;
    }
    if (videoUrl !== undefined) {
      const video = cleanVideoUrl(videoUrl);
      if (!video.ok) return fail(res, "رابط الفيديو غير صالح", 400);
      lecture.videoUrl = video.value;
    }
    if (order !== undefined && !isNaN(Number(order))) {
      lecture.order = Number(order);
    }

    await lecture.save();
    clearCache('/api/lectures');
    return success(res, lecture, "تم تعديل المحاضرة بنجاح");
  } catch (err) {
    return serverError(res, err, "تعديل المحاضرة");
  }
});

// جلب جميع المحاضرات
router.get("/", auth, async (req, res) => {
  try {
    const subjectFilter = await getAccessibleSubjectFilter(req.user);
    const accessibleSubjects = await Subject.find(subjectFilter).select("_id");
    const accessibleIds = accessibleSubjects.map(subject => subject._id);

    /* دعم التصفية بمادة واحدة: بدونها كانت الصفحة تعرض محاضرات كل المواد
       مختلطة، ويستحيل ترتيبها ترتيباً ذا معنى. */
    let filter = { subject: { $in: accessibleIds } };
    const requestedSubject = req.query.subject;
    if (requestedSubject) {
      if (!mongoose.Types.ObjectId.isValid(requestedSubject)) {
        return fail(res, "معرّف مادة غير صالح", 400);
      }
      const allowed = accessibleIds.some(id => id.toString() === requestedSubject);
      if (!allowed) return fail(res, "غير مصرح لك بهذه المادة", 403);
      filter = { subject: new mongoose.Types.ObjectId(requestedSubject) };
    }

    /* الترتيب حسب المادة أولاً: حقل order رقم داخل المادة الواحدة، فترتيب
       عالمي عبر المواد كان يُشابك محاضرات المواد ببعضها بلا معنى. */
    const lectures = await Lecture.find(filter)
      .select(LIST_FIELDS)
      .populate("subject", "name doctor batches")
      .sort({ subject: 1, order: 1, createdAt: 1 })
      .lean();

    /* canManage لكل محاضرة من نفس قاعدة الخادم: الواجهة كانت تحسبها بنفسها
       ("من رفعها فقط") فتختفي أزرار الحذف عن الليدر والدكتور. */
    const scope = await getManageScope(req.user);
    res.json(lectures.map(l => {
      const canManage = canManageLecture(scope, l, l.subject);
      const { doctor, batches, ...subjectPublic } = l.subject || {};
      return { ...l, subject: l.subject ? subjectPublic : l.subject, canManage };
    }));
  } catch (err) {
    serverError(res, err, "جلب المحاضرات");
  }
});

// حذف محاضرة
router.delete("/:id", auth, role("dean", "doctor", "leader", "admin"), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return fail(res, "معرّف غير صالح", 400);
    const lecture = await Lecture.findById(req.params.id);
    if (!lecture) return notFound(res, 'المحاضرة غير موجودة');

    const subject = await Subject.findById(lecture.subject).select("doctor batches").lean();
    if (!canManageLecture(await getManageScope(req.user), lecture, subject)) {
      return fail(res, "لا تملك صلاحية حذف هذه المحاضرة", 403);
    }

    // حذف الملف المرتبط من القرص
    if (lecture.file) {
      const filePath = path.join(__dirname, '..', 'uploads', 'lectures', lecture.file);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
    }

    await Lecture.findByIdAndDelete(req.params.id);
    clearCache('/api/lectures');
    success(res, null, 'تم حذف المحاضرة');
  } catch (err) {
    serverError(res, err, 'حذف محاضرة');
  }
});

// جلب محاضرات مادة معينة (مرتبة حسب الترتيب المعتمد للمقرر)
router.get("/by-subject/:subjectId", auth, async (req, res) => {
  try {
    const { subjectId } = req.params;
    
    // التحقق: إذا كان المعرف "null" أو غير صالح، نرجع قائمة فارغة فوراً
    if (!subjectId || subjectId === "null" || subjectId === "undefined" || !mongoose.Types.ObjectId.isValid(subjectId)) {
      return res.json([]); 
    }

    const subjectFilter = await getAccessibleSubjectFilter(req.user);
    const allowedSubject = await Subject.findOne({ _id: subjectId, ...subjectFilter }).select('_id');
    if (!allowedSubject) {
      return res.status(403).json({ success: false, message: "غير مصرح لك بعرض محاضرات هذا المقرر" });
    }

    const lectures = await Lecture.find({ subject: subjectId }).select(LIST_FIELDS).sort({ order: 1, createdAt: 1 });
    
    res.json(lectures);
  } catch (err) {
    console.error("Lecture Error:", err.message);
    serverError(res, err, "جلب محاضرات المقرر");
  }
});

module.exports = router;

