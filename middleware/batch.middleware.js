const Batch = require("../models/Batch");
const User = require("../models/User");

/**
 * Middleware to validate batch access and set req.activeBatch.
 * - Student: batch is taken automatically from their profile (user.batch).
 * - Doctor: must pass ?batch= and must be assigned to that batch.
 * - Dean/Leader: can access any batch; if only 1 active batch exists, auto-selected.
 * - Blocks access to archived batches for all roles.
 */
module.exports = async (req, res, next) => {
  try {
    /* دور "admin" موجود في enum الأدوار ويُعامَل في كل الواجهة معاملة العميد،
       لكنه لم يكن مذكوراً في أي فرع هنا — فكان المسؤول يسقط حتى النهاية ويحصل
       على 403 "صلاحيات غير كافية" في كل المسارات المرتبطة بدفعة
       (الاختبارات، الفعاليات، الحرم، التعليقات، الفيديوهات). */
    const isDeanLevel = req.user.roles.includes("dean") || req.user.roles.includes("admin");

    // 1. Determine requested batch ID from URL param, header, or body
    let requestedBatchId =
      req.query.batch ||
      req.headers["x-batch-id"] ||
      (req.body && req.body.batch);

    if (requestedBatchId === "undefined" || requestedBatchId === "null" || requestedBatchId === "[object Object]" || !requestedBatchId) {
      requestedBatchId = null;
    }

    // 2. Students & Leaders → always use their own batch from DB (ignore any passed batch param)
    if (req.user.roles.includes("student") || req.user.roles.includes("leader")) {
      const user = await User.findById(req.user.id).select("batch").lean();
      if (!user || !user.batch) {
        return res.status(403).json({ success: false, message: "حسابك غير مرتبط بأي دفعة" });
      }
      // تجاهل أي batch-id قادم من الـ header — الليدر/الطالب لهم دفعة واحدة ثابتة في DB
      req.activeBatch = user.batch;
      
      // Check if student's/leader's batch is archived
      const batch = await Batch.findById(user.batch).select("status").lean();
      if (batch && batch.status === "archived") {
        return res.status(403).json({ success: false, message: "هذه الدفعة مؤرشفة — لا يمكن الوصول لمحتواها" });
      }
      
      return next();
    }

    // 3. If a batch was explicitly provided, validate it
    if (requestedBatchId) {
      const batch = await Batch.findById(requestedBatchId).lean();
      if (!batch) {
        return res.status(404).json({ success: false, message: "الدفعة المطلوبة غير موجودة" });
      }

      // Block archived batches
      if (batch.status === "archived") {
        return res.status(403).json({ success: false, message: "هذه الدفعة مؤرشفة — لا يمكن الوصول لمحتواها" });
      }

      // Dean/Admin → full access to any batch
      if (isDeanLevel) {
        req.activeBatch = batch._id;
        return next();
      }

      // Doctor → the dean assigns batches. A URL must never grant access.
      if (req.user.roles.includes("doctor")) {
        const user = await User.findById(req.user.id).select("batches").lean();
        const hasAccess = user && user.batches && user.batches.some(b => b && b.toString() === requestedBatchId.toString());
        if (!hasAccess) {
          return res.status(403).json({ success: false, message: "غير مصرح لك بالوصول إلى هذه الدفعة" });
        }
        req.activeBatch = batch._id;
        return next();
      }
    }

    // 4. No batch param provided — try to auto-select

    // Dean/Admin: auto-pick only if exactly 1 active batch exists
    if (isDeanLevel) {
      const batches = await Batch.find({ status: "active" }).select("_id").lean();
      if (batches.length === 1) {
        req.activeBatch = batches[0]._id;
        return next();
      }
      return res.status(400).json({ success: false, message: "يرجى تحديد الدفعة أولاً (?batch=ID)" });
    }

    // Doctor: auto-pick only if assigned to exactly 1 batch
    if (req.user.roles.includes("doctor")) {
      const user = await User.findById(req.user.id).select("batches").lean();
      if (user && user.batches && user.batches.length === 1) {
        req.activeBatch = user.batches[0];
        return next();
      }
      return res.status(400).json({ success: false, message: "يرجى تحديد الدفعة أولاً (?batch=ID)" });
    }

    return res.status(403).json({ success: false, message: "صلاحيات غير كافية" });
  } catch (err) {
    console.error("Batch Middleware Error:", err);
    res.status(500).json({ success: false, message: "خطأ في التحقق من مساحة العمل" });
  }
};
