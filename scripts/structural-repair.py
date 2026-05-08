import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # Fix the specific "payload = { ..., success: true as const}, meta: null };" corruption
    # This was caused by the aggressive-hardening script's Pattern C/D
    payload_corruption = re.compile(r'const\s+payload\s*=\s*\{\s*error:\s*null\s*,\s*success:\s*true\s*as\s*const\s*\}\s*,\s*meta:\s*null\s*\};', re.DOTALL)
    content = payload_corruption.sub(r'const payload = { error: null, success: true as const, data: null, meta: null };', content)

    # Fix "return { error: null, success: true as const} };"
    return_corruption = re.compile(r'return\s*\{\s*error:\s*null\s*,\s*success:\s*true\s*as\s*const\s*\}\s*\};', re.DOTALL)
    content = return_corruption.sub(r'return { error: null, success: true as const, data: null };', content)

    # Fix "return { success: true as const` }," or similar
    backtick_corruption = re.compile(r'return\s*\{\s*error:\s*null\s*,\s*success:\s*true\s*as\s*const`[^`]*?`\s*\}\s*,', re.DOTALL)
    content = backtick_corruption.sub(r'return { error: null, success: true as const, data: null },', content)

    if content != original:
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

print(f"Fixed structural syntax corruption in {modified_count} files.")
