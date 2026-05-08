import os

filepath = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions/wave.ts"

with open(filepath, 'r') as f:
    lines = f.readlines()

new_lines = []
for line in lines:
    if "meta: { cursor: nextCursor, hasMore , data: null } , data: null };" in line:
        indent = line[:line.find("return")]
        new_lines.append(f"{indent}return {{ error: null, success: true as const, data, meta: {{ cursor: nextCursor, hasMore }} }};\n")
    else:
        new_lines.append(line)

with open(filepath, 'w') as f:
    f.writelines(new_lines)

print("Repaired wave.ts")
