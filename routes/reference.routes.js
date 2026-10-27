const mongoose = require("mongoose");
const router = require("express").Router();
const Reference = require("../models/Reference");
const Subject = require("../models/Subject");
const User = require("../models/User");
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const upload = require("../config/multer");
const { success, fail, notFound, serverError } = require("../utils/response");
const { uploadLimiter } = require("../middleware/rateLimiter");
const { getManageScope, canManageSubjectContent } = require("../utils/contentPermissions");
const fs = require("fs");

const discardUpload = (req) => { if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {}); };

// الرابط يُعرض كـ <a href>: http/https فقط
function safeLink(raw) {
  const v = String(raw || "").trim();
  if (!v) return { ok: true, value: null };
  try {
    const u = new URL(v);
    return ["http:", "https:"].includes(u.protocol) ? { ok: true, value: v } : { ok: false };
  } catch { return { ok: false }; }
}

/* من يضيف مرجعاً لأي مادة؟ كان أي دكتور أو ليدر يضيف لأي مادة في الكلية. */
async function canAddToSubject(user, subjectId) {
  if (user.roles.includes("dean") || user.roles.includes("admin")) return true;
  const subject = await Subject.findById(subjectId).select("doctor batches").lean();
  if (!subject) return false;
  if (user.roles.includes("doctor") && String(subject.doctor) === String(user.id)) return true;
  if (user.roles.includes("leader") && user.batch) {
    return (subject.batches || []).some(b => String(b) === String(user.batch));
  }
  return false;
}

// إضافة مرجع (عميد أو دكتور أو ليدر)
router.post("/", auth, role("dean", "doctor", "leader", "admin"), uploadLimiter, upload.single("file"), async (req, res) => {
  try {
    const { title, subject, link } = req.body;
    if (!title || !title.trim() || !subject) {
      discardUpload(req);
      return fail(res, "عنوان المرجع والمادة مطلوبان", 400);
    }
    if (!mongoose.Types.ObjectId.isValid(subject)) {
      discardUpload(req);
      return fail(res, "معرف المادة غير صالح", 400);
    }
    if (!(await canAddToSubject(req.user, subject))) {
      discardUpload(req);
      return fail(res, "غير مصرح لك بإضافة مراجع لهذه المادة", 403);
    }
    const cleanLink = safeLink(link);
    if (!cleanLink.ok) {
      discardUpload(req);
      return fail(res, "الرابط يجب أن يبدأ بـ http أو https", 400);
    }
    if (!req.file && !cleanLink.value) {
      return fail(res, "أرفق ملفاً أو رابطاً للمرجع", 400);
    }

    const reference = await Reference.create({
      title: title.trim(),
      subject,
      link: cleanLink.value,
      file: req.file ? req.file.filename : null,
      addedBy: req.user.id
    });

    return success(res, { reference }, "تم إضافة المرجع بنجاح", 201);
  } catch (err) {
    discardUpload(req);
    return serverError(res, err, "إضافة مرجع");
  }
});

// جلب مراجع مادة معينة
router.get("/by-subject/:subjectId", auth, async (req, res) => {
  try {
    const { subjectId } = req.params;

    if (!subjectId || subjectId === "null" || subjectId === "undefined" || !mongoose.Types.ObjectId.isValid(subjectId)) {
      return fail(res, "معرف المادة غير صالح", 400);
    }

    const filter = { subject: subjectId };
    
    if (req.user.roles.includes("student") || req.user.roles.includes("leader")) {
      const user = await User.findById(req.user.id).select("batch").lean();
      if (user?.batch) {
        const subject = await Subject.findById(subjectId).lean();
        if (!subject?.batches?.some(b => b.toString() === user.batch.toString())) {
          return fail(res, "غير مصرح لك باستعراض مراجع هذه المادة", 403);
        }
      } else filter._id = null;
    } else if (req.user.roles.includes("doctor") && !req.user.roles.includes("dean") && !req.user.roles.includes("admin")) {
      const subject = await Subject.findById(subjectId).lean();
      if (subject?.doctor?.toString() !== req.user.id) {
        return fail(res, "غير مصرح لك باستعراض مراجع مادة لا تدرسها", 403);
      }
    }

    const refs = await Reference.find(filter).sort({ createdAt: -1 });
    return success(res, { references: refs });
  } catch (error) {
    return serverError(res, error, "جلب مراجع المادة");
  }
});

// جلب كل المراجع (أي مستخدم مسجّل)
router.get("/", auth, async (req, res) => {
  try {
    const filter = {};
    if (req.user.roles.includes("student") || req.user.roles.includes("leader")) {
      const user = await User.findById(req.user.id).select("batch").lean();
      if (user?.batch) {
        const accessibleSubjects = await Subject.find({ batches: user.batch }).select("_id").lean();
        filter.subject = { $in: accessibleSubjects.map(s => s._id) };
      } else filter._id = null;
    } else if (req.user.roles.includes("doctor") && !req.user.roles.includes("dean") && !req.user.roles.includes("admin")) {
      const mySubjects = await Subject.find({ doctor: req.user.id }).select("_id").lean();
      filter.subject = { $in: mySubjects.map(s => s._id) };
    }

    const refs = await Reference.find(filter)
      .populate("subject", "name")
      .populate("addedBy", "name")
      .sort({ createdAt: -1 });

    return success(res, { references: refs });
  } catch (err) {
    return serverError(res, err, "جلب المراجع");
  }
});

// حذف مرجع
router.delete("/:id", auth, role("dean", "doctor", "admin", "leader"), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, "معرف المرجع غير صالح", 400);
    }
    const ref = await Reference.findById(req.params.id);
    if (!ref) return notFound(res, "المرجع غير موجود");

    // نفس قاعدة المحاضرات: العميد، من أضافه، دكتور المادة، ليدر دفعتها
    const subject = await Subject.findById(ref.subject).select("doctor batches").lean();
    if (!canManageSubjectContent(await getManageScope(req.user), { ownerId: ref.addedBy, subject })) {
      return fail(res, "غير مصرح لك بحذف هذا المرجع", 403);
    }

    await Reference.findByIdAndDelete(req.params.id);
    return success(res, null, "تم حذف المرجع بنجاح");
  } catch (err) {
    return serverError(res, err, "حذف المرجع");
  }
});

module.exports = router;
