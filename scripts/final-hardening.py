import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # 1. Fix nested success with error: null inside data
    # { success: true, data: { ..., error: null } } -> { success: true, error: null, data: { ... } }
    nested_success_pattern = re.compile(r'\{\s*success:\s*true\s*as\s*const\s*,\s*data:\s*\{\s*(.*?)\s*,\s*error:\s*null\s*\}\s*\}', re.DOTALL)
    content = nested_success_pattern.sub(r'{ success: true as const, error: null, data: { \1 } }', content)

    # 2. Fix success: true with error: "some string"
    # { success: true ..., error: "some string" } -> { success: false ..., error: "some string" }
    success_with_error_msg = re.compile(r'\{\s*success:\s*true\s*as\s*const\s*,\s*error:\s*"(.*?)"', re.DOTALL)
    content = success_with_error_msg.sub(r'{ success: false as const, error: "\1"', content)

    # 3. Fix duplicate error key
    # error: null, ..., error: null
    duplicate_error_pattern = re.compile(r'error:\s*null\s*,\s*(.*?)\s*,\s*error:\s*null', re.DOTALL)
    content = duplicate_error_pattern.sub(r'error: null, \1', content)

    # 4. Fix specific case: { success: false as const, error: "...", data: undefined } -> data: null
    undefined_data_pattern = re.compile(r'success:\s*false\s*as\s*const\s*,\s*error:\s*(.*?)\s*,\s*data:\s*undefined', re.DOTALL)
    content = undefined_data_pattern.sub(r'success: false as const, error: \1, data: null', content)

    # 5. Fix common return mismatch where data is missing in failure
    # return { success: false as const, error: ... } (if it doesn't have data: null)
    # We only apply this to lines that look like returns and are clearly missing data
    # This is risky, so we do it line by line for return statements
    lines = content.split('\n')
    new_lines = []
    for line in lines:
        if 'return { success: false as const, error:' in line and 'data:' not in line:
            line = line.replace('}', ', data: null }')
        new_lines.append(line)
    content = '\n'.join(new_lines)

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

print(f"Final hardening applied to {modified_count} files.")
