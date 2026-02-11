#!/usr/bin/env python3
"""
Migrate Server Actions from firebase Client SDK to firebase-admin SDK
Converts:
- import { db } from "@/lib/firebase" --> import { db } from "@/lib/firebase-admin"  
- Removes Client SDK firestore imports (collection, doc, getDoc,  etc.)
- Adds Admin SDK imports (FieldValue, Timestamp) if serverTimestamp() is used
- Converts method calls to Admin SDK syntax
"""

import re
import sys

def migrate_file(filepath):
    print(f"Migrating {filepath}...")
    
    with open(filepath, 'r') as f:
        content = f.read()
    
    original_content = content
    
    # Step 1: Change db import
    content = content.replace(
        'import { db } from "@/lib/firebase";',
        'import { db } from "@/lib/firebase-admin";'
    )
    
    # Step 2: Remove firestore client SDK imports
    # Match the entire import block from firebase/firestore
    firestore_import_pattern = r'import \{[^}]+\} from "firebase/firestore";?\n'
    content = re.sub(firestore_import_pattern, '', content)
    
    # Step 3: Add FieldValue import if serverTimestamp is used
    if 'serverTimestamp()' in content:
        # Check if FieldValue is already imported
        if 'import { FieldValue' not in content and 'import {FieldValue' not in content:
            # Find the line with db import and add FieldValue after it
            admin_import_line = 'import { db } from "@/lib/firebase-admin";'
            if admin_import_line in content:
                content = content.replace(
                    admin_import_line,
                    admin_import_line + '\nimport { FieldValue } from "firebase-admin/firestore";'
                )
        # Replace serverTimestamp() with FieldValue.serverTimestamp()
        content = content.replace('serverTimestamp()', 'FieldValue.serverTimestamp()')
    
    # Step 4: Convert Timestamp.now() to FieldValue.serverTimestamp() 
    if 'Timestamp.now()' in content:
        if 'import { FieldValue' not in content:
            admin_import_line = 'import { db } from "@/lib/firebase-admin";'
            if admin_import_line in content:
                content = content.replace(
                    admin_import_line,
                    admin_import_line + '\nimport { FieldValue } from "firebase-admin/firestore";'
                )
        content = content.replace('Timestamp.now()', 'FieldValue.serverTimestamp()')
    
    # Step 5: Convert Client SDK method calls to Admin SDK
    
    # getDoc(doc(db, collection, id)) --> db.collection(collection).doc(id).get()
    # This is complex, so we'll do a simpler regex replacement
    
    # Pattern: getDoc(doc(db, "collection", id))
    pattern1 = r'getDoc\(doc\(db,\s*([^,]+),\s*([^)]+)\)\)'
    replacement1 = r'db.collection(\1).doc(\2).get()'
    content = re.sub(pattern1, replacement1, content)
    
    # Pattern: getDocs(query(...))collection(db, "collection"), where(...))  
    # getDocs(collection(db, "collection")) --> db.collection("collection").get()
    pattern2 = r'getDocs\(collection\(db,\s*([^)]+)\)\)'
    replacement2 = r'db.collection(\1).get()'
    content = re.sub(pattern2, replacement2, content)
    
    # Pattern: collection(db, "name") --> db.collection("name")
    pattern3 = r'collection\(db,\s*([^)]+)\)'
    replacement3 = r'db.collection(\1)'
    content = re.sub(pattern3, replacement3, content)
    
    # Pattern: doc(db, "collection", id) --> db.collection("collection").doc(id) 
    pattern4 = r'doc\(db,\s*([^,]+),\s*([^)]+)\)'
    replacement4 = r'db.collection(\1).doc(\2)'
    content = re.sub(pattern4, replacement4, content)
    
    # Pattern: updateDoc(ref, data) --> ref.update(data)
    pattern5 = r'updateDoc\(([^,]+),\s*'
    replacement5 = r'\1.update('
    content = re.sub(pattern5, replacement5, content)
    
    # Pattern: setDoc(ref, data) --> ref.set(data)
    pattern6 = r'setDoc\(([^,]+),\s*'
    replacement6 = r'\1.set('
    content = re.sub(pattern6, replacement6, content)
    
    # Pattern: addDoc(ref, data) --> ref.add(data)  
    pattern7 = r'addDoc\(([^,]+),\s*'
    replacement7 = r'\1.add('
    content = re.sub(pattern7, replacement7, content)
    
    # Pattern: deleteDoc(ref) --> ref.delete()
    pattern8 = r'deleteDoc\(([^)]+)\)'
    replacement8 = r'\1.delete()'
    content = re.sub(pattern8, replacement8, content)
    
    # Pattern: .exists() --> .exists (property, not method)
    content = content.replace('.exists()', '.exists')
    
    # Pattern: snapshot.data() in Admin SDK needs ! or optional chaining sometimes
    # This is tricky, we'll leave it for manual review
    
    if content != original_content:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"✓ Migrated {filepath}")
        return True
    else:
        print(f"- No changes needed for {filepath}")
        return False

if __name__ == "__main__":
    files = [
        "src/app/actions/admin-content.ts",
        "src/app/actions/cooperative-admin.ts",
        "src/app/actions/order-management.ts",
        "src/app/actions/resource-actions.ts",
    ]
    
    migrated_count = 0
    for filepath in files:
        try:
            if migrate_file(filepath):
                migrated_count += 1
        except Exception as e:
            print(f"✗ Error migrating {filepath}: {e}")
    
    print(f"\n✅ Migrated {migrated_count}/{len(files)} files")
