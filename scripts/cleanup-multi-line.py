import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def cleanup_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Target Promise signatures with duplicate error keys
    # Match from "Promise<{" up to "}>"
    pattern = re.compile(r'Promise<\{.*?\}>', re.DOTALL)
    
    def fix_promise(match):
        block = match.group(0)
        if block.count('error:') > 1:
            # Duplicate detected
            # 1. Standardize error?: string, error?: string | null, error: null
            # First, extract all keys except 'error'
            lines = block.split('\n')
            new_lines = []
            has_error = False
            for line in lines:
                if 'error:' in line or 'error?:' in line:
                    continue
                new_lines.append(line)
            
            # Reconstruct with a single error key at the top
            # Insert error after the first '{'
            if len(new_lines) > 0:
                first_line = new_lines[0]
                if '{' in first_line:
                    new_lines[0] = first_line.replace('{', '{ error: string | null, success: boolean, ')
                    # Also remove success from other lines if present to avoid duplication
                    for j in range(1, len(new_lines)):
                        new_lines[j] = re.sub(r'success:\s*(true\s*\|\s*false|boolean|true|false);?\s*,?', '', new_lines[j])
                return '\n'.join(new_lines)
        return block

    new_content = pattern.sub(fix_promise, content)
    
    if new_content != content:
        with open(filepath, 'w') as f:
            f.write(new_content)
        return True
    return False

modified_count = 0
for root, dirs, files in os.walk(actions_dir):
    for file in files:
        if file.endswith('.ts'):
            if cleanup_file(os.path.join(root, file)):
                modified_count += 1

print(f"Cleaned up {modified_count} files.")
