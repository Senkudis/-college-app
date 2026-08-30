/**
 * fix_meta.js — استبدال وسم apple-mobile-web-app-capable المهمل
 * بالوسمين الحديثين في جميع صفحات HTML
 */
const fs   = require('fs');
const path = require('path');

const WWW = path.join(__dirname, 'www');

const OLD_TAG    = 'name="apple-mobile-web-app-capable"';
const NEW_TAGS   = '<meta name="mobile-web-app-capable" content="yes">\n  <meta name="apple-mobile-web-app-capable" content="yes">';
const APPLE_FULL = '<meta name="apple-mobile-web-app-capable" content="yes">';

let totalFiles = 0;
let totalFixed  = 0;
let totalSkipped = 0;

function walk(dir) {
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath);
    } else if (entry.endsWith('.html')) {
      totalFiles++;
      // read as Buffer then convert to string to preserve CRLF exactly
      const buf = fs.readFileSync(fullPath);
      let content = buf.toString('utf8');

      const hasApple  = content.includes(OLD_TAG);
      const hasMobile = content.includes('name="mobile-web-app-capable"');

      if (!hasApple) {
        totalSkipped++;
        continue;
      }

      if (hasMobile) {
        // already has the modern tag — skip
        totalSkipped++;
        continue;
      }

      // simple string replace (no regex)
      content = content.split(APPLE_FULL).join(NEW_TAGS);

      // write back as UTF-8
      fs.writeFileSync(fullPath, content, 'utf8');
      totalFixed++;
      console.log(`  [OK] ${path.relative(__dirname, fullPath)}`);
    }
  }
}

walk(WWW);
console.log(`\nالنتيجة: تم تصحيح ${totalFixed} ملف | تخطي ${totalSkipped} ملف | الكل ${totalFiles} ملف`);
