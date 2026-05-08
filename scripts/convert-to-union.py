import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def convert_to_union(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Target Promise signatures that have error: null, success: true | false
    # but are NOT unions yet.
    
    # Pattern: Promise<{ ... error: null, success: true | false; ... }>
    pattern = re.compile(r'Promise<\{([^{}]*error: null, success: true \| false;[^{}]*)\}>', re.DOTALL)
    
    def fix_signature(match):
        inner = match.group(1)
        # Extract properties
        props = inner.split(';')
        cleaned_props = []
        for p in props:
            p = p.strip()
            if not p: continue
            if 'error: null' in p or 'success: true | false' in p:
                continue
            cleaned_props.append(p)
        
        props_str = "; ".join(cleaned_props)
        if props_str: props_str = "; " + props_str
        
        other_props_str = re.sub(r'data:\s*[^;]*', '', props_str)
        union = (
            "Promise<\n"
            f"    | {{ success: true; error: null{props_str} }}\n"
            f"    | {{ success: false; error: string; data?: null{other_props_str} }}\n"
            ">"
        )
        return union

    new_content = pattern.sub(fix_signature, content)
    
    if new_content != content:
        with open(filepath, 'w') as f:
            f.write(new_content)
        return True
    return False

modified_count = 0
for root, dirs, files in os.walk(actions_dir):
    for file in files:
        if file.endswith('.ts'):
            if convert_to_union(os.path.join(root, file)):
                modified_count += 1

print(f"Converted {modified_count} files to unions.")
