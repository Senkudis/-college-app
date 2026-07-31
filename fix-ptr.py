import sys, re

# 1. Update app.js
app_path = 'c:/Users/kde/Desktop/kedwebcbs-main/www/js/app.js'
with open(app_path, 'r', encoding='utf-8') as f:
    app_content = f.read()

new_ptr_func = '''    const shouldPreventPTR = (target) => {
      // 1. Block if PDF modal, viewer or any modal/overlay/sidebar is open
      const pdfModal = document.getElementById('pdfModal');
      if (pdfModal && (pdfModal.style.display === 'flex' || pdfModal.style.display === 'block')) return true;
      if (document.querySelector('.modal-overlay.show, .modal.show, .modal-open, .lightbox-overlay.active, #globalSearchOverlay, #iosInstallOverlay, .sidebar.open, .subject-sidebar.active')) return true;

      // 2. Block if user is focusing or typing in any form control
      const activeEl = document.activeElement;
      if (activeEl && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName)) return true;

      // 3. Block if touch started inside a form, input, modal, PDF viewer, editor, AI container, sidebar or opted-out container
      if (target && target.closest && target.closest('form, .modal-overlay, .modal-box, .modal-body, #pdfModal, #pdfCanvasWrap, iframe, canvas, input, textarea, select, .editor, .input-wrap, [contenteditable], [data-no-ptr], .subject-sidebar, .ai-chat, .ai-container, .ai-section, #aiChatMessages, .chat-box, .sidebar, .tab-pane, .tab-content, [class*="ai-"], [class*="sidebar"], [id*="ai"]')) return true;

      // 4. Block if target or any parent is an internal scrollable container
      let el = target;
      while (el && el !== document.body && el !== document.documentElement) {
        if (el.nodeType === 1) {
          const style = window.getComputedStyle(el);
          const overflowY = style.overflowY;
          if (overflowY === 'auto' || overflowY === 'scroll') {
            return true;
          }
        }
        el = el.parentElement;
      }

      // 5. Block if any editable area on the page has unsaved content
      if (Array.from(document.querySelectorAll('[contenteditable]')).some(el => el.textContent.trim() !== '')) return true;

      // 6. Block if any form on the page contains active unsubmitted user inputs
      const dirtyForm = Array.from(document.querySelectorAll('form input:not([type="hidden"]), form textarea')).some(el => el.value && el.value.trim() !== '');
      if (dirtyForm) return true;

      return false;
    };'''

app_content = re.sub(r'const shouldPreventPTR = \(target\) => \{[\s\S]*?\};\s*document\.addEventListener\(\'touchstart\'', new_ptr_func + '\n\n    document.addEventListener(\'touchstart\'', app_content)

with open(app_path, 'w', encoding='utf-8') as f:
    f.write(app_content)

# 2. Update subject.html to add overscroll-behavior: contain to AI sidebar and tabs
sub_path = 'c:/Users/kde/Desktop/kedwebcbs-main/www/subject.html'
with open(sub_path, 'r', encoding='utf-8') as f:
    sub_content = f.read()

css_inject = '''
/* Prevent PTR / Overscroll inside AI sidebar and scrollable tabs */
.subject-sidebar, .tab-content, #aiTab, #notesTab, #plannerTab, .ai-chat-messages, [class*="ai-"] {
  overscroll-behavior: contain !important;
  overscroll-behavior-y: contain !important;
  -webkit-overflow-scrolling: touch;
}
</style>'''

if 'overscroll-behavior: contain !important;' not in sub_content:
    sub_content = sub_content.replace('</style>', css_inject)
    with open(sub_path, 'w', encoding='utf-8') as f:
        f.write(sub_content)

print("PTR and Overscroll fixed successfully in app.js and subject.html!")
