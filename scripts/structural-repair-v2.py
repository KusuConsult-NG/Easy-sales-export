import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # Pattern 1: Single backtick corruption
    # return { ..., success: true as const` },
    single_backtick = re.compile(r'(success:\s*true\s*as\s*const)`\s*\}', re.DOTALL)
    content = single_backtick.sub(r'\1, data: null }', content)

    # Pattern 2: Success with error message inside template literal (previously injected)
    # error: `... (some, data: null) ...`
    injected_template = re.compile(r'`([^`]*?),\s*data:\s*null\s*([^`]*?)`', re.DOTALL)
    while injected_template.search(content):
        content = injected_template.sub(r'`\1\2`', content)

    # Pattern 3: Payload structural corruption
    payload_corruption = re.compile(r'const\s+payload\s*=\s*\{\s*error:\s*null\s*,\s*success:\s*true\s*as\s*const\s*\}\s*,\s*meta:\s*null\s*\};', re.DOTALL)
    content = payload_corruption.sub(r'const payload = { error: null, success: true as const, data: null, meta: null };', content)

    # Pattern 4: Nested success in catch blocks or returns
    nested_success = re.compile(r'return\s*\{\s*error:\s*null\s*,\s*success:\s*true\s*as\s*const\s*\}\s*\};', re.DOTALL)
    content = nested_success.sub(r'return { error: null, success: true as const, data: null };', content)

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

print(f"Fixed structural syntax corruption (v2) in {modified_count} files.")
