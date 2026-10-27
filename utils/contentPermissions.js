/**
 * utils/contentPermissions.js
 * من يدير (يعدّل/يحذف) محتوى مادة: محاضرة، مرجع، فيديو.
 *
 * كانت كل نوع محتوى يطبّق "من رفعه فقط"، فالليدر لا يحذف ملفاً مكرراً أو
 * خاطئاً رفعه الدكتور أو ليدر سابق في مواد دفعته، والدكتور لا يحذف ما رفعه
 * الليدر في مادته. القاعدة الموحّدة (اعتمدها صاحب النظام 2026-10-14):
 *   - العميد/المسؤول: الكل
 *   - رافع المحتوى: محتواه
 *   - الدكتور: كل محتوى المواد التي يدرّسها
 *   - الليدر: كل محتوى مواد دفعته
 * التكليفات مستثناة عمداً: عمل مُقيَّم مرتبط بتسليمات الطلاب (انظر assignment.routes).
 */
const User = require("../models/User");

async function getManageScope(user) {
  const roles = user.roles || [];
  const scope = {
    all: roles.includes("dean") || roles.includes("admin"),
    userId: String(user.id),
    doctor: roles.includes("doctor"),
    leaderBatch: null
  };
  if (!scope.all && roles.includes("leader")) {
    const batch = user.batch || (await User.findById(user.id).select("batch").lean())?.batch;
    scope.leaderBatch = batch ? String(batch?._id || batch) : null;
  }
  return scope;
}

const idOf = v => String(v?._id || v || "");

/**
 * ownerId: من رفع/أضاف المحتوى. subject: المادة {doctor, batches} أو null.
 * extraBatches: دفعات المحتوى نفسه إن وُجدت (الفيديو يحمل batches خاصة به).
 */
function canManageSubjectContent(scope, { ownerId, subject, extraBatches = [] }) {
  if (scope.all) return true;
  if (ownerId && idOf(ownerId) === scope.userId) return true;
  if (!subject) return false;
  if (scope.doctor && idOf(subject.doctor) === scope.userId) return true;
  if (scope.leaderBatch) {
    const batches = [...(subject.batches || []), ...(extraBatches || [])].map(idOf);
    if (batches.includes(scope.leaderBatch)) return true;
  }
  return false;
}

module.exports = { getManageScope, canManageSubjectContent };
