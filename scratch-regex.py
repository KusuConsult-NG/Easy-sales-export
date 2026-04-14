import os
import re

def process_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception:
        return

    # Looking for `return { success: true, x: y, ... }`
    # We want to convert to `return { success: true, data: { x: y, ... } }`
    
    def replacer(match):
        inner = match.group(1).strip()
        if inner == "" or inner.startswith("data:") or inner.startswith("error:") or inner.startswith("message:"):
            return match.group(0)
        return "return { success: true, data: { " + inner + " } }"

    # Match `return { success: true, ` followed by anything until `}`
    # using non-greedy match. We must handle newlines inside `{...}`
    pattern = r"return\s*\{\s*success:\s*true,\s*([^}]+)\}"
    
    new_content = re.sub(pattern, replacer, content)
    
    if content != new_content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Updated: {filepath}")

for root, dirs, files in os.walk('src/app/actions'):
    for file in files:
        if file.endswith('.ts'):
            process_file(os.path.join(root, file))

