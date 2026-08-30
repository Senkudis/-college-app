const fs = require('fs');
const path = 'c:/Users/kde/Desktop/kedwebcbs-main/www/js/app.js';
let content = fs.readFileSync(path, 'utf8');

const t1 = `        botMsg.innerHTML = this.formatAiResponse(data.answer) + interactiveHtml + \n          \`<br><button onclick="CBS._saveGlobalNote('\\${this.escapeHTML(msg)}', '\\${this.escapeHTML(data.answer)}')\" style=\"margin-top:8px;padding:3px 8px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:0.75rem;font-weight:700;\"><i class=\"ri-bookmark-3-line\"></i> حفظ في ملاحظاتي  </button>\`;\n      } else {\n        botMsg.innerHTML = '<span style=\"color:var(--danger)\">' + (data.message || 'حدث خطأ في الإجابة') + '</span>';\n      }\n    } catch {\n      botMsg.innerHTML = '<span style=\"color:var(--danger)\">تعذّر الاتصال بالخادم الذكي</span>';\n    }\n    sendBtn.disabled = false;`;

const r1 = `        const jsMsg = this.escapeHTML(this.escapeJS(msg));\n        const jsAns = this.escapeHTML(this.escapeJS(data.answer));\n        botMsg.innerHTML = this.formatAiResponse(data.answer) + interactiveHtml + \n          \`<br><button onclick="CBS._saveGlobalNote('\\${jsMsg}', '\\${jsAns}')\" style=\"margin-top:8px;padding:3px 8px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:0.75rem;font-weight:700;\"><i class=\"ri-bookmark-3-line\"></i> حفظ في ملاحظاتي  </button>\`;\n      } else {\n        botMsg.innerHTML = '<span style=\"color:var(--danger)\">' + (data?.message || 'الخادم لم يرسل إجابة صالحة') + '</span>';\n      }\n    } catch (e) {\n      console.error('[AI] Fetch error:', e);\n      botMsg.innerHTML = '<span style=\"color:var(--danger)\">تعذّر الاتصال بالخادم الذكي</span>';\n    }\n    sendBtn.disabled = false;`;

const t2 = `      localStorage.setItem('cbs_saved_notes', JSON.stringify(notes));\n      this.toast('تم الحفظ في ملاحظاتك بنجاح  ', '', 'success');\n    } catch(e){}\n  },`;

const r2 = `      localStorage.setItem('cbs_saved_notes', JSON.stringify(notes));\n      this.toast('تم الحفظ في ملاحظاتك بنجاح  ', '', 'success');\n    } catch (e) {\n      console.error('[AI] Error saving note to localStorage:', e);\n      this.toast('فشل حفظ الملاحظة، المساحة قد تكون ممتلئة', '', 'danger');\n    }\n  },`;

if (content.includes(t1)) {
    content = content.replace(t1, r1);
    console.log('Block 1 replaced');
} else {
    console.log('Block 1 not found');
}

if (content.includes(t2)) {
    content = content.replace(t2, r2);
    console.log('Block 2 replaced');
} else {
    console.log('Block 2 not found');
}

fs.writeFileSync(path, content, 'utf8');
