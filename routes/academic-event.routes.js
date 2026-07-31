const router = require("express").Router();
const mongoose = require("mongoose");
const AcademicEvent = require("../models/AcademicEvent");
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const batch = require("../middleware/batch.middleware");
const { success, fail, notFound, serverError } = require("../utils/response");

router.use(auth, batch);

router.get("/", async (req, res) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date();
    const to = req.query.to ? new Date(req.query.to) : new Date(Date.now() + 1000 * 60 * 60 * 24 * 45);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      return fail(res, "نطاق التاريخ غير صالح");
    }

    const events = await AcademicEvent.find({ batch: req.activeBatch, startsAt: { $gte: from, $lte: to } })
      .populate("subject", "name")
      .populate("createdBy", "name")
      .sort({ startsAt: 1 })
      .limit(100);
    success(res, { events });
  } catch (err) {
    serverError(res, err, "جلب الفعاليات الأكاديمية");
  }
});

router.post("/", role("dean", "leader", "admin"), async (req, res) => {
  try {
    const { title, description, type, startsAt, endsAt, location, subject } = req.body;
    if (!title || !startsAt) return fail(res, "العنوان وموعد البداية مطلوبان");
    if (endsAt && new Date(endsAt) < new Date(startsAt)) return fail(res, "موعد النهاية يجب أن يكون بعد البداية");
    if (subject && !mongoose.Types.ObjectId.isValid(subject)) return fail(res, "معرف المادة غير صالح");

    const event = await AcademicEvent.create({
      title, description, type, startsAt, endsAt: endsAt || null, location, subject: subject || null,
      batch: req.activeBatch, createdBy: req.user.id
    });
    await event.populate("subject", "name");

    // Trigger notification
    try {
      const Notification = require("../models/Notification");
      await Notification.create({
        title: `فعالية جديدة: ${event.title}`,
        message: `تمت إضافة فعالية أكاديمية جديدة للجدول: ${event.title} في تاريخ ${event.startsAt}`,
        type: "normal",
        target: "students",
        batches: [req.activeBatch],
        createdBy: req.user.id
      });
    } catch (notifErr) {
      console.error("Failed to trigger academic event notification:", notifErr);
    }

    success(res, { event }, "تمت إضافة الفعالية إلى الجدول", 201);
  } catch (err) {
    serverError(res, err, "إنشاء فعالية أكاديمية");
  }
});

router.put("/:id", role("dean", "leader", "admin"), async (req, res) => {
  try {
    const event = await AcademicEvent.findOne({ _id: req.params.id, batch: req.activeBatch });
    if (!event) return notFound(res, "الفعالية غير موجودة");
    const isDeanOrLeader = req.user.roles && (req.user.roles.includes("dean") || req.user.roles.includes("admin") || req.user.roles.includes("leader"));
    if (!isDeanOrLeader && event.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "ليس لديك صلاحية لتعديل هذه الفعالية" });
    }
    const permitted = ["title", "description", "type", "startsAt", "endsAt", "location", "subject"];
    permitted.forEach((key) => { if (req.body[key] !== undefined) event[key] = req.body[key] || null; });
    if (event.endsAt && event.startsAt > event.endsAt) return fail(res, "موعد النهاية يجب أن يكون بعد البداية");
    await event.save();
    await event.populate("subject", "name");
    success(res, { event }, "تم تحديث الفعالية في الجدول");
  } catch (err) {
    serverError(res, err, "تحديث فعالية أكاديمية");
  }
});

router.delete("/:id", role("dean", "leader", "admin"), async (req, res) => {
  try {
    const event = await AcademicEvent.findOne({ _id: req.params.id, batch: req.activeBatch });
    if (!event) return notFound(res, "الفعالية غير موجودة");
    const isDeanOrLeader = req.user.roles && (req.user.roles.includes("dean") || req.user.roles.includes("admin") || req.user.roles.includes("leader"));
    if (!isDeanOrLeader && event.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "ليس لديك صلاحية لحذف هذه الفعالية" });
    }
    await event.deleteOne();
    success(res, null, "تم حذف الفعالية من الجدول");
  } catch (err) {
    serverError(res, err, "حذف فعالية أكاديمية");
  }
});

module.exports = router;

