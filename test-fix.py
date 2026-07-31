file_path = 'c:/Users/kde/Desktop/kedwebcbs-main/www/js/app.js'
with open(file_path, 'rb') as f:
    raw = f.read()

# Try decoding
text = raw.decode('utf-8', errors='ignore')

# Fix Mojibake if present
try:
    fixed = text.encode('latin1').decode('utf-8')
    print("Fixed 1-level Mojibake!")
    try:
        fixed2 = fixed.encode('latin1').decode('utf-8')
        print("Fixed 2-level Mojibake!")
        text = fixed2
    except:
        text = fixed
except Exception as e:
    print("No Mojibake or error:", e)

# Print first 20 lines with Arabic to check
lines = text.split('\n')
for i, l in enumerate(lines[:1000]):
    if 'كيدي' in l or 'إشعار' in l or 'مادة' in l or 'وضع' in l:
        print(f"Line {i+1}: {l[:80]}")
        break
else:
    print("Sample lines:", lines[890:900])
