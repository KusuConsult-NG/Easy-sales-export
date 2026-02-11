#!/usr/bin/env python3
"""Migrate academy.ts"""

import re
import sys

def migrate_file(filepath):
    print(f"Migrating {filepath}...")
    
    with open(filepath, 'r') as f:
        content = f.read()
    
    original_content = content
    
    # Replace Timestamp.now() with FieldValue.serverTimestamp()
    content = content.replace('Timestamp.now()', 'FieldValue.serverTimestamp()')
    
    # Convert method calls
    content = re.sub(r'getDocs\(collection\(db,\s*([^)]+)\)\)', r'db.collection(\1).get()', content)
    content = re.sub(r'getDocs\(([^)]+)\)', r'\1.get()', content)  # For queries  
    content = re.sub(r'getDoc\(doc\(db,\s*([^,]+),\s*([^)]+)\)\)', r'db.collection(\1).doc(\2).get()', content)
    content = re.sub(r'getDoc\(([^)]+)\)', r'\1.get()', content)  # For refs
    content = re.sub(r'collection\(db,\s*([^)]+)\)', r'db.collection(\1)', content)
    content = re.sub(r'(\s)doc\(db,\s*([^,]+),\s*([^)]+)\)', r'\1db.collection(\2).doc(\3)', content)
    content = re.sub(r'updateDoc\(([^,]+),\s*', r'\1.update(', content)
    content = re.sub(r'setDoc\(([^,]+),\s*', r'\1.set(', content)
    content = re.sub(r'addDoc\(([^,]+),\s*', r'\1.add(', content)
    content = re.sub(r'deleteDoc\(([^)]+)\)', r'\1.delete()', content)
    content = content.replace('.exists()', '.exists')
    
    # Fix query patterns
    content = re.sub(r'query\(([^,)]+),\s*where\(', r'db.collection(\1).where(', content)
    content = re.sub(r'query\(query\(([^)]+)\),\s*where\(', r'\1.where(', content)
    content = re.sub(r'query\(([^)]+)\)', r'\1', content)  # Remove remaining query() wrappers
    
    if content != original_content:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"✓ Migrated {filepath}")
        return True
    else:
        print(f"- No changes needed for {filepath}")
        return False

if __name__ == "__main__":
    migrate_file("src/app/actions/academy.ts")
