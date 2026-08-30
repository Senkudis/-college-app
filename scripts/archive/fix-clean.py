file_path = 'c:/Users/kde/Desktop/kedwebcbs-main/www/js/app.js'
with open(file_path, 'r', encoding='utf-8') as f:
    text = f.read()

def unmojibake(text):
    # Convert string to cp1252 bytes character by character if possible
    byte_list = []
    for char in text:
        try:
            byte_list.append(char.encode('cp1252'))
        except:
            byte_list.append(char.encode('utf-8'))
    
    # Combine bytes
    full_bytes = b''.join(byte_list)
    return full_bytes.decode('utf-8', errors='ignore')

# Apply unmojibake twice to fix double Mojibake
clean1 = unmojibake(text)
clean2 = unmojibake(clean1)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(clean2)

print("Character-by-character unmojibake completed!")
