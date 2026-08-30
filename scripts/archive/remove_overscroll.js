const fs = require('fs');
let content = fs.readFileSync('c:/Users/kde/Desktop/kedwebcbs-main/www/subject.html', 'utf8');

const target1 = `/* Prevent PTR / Overscroll inside AI sidebar and scrollable tabs */
.subject-sidebar, .tab-content, #aiTab, #notesTab, #plannerTab, .ai-chat-messages, [class*="ai-"] {
  overscroll-behavior: contain !important;
  overscroll-behavior-y: contain !important;
  -webkit-overflow-scrolling: touch;
}`;
const target2 = target1.replace(/\n/g, '\r\n');

if (content.includes(target1)) content = content.replace(target1, '/* Overscroll removed */');
if (content.includes(target2)) content = content.replace(target2, '/* Overscroll removed */');

fs.writeFileSync('c:/Users/kde/Desktop/kedwebcbs-main/www/subject.html', content, 'utf8');
console.log('done');
