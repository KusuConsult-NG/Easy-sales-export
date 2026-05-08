import os
import re

filepath = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions/export.ts"

with open(filepath, 'r') as f:
    content = f.read()

# Fix type corruption
content = content.replace('message: string;, data: null;', 'message: string; data: null;')

# Fix template literal corruption
content = re.sub(r'(\$\{[^}]*?),\s*data:\s*null\s*\}', r'\1}', content)

# Fix missing commas
content = re.sub(r'([a-zA-Z0-9_]+)\s+(data:\s*null)', r'\1, \2', content)

# Fix duplicate error keys in submission logic if any
content = re.sub(r'error:\s*"Action failed",\s*success:\s*false\s*as\s*const\s*,\s*error:', r'success: false as const, error:', content)

with open(filepath, 'w') as f:
    f.write(content)

print("Repaired export.ts")
