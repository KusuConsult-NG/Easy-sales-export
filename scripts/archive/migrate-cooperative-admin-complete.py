#!/usr/bin/env python3
"""Complete migration for cooperative-admin.ts - fix ALL remaining patterns"""

filepath = "src/app/actions/cooperative-admin.ts"

with open(filepath, 'r') as f:
    content = f.read()

import re

# Fix q = query(q, where(...)) -> q = q.where(...)
content = re.sub(
    r'q = query\(q,\s*where\(([^)]+)\)\)',
    r'q = q.where(\1)',
    content
)

# Fix q = query(q, limit(...)) -> q = q.limit(...)
content = re.sub(
    r'q = query\(q,\s*limit\(([^)]+)\)\)',
    r'q = q.limit(\1)',
    content
)

# Fix await getDocs(q) -> await q.get()
content = content.replace('await getDocs(q)', 'await q.get()')

with open(filepath, 'w') as f:
    f.write(content)

print("✓ Completed cooperative-admin.ts migration")
