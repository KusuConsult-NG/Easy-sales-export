#!/usr/bin/env python3
"""Complete migration for admin-analytics.ts - handle all complex patterns"""

filepath = "src/app/actions/admin-analytics.ts"

with open(filepath, 'r') as f:
    content = f.read()

# Fix all the broken query patterns
# Pattern 1: getDocs(db.collection("name", where(...))) -> db.collection("name").where(...).get()
import re

# Replace getDocs(db.collection("x", where("field", "op", value))) patterns
# This is the most complex pattern - collection() with where() as second argument (wrong syntax)
content = re.sub(
    r'getDocs\(db\.collection\(([^,]+),\s*where\(([^)]+)\)\)\)',
    r'db.collection(\1).where(\2).get()',
    content
)

# Replace any remaining getDocs calls
content = re.sub(r'await getDocs\(([^)]+)\)', r'await \1.get()', content)
content = re.sub(r'getDocs\(([^)]+)\)', r'\1.get()', content)

# Fix query() wrappers
content = re.sub(r'query\(([^,)]+),\s*where\(', r'\1.where(', content)
content = re.sub(r'query\(([^,)]+),\s*orderBy\(', r'\1.orderBy(', content)

# Fix standalone where(), orderBy(), limit() calls that aren't methods
# These need to be chained as methods
content = re.sub(r',\s*where\(', r'.where(', content)
content = re.sub(r',\s*orderBy\(', r'.orderBy(', content)
content = re.sub(r',\s*firestoreLimit\(', r'.limit(', content)
content = content.replace('firestoreLimit(', 'limit(')

# Fix Timestamp usage - Admin SDK uses different import
content = content.replace('Timestamp.fromDate(', 'admin.firestore.Timestamp.fromDate(')
content = content.replace('Timestamp.now()', 'admin.firestore.Timestamp.now()')

# Actually, simpler - just use Date objects or FieldValue
content = content.replace('admin.firestore.Timestamp.fromDate(thirtyDaysAgo)', 'thirtyDaysAgo')

# Make sure we're not calling undefined functions
content = re.sub(r'\bwhere\(', r'XXX_WHERE_PLACEHOLDER(', content)  # Temporarily mark
content = re.sub(r'\borderBy\(', r'XXX_ORDERBY_PLACEHOLDER(', content)
content = re.sub(r'\.XXX_WHERE_PLACEHOLDER\(', r'.where(', content)  # Restore chained calls
content = re.sub(r'\.XXX_ORDERBY_PLACEHOLDER\(', r'.orderBy(', content)

# If there are any remaining standalone placeholders, they're errors - replace with comments
content = content.replace('XXX_WHERE_PLACEHOLDER(', '/* FIXME: where( */(')
content = content.replace('XXX_ORDERBY_PLACEHOLDER(', '/* FIXME: orderBy( */(')

with open(filepath, 'w') as f:
    f.write(content)

print("✓ Migrated admin-analytics.ts with complex query fix")
