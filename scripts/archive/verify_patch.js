const fs = require('fs');
const content = fs.readFileSync('c:/Users/kde/Desktop/kedwebcbs-main/www/subject.html', 'utf8');
console.log('gkFab logic:', content.includes('const fab = document.getElementById(\'gkFab\');'));
console.log('empty extract:', content.includes('_aiExtractedText = \'\';'));
console.log('overflow-x:', content.includes('overflow-x: auto;'));
console.log('cubic-bezier:', content.includes('cubic-bezier'));
