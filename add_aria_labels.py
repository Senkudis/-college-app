import os
import re

html_dir = r"c:\Users\kde\Desktop\kedwebcbs-main\www"

# Map icon class to aria-label
icon_to_label = {
    'ri-moon-line': 'تبديل الوضع الليلي',
    'ri-sun-line': 'تبديل الوضع الليلي',
    'ri-search-line': 'بحث',
    'ri-notification-line': 'الإشعارات',
    'ri-notification-3-line': 'الإشعارات',
    'ri-arrow-right-s-line': 'رجوع',
    'ri-arrow-left-s-line': 'رجوع',
    'ri-close-line': 'إغلاق',
    'ri-menu-line': 'القائمة',
    'ri-menu-2-line': 'القائمة',
    'ri-menu-3-line': 'القائمة',
    'ri-settings-line': 'الإعدادات',
    'ri-settings-3-line': 'الإعدادات',
    'ri-edit-line': 'تعديل',
    'ri-edit-2-line': 'تعديل',
    'ri-delete-bin-line': 'حذف',
    'ri-delete-bin-7-line': 'حذف',
    'ri-logout-box-r-line': 'تسجيل الخروج', # Add some others if needed, but the prompt just specified those
    'ri-more-2-line': 'خيارات',
    'ri-more-fill': 'خيارات'
}

# Find all buttons that lack aria-label
# This is tricky with regex. Let's do a simple approach:
# Find <button ...> ... </button>
# If no aria-label inside <button ...>, and it contains <i class="... ri-... "></i>
# Insert aria-label into <button ...>

def process_html_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    original_content = content

    # Regex to find buttons
    # group 1: button tag inner attrs (e.g. class="btn" onclick="...")
    # group 2: button body
    button_pattern = re.compile(r'<button([^>]*)>(.*?)</button>', re.IGNORECASE | re.DOTALL)
    
    def button_replacer(match):
        attrs = match.group(1)
        body = match.group(2)
        
        # Check if already has aria-label
        if 'aria-label' in attrs.lower():
            return match.group(0)
            
        # Check if button body has an icon
        i_tag_match = re.search(r'<i\s+class="[^"]*(ri-[a-zA-Z0-9-]+)[^"]*"', body)
        if not i_tag_match:
            # Maybe the icon is on the button itself?
            # Check button classes
            class_match = re.search(r'class="[^"]*(ri-[a-zA-Z0-9-]+)[^"]*"', attrs)
            if class_match:
                icon_class = class_match.group(1)
            else:
                return match.group(0)
        else:
            icon_class = i_tag_match.group(1)

        # Map to label
        label = icon_to_label.get(icon_class)
        # Handle some fallbacks for variations like ri-close-fill etc
        if not label:
            if 'moon' in icon_class or 'sun' in icon_class: label = 'تبديل الوضع الليلي'
            elif 'search' in icon_class: label = 'بحث'
            elif 'notification' in icon_class: label = 'الإشعارات'
            elif 'arrow' in icon_class: label = 'رجوع'
            elif 'close' in icon_class: label = 'إغلاق'
            elif 'menu' in icon_class: label = 'القائمة'
            elif 'setting' in icon_class: label = 'الإعدادات'
            elif 'edit' in icon_class or 'pencil' in icon_class: label = 'تعديل'
            elif 'delete' in icon_class or 'trash' in icon_class: label = 'حذف'
        
        if label:
            new_attrs = attrs + f' aria-label="{label}"'
            return f'<button{new_attrs}>{body}</button>'
        
        return match.group(0)

    new_content = button_pattern.sub(button_replacer, content)

    # Let's also handle a tags used as icon buttons with class containing icon-btn or similar if they lack aria-label
    # Wait, the instruction specifically says: "Search for patterns like `<button` containing icon classes..."
    # So buttons only.

    if new_content != original_content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        return True
    return False

modified_files = []
for root, dirs, files in os.walk(html_dir):
    for f in files:
        if f.endswith('.html'):
            path = os.path.join(root, f)
            if process_html_file(path):
                modified_files.append(path)

print("Modified files:")
for f in modified_files:
    print(f)
