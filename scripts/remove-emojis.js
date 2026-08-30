const fs = require('fs');
const path = require('path');

const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

function cleanFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  if (!emojiRegex.test(content)) return;
  
  // Specific replacements first
  content = content
    .replace(/ثبّت التطبيق 📲/g, 'تثبيت التطبيق')
    .replace(/خلاص! 🎉/g, 'اكتمل التثبيت')
    .replace(/فاهم، راح أثبّت الآن 🚀/g, 'فهمت، تثبيت الآن')
    .replace(/<div class="arrow-icon">👇<\/div>/g, '<div class="arrow-icon"><i class="ri-arrow-down-line"></i></div>')
    .replace(/عاد الاتصال بالإنترنت ✓/g, 'عاد الاتصال بالإنترنت')
    .replace(/✅/g, '')
    .replace(/❌/g, '')
    .replace(/⚠/g, '')
    .replace(/✨/g, '')
    .replace(/🎉/g, '')
    .replace(/🔥/g, '')
    .replace(/🔴/g, '')
    .replace(/🟡/g, '')
    .replace(/🟢/g, '')
    .replace(/⏱️/g, '')
    .replace(/🎓/g, '')
    .replace(/📄/g, '')
    .replace(/📋/g, '')
    .replace(/⚡/g, '')
    .replace(/🧠/g, '')
    .replace(/💻/g, '')
    .replace(/🎯/g, '')
    .replace(/❓/g, '')
    .replace(/📅/g, '')
    .replace(/💡/g, '')
    .replace(/📝/g, '')
    .replace(/👨‍💻/g, '')
    .replace(/👑/g, '')
    .replace(/🏆/g, '')
    .replace(/📌/g, '')
    .replace(/🚀/g, '')
    .replace(/🔒/g, '')
    .replace(/🔄/g, '')
    .replace(/🛠️/g, '')
    .replace(/ℹ️/g, '')
    .replace(/🔹/g, '•')
    .replace(/💳/g, '');

  // Strip any remaining emojis
  content = content.replace(emojiRegex, '');

  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Cleaned emojis from:', filePath);
}

function walkDir(dir) {
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of list) {
    if (item.name === 'node_modules' || item.name === '.git' || item.name === 'vendor') continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      walkDir(full);
    } else if (item.isFile() && (item.name.endsWith('.html') || item.name.endsWith('.js') || item.name.endsWith('.css'))) {
      cleanFile(full);
    }
  }
}

walkDir(path.join(__dirname, '../www'));
walkDir(path.join(__dirname, '../routes'));
console.log('Emoji cleanup completed successfully.');
