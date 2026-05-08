import os

filepath = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions/vendor-dashboard.ts"

with open(filepath, 'r') as f:
    content = f.read()

# Fix _getVendorRevenueTrendsAction
content = content.replace('        return { error: null, success: true as const, data: stats };', '        return { error: null, success: true as const, data: trends };', 1)

# Fix _getVendorActivityFeedAction
content = content.replace('        return { error: null, success: true as const, data: stats };', '        return { error: null, success: true as const, data: activities };', 1)

with open(filepath, 'w') as f:
    f.write(content)

print("Repaired vendor-dashboard.ts")
