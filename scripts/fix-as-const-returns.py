import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    modified = False
    
    # 1. Fix success: true to success: true as const in returns
    new_content, count = re.subn(r'success:\s*true\s*([,}])', r'success: true as const\1', content)
    if count > 0:
        modified = True
        content = new_content

    # 2. Fix success: false to success: false as const in returns
    new_content, count = re.subn(r'success:\s*false\s*([,}])', r'success: false as const\1', content)
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

print(f"Added as const to {modified_count} files.")
