#!/usr/bin/env python3
"""Complete migration for cms.ts - fix all remaining unmigrated patterns"""

filepath = "src/app/actions/cms.ts"

with open(filepath, 'r') as f:
    content = f.read()

import re

# Fix doc(db, "collection", id) -> db.collection("collection").doc(id)
content = re.sub(
    r'doc\(db,\s*"announcements",\s*announcementId\)',
    'db.collection("announcements").doc(announcementId)',
    content
)

content = re.sub(
    r'doc\(db,\s*"banners",\s*bannerId\)',
    'db.collection("banners").doc(bannerId)',
    content
)

# Fix updateDoc(ref, data) -> ref.update(data)
content = re.sub(
    r'await updateDoc\((\w+),\s*\{',
    r'await \1.update({',
    content
)

with open(filepath, 'w') as f:
    f.write(content)

print("✓ Completed cms.ts migration")
