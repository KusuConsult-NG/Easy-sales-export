import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # Fix string;, pattern in types
    content = content.replace('error: string;, data: null', 'error: string; data: null')
    content = content.replace('error: string;,', 'error: string;')
    
    # Fix any remaining success: false as const without data: null in return objects
    def fix_return(match):
        obj = match.group(0)
        if 'data:' not in obj:
            return obj.replace('}', ', data: null }')
        return obj

    content = re.sub(r'return\s*\{\s*[^}]*?success:\s*false\s*as\s*const\s*\}', fix_return, content, flags=re.DOTALL)
    content = re.sub(r'return\s*\{\s*[^}]*?success:\s*true\s*as\s*const\s*\}', fix_return, content, flags=re.DOTALL)

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

print(f"Type and return repair applied to {modified_count} files.")
