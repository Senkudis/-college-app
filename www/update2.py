import re

with open('c:/Users/kde/Desktop/kedwebcbs-main/www/login.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the HTML
pattern = r'<div class="btn-loader"[^>]*>\s*<div class="h"></div>\s*<div class="h"></div>\s*</div>'
content = re.sub(pattern, '<span class="btn-loading" id="btnLoader" style="display: none;"></span>', content)

# Remove the complex btn-loader CSS block
content = re.sub(r'\.btn-loader \{.*?\@keyframes uib-flow \{[^}]*\}\s*\}', '', content, flags=re.DOTALL)

# Add login.css to head
if 'login.css' not in content:
    content = re.sub(r'(</head>)', r'  <link rel="stylesheet" href="/css/login.css">\n\1', content)

with open('c:/Users/kde/Desktop/kedwebcbs-main/www/login.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done login.html')
