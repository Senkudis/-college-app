#!/usr/bin/env node
/**
 * فاحص حزمة الإصدار قبل رفعها إلى Google Play.
 *
 * لماذا لا يكفي grep على ملف الـ.aab مباشرة: البيان داخل الحزمة مضغوط
 * (deflate) وبصيغة AXML الثنائية، فقد لا تظهر نصوصه في الملف الخام —
 * أي أن "غير موجود" قد تكون نتيجة كاذبة. لذلك نفكّ الضغط أولاً ثم نقرأ
 * مجمّع السلاسل من البيان المستخرج.
 *
 *   node scripts/check-aab.js [path/to/app-release.aab]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// أذونات تخالف سياسة صور وفيديو Google Play لتطبيق غير معرض صور
const FORBIDDEN = ['READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_MEDIA_AUDIO'];
// أذونات نتوقع وجودها — غيابها يعني أننا نقرأ الملف الخطأ
const EXPECTED = ['INTERNET', 'CAMERA'];

const aab = process.argv[2] || findDefault();

function findDefault() {
  const candidates = [
    'android/app/build/outputs/bundle/release/app-release.aab',
    'android/app/release/app-release.aab',
  ];
  const found = candidates.filter(c => fs.existsSync(c));
  if (!found.length) {
    console.error('لم أجد ملف .aab — مرّر مساره كوسيط.');
    process.exit(2);
  }
  // نأخذ الأحدث حتى لا نفحص بناءً قديماً بالخطأ
  return found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

if (!fs.existsSync(aab)) {
  console.error('الملف غير موجود:', aab);
  process.exit(2);
}

const stat = fs.statSync(aab);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aabcheck-'));

try {
  execFileSync('unzip', ['-o', '-q', path.resolve(aab), 'base/manifest/AndroidManifest.xml', '-d', tmp]);
} catch {
  console.error('تعذّر فكّ الحزمة — تأكد من توفر unzip.');
  process.exit(2);
}

const manifestPath = path.join(tmp, 'base', 'manifest', 'AndroidManifest.xml');
if (!fs.existsSync(manifestPath)) {
  console.error('لا يحتوي الملف على base/manifest/AndroidManifest.xml — هل هو AAB فعلاً؟');
  process.exit(2);
}

const buf = fs.readFileSync(manifestPath);
// AXML يخزّن السلاسل إما UTF-8 أو UTF-16LE حسب الإصدار، فنفحص الاثنين
const asUtf8 = buf.toString('latin1');
const asUtf16 = buf.toString('utf16le');
const has = needle => asUtf8.includes(needle) || asUtf16.includes(needle);

console.log('الملف   :', aab);
console.log('الحجم   :', (stat.size / 1048576).toFixed(1), 'MB');
console.log('بُني في :', stat.mtime.toLocaleString());
console.log('');

let ok = true;

for (const p of EXPECTED) {
  const found = has(p);
  console.log(`  ${found ? '✓' : '✗'} ${p} ${found ? 'موجود (متوقع)' : 'مفقود — قد يكون الملف خاطئاً'}`);
  if (!found) ok = false;
}
for (const p of FORBIDDEN) {
  const found = has(p);
  console.log(`  ${found ? '✗' : '✓'} ${p} ${found ? 'موجود — سيُرفض من Play' : 'غير موجود'}`);
  if (found) ok = false;
}

console.log('');
console.log(ok ? '✅ الحزمة نظيفة وصالحة للرفع.' : '❌ لا ترفعها — راجع النقاط أعلاه.');
process.exit(ok ? 0 : 1);
