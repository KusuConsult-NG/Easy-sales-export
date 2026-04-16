import os
import re

def process_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception:
        return

    # Replace result.data?.property with result.property
    new_content = re.sub(r'(\b[a-zA-Z0-9_]+esult|\b[a-zA-Z0-9_]*es)\.data\?\.', r'\1.', content)
    # Replace result.data.property with result.property
    new_content = re.sub(r'(\b[a-zA-Z0-9_]+esult|\b[a-zA-Z0-9_]*es)\.data\.', r'\1.', new_content)
    
    # Replace result.data) with result)
    new_content = re.sub(r'(\b[a-zA-Z0-9_]+esult|\b[a-zA-Z0-9_]*es)\.data\b', r'\1', new_content)
    
    if content != new_content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Updated: {filepath}")

targets = ['src/app']

for target in targets:
    if not os.path.exists(target): continue
    for root, dirs, files in os.walk(target):
        for file in files:
            if file.endswith('.tsx') or file.endswith('.ts'):
                process_file(os.path.join(root, file))

