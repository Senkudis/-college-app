/* إصلاحات وصول آلية ومحافظة عبر صفحات www:
   1) rel="noopener noreferrer" لكل target="_blank" — يمنع الصفحة المفتوحة
      من التحكم في نافذتنا عبر window.opener (مهم في WebView أندرويد الذي
      لا يطبّق السلوك الضمني الحديث).
   2) alt="" للصور الزخرفية بلا نص بديل — قارئ الشاشة يتخطّاها بدل أن
      ينطق اسم الملف.
*/
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'www');
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.html'));

let relFixed = 0, altFixed = 0;
const touched = new Set();

for (const file of files) {
  const full = path.join(DIR, file);
  let html = fs.readFileSync(full, 'utf8');
  const before = html;

  // 1) rel آمن لروابط التبويب الجديد
  html = html.replace(/<a\b([^>]*?)target\s*=\s*["']_blank["']([^>]*?)>/gi, (m, pre, post) => {
    if (/\brel\s*=/i.test(m)) {
      // rel موجود لكن ينقصه noopener
      if (/noopener/i.test(m)) return m;
      relFixed += 1;
      return m.replace(/\brel\s*=\s*["']([^"']*)["']/i, (rm, val) => `rel="${val} noopener noreferrer"`.replace(/\s+/g, ' '));
    }
    relFixed += 1;
    return `<a${pre}target="_blank" rel="noopener noreferrer"${post}>`;
  });

  // 2) alt للصور الناقصة — فارغ لأنها زخرفية ما لم يقرر المؤلف غير ذلك
  html = html.replace(/<img\b([^>]*)>/gi, (m, attrs) => {
    if (/\balt\s*=/i.test(attrs)) return m;
    altFixed += 1;
    return `<img${attrs} alt="">`;
  });

  if (html !== before) {
    fs.writeFileSync(full, html, 'utf8');
    touched.add(file);
  }
}

console.log('═══ إصلاحات وصول ═══\n');
console.log(`  rel="noopener noreferrer" مضاف: ${relFixed}`);
console.log(`  alt مضاف: ${altFixed}`);
console.log(`  صفحات معدّلة: ${touched.size} — ${[...touched].join(', ')}`);
