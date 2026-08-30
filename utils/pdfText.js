/**
 * utils/pdfText.js — استخراج نص من ملفات PDF.
 *
 * سبب وجوده: المشروع يستخدم pdf-parse@2، وواجهته تختلف جذرياً عن الإصدار 1:
 *   - v1 يُصدّر دالة:      const data = await pdfParse(buffer)
 *   - v2 يُصدّر كائناً:     new PDFParse(uint8).getText()  ويرفض Buffer صراحةً
 * الكود كان يستدعيه بأسلوب v1 فيفشل دائماً بـ "pdfParse is not a function"
 * داخل try/catch صامت — أي أن استخراج نصوص المحاضرات كان معطّلاً بالكامل
 * دون أن يظهر أي خطأ، فيعتذر المساعد بأنه "لا يستطيع قراءة الملفات".
 *
 * هذه الدالة تتعامل مع الإصدارين حتى لا تتكرر المشكلة عند أي ترقية.
 */
const MAX_CHARS = 150000;

async function extractPdfText(buffer, { maxChars = MAX_CHARS } = {}) {
  if (!buffer || !buffer.length) return '';

  const mod = require('pdf-parse');
  let raw = '';

  if (typeof mod === 'function') {
    // pdf-parse v1
    const data = await mod(buffer);
    raw = data?.text || '';
  } else if (mod && typeof mod.PDFParse === 'function') {
    // pdf-parse v2 — يشترط Uint8Array ويحتاج destroy() لتحرير الموارد
    const parser = new mod.PDFParse(new Uint8Array(buffer));
    try {
      const data = await parser.getText();
      raw = data?.text || '';
    } finally {
      try { await parser.destroy(); } catch { /* لا يهم */ }
    }
  } else {
    throw new Error('صيغة pdf-parse غير معروفة');
  }

  // pdf-parse v2 يذيّل كل صفحة بعلامة مثل "-- 3 of 12 --"
  return raw
    .replace(/--\s*\d+\s*of\s*\d+\s*--/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

module.exports = { extractPdfText, MAX_CHARS };
