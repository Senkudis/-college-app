import os
import re

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Pattern for dash-card
    pattern_dash = r'<div\s+class="dash-card"\s+onclick="location\.href=\'([^\']+)\'">\s*([\s\S]*?)\s*</div>'
    
    def replacer_dash(match):
        href = match.group(1)
        inner = match.group(2)
        return f'<a href="{href}" class="dash-card" style="text-decoration:none;color:inherit;display:block;">\n      {inner}\n    </a>'

    content = re.sub(pattern_dash, replacer_dash, content)

    # Pattern for subject-card
    pattern_subject = r'<div\s+class="subject-card([^"]*)"\s+onclick="location\.href=\'([^\']+)\'">\s*([\s\S]*?)\s*</div>'
    
    def replacer_subject(match):
        classes = match.group(1)
        href = match.group(2)
        inner = match.group(3)
        return f'<a href="{href}" class="subject-card{classes}" style="text-decoration:none;color:inherit;display:block;">\n          {inner}\n        </a>'

    new_content = re.sub(pattern_subject, replacer_subject, content)

    if new_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Updated {filepath}")

# Process specific files
files = [
    r'c:\Users\kde\Desktop\kedwebcbs-main\www\dashboard.html',
    r'c:\Users\kde\Desktop\kedwebcbs-main\www\admin_dashboard.html',
    r'c:\Users\kde\Desktop\kedwebcbs-main\www\subjects.html'
]

for f in files:
    if os.path.exists(f):
        process_file(f)
    else:
        print(f"Not found: {f}")
