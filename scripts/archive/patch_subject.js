const fs = require('fs');
const path = require('path');
let content = fs.readFileSync('c:/Users/kde/Desktop/kedwebcbs-main/www/subject.html', 'utf8');

// 1. Fix openAiPanel / closeAiPanel
let t1 = `function openAiPanel() {
  document.getElementById('aiPanel').classList.add('show');
  switchAiTab(_aiCurrentTab);
}
function closeAiPanel() {
  document.getElementById('aiPanel').classList.remove('show');
}`;
let t1r = t1.replace(/\n/g, '\r\n');
let r1 = `function openAiPanel() {
  document.getElementById('aiPanel').classList.add('show');
  switchAiTab(_aiCurrentTab);
  const fab = document.getElementById('gkFab');
  if (fab) fab.style.display = 'none';
}
function closeAiPanel() {
  document.getElementById('aiPanel').classList.remove('show');
  const fab = document.getElementById('gkFab');
  if (fab) fab.style.display = 'flex';
}`;
if (content.includes(t1)) content = content.split(t1).join(r1);
else if (content.includes(t1r)) content = content.split(t1r).join(r1);

// 2. Fix extractPdfText
let t2 = `  // Fallback context if PDF text is empty or image-based
  _aiExtractedText = \`المادة: \${subjectTitle} · المحاضرة: \${lectureTitle || 'شرح المنهج والأفكار الرئيسية'}\`;
  return _aiExtractedText;`;
let t2r = t2.replace(/\n/g, '\r\n');
let r2 = `  // [BUG FIX] Return empty string if no text is found, so backend can fallback to lectureId
  _aiExtractedText = '';
  return _aiExtractedText;`;
if (content.includes(t2)) content = content.split(t2).join(r2);
else if (content.includes(t2r)) content = content.split(t2r).join(r2);

// 3. Fix CSS .ai-tabs
let t3 = `    .ai-tabs {
      display: flex; gap: 6px; padding: 14px 20px 0; flex-shrink: 0; flex-wrap: wrap;
    }`;
let t3r = t3.replace(/\n/g, '\r\n');
let r3 = `    .ai-tabs {
      display: flex; gap: 8px; padding: 14px 20px 8px; flex-shrink: 0; flex-wrap: nowrap;
      overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none;
    }
    .ai-tabs::-webkit-scrollbar { display: none; }`;
if (content.includes(t3)) content = content.split(t3).join(r3);
else if (content.includes(t3r)) content = content.split(t3r).join(r3);

// 4. Fix CSS .ai-sheet
let t4 = `    .ai-sheet {
      width: 100%; max-width: 680px; max-height: 85vh;
      background: var(--bg-card); border-radius: 24px 24px 0 0;
      display: flex; flex-direction: column;
      animation: slideUp 0.3s ease;
      overflow: hidden;
    }`;
let t4r = t4.replace(/\n/g, '\r\n');
let r4 = `    .ai-sheet {
      width: 100%; max-width: 680px; max-height: 85vh;
      background: var(--bg-card); border-radius: 28px 28px 0 0;
      display: flex; flex-direction: column;
      animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      overflow: hidden; box-shadow: 0 -10px 40px rgba(0,0,0,0.2);
    }`;
if (content.includes(t4)) content = content.split(t4).join(r4);
else if (content.includes(t4r)) content = content.split(t4r).join(r4);

// 5. Fix CSS .ai-sheet-header
let t5 = `    .ai-sheet-header {
      padding: 20px 20px 0;
      display: flex; align-items: center; justify-content: space-between;
      border-bottom: 1px solid var(--border); padding-bottom: 14px;
      flex-shrink: 0;
    }`;
let t5r = t5.replace(/\n/g, '\r\n');
let r5 = `    .ai-sheet-header {
      padding: 24px 20px 0;
      display: flex; align-items: center; justify-content: space-between;
      border-bottom: 1px solid var(--border); padding-bottom: 14px;
      flex-shrink: 0; position: relative;
    }
    .ai-sheet-header::before {
      content: ''; position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
      width: 40px; height: 5px; background: var(--border); border-radius: 10px; opacity: 0.8;
    }`;
if (content.includes(t5)) content = content.split(t5).join(r5);
else if (content.includes(t5r)) content = content.split(t5r).join(r5);

fs.writeFileSync('c:/Users/kde/Desktop/kedwebcbs-main/www/subject.html', content, 'utf8');
console.log('Patch complete.');
