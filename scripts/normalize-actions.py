import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def normalize_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Target object literals that have success: true (with or without as const)
    # and are missing error: null
    
    # Pattern to find { ... success: true ... }
    # We look for return { or inside an object
    # This is a bit tricky with regex, but we can try to target specific patterns
    
    # Pattern 1: { success: true as const, ... } without error: null
    new_content = content
    
    # Add error: null if success: true is present but error: is not
    def add_error_null(match):
        obj_content = match.group(0)
        if 'error:' not in obj_content:
            # Insert error: null,
            if 'success:' in obj_content:
                return obj_content.replace('success:', 'error: null, success:')
        return obj_content

    # Match return { ... } blocks
    # new_content = re.sub(r'return\s*\{[^{}]*success:\s*true[^{}]*\}', add_error_null, new_content, flags=re.DOTALL)
    
    # simpler approach: just replace "success: true as const," with "error: null, success: true as const,"
    # if error: null isn't already there in the vicinity.
    
    # We'll do it line-by-line for common patterns
    lines = new_content.split('\n')
    for i in range(len(lines)):
        line = lines[i]
        
        # Ensure success: true has error: null
        if 'success: true' in line and 'error:' not in line:
            # Check context
            context = ""
            if i > 0: context += lines[i-1]
            context += line
            if i < len(lines) - 1: context += lines[i+1]
            
            if 'error:' not in context:
                lines[i] = line.replace('success: true', 'error: null, success: true')
        
        # Ensure success: false has error: some_string
        if 'success: false' in line and 'error:' not in line:
            # Check context
            context = ""
            if i > 0: context += lines[i-1]
            context += line
            if i < len(lines) - 1: context += lines[i+1]
            
            if 'error:' not in context:
                lines[i] = line.replace('success: false', 'error: "Action failed", success: false')

    new_content = '\n'.join(lines)
    
    if new_content != content:
        with open(filepath, 'w') as f:
            f.write(new_content)
        return True
    return False

modified_count = 0
for root, dirs, files in os.walk(actions_dir):
    for file in files:
        if file.endswith('.ts'):
            if normalize_file(os.path.join(root, file)):
                modified_count += 1

print(f"Normalized {modified_count} files.")
