file_path = 'c:/Users/kde/Desktop/kedwebcbs-main/www/js/app.js'
with open(file_path, 'rb') as f:
    raw = f.read()

# Fix CP1252 / Mojibake string
text = raw.decode('utf-8', errors='ignore')

def try_fix(s):
    try:
        return s.encode('cp1252').decode('utf-8')
    except:
        try:
            return s.encode('latin1').decode('utf-8')
        except:
            return s

# Line by line fix
fixed_lines = []
for line in text.splitlines():
    if 'Ã' in line or 'Å' in line or 'Ä' in line or 'Â' in line:
        fixed_lines.append(try_fix(line))
    else:
        fixed_lines.append(line)

new_content = '\n'.join(fixed_lines)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Encoding repair finished for app.js!")
