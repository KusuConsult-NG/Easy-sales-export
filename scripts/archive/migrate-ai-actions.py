#!/usr/bin/env python3
"""Migrate ai-actions.ts to firebase-admin SDK"""

filepath = "src/app/actions/ai-actions.ts"

with open(filepath, 'r') as f:
    content = f.read()

import re

# Fix line 84: addDoc(collection(db, 'ai_chat_history'), {...})
# Should be: db.collection('ai_chat_history').add({...})
content = re.sub(
    r'await addDoc\(collection\(db,\s*([\'"][^\'"]+[\'"])\),\s*',
    r'await db.collection(\1).add(',
    content
)

# Fix line 89: serverTimestamp() -> FieldValue.serverTimestamp()
content = content.replace('serverTimestamp()', 'FieldValue.serverTimestamp()')

# Fix lines 137-144: query(collection(db, ...), where(...), orderBy(...), limit(...))
# Should be: db.collection(...).where(...).orderBy(...).limit(...)
content = re.sub(
    r'query\(\s*collection\(db,\s*([\'"][^\'"]+[\'"])\),\s*where\(([^)]+)\),\s*orderBy\(([^)]+)\),\s*limit\(([^)]+)\)\s*\)',
    r'db.collection(\1).where(\2).orderBy(\3).limit(\4)',
    content,
    flags=re.MULTILINE | re.DOTALL
)

# Fix getDocs
content = re.sub(r'await getDocs\(([a-zA-Z_]+)\)', r'await \1.get()', content)

with open(filepath, 'w') as f:
    f.write(content)

print("✓ Migrated ai-actions.ts")
