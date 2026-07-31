/**
 * rate-limit.middleware.js
 * 
 * ملاحظة: هذا الملف يُعيد تصدير المحدّدات من rateLimiter.js الموحّد
 * للحفاظ على التوافق مع الكود القديم. يُرجى استخدام rateLimiter.js مباشرةً
 * في أي كود جديد.
 */
const {
  authLimiter,
  passwordResetLimiter,
  apiLimiter,
  uploadLimiter
} = require("./rateLimiter");

// تعريفات متوافقة مع الأسماء القديمة
module.exports = {
  loginLimiter: authLimiter,
  forgotPasswordLimiter: passwordResetLimiter,
  apiLimiter,
  uploadLimiter
};
