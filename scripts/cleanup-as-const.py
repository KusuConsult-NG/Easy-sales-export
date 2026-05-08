import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def cleanup_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    modified = False
    
    # 1. Target type definitions: type ... = { ... }
    def fix_type(match):
        block = match.group(0)
        # Remove "as const" only if it's following success: true/false
        # but the user says ANY as const inside type/interface/Promise is bad for SWC.
        return block.replace('as const', '')

    # Regex for type/interface/Promise signatures
    # This matches the block until the first { that starts a function body
    new_content = re.sub(r'(type\s+\w+\s*=[^;]*;|interface\s+\w+\s*\{[^}]*\}|Promise<\{[^}]*\}>)', fix_type, content, flags=re.DOTALL)
    
    if new_content != content:
        with open(filepath, 'w') as f:
            f.write(new_content)
        return True
    return False

modified_count = 0
for root, dirs, files in os.walk(actions_dir):
    for file in files:
        if file.endswith('.ts') or file.endswith('.tsx'):
            if cleanup_file(os.path.join(root, file)):
                modified_count += 1

print(f"Cleaned up {modified_count} files.")
