/**
 * moderation.routes.js — الإبلاغ عن المحتوى المسيء وحظر المستخدمين.
 *
 * سبب وجوده: App Store Review Guideline 1.2 يشترط في أي تطبيق يعرض
 * محتوى ينشئه المستخدمون ثلاثة أمور مجتمعة، وغيابها سبب رفض متكرر:
 *   1. وسيلة للإبلاغ عن المحتوى المسيء.
 *   2. وسيلة لحظر المستخدم المسيء.
 *   3. التزام معلن بمراجعة البلاغات وإزالة المخالف خلال 24 ساعة.
 * التطبيق يتيح تعليقات الفيديو وصور المعرض ومهام غرف المذاكرة، فيلزمه
 * كل ذلك. (نفس المتطلب موجود لدى Google Play ضمن سياسة UGC.)
 */
const router = require("express").Router();
const mongoose = require("mongoose");
const ContentReport = require("../models/ContentReport");
const User = require("../models/User");
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const { success, fail, notFound, serverError } = require("../utils/response");

/* المهلة المعلنة للبت في البلاغ — تُعرض للمستخدم وتُذكر في سياسة
   الخصوصية وصفحة المتجر، فتُقرأ من مكان واحد. */
const REVIEW_SLA_HOURS = 24;

/* يجلب المستند المُبلَّغ عنه من مجموعته ويعيد نصاً مختصراً وصاحبه. */
async function loadTarget(targetType, targetId) {
  if (targetType === "comment") {
    const doc = await mongoose.model("VideoComment").findById(targetId).lean();
    return doc && { author: doc.author, snapshot: doc.text || "" };
  }
  if (targetType === "gallery") {
    const doc = await mongoose.model("PublicGallery").findById(targetId).lean();
    return doc && { author: doc.uploadedBy, snapshot: doc.caption || doc.imageUrl || "" };
  }
  if (targetType === "pod-task") {
    const pod = await mongoose.model("StudyPod").findOne({ "tasks.id": String(targetId) }).lean();
    const task = pod?.tasks?.find(t => String(t.id) === String(targetId));
    return task && { author: pod.createdBy, snapshot: task.title || "" };
  }
  if (targetType === "user") {
    const doc = await User.findById(targetId).select("name").lean();
    return doc && { author: doc._id, snapshot: doc.name || "" };
  }
  return null;
}

/* يحذف المحتوى المخالف فعلياً بعد قبول البلاغ. */
async function removeTarget(targetType, targetId) {
  if (targetType === "comment") {
    return !!(await mongoose.model("VideoComment").findByIdAndDelete(targetId));
  }
  if (targetType === "gallery") {
    return !!(await mongoose.model("PublicGallery").findByIdAndUpdate(targetId, { isVisible: false }));
  }
  if (targetType === "pod-task") {
    const res = await mongoose.model("StudyPod").updateOne(
      { "tasks.id": String(targetId) },
      { $pull: { tasks: { id: String(targetId) } } }
    );
    return res.modifiedCount > 0;
  }
  // "user" لا يُحذف بالبلاغ — الإيقاف قرار إداري منفصل عبر إدارة المستخدمين
  return false;
}

// ============ الإبلاغ (متاح لأي مستخدم مسجّل) ============

// POST /api/moderation/report
router.post("/report", auth, async (req, res) => {
  try {
    const { targetType, targetId, reason, details } = req.body;

    const allowedTypes = ["comment", "gallery", "pod-task", "user"];
    const allowedReasons = ["spam", "harassment", "hate", "sexual", "violence", "cheating", "other"];
    if (!allowedTypes.includes(targetType)) return fail(res, "نوع المحتوى غير صالح");
    if (!allowedReasons.includes(reason)) return fail(res, "يرجى اختيار سبب الإبلاغ");

    /* مهام غرف المذاكرة تحمل معرّفاً نصياً لا ObjectId، فاشتراط ObjectId
       هنا كان يرفض كل بلاغ عليها. نتحقق من الشكل حسب نوع المحتوى. */
    const idStr = String(targetId || "").trim();
    if (!idStr || idStr.length > 64) return fail(res, "معرّف المحتوى غير صالح");
    if (targetType !== "pod-task" && !mongoose.Types.ObjectId.isValid(idStr)) {
      return fail(res, "معرّف المحتوى غير صالح");
    }

    const target = await loadTarget(targetType, idStr);
    if (!target) return notFound(res, "المحتوى غير موجود أو حُذف مسبقاً");

    if (String(target.author) === String(req.user.id)) {
      return fail(res, "لا يمكنك الإبلاغ عن محتواك أنت");
    }

    const report = await ContentReport.create({
      targetType,
      targetId: idStr,
      targetAuthor: target.author || null,
      snapshot: String(target.snapshot || "").slice(0, 2000),
      reportedBy: req.user.id,
      reason,
      details: details ? String(details).trim().slice(0, 1000) : ""
    });

    return success(
      res,
      { reportId: report._id, reviewWithinHours: REVIEW_SLA_HOURS },
      `تم استلام بلاغك. تُراجَع البلاغات ويُزال المحتوى المخالف خلال ${REVIEW_SLA_HOURS} ساعة.`,
      201
    );
  } catch (err) {
    // بلاغ مكرر من نفس المستخدم على نفس المحتوى
    if (err.code === 11000) {
      return success(res, null, "سبق أن أبلغت عن هذا المحتوى، وبلاغك قيد المراجعة.");
    }
    return serverError(res, err, "الإبلاغ عن محتوى");
  }
});

// ============ الحظر (قرار شخصي لكل مستخدم) ============

// POST /api/moderation/block/:userId
router.post("/block/:userId", auth, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) return fail(res, "معرّف المستخدم غير صالح");
    if (String(userId) === String(req.user.id)) return fail(res, "لا يمكنك حظر نفسك");

    const target = await User.findById(userId).select("_id name").lean();
    if (!target) return notFound(res, "المستخدم غير موجود");

    await User.findByIdAndUpdate(req.user.id, { $addToSet: { blockedUsers: userId } });
    return success(res, { blocked: userId }, `تم حظر ${target.name}. لن يظهر لك محتواه بعد الآن.`);
  } catch (err) {
    return serverError(res, err, "حظر مستخدم");
  }
});

// DELETE /api/moderation/block/:userId
router.delete("/block/:userId", auth, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) return fail(res, "معرّف المستخدم غير صالح");
    await User.findByIdAndUpdate(req.user.id, { $pull: { blockedUsers: userId } });
    return success(res, { unblocked: userId }, "تم إلغاء الحظر");
  } catch (err) {
    return serverError(res, err, "إلغاء حظر");
  }
});

// GET /api/moderation/blocked — قائمة من حظرهم المستخدم
router.get("/blocked", auth, async (req, res) => {
  try {
    const me = await User.findById(req.user.id).select("blockedUsers")
      .populate("blockedUsers", "name email").lean();
    return success(res, { blocked: me?.blockedUsers || [] });
  } catch (err) {
    return serverError(res, err, "جلب قائمة المحظورين");
  }
});

// ============ طابور المراجعة (الإدارة) ============

// GET /api/moderation/reports?status=pending
router.get("/reports", auth, role("dean", "admin"), async (req, res) => {
  try {
    const status = ["pending", "removed", "dismissed"].includes(req.query.status)
      ? req.query.status : "pending";

    const reports = await ContentReport.find({ status })
      .populate("reportedBy", "name email")
      .populate("targetAuthor", "name email")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    // كم بلاغ تجاوز المهلة المعلنة؟ رقم يهم الإدارة ويهم مراجع المتجر
    const overdueBefore = new Date(Date.now() - REVIEW_SLA_HOURS * 3600 * 1000);
    const overdue = reports.filter(r => r.status === "pending" && new Date(r.createdAt) < overdueBefore).length;

    return success(res, { reports, count: reports.length, overdue, slaHours: REVIEW_SLA_HOURS });
  } catch (err) {
    return serverError(res, err, "جلب البلاغات");
  }
});

// POST /api/moderation/reports/:id/action  { action: "remove" | "dismiss", note }
router.post("/reports/:id/action", auth, role("dean", "admin"), async (req, res) => {
  try {
    const { action, note } = req.body;
    if (!["remove", "dismiss"].includes(action)) {
      return fail(res, "الإجراء غير صالح. القيم المسموحة: remove أو dismiss");
    }

    const report = await ContentReport.findById(req.params.id);
    if (!report) return notFound(res, "البلاغ غير موجود");
    if (report.status !== "pending") return fail(res, "تم البتّ في هذا البلاغ مسبقاً", 409);

    let removed = false;
    if (action === "remove") {
      removed = await removeTarget(report.targetType, report.targetId);
      /* نُغلق كل البلاغات الأخرى على نفس المحتوى: تركها معلّقة كان
         سيُبقي طابور المراجعة منتفخاً ببلاغات عن محتوى لم يعد موجوداً. */
      await ContentReport.updateMany(
        { targetType: report.targetType, targetId: report.targetId, status: "pending", _id: { $ne: report._id } },
        { $set: { status: "removed", reviewedBy: req.user.id, reviewedAt: new Date(), reviewNote: "أُزيل ضمن بلاغ آخر" } }
      );
    }

    report.status = action === "remove" ? "removed" : "dismissed";
    report.reviewedBy = req.user.id;
    report.reviewedAt = new Date();
    report.reviewNote = note ? String(note).trim().slice(0, 500) : "";
    await report.save();

    return success(res, { report, contentRemoved: removed },
      action === "remove" ? "أُزيل المحتوى المخالف" : "رُفض البلاغ");
  } catch (err) {
    return serverError(res, err, "معالجة بلاغ");
  }
});

module.exports = router;
module.exports.REVIEW_SLA_HOURS = REVIEW_SLA_HOURS;
