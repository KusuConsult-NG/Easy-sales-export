import os
import re

filepath = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions/farm-nation.ts"

with open(filepath, 'r') as f:
    content = f.read()

# Pattern 1: { error: "Action failed", success: false as const, data: null, error: "...", meta: null }
# Replacement: { success: false as const, error: "...", data: null, meta: null }
pattern1 = r'\{\s*error:\s*"Action failed",\s*success:\s*false as const,\s*data:\s*null,\s*error:\s*([^,]+),\s*meta:\s*null\s*\}'
content = re.sub(pattern1, r'{ success: false as const, error: \1, data: null, meta: null }', content)

# Pattern 2: { error: "Action failed", success: false as const, error: "...", meta: null }
# Replacement: { success: false as const, error: "...", data: null, meta: null }
pattern2 = r'\{\s*error:\s*"Action failed",\s*success:\s*false as const,\s*error:\s*([^,]+),\s*meta:\s*null\s*\}'
content = re.sub(pattern2, r'{ success: false as const, error: \1, data: null, meta: null }', content)

# Pattern 3: return { success: false as const, data: null, error: "Unauthorized", meta: null };
# (Ensure error is first or just consistent)
# Already fine but let's check for others.

# Fix multiple "data: null" like in wave.ts
# return { error: null, success: true as const, data, meta: { ... }, data: null };
pattern3 = r'return \{\s*error: null,\s*success: true as const,\s*data,\s*meta: \{ cursor: nextCursor, hasMore , data: null \} , data: null \};'
content = re.sub(pattern3, r'return { error: null, success: true as const, data, meta: { cursor: nextCursor, hasMore } };', content)

# Fix specific lines from tsc output if they are still there
# src/app/actions/farm-nation.ts(427,69): error TS2304: Cannot find name 'properties'.
content = content.replace('return { error: null, success: true as const, data: properties, meta: null };', 'return { error: null, success: true as const, data: requests, meta: null };')

# src/app/actions/farm-nation.ts(427,69) is actually in getMyPurchaseRequestsAction fallback
# Let's check getMyPurchaseRequestsAction around 427.
# 427:                 return { error: null, success: true as const, data: properties, meta: null };
# Should be 'requests'.

with open(filepath, 'w') as f:
    f.write(content)

print("Repaired farm-nation.ts")
