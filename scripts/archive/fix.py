import sys, re
path = r'c:\Users\kde\Desktop\kedwebcbs-main\www\js\app.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace block 1 using regex
content, count1 = re.subn(
    r'botMsg\.innerHTML = this\.formatAiResponse\(data\.answer\) \+ interactiveHtml \+[\s\S]*?} catch {[\s\S]*?تعذّر الاتصال بالخادم الذكي<\/span>\';\s*?}',
    '''        const jsMsg = this.escapeHTML(this.escapeJS(msg));
        const jsAns = this.escapeHTML(this.escapeJS(data.answer));
        botMsg.innerHTML = this.formatAiResponse(data.answer) + interactiveHtml + 
          `<br><button onclick="CBS._saveGlobalNote('${jsMsg}', '${jsAns}')" style="margin-top:8px;padding:3px 8px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:0.75rem;font-weight:700;"><i class="ri-bookmark-3-line"></i> حفظ في ملاحظاتي  </button>`;
      } else {
        botMsg.innerHTML = '<span style="color:var(--danger)">' + (data?.message || 'الخادم لم يرسل إجابة صالحة') + '</span>';
      }
    } catch (e) {
      console.error('[AI] Fetch error:', e);
      botMsg.innerHTML = '<span style="color:var(--danger)">تعذّر الاتصال بالخادم الذكي</span>';
    }''',
    content
)

# Replace block 2 using regex
content, count2 = re.subn(
    r'localStorage\.setItem\(\'cbs_saved_notes\', JSON\.stringify\(notes\)\);\s*this\.toast\(\'تم الحفظ في ملاحظاتك بنجاح  \', \'\', \'success\'\);\s*\} catch\(e\)\{\}',
    '''      localStorage.setItem('cbs_saved_notes', JSON.stringify(notes));
      this.toast('تم الحفظ في ملاحظاتك بنجاح  ', '', 'success');
    } catch (e) {
      console.error('[AI] Error saving note to localStorage:', e);
      this.toast('فشل حفظ الملاحظة، المساحة قد تكون ممتلئة', '', 'danger');
    }''',
    content
)

print(f'Block 1 replaced {count1} times.')
print(f'Block 2 replaced {count2} times.')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
