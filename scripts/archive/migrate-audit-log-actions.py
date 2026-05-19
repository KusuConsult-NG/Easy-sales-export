#!/usr/bin/env python3
"""Complete migration for audit-log-actions.ts"""

filepath = "src/app/actions/audit-log-actions.ts"

with open(filepath, 'r') as f:
    content = f.read()

import re

# Fix complex query patterns
# query(collection(db, "x"), orderBy(...)) -> db.collection("x").orderBy(...)
content = re.sub(
    r'query\(collection\(db,\s*([\'"][^\'"]+[\'"])\),\s*orderBy\(([^)]+)\)\)',
    r'db.collection(\1).orderBy(\2)',
    content,
    flags=re.MULTILINE | re.DOTALL
)

# Fix where() chaining patterns - q = query(q, where(...))
content = re.sub(
    r'q = query\(q,\s*where\(([^)]+)\)\)',
    r'q = q.where(\1)',
    content
)

# Fix limit() chaining - q = query(q, limit(...))
content = re.sub(
    r'q = query\(q,\s*limit\(([^)]+)\)\)',
    r'q = q.limit(\1)',
    content
)

# Fix getDocs -> .get()
content = content.replace('await getDocs(q)', 'await q.get()')

with open(filepath, 'w') as f:
    f.write(content)

print("✓ Migrated audit-log-actions.ts")
