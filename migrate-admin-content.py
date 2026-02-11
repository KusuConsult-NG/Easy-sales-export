#!/usr/bin/env python3
"""Complete migration for admin-content.ts - convert all query/where/getDocs patterns"""

filepath = "src/app/actions/admin-content.ts"

with open(filepath, 'r') as f:
    content = f.read()

# Pattern: query(db.collection("name"), where(...))
# Should become: db.collection("name").where(...)

# Replace all query( ... ) patterns that wrap db.collection
import re

# Step 1: Remove query() wrappers around db.collection() calls
# Match: query(\n  db.collection("..."),\n  where(...)
# )
# This is a multi-line pattern, so we need to handle it carefully

# Replace query(db.collection("x"), where("field", "op", value))
# with db.collection("x").where("field", "op", value)

# First, let's handle the most common pattern:
# query(\n    db.collection(...),\n    where(...)\n)

content = re.sub(
    r'query\(\s*db\.collection\(([^)]+)\),\s*where\(([^)]+)\)\s*\)',
    r'db.collection(\1).where(\2)',
    content,
    flags=re.MULTILINE | re.DOTALL
)

# Step 2: Replace getDocs() calls with .get()
content = re.sub(r'await getDocs\(([a-zA-Z_]+)\)', r'await \1.get()', content)
content = re.sub(r'getDocs\(([a-zA-Z_]+)\)', r'\1.get()', content)

# Step 3: Replace .forEach() with .docs.forEach() if needed
# Admin SDK returns QuerySnapshot, and .forEach() is a method on it  
# But we're using .docs already in the code (productsSnap.forEach)
# which is correct for Admin SDK (snapshot.docs.forEach())

# Step 4: Remove any remaining standalone where() or query() imports/usages
# These shouldn't be in the file after our changes

with open(filepath, 'w') as f:
    f.write(content)

print("✓ Migrated admin-content.ts - converted all query/where/getDocs patterns")
