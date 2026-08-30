import re

with open('c:/Users/kde/Desktop/kedwebcbs-main/www/js/login.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(r'showError\((.*?)\)', r"showToast(\1, 'error')", content)
content = re.sub(r'showSuccess\((.*?)\)', r"showToast(\1, 'success')", content)

with open('c:/Users/kde/Desktop/kedwebcbs-main/www/js/new_toast.js', 'r', encoding='utf-8') as f:
    new_toast_func = f.read()

pattern = r'function showError\(message\) \{[\s\S]*?return container;\s*\}'
content = re.sub(pattern, new_toast_func, content)

with open('c:/Users/kde/Desktop/kedwebcbs-main/www/js/login.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done!')
