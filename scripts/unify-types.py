import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    modified = False
    
    # Unify ActionState definitions
    action_state_pattern = re.compile(r'type\s+ActionState\s*=\s*\{\s*error:\s*string;\s*success:\s*false;?.*?\}|type\s+ActionState\s*=\s*\{\s*success:\s*true;?.*?\}', re.DOTALL)
    
    # If ActionState is found as a simple object, convert to union
    if 'type ActionState =' in content and '|' not in content.split('type ActionState =')[1].split(';')[0]:
        # This is a bit risky to automate fully without knowing the exact structure
        pass

    # Fix error: string | null to a union in Promise returns
    content, count = re.subn(r'Promise<\{\s*success:\s*boolean;?\s*error:\s*string\s*\|\s*null;?.*?\}>', 
                             r'Promise<{ success: true; error: null; data?: any } | { success: false; error: string; data?: null }>', content, flags=re.DOTALL)
    if count > 0: modified = True

    # Fix error: null, success: boolean
    content, count = re.subn(r'Promise<\{\s*error:\s*null\s*,\s*success:\s*boolean;?.*?\}>', 
                             r'Promise<{ success: true; error: null; data?: any } | { success: false; error: string; data?: null }>', content, flags=re.DOTALL)
    if count > 0: modified = True

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

print(f"Unified types in {modified_count} files.")
