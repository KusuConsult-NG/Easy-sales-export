import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # Pattern A: Failure with data: { ... } -> data: null
    # return { success: false as const, error: ..., data: { ... } }
    # regex for object literal with data property that isn't null/undefined
    failure_with_data = re.compile(r'(\breturn\s*\{\s*success:\s*false\s*as\s*const\s*,\s*error:\s*.*?,)\s*data:\s*\{.*?\}', re.DOTALL)
    content = failure_with_data.sub(r'\1 data: null', content)

    # Pattern B: Success with error: string -> success: false
    # return { success: true as const, error: "..." }
    content = re.sub(r'success:\s*true\s*as\s*const\s*,\s*error:\s*"(.*?)"', r'success: false as const, error: "\1"', content)

    # Pattern C: Success missing error: null
    # return { success: true as const, data: ... } (if error: null is missing)
    def fix_missing_error_null(match):
        obj = match.group(0)
        if 'error:' not in obj:
            return obj.replace('{', '{ error: null, ', 1)
        return obj

    # Match return objects that start with success: true as const
    content = re.sub(r'return\s*\{\s*success:\s*true\s*as\s*const.*?;', fix_missing_error_null, content, flags=re.DOTALL)

    # Pattern D: Failure missing data: null
    def fix_missing_data_null(match):
        obj = match.group(0)
        if 'data:' not in obj:
            return obj.replace('}', ', data: null }')
        return obj

    content = re.sub(r'return\s*\{\s*success:\s*false\s*as\s*const.*?;', fix_missing_data_null, content, flags=re.DOTALL)

    # Cleanup multiple commas or weird spacings
    content = re.sub(r',\s*,', ',', content)
    content = re.sub(r'\{\s*,', '{', content)
    
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

print(f"Aggressive hardening applied to {modified_count} files.")
