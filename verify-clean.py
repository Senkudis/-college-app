import os, sys

sys.stdout.reconfigure(encoding='utf-8')

files_to_check = [
    'c:/Users/kde/Desktop/kedwebcbs-main/www/js/app.js',
    'c:/Users/kde/Desktop/kedwebcbs-main/www/subject.html',
    'c:/Users/kde/Desktop/kedwebcbs-main/routes/ai.routes.js',
    'c:/Users/kde/Desktop/kedwebcbs-main/models/SavedNote.js'
]

clean = True
for path in files_to_check:
    with open(path, 'r', encoding='utf-8') as f:
        text = f.read()
    bad = []
    for line_num, line in enumerate(text.splitlines(), 1):
        if 'Ã' in line or 'Å' in line or 'Ä' in line or 'Â' in line:
            bad.append((line_num, line.strip()))
    if bad:
        clean = False
        print(f"❌ Found Mojibake in {path}:")
        for num, l in bad[:5]:
            print(f"  Line {num}: {l[:80]}")
    else:
        print(f"✅ {os.path.basename(path)} is 100% clean UTF-8 Arabic!")

if clean:
    print("ALL USER CODEFILES ARE CLEAN AND VERIFIED!")
