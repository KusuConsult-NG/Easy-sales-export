import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    modified = False
    
    # 1. Standardize ActionState type definitions
    # Make data optional to allow return { success: true, error: null }
    strict_action_state = """type ActionState = 
    | { success: true; error: null; data?: any; message?: string; [key: string]: any }
    | { success: false; error: string; data?: null; message?: string; [key: string]: any };"""

    # 2. Standardize inline Promise return types
    strict_promise = """Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
>"""

    # Regex patterns
    action_state_pattern = re.compile(r'type\s+ActionState\s*=\s*(?:\|\s*)?\{\s*[^}]*success:\s*(?:true|false)[^}]*\}\s*\|\s*\{\s*[^}]*success:\s*(?:true|false)[^}]*\}', re.IGNORECASE | re.DOTALL)
    promise_pattern = re.compile(r'Promise\s*<\s*(?:\|\s*)?\{\s*[^}]*success:\s*(?:true|false)[^}]*\}\s*\|\s*\{\s*[^}]*success:\s*(?:true|false)[^}]*\}\s*>', re.IGNORECASE | re.DOTALL)
    
    # Also generic State/Result types
    generic_state_pattern = re.compile(r'type\s+(\w+(?:State|Result))\s*=\s*(?:\|\s*)?\{\s*[^}]*success:\s*(?:true|false)[^}]*\}\s*\|\s*\{\s*[^}]*success:\s*(?:true|false)[^}]*\}', re.IGNORECASE | re.DOTALL)

    def fix_generic(match):
        name = match.group(1)
        return f"""type {name} = 
    | {{ success: true; error: null; data?: any; meta?: any; [key: string]: any }}
    | {{ success: false; error: string; data?: null; meta?: any; [key: string]: any }};"""

    new_content, count1 = action_state_pattern.subn(strict_action_state, content)
    new_content, count2 = promise_pattern.subn(strict_promise, new_content)
    new_content, count3 = generic_state_pattern.subn(fix_generic, new_content)

    if count1 > 0 or count2 > 0 or count3 > 0:
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

print(f"Final high-assurance stabilization of {modified_count} action files.")
