import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    modified = False
    
    # Pattern 1: Promise<{ error: ..., success: boolean; ... }>
    # often with a comma between error and success
    promise_comma_pattern = re.compile(r'Promise\s*<\s*\{\s*error:\s*[^,;]+[,;]\s*success:\s*boolean;?\s*[^}]*\}\s*>', re.IGNORECASE | re.DOTALL)
    
    strict_promise = """Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
>"""

    new_content, count = promise_comma_pattern.subn(strict_promise, content)
    if count > 0:
        modified = True
        content = new_content

    # Pattern 2: interface SomethingState { error: null, success: boolean; ... }
    interface_pattern = re.compile(r'interface\s+(\w+State)\s*\{\s*error:\s*[^,;]+[,;]\s*success:\s*boolean;?\s*[^}]*\}', re.IGNORECASE | re.DOTALL)
    
    def fix_interface(match):
        name = match.group(1)
        return f"""type {name} = 
    | {{ success: true; error: null; data?: any; meta?: any; [key: string]: any }}
    | {{ success: false; error: string; data?: null; meta?: any; [key: string]: any }};"""

    new_content, count = interface_pattern.subn(fix_interface, content)
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

print(f"Standardized comma-separated results in {modified_count} files.")
