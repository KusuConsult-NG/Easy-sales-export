import os

filepath = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions/vendor-dashboard.ts"

with open(filepath, 'r') as f:
    lines = f.readlines()

new_lines = []
for i, line in enumerate(lines):
    line_num = i + 1
    if line_num == 207:
        new_lines.append('        return { error: null, success: true as const, data: stats };\n')
    elif line_num == 317:
        new_lines.append('        return { error: null, success: true as const, data: activities };\n')
    else:
        new_lines.append(line)

with open(filepath, 'w') as f:
    f.writelines(new_lines)

print("Repaired vendor-dashboard.ts (final pass)")
