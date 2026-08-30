const fs = require('fs');
const path = 'c:/Users/kde/Desktop/kedwebcbs-main/www/js/app.js';
let content = fs.readFileSync(path, 'utf8');

// Use exact character matching with split/join or indexOf to be perfectly safe against JS escape sequences.
// Target 1 start signature: "botMsg.innerHTML = this.formatAiResponse(data.answer) + interactiveHtml"
// Target 1 end signature: "sendBtn.disabled = false;" after "تعذّر الاتصال بالخادم الذكي"

const t1_start = "botMsg.innerHTML = this.formatAiResponse(data.answer) + interactiveHtml + ";
const t1_end = "      botMsg.innerHTML = '<span style=\"color:var(--danger)\">تعذّر الاتصال بالخادم الذكي</span>';\r\n    }";

const i1 = content.indexOf(t1_start);
if (i1 !== -1) {
    const e1 = content.indexOf(t1_end, i1);
    if (e1 !== -1) {
        const fullBlock = content.substring(i1, e1 + t1_end.length);
        
        const replaceBlock = "const jsMsg = this.escapeHTML(this.escapeJS(msg));\r\n        const jsAns = this.escapeHTML(this.escapeJS(data.answer));\r\n        botMsg.innerHTML = this.formatAiResponse(data.answer) + interactiveHtml + \r\n          `<br><button onclick=\"CBS._saveGlobalNote('${jsMsg}', '${jsAns}')\" style=\"margin-top:8px;padding:3px 8px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:0.75rem;font-weight:700;\"><i class=\"ri-bookmark-3-line\"></i> حفظ في ملاحظاتي  </button>`;\r\n      } else {\r\n        botMsg.innerHTML = '<span style=\"color:var(--danger)\">' + (data?.message || 'الخادم لم يرسل إجابة صالحة') + '</span>';\r\n      }\r\n    } catch (e) {\r\n      console.error('[AI] Fetch error:', e);\r\n      botMsg.innerHTML = '<span style=\"color:var(--danger)\">تعذّر الاتصال بالخادم الذكي</span>';\r\n    }";
        
        content = content.replace(fullBlock, replaceBlock);
        console.log("Block 1 replaced successfully");
    } else {
        console.log("Block 1 end not found");
    }
} else {
    console.log("Block 1 start not found");
}

const t2_start = "      localStorage.setItem('cbs_saved_notes', JSON.stringify(notes));\r\n      this.toast('تم الحفظ في ملاحظاتك بنجاح  ', '', 'success');\r\n    } catch(e){}";

if (content.includes(t2_start)) {
    const replaceBlock2 = "      localStorage.setItem('cbs_saved_notes', JSON.stringify(notes));\r\n      this.toast('تم الحفظ في ملاحظاتك بنجاح  ', '', 'success');\r\n    } catch (e) {\r\n      console.error('[AI] Error saving note to localStorage:', e);\r\n      this.toast('فشل حفظ الملاحظة، المساحة قد تكون ممتلئة', '', 'danger');\r\n    }";
    content = content.replace(t2_start, replaceBlock2);
    console.log("Block 2 replaced successfully");
} else {
    // try with \n
    const t2_start_n = t2_start.replace(/\r\n/g, '\n');
    if (content.includes(t2_start_n)) {
        const replaceBlock2_n = "      localStorage.setItem('cbs_saved_notes', JSON.stringify(notes));\n      this.toast('تم الحفظ في ملاحظاتك بنجاح  ', '', 'success');\n    } catch (e) {\n      console.error('[AI] Error saving note to localStorage:', e);\n      this.toast('فشل حفظ الملاحظة، المساحة قد تكون ممتلئة', '', 'danger');\n    }";
        content = content.replace(t2_start_n, replaceBlock2_n);
        console.log("Block 2 replaced successfully (LF)");
    } else {
        console.log("Block 2 start not found");
    }
}

fs.writeFileSync(path, content, 'utf8');
