import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    modified = False
    
    # 1. Find Promise definitions and remove as const inside them
    # Promise<{ ... success: true as const ... }>
    def remove_as_const_in_promise(match):
        return match.group(0).replace(' as const', '')

    new_content, count = re.subn(r'Promise<.*?>', remove_as_const_in_promise, content, flags=re.DOTALL)
    if count > 0:
        modified = True
        content = new_content

    # 2. Find type/interface definitions and remove as const inside them
    new_content, count = re.subn(r'type\s+\w+\s*=\s*\{.*?\}|interface\s+\w+\s*\{.*?\}', remove_as_const_in_promise, content, flags=re.DOTALL)
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

print(f"Purged as const from types in {modified_count} files.")
