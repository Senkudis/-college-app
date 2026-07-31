file_path = 'c:/Users/kde/Desktop/kedwebcbs-main/www/js/app.js'
with open(file_path, 'r', encoding='utf-8') as f:
    text = f.read()

def fix_double(s):
    try:
        # First un-mojibake
        b1 = s.encode('cp1252')
        s1 = b1.decode('utf-8')
        # Second un-mojibake
        b2 = s1.encode('cp1252')
        return b2.decode('utf-8')
    except Exception as e:
        try:
            b1 = s.encode('cp1252')
            return b1.decode('utf-8')
        except:
            return s

fixed_lines = [fix_double(line) for line in text.splitlines()]
new_content = '\n'.join(fixed_lines)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Double Mojibake fixed!")
