import os
import re

html_path = r"c:\Users\kde\Desktop\kedwebcbs-main\www\offline.html"
with open(html_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace hardcoded font
content = content.replace("font-family: 'Segoe UI', Tahoma, sans-serif;", "font-family: 'Cairo', system-ui, -apple-system, sans-serif;")

# Include style.css if not there
if "style.css" not in content:
    content = content.replace("</head>", '  <link rel="stylesheet" href="/css/style.css?v=2026081907">\n</head>')

# Replace colors with vars
content = content.replace("#0d3b66", "var(--primary)")
content = content.replace("#1a5276", "var(--accent)")
content = content.replace("#2563eb", "var(--primary)")
content = content.replace("#3b82f6", "var(--primary-light)")

# Add "go to home" link
# Find <button class="retry-btn"...
button_pattern = r'(<button class="retry-btn".*?</button>)'
home_link = '\n  <a href="/welcome.html" class="retry-btn" style="background: rgba(255,255,255,0.2); margin-top: 10px; text-decoration: none; display: inline-flex; justify-content: center;">\n    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>\n    الرئيسية\n  </a>'

if 'href="/welcome.html"' not in content:
    content = re.sub(button_pattern, r'\1' + home_link, content, flags=re.DOTALL)

with open(html_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated offline.html")
