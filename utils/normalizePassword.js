/**
 * utils/normalizePassword.js
 * تطبيع كلمة المرور قبل التشفير وقبل المقارنة — نفس فكرة normalizeEmail.
 *
 * السبب: حقل كلمة المرور يعرض نقاطاً فقط، فلا يرى الطالب ما كتبه فعلاً:
 *  - لوحة المفاتيح العربية تكتب الأرقام "١٢٣٤٥٦" (U+0660–0669) لا "123456"،
 *    فيسجّل بلوحة ويدخل بأخرى → "كلمة المرور غير صحيحة" مع أنه "كتبها صح".
 *  - سياق RTL يُدخل علامات اتجاهية/عرض صفري خفية (U+200E/U+200F/U+200B...).
 *  - مسافة زائدة في الطرفين من الاقتراح التلقائي للوحة المفاتيح.
 * كان التسجيل العام يقصّ المسافات بينما الدخول لا يقصّها — مساران بقاعدتين.
 *
 * الحل: صيغة واحدة تُشفَّر بها كلمة المرور وتُقارَن بها في كل المسارات.
 */
const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿­]/g;

function normalizePassword(password) {
  if (password == null) return password;
  return String(password)
    .normalize('NFKC') // أرقام/حروف بعرض كامل ومسافات غير فاصلة → صيغها العادية
    .replace(INVISIBLE, '')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)) // أرقام عربية مشرقية
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0)) // أرقام فارسية
    .trim();
}

/* الصيغة التي كانت لوحة المفاتيح العربية ستنتجها للأرقام نفسها — تُستخدم
   فقط لمطابقة كلمات مرور قديمة شُفّرت قبل التطبيع بأرقام عربية. */
function toArabicIndicDigits(password) {
  return String(password).replace(/[0-9]/g, d => String.fromCharCode(0x0660 + Number(d)));
}

module.exports = normalizePassword;
module.exports.toArabicIndicDigits = toArabicIndicDigits;
