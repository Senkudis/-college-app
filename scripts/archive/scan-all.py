import os, re

def check_and_fix_mojibake(directory):
    corrupted_files = []
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith(('.js', '.html', '.css')):
                filepath = os.path.join(root, file)
                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    # Check for typical Mojibake patterns
                    if re.search(r'Ã[\u0080-\u00BF]|Å[\u0080-\u00BF]|Ä[\u0080-\u00BF]|Â[\u0080-\u00BF]', content):
                        corrupted_files.append(filepath)
                        
                        # Try to unmojibake
                        def unmojibake(text):
                            byte_list = []
                            for char in text:
                                try:
                                    byte_list.append(char.encode('cp1252'))
                                except:
                                    byte_list.append(char.encode('utf-8'))
                            full_bytes = b''.join(byte_list)
                            return full_bytes.decode('utf-8', errors='ignore')
                        
                        fixed = unmojibake(unmojibake(content))
                        with open(filepath, 'w', encoding='utf-8') as f:
                            f.write(fixed)
                        print(f"Fixed Mojibake in: {filepath}")
                except Exception as e:
                    pass
    return corrupted_files

www_corrupted = check_and_fix_mojibake('c:/Users/kde/Desktop/kedwebcbs-main/www')
routes_corrupted = check_and_fix_mojibake('c:/Users/kde/Desktop/kedwebcbs-main/routes')

print(f"Scan complete. Corrupted files found & repaired: {len(www_corrupted) + len(routes_corrupted)}")
