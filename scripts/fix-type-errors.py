import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

pattern = re.compile(r'(if\s*\(!sessionResult\.session\)\s*return\s*\{[^}]*error:\s*sessionResult\.error\.error)(\s*\};)')

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Also check for success: boolean; error: string | null patterns in types
    # and common error: undefined
    
    modified = False
    
    # 1. Fix session failure returns
    new_content, count = pattern.subn(r'\1, data: null\2', content)
    if count > 0:
        modified = True
        content = new_content
    
    # 2. Fix error: undefined to error: null
    new_content, count = re.subn(r'error:\s*undefined', 'error: null', content)
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
