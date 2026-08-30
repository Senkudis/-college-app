const fs = require('fs');
const path = 'c:/Users/kde/Desktop/kedwebcbs-main/www/js/app.js';
let content = fs.readFileSync(path, 'utf8');

// Undo the fuzzy matcher error
content = content.replace(
  'ملخص شامل لمادة كاملة',
  'ملخص شامل للمادة كاملة'
);

const target1 = `        botMsg.innerHTML = this.formatAiResponse(data.answer) + interactiveHtml + \n          \`<br><button onclick="CBS._saveGlobalNote('\\${this.escapeHTML(msg)}', '\\${this.escapeHTML(data.answer)}')\" style=\"margin-top:8px;padding:3px 8px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:0.75rem;font-weight:700;\"><i class=\"ri-bookmark-3-line\"></i> حفظ في ملاحظاتي  </button>\`;\n      } else {\n        botMsg.innerHTML = '<span style=\"color:var(--danger)\">' + (data.message || 'حدث خطأ في الإجابة') + '</span>';\n      }\n    } catch {\n      botMsg.innerHTML = '<span style=\"color:var(--danger)\">تعذّر الاتصال بالخادم الذكي</span>';\n    }`;

const replace1 = `        const jsMsg = this.escapeHTML(this.escapeJS(msg));\n        const jsAns = this.escapeHTML(this.escapeJS(data.answer));\n        botMsg.innerHTML = this.formatAiResponse(data.answer) + interactiveHtml + \n          \`<br><button onclick="CBS._saveGlobalNote('\\${jsMsg}', '\\${jsAns}')\" style=\"margin-top:8px;padding:3px 8px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:0.75rem;font-weight:700;\"><i class=\"ri-bookmark-3-line\"></i> حفظ في ملاحظاتي  </button>\`;\n      } else {\n        botMsg.innerHTML = '<span style=\"color:var(--danger)\">' + (data?.message || 'الخادم لم يرسل إجابة صالحة') + '</span>';\n      }\n    } catch (e) {\n      console.error('[AI] Fetch error:', e);\n      botMsg.innerHTML = '<span style=\"color:var(--danger)\">تعذّر الاتصال بالخادم الذكي</span>';\n    }`;

content = content.replace(target1, replace1);

const target2 = `    try {\n      const notes = JSON.parse(localStorage.getItem('cbs_saved_notes') || '[]');\n      notes.unshift({\n        id: 'note_' + Date.now(),\n        subject: 'المساعد الذكي (كيدي)',\n        title: title || 'ملاحظة كيدي',\n        content: content,\n        date: new Date().toLocaleDateString('ar-SD', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })\n      });\n      localStorage.setItem('cbs_saved_notes', JSON.stringify(notes));\n      this.toast('تم الحفظ في ملاحظاتك بنجاح  ', '', 'success');\n    } catch(e){}`;

const replace2 = `    try {\n      const notes = JSON.parse(localStorage.getItem('cbs_saved_notes') || '[]');\n      notes.unshift({\n        id: 'note_' + Date.now(),\n        subject: 'المساعد الذكي (كيدي)',\n        title: title || 'ملاحظة كيدي',\n        content: content,\n        date: new Date().toLocaleDateString('ar-SD', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })\n      });\n      localStorage.setItem('cbs_saved_notes', JSON.stringify(notes));\n      this.toast('تم الحفظ في ملاحظاتك بنجاح  ', '', 'success');\n    } catch (e) {\n      console.error('[AI] Error saving note to localStorage:', e);\n      this.toast('فشل حفظ الملاحظة، المساحة قد تكون ممتلئة', '', 'danger');\n    }`;

content = content.replace(target2, replace2);

fs.writeFileSync(path, content, 'utf8');
console.log('Done');
