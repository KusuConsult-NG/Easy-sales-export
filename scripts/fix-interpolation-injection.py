import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    modified = False
    
    # Pattern: ${something, data: null } -> ${something}, data: null
    # This happens when standardized-returns.py matched a block that included a template literal
    # and injected the field inside the backticks.
    
    def fix_interpolation_injection_data(match):
        pre = match.group(1)
        expr = match.group(2)
        post = match.group(3)
        return f'{pre}{expr}`{post}, data: null'

    # Regex to find `... ${expr, data: null } ...`
    # We want to move ", data: null" outside the backticks.
    # Pattern: `(backtick_content) ${ (expr) , data: null } (backtick_content)` }
    
    # Actually, it's easier to just match the broken interpolation directly and move it.
    
    # Fix ${expr, data: null } -> ${expr} and add data: null after the backtick
    
    # 1. Match the broken interpolation
    broken_pattern_data = re.compile(r'(`[^`]*)\$\{([^},]+),\s*data:\s*null\s*\}([^`]*)`')
    
    while True:
        match = broken_pattern_data.search(content)
        if not match:
            break
        
        pre_tick = match.group(1)
        expr = match.group(2)
        post_tick = match.group(3)
        
        # We need to find the closing brace of the return object to insert data: null
        # But wait, if it was return { success: false, error: `...`, data: null }, 
        # my previous script probably turned it into return { success: false, error: `... ${expr, data: null }` }
        
        replacement = f'{pre_tick}${{{expr}}}{post_tick}`'
        # Check if data: null is already present after the tick
        # We need to look ahead for the next }
        
        content = content[:match.start()] + replacement + content[match.end():]
        # Now find the next } and insert , data: null before it if not present
        
        next_brace = content.find('}', match.start())
        if next_brace != -1:
            block = content[match.start():next_brace]
            if 'data:' not in block:
                content = content[:next_brace] + ', data: null ' + content[next_brace:]
        
        modified = True

    # Same for error: null
    broken_pattern_error = re.compile(r'(`[^`]*)\$\{([^},]+),\s*error:\s*null\s*\}([^`]*)`')
    
    while True:
        match = broken_pattern_error.search(content)
        if not match:
            break
        
        pre_tick = match.group(1)
        expr = match.group(2)
        post_tick = match.group(3)
        
        replacement = f'{pre_tick}${{{expr}}}{post_tick}`'
        
        content = content[:match.start()] + replacement + content[match.end():]
        
        next_brace = content.find('}', match.start())
        if next_brace != -1:
            block = content[match.start():next_brace]
            if 'error:' not in block:
                content = content[:next_brace] + ', error: null ' + content[next_brace:]
        
        modified = True

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

print(f"Fixed interpolation injection in {modified_count} files.")
