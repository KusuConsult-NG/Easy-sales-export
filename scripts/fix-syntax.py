import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    modified = False
    
    # 1. Fix data: type,;
    new_content, count = re.subn(r'data:\s*([^,;]+),\s*;', r'data: \1;', content)
    if count > 0:
        modified = True
        content = new_content

    # 2. Fix meta?: any,;
    new_content, count = re.subn(r'meta\?:\s*([^,;]+),\s*;', r'meta?: \1;', content)
    if count > 0:
        modified = True
        content = new_content
        
    # 3. Fix double semicolons or comma-semicolon patterns
    new_content, count = re.subn(r',\s*;', r';', content)
    if count > 0:
        modified = True
        content = new_content

    if modified:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False

modified_count = 0
for root, dirs, files in os.walk(actions_dir):
    for file in files:
        if file.endswith('.ts') or file.endswith('.tsx'):
            if fix_file(os.path.join(root, file)):
                modified_count += 1

print(f"Fixed syntax in {modified_count} files.")
