import os
import re

filepath = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions/admin.ts"

with open(filepath, 'r') as f:
    content = f.read()

# Fix cases where a property is immediately followed by data: null without a comma
# Pattern: someProp data: null
content = re.sub(r'([a-zA-Z0-9_]+)\s+(data:\s*null)', r'\1, \2', content)

# Fix double success/error if any
content = re.sub(r'success:\s*true\s*as\s*const\s*,\s*success:\s*true\s*as\s*const', r'success: true as const', content)

# Fix misplaced commas
content = re.sub(r',\s*,', ',', content)

with open(filepath, 'w') as f:
    f.write(content)

print("Generic repair applied to admin.ts")
