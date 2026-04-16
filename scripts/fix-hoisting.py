import os
import re

def process_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception:
        return

    # Replace `const funcName = async () => {` with `async function funcName() {`
    # Also handle `const funcName = async (args) => {`
    # new_content = re.sub(r'const\s+([a-zA-Z0-9_]+)\s*=\s*async\s*\((.*?)\)\s*=>\s*\{', r'async function \1(\2) {', content)
    
    new_content = re.sub(r'const\s+((?:handle|load)[a-zA-Z0-9_]+)\s*=\s*async\s*\((.*?)\)\s*=>\s*\{', r'async function \1(\2) {', content)
    new_content = re.sub(r'const\s+((?:handle|load)[a-zA-Z0-9_]+)\s*=\s*\((.*?)\)\s*=>\s*\{', r'function \1(\2) {', new_content)

    if content != new_content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Hoisted functions in: {filepath}")

targets = ['src/app', 'src/components', 'src/contexts', 'src/hooks']

for target in targets:
    if not os.path.exists(target): continue
    for root, dirs, files in os.walk(target):
        for file in files:
            if file.endswith('.tsx') or file.endswith('.ts'):
                process_file(os.path.join(root, file))

