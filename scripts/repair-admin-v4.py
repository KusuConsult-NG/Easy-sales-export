import os
import re

filepath = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions/admin.ts"

with open(filepath, 'r') as f:
    content = f.read()

# Fix template literal injections specifically in admin.ts
# Patterns: ${variable, data: null } or similar inside `...`
content = re.sub(r'(\$\{[^}]*?),\s*data:\s*null\s*\}', r'\1}', content)

# Fix double data: null at end of return objects if any
content = re.sub(r'data:\s*null\s*,\s*data:\s*null', r'data: null', content)

with open(filepath, 'w') as f:
    f.write(content)

print("Template literal repair applied to admin.ts")
