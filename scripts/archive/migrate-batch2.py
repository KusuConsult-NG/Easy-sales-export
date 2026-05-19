#!/usr/bin/env python3
"""Migrate Batch 2: Marketplace & Transactions"""

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
    firestore_import_pattern = r'import \{[^}]+\} from "firebase/firestore";?\n'
    content = re.sub(firestore_import_pattern, '', content)
    
    # Step 3: Add FieldValue import if server Timestamp is used
    if 'serverTimestamp()' in content or 'Timestamp.now()' in content:
        if 'import { FieldValue' not in content and 'import {FieldValue' not in content:
            admin_import_line = 'import { db } from "@/lib/firebase-admin";'
            if admin_import_line in content:
                content = content.replace(
                    admin_import_line,
                    admin_import_line + '\nimport { FieldValue } from "firebase-admin/firestore";'
                )
        content = content.replace('serverTimestamp()', 'FieldValue.serverTimestamp()')
        content = content.replace('Timestamp.now()', 'FieldValue.serverTimestamp()')
    
    # Step 4: Convert method calls
    content = re.sub(r'getDoc\(doc\(db,\s*([^,]+),\s*([^)]+)\)\)', r'db.collection(\1).doc(\2).get()', content)
    content = re.sub(r'getDocs\(collection\(db,\s*([^)]+)\)\)', r'db.collection(\1).get()', content)
    content = re.sub(r'collection\(db,\s*([^)]+)\)', r'db.collection(\1)', content)
    content = re.sub(r'doc\(db,\s*([^,]+),\s*([^)]+)\)', r'db.collection(\1).doc(\2)', content)
    content = re.sub(r'updateDoc\(([^,]+),\s*', r'\1.update(', content)
    content = re.sub(r'setDoc\(([^,]+),\s*', r'\1.set(', content)
    content = re.sub(r'addDoc\(([^,]+),\s*', r'\1.add(', content)
    content = re.sub(r'deleteDoc\(([^)]+)\)', r'\1.delete()', content)
    content = content.replace('.exists()', '.exists')
    
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
        "src/app/actions/marketplace-buyer.ts",
        "src/app/actions/disputes.ts",
        "src/app/actions/escrow-actions.ts",
        "src/app/actions/orders.ts",
        "src/app/actions/reviews.ts",
    ]
    
    migrated_count = 0
    for filepath in files:
        try:
            if migrate_file(filepath):
                migrated_count += 1
        except Exception as e:
            print(f"✗ Error migrating {filepath}: {e}")
    
    print(f"\n✅ Migrated {migrated_count}/{len(files)} files")
