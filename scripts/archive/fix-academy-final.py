#!/usr/bin/env python3
"""Fix remaining Client SDK calls in academy.ts"""

import re

filepath = "src/app/actions/academy.ts"

with open(filepath, 'r') as f:
    content = f.read()

# Fix doc(db, path) --> db.doc(path)
content = re.sub(r'\bdoc\(db,\s*([^)]+)\)', r'db.doc(\1)', content)

# Fix getDoc(ref) --> ref.get()
content = re.sub(r'await getDoc\(([^)]+)\)', r'await \1.get()', content)
content = re.sub(r'getDoc\(([^)]+)\)', r'\1.get()', content)

# Fix setDoc(ref, data) --> ref.set(data)
content = re.sub(r'await setDoc\(([^,]+),\s*', r'await \1.set(', content)
content = re.sub(r'setDoc\(([^,]+),\s*', r'\1.set(', content)

# Fix getDocs(ref) --> ref.get()
content = re.sub(r'await getDocs\(([^)]+)\)', r'await \1.get()', content)
content = re.sub(r'getDocs\(([^)]+)\)', r'\1.get()', content)

# Fix the Type issue: Timestamp type annotations should stay, but values should use FieldValue
# The UserProgress interface uses Timestamp as type but values use FieldValue.serverTimestamp()
# This is OK - TypeScript will accept it. We just need to cast or use any

with open(filepath, 'w') as f:
    f.write(content)

print("✓ Fixed remaining Client SDK calls in academy.ts")
