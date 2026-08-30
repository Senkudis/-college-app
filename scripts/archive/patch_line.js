const fs = require('fs');
const path = 'c:/Users/kde/Desktop/kedwebcbs-main/www/js/app.js';
let lines = fs.readFileSync(path, 'utf8').split('\n');

let inFunc = false;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('_saveGlobalNote(title, content)')) {
        inFunc = true;
    }
    if (inFunc && lines[i].includes('catch(e){}')) {
        lines[i] = lines[i].replace('catch(e){}', 'catch (e) {\n      console.error("[AI] Error saving note to localStorage:", e);\n      this.toast("فشل حفظ الملاحظة، المساحة قد تكون ممتلئة", "", "danger");\n    }');
        console.log('Replaced at line ' + (i+1));
        inFunc = false; // Done
        break;
    }
}
fs.writeFileSync(path, lines.join('\n'), 'utf8');
