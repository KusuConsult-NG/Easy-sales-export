import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    modified = False
    
    # 1. Fix double commas
    new_content, count = re.subn(r',\s*,', ',', content)
    if count > 0:
        modified = True
        content = new_content

    # 2. Fix trailing comma before closing brace
    new_content, count = re.subn(r',\s*\}', ' }', content)
    if count > 0:
        modified = True
        content = new_content

    # 3. Specific fix for withdrawal.ts issues
    if 'withdrawal.ts' in filepath:
        new_content, count = re.subn(r'data: null };\s*\}', 'data: null };\n        }', content)
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

print(f"Cleaned up syntax in {modified_count} files.")
