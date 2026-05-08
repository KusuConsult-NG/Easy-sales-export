import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

# More flexible patterns for Promise return types
patterns = [
    # Promise<{ error: string | null, success: boolean; data?: Course[]; meta?: { lastDocId: string | null }; }>
    r'Promise<\{\s*error:\s*string\s*\|\s*null\s*,\s*success:\s*boolean;?\s*(.*?)\}>',
    # Promise<{ success: boolean; error: string | null; data?: any; meta?: any; }>
    r'Promise<\{\s*success:\s*boolean;?\s*error:\s*string\s*\|\s*null;?\s*(.*?)\}>',
    # Promise<{ error: null, success: boolean; data?: ...; meta?: ...; }>
    r'Promise<\{\s*error:\s*null\s*,\s*success:\s*boolean;?\s*(.*?)\}>'
]

def transform_match(match):
    extra = match.group(1).strip()
    # Remove data?: and meta?: from extra to handle them in the union
    data_match = re.search(r'data\?:\s*(.*?)(;|$)', extra)
    meta_match = re.search(r'meta\?:\s*(.*?)(;|$)', extra)
    
    data_type = data_match.group(1) if data_match else "any"
    meta_type = meta_match.group(1) if meta_match else "any"
    
    # Reconstruct extra without data/meta for simplicity, or just keep them
    # Actually, it's safer to just define the union clearly
    
    res = f"""Promise<
    | {{ success: true; error: null; data: {data_type}; meta?: {meta_type} }}
    | {{ success: false; error: string; data?: null; meta?: {meta_type} }}
>"""
    return res

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    modified = False
    for p in patterns:
        content, count = re.subn(p, transform_match, content, flags=re.DOTALL)
        if count > 0: modified = True

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

print(f"Transformed {modified_count} files.")
