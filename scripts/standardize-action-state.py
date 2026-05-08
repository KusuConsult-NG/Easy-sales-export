import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    modified = False
    
    # Standardize ActionState type definitions
    # Match type ActionState = | { success: true ... } | { success: false ... }
    # OR type ActionState = { success: true ... } | { success: false ... }
    
    def fix_action_state(match):
        # We want to ensure success: true has error: null and success: false has data: null
        # And no 'as const' in the type definition
        return """type ActionState = 
    | { success: true; error: null; data?: any; message?: string; [key: string]: any }
    | { success: false; error: string; data?: null; message?: string; [key: string]: any };"""

    new_content, count = re.subn(r'type\s+ActionState\s*=\s*(?:\|\s*)?\{\s*success:\s*true[^}]*\}\s*\|\s*\{\s*success:\s*false[^}]*\}', fix_action_state, content, flags=re.IGNORECASE)
    if count == 0:
        new_content, count = re.subn(r'type\s+ActionState\s*=\s*(?:\|\s*)?\{\s*success:\s*false[^}]*\}\s*\|\s*\{\s*success:\s*true[^}]*\}', fix_action_state, content, flags=re.IGNORECASE)

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

print(f"Standardized ActionState in {modified_count} files.")
