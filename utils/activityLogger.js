const ActivityLog = require("../models/ActivityLog");
const User = require("../models/User");

/**
 * تسجيل نشاط للمستخدم في قاعدة البيانات بشكل غير متزامن ولا يعرقل الاستجابة
 * @param {string} userId - معرف المستخدم
 * @param {string} action - نوع النشاط: USER_LOGIN, VIDEO_VIEWED, QUIZ_ATTEMPTED, ASSIGNMENT_SUBMITTED
 * @param {Object} details - تفاصيل إضافية (مثل عنوان الفيديو أو الواجب)
 * @param {string} batchId - (اختياري) معرف الدفعة
 */
async function logActivity(userId, action, details = {}, batchId = null) {
  try {
    if (!userId || !action) return;

    let bId = batchId;
    if (!bId) {
      const user = await User.findById(userId).select("batch").lean();
      if (user?.batch) bId = user.batch;
    }

    await ActivityLog.create({
      user: userId,
      action,
      batch: bId || undefined,
      details
    });
  } catch (err) {
    console.error("[ActivityLogger] Error logging activity:", err.message);
  }
}

module.exports = { logActivity };
