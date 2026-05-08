import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def cleanup_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    modified = False
    
    # 1. Target lines that look like type/interface/Promise property definitions
    # and contain "success: true/false as const"
    
    # Pattern to find 'success: true as const' or 'success: false as const'
    # that are followed by a semicolon or a brace (indicating they are in a type/interface)
    # vs return { success: true as const, ... } (which has a comma)
    
    # Actually, the user says "Expected ';', got 'as'" on lines like:
    # | { error: string; success: false as const }
    
    # Let's target lines containing "Promise", "type ", or "interface "
    # and remove "as const" from them.
    
    lines = content.split('\n')
    new_lines = []
    
    in_type_block = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('type ') or stripped.startswith('export type ') or stripped.startswith('interface ') or stripped.startswith('export interface '):
            in_type_block = True
        
        # If we are in a type block or the line contains a Promise signature
        if in_type_block or '): Promise<' in line or 'Promise<{ ' in line:
            if 'as const' in line:
                line = line.replace(' as const', '')
                modified = True
        
        if in_type_block and (stripped.endswith('};') or stripped.endswith('}')):
            # This is a bit naive for multi-line types but most of ours are simple
            # Let's refine: if it's a closing brace at the start of a line or after some content
            if '}' in stripped and ';' in stripped:
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
            if cleanup_file(os.path.join(root, file)):
                modified_count += 1

print(f"Cleaned up {modified_count} files.")
