import os

filepath = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/lib/safe-action.ts"

with open(filepath, 'r') as f:
    content = f.read()

# Fix return { success: false, error: errorMessage };
content = content.replace('return { success: false, error: errorMessage };', 'return { success: false, error: errorMessage, data: null as any };')

# Fix multi-line returns
# return {
#     success: false,
#     error: errorMessage,
# };
# to
# return {
#     success: false,
#     error: errorMessage,
#     data: null as any,
# };

import re
pattern = r'return \{\s+success: false,\s+error: errorMessage,\s+\};'
replacement = 'return {\n                success: false,\n                error: errorMessage,\n                data: null as any,\n            };'

content = re.sub(pattern, replacement, content)

with open(filepath, 'w') as f:
    f.write(content)

print("Repaired safe-action.ts")
