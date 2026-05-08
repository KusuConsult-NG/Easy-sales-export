import os

filepath = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions/cooperative.ts"

with open(filepath, 'r') as f:
    content = f.read()

# Fix the structural corruption pattern
content = content.replace('        return { error: null, success: true as const},\n            meta: null\n        };', '        return { error: null, success: true as const, data: null, meta: null };')
content = content.replace('        return { error: null, success: true as const, meta: null };', '        return { error: null, success: true as const, data: null, meta: null };')
content = content.replace('success: true as const` },', 'success: true as const, data: null },')
content = content.replace('success: true as constcreated successfully.` },', 'success: true as const, data: null },')

with open(filepath, 'w') as f:
    f.write(content)

print("Repaired cooperative.ts")
