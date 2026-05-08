import os
import re

filepath = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions/admin.ts"

with open(filepath, 'r') as f:
    content = f.read()

# Fix cases like "hasMore: ... \n data: null };"
content = re.sub(r'(hasMore:\s*[^,\n}]*?)(\s*data:\s*null\s*\};)', r'\1, \2', content)

# Fix cases like "applications: ... \n data: null };"
content = re.sub(r'(applications:\s*[^,\n}]*?)(\s*data:\s*null\s*\};)', r'\1, \2', content)

# Fix cases like "listings: ... \n data: null };"
content = re.sub(r'(listings:\s*[^,\n}]*?)(\s*data:\s*null\s*\};)', r'\1, \2', content)

# Fix corrupted message logic
content = re.sub(r'message: `(.*?), data: null \}`,', r'message: `\1`, data: null,', content)

with open(filepath, 'w') as f:
    f.write(content)

print("Repaired admin.ts")
