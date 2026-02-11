#!/usr/bin/env python3
"""
MASTER BATCH MIGRATION SCRIPT
Scans ALL Server Action files and migrates any with Client SDK patterns
"""

import os
import re
import glob

# Get all Server Action files
action_files = glob.glob("src/app/actions/*.ts")
action_files = [f for f in action_files if ".bak" not in f]

migrated_count = 0
skipped_count = 0

for filepath in action_files:
    with open(filepath, 'r') as f:
        original_content = f.read()
    
    content = original_content
    changed = False
    
    # Step 1: Update imports if using Client SDK
    if 'from "firebase/firestore"' in content:
        # Replace import path
        content = content.replace('from "firebase/firestore"', 'from "firebase-admin/firestore"')
        # But we don't actually want to import from firebase-admin/firestore directly
        # We should just remove the Client SDK import since we're using db from firebase-admin
        content = re.sub(r'import \{[^}]+\} from "firebase-admin/firestore";\n', '', content)
        changed = True
    
    # Step 2: Make sure firebase-admin is imported
    if changed and '@/lib/firebase-admin' not in content:
        # Add the import after "use server"
        content = content.replace(
            '"use server";',
            '"use server";\n\nimport { db } from "@/lib/firebase-admin";'
        )
    
    # If not using Client SDK, skip
    if 'from "@/lib/firebase"' in content and 'from "@/lib/firebase-admin"' not in content:
        content = content.replace('from "@/lib/firebase";', 'from "@/lib/firebase-admin";')
        changed = True
    
    # Step 3: Convert method calls
    # getDoc(doc(db, "coll", "id")) -> db.collection("coll").doc("id").get()
    content = re.sub(
        r'await getDoc\(doc\(db,\s*([\'"][^\'"]+[\'"]),\s*([^)]+)\)\)',
        r'await db.collection(\1).doc(\2).get()',
        content
    )
    
    # getDocs(collection(db, "coll")) -> db.collection("coll").get()
    content = re.sub(
        r'await getDocs\(collection\(db,\s*([\'"][^\'"]+[\'"])\)\)',
        r'await db.collection(\1).get()',
        content
    )
    
    # addDoc(collection(db, "coll"), {...}) -> db.collection("coll").add({...})
    content = re.sub(
        r'await addDoc\(collection\(db,\s*([\'"][^\'"]+[\'"])\),\s*',
        r'await db.collection(\1).add(',
        content
    )
        
    # query(collection(db, "x"), where(...), ...) -> db.collection("x").where(...)...
    content = re.sub(
        r'query\(\s*collection\(db,\s*([\'"][^\'"]+[\'"])\),\s*where\(([^)]+)\)\s*\)',
        r'db.collection(\1).where(\2)',
        content,
        flags=re.MULTILINE | re.DOTALL
    )
    
    # Even more complex query patterns with orderBy, limit
    content = re.sub(
        r'query\(\s*collection\(db,\s*([\'"][^\'"]+[\'"])\),\s*where\(([^)]+)\),\s*orderBy\(([^)]+)\)\s*\)',
        r'db.collection(\1).where(\2).orderBy(\3)',
        content,
        flags=re.MULTILINE | re.DOTALL
    )
    
    content = re.sub(
        r'query\(\s*collection\(db,\s*([\'"][^\'"]+[\'"])\),\s*where\(([^)]+)\),\s*orderBy\(([^)]+)\),\s*limit\(([^)]+)\)\s*\)',
        r'db.collection(\1).where(\2).orderBy(\3).limit(\4)',
        content,
        flags=re.MULTILINE | re.DOTALL
    )
    
    # setDoc(doc(db, ...), {...}) -> db.doc(...).set({...})
    content = re.sub(
        r'await setDoc\(doc\(db,\s*([^)]+)\),\s*',
        r'await db.doc(\1).set(',
        content
    )
    
    # updateDoc(doc(db, ...), {...}) -> db.doc(...).update({...})
    content = re.sub(
        r'await updateDoc\(doc\(db,\s*([^)]+)\),\s*',
        r'await db.doc(\1).update(',
        content
    )
    
    # deleteDoc(doc(db, ...)) -> db.doc(...).delete()
    content = re.sub(
        r'await deleteDoc\(doc\(db,\s*([^)]+)\)\)',
        r'await db.doc(\1).delete()',
        content
    )
    
    # .exists() -> .exists (property, not method)
    content = content.replace('.exists()', '.exists')
    
    # serverTimestamp() -> FieldValue.serverTimestamp()
    content = content.replace('serverTimestamp()', 'FieldValue.serverTimestamp()')
    
    # Timestamp.now() -> FieldValue.serverTimestamp()
    content = content.replace('Timestamp.now()', 'FieldValue.serverTimestamp()')
    
    # Add FieldValue import if needed
    if 'FieldValue.serverTimestamp()' in content and 'from "firebase-admin/firestore"' not in content:
        # Add import after db import
        content = content.replace(
            'import { db } from "@/lib/firebase-admin";',
            'import { db } from "@/lib/firebase-admin";\nimport { FieldValue } from "firebase-admin/firestore";'
        )
        changed = True
    
    # Check if content actually changed
    if content != original_content:
        with open(filepath, 'w') as f:
            f.write(content)
        migrated_count += 1
        print(f"✓ Migrated: {filepath}")
    else:
        skipped_count += 1

print(f"\n=== Migration Complete ===")
print(f"✓ Migrated: {migrated_count} files")
print(f"- Skipped: {skipped_count} files (already migrated or no Client SDK usage)")
print(f"Total: {len(action_files)} Server Action files scanned")
