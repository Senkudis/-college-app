/**
 * utils/idCard.js
 * رمز التحقق في بطاقة الهوية الرقمية.
 *
 * كان الـQR يحمل JSON نصياً (الاسم والبريد والمعرّف الداخلي): الماسح يعرض
 * نصاً لا يفتح شيئاً، ولا يثبت شيئاً — أي أحد يكتب JSON مماثلاً ويولّد منه
 * رمزاً. الآن يحمل رابطاً إلى صفحة تحقق عامة، والرابط موقَّع بمفتاح الخادم
 * فلا يمكن تخمين رابط طالب آخر من معرّفه ولا تزوير بطاقة لحساب غير موجود.
 *
 * الصيغة: <ObjectId>.<توقيع base64url بطول 16 حرفاً = 96 بت>
 * قصيرة عمداً: كل حرف إضافي يكبّر الرمز ويصعّب مسحه من شاشة الهاتف.
 */
const crypto = require("crypto");

const SIG_LENGTH = 16;
const CODE_PATTERN = /^([a-f0-9]{24})\.([A-Za-z0-9_-]{16})$/i;

function secret() {
  // مفتاح مستقل اختياري: يتيح تدوير JWT_SECRET دون إبطال البطاقات المطبوعة
  return process.env.ID_CARD_SECRET || process.env.JWT_SECRET;
}

function sign(userId) {
  return crypto.createHmac("sha256", secret())
    .update(`id-card:v1:${String(userId).toLowerCase()}`)
    .digest("base64url")
    .slice(0, SIG_LENGTH);
}

function createCode(userId) {
  return `${String(userId).toLowerCase()}.${sign(userId)}`;
}

/** يعيد معرّف المستخدم إن كان الرمز سليم التوقيع، وإلا null. */
function verifyCode(code) {
  const match = CODE_PATTERN.exec(String(code || "").trim());
  if (!match) return null;
  const [, userId, given] = match;
  const expected = Buffer.from(sign(userId));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  return userId.toLowerCase();
}

module.exports = { createCode, verifyCode };
