/* مسح ثابت لمشاكل الواجهة عبر كل صفحات www.
   لا يستبدل الفحص في المتصفح (التباين والأحجام تحتاج تصييراً فعلياً)،
   لكنه يكشف ما يظهر في الترميز نفسه: صور بلا بديل، حقول بلا تسمية،
   أزرار أيقونية بلا اسم مقروء، وسمات lang/dir الناقصة. */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'www');
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.html'));

const findings = [];
const add = (file, kind, detail) => findings.push({ file, kind, detail });

for (const file of files) {
  const html = fs.readFileSync(path.join(DIR, file), 'utf8');

  // 1) صور بلا نص بديل
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const noAlt = imgs.filter(t => !/\balt\s*=/i.test(t));
  if (noAlt.length) add(file, 'img-no-alt', `${noAlt.length} صورة`);

  // 2) حقول إدخال بلا تسمية ولا aria-label ولا placeholder
  const inputs = html.match(/<input\b[^>]*>/gi) || [];
  const bare = inputs.filter(t =>
    !/\btype\s*=\s*["'](hidden|submit|button)["']/i.test(t) &&
    !/aria-label/i.test(t) && !/placeholder/i.test(t) && !/\bid\s*=/i.test(t)
  );
  if (bare.length) add(file, 'input-unlabelled', `${bare.length} حقل`);

  // 3) أزرار تحوي أيقونة فقط بلا aria-label/title
  const btns = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi) || [];
  const iconOnly = btns.filter(b => {
    const inner = b.replace(/<button\b[^>]*>/i, '').replace(/<\/button>/i, '');
    const text = inner.replace(/<[^>]+>/g, '').replace(/&\w+;/g, '').trim();
    const hasIcon = /<i\b|<svg\b/i.test(inner);
    const labelled = /aria-label|title\s*=/i.test(b);
    return hasIcon && !text && !labelled;
  });
  if (iconOnly.length) add(file, 'iconbtn-unlabelled', `${iconOnly.length} زر`);

  /* 3.5) تسميات غير مربوطة: <label> بلا for والحقل ليس بداخلها.
     النقر على التسمية لا يركّز الحقل، وقارئ الشاشة لا يعلن اسمه. */
  const labels = html.match(/<label\b[^>]*>[\s\S]*?<\/label>/gi) || [];
  const orphanLabels = labels.filter(l =>
    !/\bfor\s*=/i.test(l) && !/<(input|select|textarea)\b/i.test(l)
  );
  if (orphanLabels.length) add(file, 'label-not-linked', `${orphanLabels.length} تسمية`);

  // 4) سمات المستند
  if (!/<html[^>]*\blang\s*=/i.test(html)) add(file, 'html-no-lang', 'ينقص lang');
  if (!/<html[^>]*\bdir\s*=/i.test(html)) add(file, 'html-no-dir', 'ينقص dir');

  // 5) viewport يمنع التكبير — عائق وصول حقيقي
  const vp = (html.match(/<meta[^>]+name=["']viewport["'][^>]*>/i) || [])[0];
  if (vp && /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/i.test(vp)) {
    add(file, 'viewport-blocks-zoom', 'يمنع التكبير');
  }

  // 6) روابط تفتح في تبويب جديد بلا rel آمن
  const blanks = (html.match(/<a\b[^>]*target\s*=\s*["']_blank["'][^>]*>/gi) || [])
    .filter(t => !/rel\s*=\s*["'][^"']*noopener/i.test(t));
  if (blanks.length) add(file, 'blank-no-noopener', `${blanks.length} رابط`);
}

const byKind = {};
for (const f of findings) (byKind[f.kind] ||= []).push(f);

console.log('═══ مسح واجهة ثابت ═══\n');
for (const kind of Object.keys(byKind).sort()) {
  const rows = byKind[kind];
  console.log(`▸ ${kind} — ${rows.length} صفحة`);
  for (const r of rows.slice(0, 8)) console.log(`    ${r.file}: ${r.detail}`);
  if (rows.length > 8) console.log(`    … و${rows.length - 8} أخرى`);
  console.log('');
}
console.log(`الإجمالي: ${findings.length} ملاحظة عبر ${files.length} صفحة`);
