/**
 * utils/normalizeEmail.js
 * تطبيع الإيميل بشكل موحّد عبر النظام.
 *
 * السبب: في إدخال البيانات بسياق RTL (عربي) تتسلل أحرف خفية داخل الإيميل —
 * علامات اتجاهية (U+200E/U+200F)، أحرف عرض صفري (U+200B–U+200D)، BOM (U+FEFF)،
 * ومسافة غير فاصلة (U+00A0). دوال .trim()/.toLowerCase() لا تزيل معظمها، فيُخزَّن
 * الإيميل "ملوّثاً" بينما يبحث الدخول عن النسخة النظيفة → لا تطابق → فشل الدخول.
 *
 * الحل: إزالة كل الأحرف الخفية وأي مسافة (الإيميلات الصالحة لا تحوي مسافات) + حروف صغيرة.
 */
// أحرف خفية: zero-width (200B-200D), علامات اتجاهية (200E-200F, 202A-202E),
// word-joiner (2060), BOM (FEFF), مسافة غير فاصلة (00A0)
const INVISIBLE = /[​-‏‪-‮⁠﻿ ]/g;

function normalizeEmail(email) {
  if (email == null) return email;
  return String(email)
    .replace(INVISIBLE, '')
    .replace(/\s+/g, '') // أي مسافة متبقية — الإيميل الصالح لا يحوي مسافات إطلاقاً
    .toLowerCase();
}

module.exports = normalizeEmail;
