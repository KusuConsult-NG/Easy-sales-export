#!/usr/bin/env python3
"""Carefully migrate academy.ts with better regex to avoid false matches"""

import re

filepath = "src/app/actions/academy.ts"
print(f"Migrating {filepath}...")

with open(filepath, 'r') as f:
    content = f.read()

# Step 1: Change db import  
content = content.replace(
    'import { db } from "@/lib/firebase";',
    'import { db } from "@/lib/firebase-admin";\nimport { FieldValue, Timestamp } from "firebase-admin/firestore";'
)

# Step 2: Remove firestore client SDK imports
firestore_import_pattern = r'import \{[^}]+\} from "firebase/firestore";?\n'
content = re.sub(firestore_import_pattern, '', content)

# Step 3: Replace Timestamp.now() with FieldValue.serverTimestamp()
content = content.replace('Timestamp.now()', 'FieldValue.serverTimestamp()')

# Step 4: Convert method calls - be very careful with word boundaries

# getDocs(collection(db, "xxx")) --> db.collection("xxx").get()
content = re.sub(r'getDocs\(collection\(db,\s*([^)]+)\)\)', r'db.collection(\1).get()', content)

# getDoc(doc(db, "coll", id)) --> db.collection("coll").doc(id).get()
# Must match ( before doc( to avoid matching in strings like ", error:"
content = re.sub(r'getDoc\(doc\(db,\s*([^,]+),\s*([^)]+)\)\)', r'db.collection(\1).doc(\2).get()', content)

# setDoc(doc(db, "coll", id), data) --> db.collection("coll").doc(id).set(data)
content = re.sub(r'setDoc\(doc\(db,\s*([^,]+),\s*([^)]+)\),', r'db.collection(\1).doc(\2).set(', content)

# addDoc(collection(db, "xxx"), data) --> db.collection("xxx").add(data)
content = re.sub(r'addDoc\(collection\(db,\s*([^)]+)\),', r'db.collection(\1).add(', content)

# updateDoc(doc(db, "coll", id), data) --> db.collection("coll").doc(id).update(data)  
content = re.sub(r'updateDoc\(doc\(db,\s*([^,]+),\s*([^)]+)\),', r'db.collection(\1).doc(\2).update(', content)

# query(collection(db, "xxx")) --> db.collection("xxx")
content = re.sub(r'query\(collection\(db,\s*([^)]+)\)\)', r'db.collection(\1)', content)

# query(q, where(...)) --> q.where(...)
content = re.sub(r'query\(([^,)]+),\s*where\(', r'\1.where(', content)

# .exists() --> .exists (property not method in Admin SDK)
content = content.replace('.exists()', '.exists')

with open(filepath, 'w') as f:
    f.write(content)

print(f"✓ Migrated {filepath}")
