import sys

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # Define the exact import string
    import_str = "import { iterateStream } from '@/lib/firestore-stream';\n"
    
    # Remove it if it is at the very beginning
    if content.startswith(import_str):
        content = content[len(import_str):]
    
    # If the file does not contain the import after 'use server', add it
    if "import { iterateStream" not in content and "iterateStream" in content:
        # Re-add it immediately after "use server"; or 'use server';
        if '"use server";' in content:
            content = content.replace('"use server";', '"use server";\nimport { iterateStream } from \'@/lib/firestore-stream\';', 1)
        elif "'use server';" in content:
            content = content.replace("'use server';", "'use server';\nimport { iterateStream } from '@/lib/firestore-stream';", 1)

    with open(filepath, 'w') as f:
        f.write(content)
    print(f"Fixed {filepath}")

for f in sys.argv[1:]:
    fix_file(f)
