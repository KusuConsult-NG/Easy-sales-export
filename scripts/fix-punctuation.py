import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_punctuation(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    modified = False
    lines = content.split('\n')
    new_lines = []
    
    in_type_block = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('type ') or stripped.startswith('export type ') or stripped.startswith('interface ') or stripped.startswith('export interface '):
            in_type_block = True
        
        # If we are in a type block or the line contains a Promise signature
        if in_type_block or '): Promise<' in line or 'Promise<{ ' in line:
            # Check for success: true/false without punctuation
            if re.search(r'success:\s*(true|false)\s*$', line):
                line = line + ';'
                modified = True
            elif re.search(r'success:\s*(true|false)\s+([a-zA-Z])', line):
                # case: success: true message: string
                line = re.sub(r'success:\s*(true|false)\s+', r'success: \1; ', line)
                modified = True
        
        if in_type_block and (stripped.endswith('};') or stripped.endswith('}')):
            if '}' in stripped:
                 in_type_block = False
        
        new_lines.append(line)

    new_content = '\n'.join(new_lines)
    
    if modified:
        with open(filepath, 'w') as f:
            f.write(new_content)
        return True
    return False

modified_count = 0
for root, dirs, files in os.walk(actions_dir):
    for file in files:
        if file.endswith('.ts') or file.endswith('.tsx'):
            if fix_punctuation(os.path.join(root, file)):
                modified_count += 1

print(f"Fixed punctuation in {modified_count} files.")
