/**
 * bump_version.js — يرفع رقم الإصدار في كل مواضعه دفعة واحدة.
 *
 *   node bump_version.js            ← يرفع رقم الإصدار الأصغر (2.1.0 ← 2.2.0)
 *   node bump_version.js 2.3.1      ← إصدار محدد
 *   node bump_version.js --patch    ← يرفع رقم التصحيح (2.1.0 ← 2.1.1)
 *
 * المواضع الخمسة:
 *   package.json · android/app/build.gradle · www/index.html · www/sw.js
 *   ووسم أصول الواجهة (?v=…) في كل صفحات www
 *
 * وسم الأصول هو الأهم عملياً: الـService Worker يخزّن css/js بالرابط
 * الكامل، فإن لم يتغيّر الوسم بقي المستخدمون على النسخة القديمة من
 * التصميم مهما نُشر من تعديلات — دون أن يلاحظ أحد أن التحديث لم يصل.
 */
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const current = pkg.version;

/* ── تحديد الإصدار الجديد ── */
const arg = process.argv[2];
let VERSION;
if (arg && /^\d+\.\d+\.\d+$/.test(arg)) {
  VERSION = arg;
} else {
  const [maj, min, pat] = current.split('.').map(Number);
  VERSION = arg === '--patch' ? `${maj}.${min}.${pat + 1}` : `${maj}.${min + 1}.0`;
}

if (VERSION === current) {
  console.error(`✗ الإصدار الجديد يطابق الحالي (${current}) — لم يتغيّر شيء.`);
  process.exit(1);
}

/* versionCode لأندرويد: رقم صحيح يتزايد أبداً، ولا يقبل جوجل تكراره */
const gradlePath = path.join(__dirname, 'android/app/build.gradle');
let VERSION_CODE = null;
if (fs.existsSync(gradlePath)) {
  const g = fs.readFileSync(gradlePath, 'utf8');
  const m = g.match(/versionCode (\d+)/);
  VERSION_CODE = m ? Number(m[1]) + 1 : 1;
}

/* وسم الأصول: تاريخ اليوم + عدّاد، بنفس الصيغة المستخدمة في المشروع */
const now = new Date();
const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}`;

const changed = [];

/* 1. package.json */
pkg.version = VERSION;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
changed.push('package.json');

/* 2. build.gradle */
if (fs.existsSync(gradlePath)) {
  let g = fs.readFileSync(gradlePath, 'utf8');
  g = g.replace(/versionCode \d+/, `versionCode ${VERSION_CODE}`);
  g = g.replace(/versionName "[^"]+"/, `versionName "${VERSION}"`);
  fs.writeFileSync(gradlePath, g, 'utf8');
  changed.push(`android/app/build.gradle (versionCode ${VERSION_CODE})`);
}

/* 3. شارة الإصدار في شاشة البداية */
const indexPath = path.join(__dirname, 'www/index.html');
if (fs.existsSync(indexPath)) {
  let h = fs.readFileSync(indexPath, 'utf8');
  const before = h;
  h = h.replace(/v\d+\.\d+\.\d+/g, `v${VERSION}`);
  if (h !== before) { fs.writeFileSync(indexPath, h, 'utf8'); changed.push('www/index.html'); }
}

/* 3ب. ثابتا الإصدار في app.js (احتياط فحص التحديث إن تعذّر App.getInfo) */
const appJsPath = path.join(__dirname, 'www/js/app.js');
if (fs.existsSync(appJsPath)) {
  let s = fs.readFileSync(appJsPath, 'utf8');
  const before = s;
  s = s.replace(/VERSION: '\d+\.\d+\.\d+',/, `VERSION: '${VERSION}',`);
  if (VERSION_CODE) s = s.replace(/BUILD_CODE: \d+,/, `BUILD_CODE: ${VERSION_CODE},`);
  if (s !== before) { fs.writeFileSync(appJsPath, s, 'utf8'); changed.push('www/js/app.js (VERSION/BUILD_CODE)'); }
}

/* 4. اسم ذاكرة الـService Worker — تغييره يُبطل الذاكرة القديمة */
const swPath = path.join(__dirname, 'www/sw.js');
if (fs.existsSync(swPath)) {
  let s = fs.readFileSync(swPath, 'utf8');
  const before = s;
  s = s.replace(/v\d+\.\d+\.\d+/g, `v${VERSION}`);
  if (s !== before) { fs.writeFileSync(swPath, s, 'utf8'); changed.push('www/sw.js'); }
}

/* 5. وسم أصول الواجهة في كل الصفحات */
const wwwDir = path.join(__dirname, 'www');
let taggedFiles = 0, taggedRefs = 0;
for (const file of fs.readdirSync(wwwDir).filter(f => f.endsWith('.html'))) {
  const p = path.join(wwwDir, file);
  const html = fs.readFileSync(p, 'utf8');
  const hits = (html.match(/\?v=\d+/g) || []).length;
  if (!hits) continue;
  const out = html.replace(/\?v=\d+/g, `?v=${stamp}`);
  if (out !== html) {
    fs.writeFileSync(p, out, 'utf8');
    taggedFiles += 1;
    taggedRefs += hits;
  }
}
if (taggedRefs) changed.push(`وسم الأصول ?v=${stamp} (${taggedRefs} مرجعاً في ${taggedFiles} صفحة)`);

console.log(`\n✓ الإصدار: ${current} ← ${VERSION}\n`);
changed.forEach(c => console.log('  • ' + c));
console.log('\nالخطوة التالية:  npx cap sync');
