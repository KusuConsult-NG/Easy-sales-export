import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    modified = False
    
    # 1. Fix broken interpolations
    # ${expr, data: null } -> ${expr}
    new_content, count1 = re.subn(r'\$\{([^},]+),\s*data:\s*null\s*\}', r'${\1}', content)
    # ${expr, error: null } -> ${expr}
    new_content, count2 = re.subn(r'\$\{([^},]+),\s*error:\s*null\s*\}', r'${\1}', new_content)
    
    if count1 > 0 or count2 > 0:
        modified = True
        content = new_content

    # 2. Fix double commas
    new_content, count = re.subn(r',\s*,', ',', content)
    if count > 0:
        modified = True
        content = new_content

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

print(f"Fixed broken interpolations in {modified_count} files.")
