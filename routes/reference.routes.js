const mongoose = require("mongoose");
const router = require("express").Router();
const Reference = require("../models/Reference");
const Subject = require("../models/Subject");
const User = require("../models/User");
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const upload = require("../config/multer");

// إضافة مرجع (عميد أو ليدر)
// رفع محاضرة (يجب أن يكون العميد أو الدكتور أو الليدر)
router.post("/", auth, role("dean", "doctor", "leader"), upload.single("file"), async (req, res) => {
  // العملية لإضافة المحاضرة هنا
  try {
    const reference = await Reference.create({
      title: req.body.title,
      subject: req.body.subject,
      link: req.body.link,
      file: req.file ? req.file.filename : null,
      addedBy: req.user.id
    });

    res.json(reference);
  } catch (err) {
    res.status(400).json({ message: "فشل إضافة المرجع" });
  }
});
// جلب مراجع مادة معينة
router.get("/by-subject/:subjectId", auth, async (req, res) => {
  try {
    const { subjectId } = req.params;

    // التحقق: إذا كان المعرف "null" أو غير صالح، نرجع رسالة خطأ بدلاً من استرجاع بيانات خاطئة
    if (!subjectId || subjectId === "null" || subjectId === "undefined" || !mongoose.Types.ObjectId.isValid(subjectId)) {
      return res.status(400).json({ message: "معرف المادة غير صالح" }); // إرجاع رسالة خطأ واضحة
    }

    const filter = { subject: subjectId };
    
    if (req.user.roles.includes("student") || req.user.roles.includes("leader")) {
      const user = await User.findById(req.user.id).select("batch").lean();
      if (user?.batch) {
        const subject = await Subject.findById(subjectId).lean();
        if (!subject?.batches?.some(b => b.toString() === user.batch.toString())) {
          return res.status(403).json({ message: "غير مصرح لك باستعراض مراجع هذه المادة" });
        }
      } else filter._id = null;
    } else if (req.user.roles.includes("doctor") && !req.user.roles.includes("dean") && !req.user.roles.includes("admin")) {
      const subject = await Subject.findById(subjectId).lean();
      if (subject?.doctor?.toString() !== req.user.id) {
         return res.status(403).json({ message: "غير مصرح لك باستعراض مراجع مادة لا تدرسها" });
      }
    }

    const refs = await Reference.find(filter).sort({ createdAt: -1 });

    res.json(refs);
  } catch (error) {
    console.error("Error fetching references:", error);
    res.status(500).json({ message: "خطأ في السيرفر" }); // إرجاع رسالة خطأ في السيرفر
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
      .populate("addedBy", "name");

    res.json(refs);
  } catch (err) {
    res.status(500).json({ message: "فشل جلب المراجع" });
  }
});

// حذف مرجع
router.delete("/:id", auth, role("dean", "doctor", "admin", "leader"), async (req, res) => {
  try {
    const ref = await Reference.findById(req.params.id);
    if (!ref) return res.status(404).json({ message: "المرجع غير موجود" });

    // Permissions
    if (!req.user.roles.includes("dean") && !req.user.roles.includes("admin")) {
      if (ref.addedBy.toString() !== req.user.id) {
        return res.status(403).json({ message: "غير مصرح لك بحذف هذا المرجع" });
      }
    }

    await Reference.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "تم حذف المرجع بنجاح" });
  } catch (err) {
    res.status(500).json({ message: "فشل الحذف" });
  }
});



module.exports = router;
