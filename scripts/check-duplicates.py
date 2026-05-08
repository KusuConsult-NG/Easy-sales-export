import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def check_duplicates(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Simple check: find blocks between { and }
    # and check for duplicate keys.
    # This is a bit complex for regex, but we can look for specific patterns.
    
    # We'll look for blocks that have more than one error: or error?:
    # outside of union types.
    
    lines = content.split('\n')
    for i in range(len(lines)):
        line = lines[i]
        if 'error:' in line or 'error?:' in line:
            # Check next 5 lines
            context = "".join(lines[i+1:i+6])
            if 'error:' in context or 'error?:' in context:
                # Potential duplicate.
                # Check if it's a union type (has |)
                if '|' not in context and '|' not in line:
                    print(f"Potential Duplicate in {filepath} around line {i+1}")
                    print(f"Line {i+1}: {line}")
                    print(f"Context: {context}")
                    print("-" * 20)

for root, dirs, files in os.walk(actions_dir):
    for file in files:
        if file.endswith('.ts'):
            check_duplicates(os.path.join(root, file))
