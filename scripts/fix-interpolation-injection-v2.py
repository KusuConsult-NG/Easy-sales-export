import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    modified = False
    
    # regex to find the broken pattern inside backticks
    # ${something, data: null }
    pattern_data = r'\$\{([^},]+),\s*data:\s*null\s*\}'
    pattern_error = r'\$\{([^},]+),\s*error:\s*null\s*\}'

    def replace_data(match):
        return f"${{{match.group(1)}}}"

    # We also need to add , data: null OUTSIDE the backticks
    # Pattern: return { ... `... ${expr, data: null} ...` }
    
    # A more robust way:
    # 1. Capture the whole return block
    # 2. If it contains a broken interpolation, fix the interpolation AND ensure the field is present in the block.
    
    def fix_return_block(match):
        block = match.group(0)
        new_block = block
        needed_data = False
        needed_error = False
        
        if ', data: null' in block and '${' in block and 'data: null' in block.split('${')[1]:
            needed_data = True
            new_block = re.sub(pattern_data, replace_data, new_block)
            
        if ', error: null' in block and '${' in block and 'error: null' in block.split('${')[1]:
            needed_error = True
            new_block = re.sub(pattern_error, replace_data, new_block)
            
        if needed_data and 'data:' not in new_block:
            new_block = re.sub(r'\}', ', data: null }', new_block)
            
        if needed_error and 'error:' not in new_block:
            new_block = re.sub(r'\}', ', error: null }', new_block)
            
        return new_block

    new_content = re.sub(r'return\s*\{[^}]*\}', fix_return_block, content, flags=re.DOTALL)
    
    if new_content != content:
        with open(filepath, 'w') as f:
            f.write(new_content)
        return True
    return False

modified_count = 0
for root, dirs, files in os.walk(actions_dir):
    for file in files:
        if file.endswith('.ts') or file.endswith('.tsx'):
            if fix_file(os.path.join(root, file)):
                modified_count += 1

print(f"Fixed interpolation injection in {modified_count} files.")
