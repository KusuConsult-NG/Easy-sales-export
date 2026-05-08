import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    modified = False
    
    # 1. Standardize success: true returns
    # Add error: null if missing, ensure data: is present if needed (though success: true usually has data)
    def fix_success_true(match):
        inner = match.group(1)
        if 'error:' not in inner:
            inner += ', error: null'
        # Clean up spaces/commas
        inner = re.sub(r'\s*,\s*', ', ', inner).strip(', ')
        return f'return {{ {inner} }}'

    new_content, count = re.subn(r'return\s*\{\s*([^}]*success:\s*true as const[^}]*)\}', fix_success_true, content)
    if count > 0:
        modified = True
        content = new_content

    # 2. Standardize success: false returns
    # Add data: null if missing, ensure error: is present
    def fix_success_false(match):
        inner = match.group(1)
        if 'data:' not in inner:
            inner += ', data: null'
        # Clean up spaces/commas
        inner = re.sub(r'\s*,\s*', ', ', inner).strip(', ')
        return f'return {{ {inner} }}'

    new_content, count = re.subn(r'return\s*\{\s*([^}]*success:\s*false as const[^}]*)\}', fix_success_false, content)
    if count > 0:
        modified = True
        content = new_content

    # 3. Final cleanup of spacing inside braces
    new_content, count = re.subn(r'\{\s+([^}]+)\s+\}', r'{ \1 }', content)
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

print(f"Standardized returns in {modified_count} files.")
