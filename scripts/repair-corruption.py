import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # Fix injected data: null inside backticks (template literals)
    corrupted_template_pattern = re.compile(r'`([^`]*?),\s*data:\s*null\s*([^`]*?)`', re.DOTALL)
    while corrupted_template_pattern.search(content):
        content = corrupted_template_pattern.sub(r'`\1\2`', content)

    # Fix injected error: null inside backticks
    corrupted_template_pattern_2 = re.compile(r'`([^`]*?),\s*error:\s*null\s*([^`]*?)`', re.DOTALL)
    while corrupted_template_pattern_2.search(content):
        content = corrupted_template_pattern_2.sub(r'`\1\2`', content)

    # Fix triple-semicolons or double-semicolons often caused by regex appending
    content = content.replace(';;', ';')
    content = content.replace('};}', '}')
    
    if content != original:
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

print(f"Repaired syntax corruption in {modified_count} files.")
