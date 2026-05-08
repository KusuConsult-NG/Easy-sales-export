import os
import re

files_to_fix = [
    "src/app/actions/academy-admin.ts",
    "src/app/actions/academy.ts",
    "src/app/actions/admin-analytics.ts",
    "src/app/actions/admin-content.ts",
    "src/app/actions/admin.ts",
    "src/app/actions/loans.ts",
    "src/app/actions/village-market.ts",
    "src/app/actions/wallet.ts",
    "src/app/actions/wave-admin.ts"
]

base_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs"

def fix_file(filepath):
    full_path = os.path.join(base_dir, filepath)
    with open(full_path, 'r') as f:
        lines = f.readlines()
    
    modified = False
    new_lines = []
    
    # Simple line-by-line fix for return statements
    # This avoids matching across multiple lines where things can get messy
    for line in lines:
        if 'return {' in line and 'success:' in line:
            # 1. success: true -> success: true as const
            line = re.sub(r'success:\s*true(?! as const)', 'success: true as const', line)
            # 2. success: false -> success: false as const
            line = re.sub(r'success:\s*false(?! as const)', 'success: false as const', line)
            
            # 3. If success: true as const and missing error: null
            if 'success: true as const' in line and 'error:' not in line:
                line = re.sub(r'\}', ', error: null }', line)
            
            # 4. If success: false as const and missing data: null
            if 'success: false as const' in line and 'data:' not in line:
                line = re.sub(r'\}', ', data: null }', line)
                
            # Clean up potential double commas or trailing commas
            line = re.sub(r',\s*,', ',', line)
            line = re.sub(r',\s*\}', ' }', line)
            
            modified = True
        new_lines.append(line)

    if modified:
        with open(full_path, 'w') as f:
            f.writelines(new_lines)
        return True
    return False

modified_count = 0
for f in files_to_fix:
    if fix_file(f):
        modified_count += 1

print(f"Fixed {modified_count} files line-by-line.")
