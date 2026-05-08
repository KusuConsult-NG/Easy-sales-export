import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def cleanup_duplicates(filepath):
    with open(filepath, 'r') as f:
        lines = f.readlines()
    
    new_lines = []
    modified = False
    
    # We'll look for Promise<{ ... }> blocks or return { ... } blocks
    # and find duplicate error keys.
    
    i = 0
    while i < len(lines):
        line = lines[i]
        
        # Check for error: null, success: ... AND error: ... on the same line
        if 'error: null, success:' in line and 'error?:' in line:
            # signature case like: Promise<{ error: null, success: true | false; ... error?: string }>
            # Remove the duplicate error?
            line = line.replace('error?: string', '')
            line = line.replace('error?: string;', '')
            # Ensure error is correctly typed
            line = line.replace('error: null', 'error: string | null')
            modified = True
            
        # Check for multiple error keys on adjacent lines
        if i > 0 and 'error: null, success:' in line and 'error?: string' in lines[i-1]:
            # Signature case across lines
            lines[i-1] = "" # Remove the duplicate
            line = line.replace('error: null', 'error: string | null')
            modified = True

        new_lines.append(line)
        i += 1

    if modified:
        with open(filepath, 'w') as f:
            f.writelines([l for l in new_lines if l.strip() or l == '\n'])
        return True
    return False

modified_count = 0
for root, dirs, files in os.walk(actions_dir):
    for file in files:
        if file.endswith('.ts'):
            if cleanup_duplicates(os.path.join(root, file)):
                modified_count += 1

print(f"Cleaned up {modified_count} files.")
