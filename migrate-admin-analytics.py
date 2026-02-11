#!/usr/bin/env python3
"""Migrate admin-analytics.ts"""

import re

filepath = "src/app/actions/admin-analytics.ts"

with open(filepath, 'r') as f:
    content = f.read()

# Step 1: Change db import  
content = content.replace(
    'import { db } from "@/lib/firebase";',
    'import { db } from "@/lib/firebase-admin";\nimport { FieldValue } from "firebase-admin/firestore";'
)

# Step 2: Remove firestore client SDK imports
content = re.sub(r'import \{[^}]+\} from "firebase/firestore";?\n', '', content)

# Step 3: Replace Timestamp.now() and serverTimestamp()
content = content.replace('Timestamp.now()', 'FieldValue.serverTimestamp()')
content = content.replace('serverTimestamp()', 'FieldValue.serverTimestamp()')

# Step 4: Convert method calls
content = re.sub(r'getDocs\(collection\(db,\s*([^)]+)\)\)', r'db.collection(\1).get()', content)
content = re.sub(r'getDoc\(doc\(db,\s*([^,]+),\s*([^)]+)\)\)', r'db.collection(\1).doc(\2).get()', content)
content = re.sub(r'\bdoc\(db,\s*([^)]+)\)', r'db.doc(\1)', content)
content = re.sub(r'collection\(db,\s*([^)]+)\)', r'db.collection(\1)', content)
content = re.sub(r'updateDoc\(([^,]+),\s*', r'\1.update(', content)
content = re.sub(r'setDoc\(([^,]+),\s*', r'\1.set(', content)
content = re.sub(r'addDoc\(([^,]+),\s*', r'\1.add(', content)
content = re.sub(r'deleteDoc\(([^)]+)\)', r'\1.delete()', content)
content = content.replace('.exists()', '.exists')

# Fix query patterns
content = re.sub(r'query\(([^,)]+),\s*where\(', r'\1.where(', content)
content = re.sub(r'query\(query\(([^)]+)\),\s*where\(', r'\1.where(', content)
content = re.sub(r'query\(([^)]+)\)', r'\1', content)

with open(filepath, 'w') as f:
    f.write(content)

print(f"✓ Migrated {filepath}")
