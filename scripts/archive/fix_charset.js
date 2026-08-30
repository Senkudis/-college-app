const fs = require('fs');
const path = require('path');
const dir = 'c:/Users/kde/Desktop/kedwebcbs-main/www';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
let count = 0;
for (const file of files) {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;
  
  content = content.replace(/<script src="\/js\/app\.js/g, '<script charset="UTF-8" src="/js/app.js');
  content = content.replace(/<script src="\/js\/shared\.js/g, '<script charset="UTF-8" src="/js/shared.js');
  
  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    count++;
  }
}
console.log('Fixed ' + count + ' HTML files.');
