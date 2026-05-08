import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    modified = False
    
    # 1. Match ANY type definition that contains success: boolean or success: true/false
    # type SomethingState = | { success: ... } | { success: ... }
    # OR interface SomethingState { success: ... }
    
    # We'll look for types ending in 'State' or 'Result'
    pattern = re.compile(r'type\s+\w+(?:State|Result)\s*=\s*(?:\|\s*)?\{\s*[^}]*success:\s*(?:true|false)[^}]*\}\s*\|\s*\{\s*[^}]*success:\s*(?:true|false)[^}]*\}', re.IGNORECASE | re.DOTALL)
    
    def fix_generic_state(match):
        type_name = match.group(0).split(' ')[1]
        return f"""type {type_name} = 
    | {{ success: true; error: null; data: any; meta?: any; [key: string]: any }}
    | {{ success: false; error: string; data: null; meta?: any; [key: string]: any }};"""

    new_content, count = pattern.subn(fix_generic_state, content)
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

print(f"Standardized custom result types in {modified_count} files.")
