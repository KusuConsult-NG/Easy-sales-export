import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

# Pattern to find the old Promise return type
# Promise<{ error: null, success: boolean; data?: { ... } }>
promise_pattern = re.compile(r'Promise<\{\s*error:\s*null\s*,\s*success:\s*boolean;?\s*(meta\?:\s*any;?\s*)?data\?:\s*(\{.*?\}|any);?\s*\}>', re.DOTALL)

def transform_to_union(match):
    meta = match.group(1) or ""
    data_content = match.group(2)
    
    return f"""Promise<
    | {{ success: true; error: null; {meta}data: {data_content} }}
    | {{ success: false; error: string; {meta}data: null }}
>"""

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    new_content, count = promise_pattern.subn(transform_to_union, content)
    
    if count > 0:
        with open(filepath, 'w') as f:
            f.write(new_content)
        return True
    return False

modified_count = 0
for root, dirs, files in os.walk(actions_dir):
    for file in files:
        if file.endswith('.ts') or file.endswith('.tsx'):
            if fix_file(os.path.join(root, file)):
                modified_count += 1

print(f"Transformed types in {modified_count} files.")
