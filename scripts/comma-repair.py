import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # Fix missing commas before data: null
    # Pattern: error: some.thing data: null
    missing_comma = re.compile(r'(error:\s*[^,}]*?)\s+(data:\s*null)', re.DOTALL)
    content = missing_comma.sub(r'\1, \2', content)

    # Fix success: true as const without comma
    # Pattern: success: true as const data: null
    missing_comma_success = re.compile(r'(success:\s*true\s*as\s*const)\s+(data:\s*null)', re.DOTALL)
    content = missing_comma_success.sub(r'\1, \2', content)

    # Fix success: false as const without comma
    missing_comma_false = re.compile(r'(success:\s*false\s*as\s*const)\s+(data:\s*null)', re.DOTALL)
    content = missing_comma_false.sub(r'\1, \2', content)

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

print(f"Comma repair applied to {modified_count} files.")
