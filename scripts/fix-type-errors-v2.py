import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

# Pattern for returns missing data: null
pattern1 = re.compile(r'(return\s*\{[^}]*success:\s*false[^}]*error:\s*[^,}]+)(\s*\};)')

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    modified = False
    
    # 1. Fix returns missing data: null
    # We want to be careful not to double add data: null
    def add_data_null(match):
        block = match.group(1)
        suffix = match.group(2)
        if 'data:' not in block:
            return f"{block}, data: null{suffix}"
        return match.group(0)

    new_content, count = pattern1.subn(add_data_null, content)
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

print(f"Fixed {modified_count} files.")
