import os
import re

def process_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception:
        return

    def replacer(match):
        var_name = match.group(1)
        attr = match.group(2)
        return f"{var_name}.data?.{attr}"

    # Now including *Res strings as well
    pattern = r"\b([a-zA-Z0-9_]*result|[a-zA-Z0-9_]*Result|[a-zA-Z0-9_]*Res|[a-zA-Z0-9_]*res|updated|data)\.(products|orders|stats|verification|analytics|product|wallet|newBalance|withdrawalId|transactions|hasMore|admins|escrowId|disputeId|authorizationUrl|reference|lastId|message|progress|userId)\b"
    
    new_content = re.sub(pattern, replacer, content)
    new_content = new_content.replace(".data?.data?.", ".data?.")
    
    if content != new_content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Updated: {filepath}")

targets = [
    'src/app/marketplace',
    'src/app/vendor',
    'src/app/dashboard',
    'src/app/escrow',
    'src/app/admin',
    'src/app/academy',
    'src/app/farm-nation',
]

for target in targets:
    if not os.path.exists(target): continue
    for root, dirs, files in os.walk(target):
        for file in files:
            if file.endswith('.tsx') or file.endswith('.ts'):
                process_file(os.path.join(root, file))
