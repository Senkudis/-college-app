/* يربط كل <label> بالحقل الذي يليه مباشرة عبر for/id.
   التسمية غير المربوطة تعني أن النقر عليها لا يركّز الحقل، وأن قارئ
   الشاشة يعلن حقلاً بلا اسم. الإصلاح محافظ: لا يلمس إلا النمط الصريح
   "تسمية ثم حقل متجاور"، ويعيد استخدام id الموجود إن وُجد. */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'www');
const files = process.argv[2] ? [process.argv[2]] : fs.readdirSync(DIR).filter(f => f.endsWith('.html'));

// معرّف مستقر مشتق من name أو من عدّاد داخل الصفحة
function makeId(attrs, file, counter) {
  const name = (attrs.match(/\bname\s*=\s*["']([^"']+)["']/i) || [])[1];
  const base = name ? name.replace(/[^A-Za-z0-9_-]/g, '') : `fld${counter}`;
  return `${path.basename(file, '.html').replace(/[^A-Za-z0-9]/g, '')}_${base}`;
}

let totalLinked = 0;
const touched = [];

for (const file of files) {
  const full = path.join(DIR, file);
  let html = fs.readFileSync(full, 'utf8');
  let counter = 0;
  let linked = 0;
  const usedIds = new Set((html.match(/\bid\s*=\s*["']([^"']+)["']/gi) || [])
    .map(m => m.replace(/.*["']([^"']+)["']$/, '$1')));

  /* نمطان شائعان في هذا المشروع:
     أ) <label>نص</label> ثم الحقل مباشرة
     ب) <label>نص</label> ثم <div class="input-wrapper"><i…></i> ثم الحقل
     الفجوة تسمح بعناصر تغليف وأيقونات لا تحوي حقلاً آخر. */
  const gapAllowed = '(?:\\s*(?:<div\\b[^>]*>|<i\\b[^>]*>(?:</i>)?|<span\\b[^>]*>(?:</span>)?)\\s*)*\\s*';
  const pattern = new RegExp(
    '(<label\\b)((?:(?!\\bfor\\s*=)[^>])*?)(>)([\\s\\S]*?)(</label>)' +
    `(${gapAllowed})` +
    '(<(?:input|select|textarea)\\b)([^>]*?)(/?>)',
    'gi'
  );

  html = html.replace(pattern, (m, lOpen, lAttrs, lGt, lText, lClose, gap, fOpen, fAttrs, fGt) => {
    // التسمية تحتوي حقلاً بداخلها — مربوطة ضمنياً، لا نلمسها
    if (/<(input|select|textarea)\b/i.test(lText)) return m;

    let id = (fAttrs.match(/\bid\s*=\s*["']([^"']+)["']/i) || [])[1];
    let newFAttrs = fAttrs;

    if (!id) {
      counter += 1;
      id = makeId(fAttrs, file, counter);
      while (usedIds.has(id)) id = `${id}_${counter}`;
      usedIds.add(id);
      newFAttrs = ` id="${id}"${fAttrs}`;
    }

    linked += 1;
    return `${lOpen}${lAttrs} for="${id}"${lGt}${lText}${lClose}${gap}${fOpen}${newFAttrs}${fGt}`;
  });

  if (linked > 0) {
    fs.writeFileSync(full, html, 'utf8');
    totalLinked += linked;
    touched.push(`${file}: ${linked}`);
  }
}

console.log('═══ ربط التسميات بالحقول ═══\n');
touched.forEach(t => console.log('  ' + t));
console.log(`\nالإجمالي: ${totalLinked} تسمية في ${touched.length} صفحة`);
