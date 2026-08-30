/* ينقل بطاقة "مؤشرات الأداء" إلى ما بعد شبكة الوصول السريع.
   الأزرار تنقّل أساسي والمؤشرات معلومات مساندة، ووضع المؤشرات قبلها كان
   يدفع الأزرار خارج الشاشة الأولى على الهاتف — وهو ما اشتكى منه الطلاب. */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'www', 'dashboard.html');
const lines = fs.readFileSync(FILE, 'utf8').split(/\r?\n/);

const startIdx = lines.findIndex(l => l.includes('<!-- Performance Progress Bars -->'));
const gridIdx  = lines.findIndex(l => l.includes('id="dashGridContainer"'));

if (startIdx === -1 || gridIdx === -1) {
  console.error('✗ لم أجد العلامات المتوقعة — الملف تغيّر. لم يُعدَّل شيء.');
  process.exit(1);
}

// نهاية البطاقة: أول </div> بعمود 2 قبل تعليق Quick Actions
const quickIdx = lines.findIndex((l, i) => i > startIdx && l.includes('<!-- Quick Actions -->'));
if (quickIdx === -1) { console.error('✗ لم أجد قسم Quick Actions.'); process.exit(1); }

let endIdx = quickIdx - 1;
while (endIdx > startIdx && !lines[endIdx].trim()) endIdx--;
if (!lines[endIdx].trim().startsWith('</div>')) {
  console.error('✗ نهاية البطاقة غير متوقعة:', lines[endIdx]);
  process.exit(1);
}

if (startIdx > gridIdx) {
  console.log('✓ البطاقة بعد الشبكة أصلاً — لا حاجة للنقل.');
  process.exit(0);
}

const block = lines.slice(startIdx, endIdx + 1);
const rest  = [...lines.slice(0, startIdx), ...lines.slice(endIdx + 1)];

// نهاية شبكة الوصول السريع بعد الحذف
const newGridIdx = rest.findIndex(l => l.includes('id="dashGridContainer"'));
let closeIdx = newGridIdx;
while (closeIdx < rest.length && !rest[closeIdx].trim().startsWith('</div>')) closeIdx++;

const out = [
  ...rest.slice(0, closeIdx + 1),
  '',
  ...block,
  ...rest.slice(closeIdx + 1)
];

fs.writeFileSync(FILE, out.join('\n'), 'utf8');
console.log(`✓ نُقلت بطاقة المؤشرات (${block.length} سطراً) إلى ما بعد شبكة الوصول السريع.`);
