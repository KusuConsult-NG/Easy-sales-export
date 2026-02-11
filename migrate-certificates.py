#!/usr/bin/env python3
"""Complete migration for certificates.ts - Final File"""

filepath = "src/app/actions/certificates.ts"

with open(filepath, 'r') as f:
    content = f.read()

import re

# Step 1: Fix Timestamp type reference - just use Date
content = content.replace('uploadedAt: Timestamp;', 'uploadedAt: Date | any;')

# Step 2: Add FieldValue import
if 'import { FieldValue } from "firebase-admin/firestore";' not in content:
    content = content.replace(
        'import { storage } from "@/lib/firebase";',
        'import { storage } from "@/lib/firebase";\nimport { FieldValue } from "firebase-admin/firestore";'
    )

# Step 3: Fix getDocs -> .get()
content = content.replace('await getDocs(q)', 'await q.get()')

# Step 4: Fix doc() calls -> db.collection().doc()
# doc(db, "certificates", certificateId) -> db.collection("certificates").doc(certificateId)
content = re.sub(
    r'doc\(db,\s*"([^"]+)",\s*([^)]+)\)',
    r'db.collection("\1").doc(\2)',
    content
)

# Step 5: Fix getDoc -> .get()
# getDoc(certRef) -> certRef.get()
content = re.sub(r'await getDoc\((\w+)\)', r'await \1.get()', content)

# Step 6: Fix deleteDoc -> .delete()
content = re.sub(r'await deleteDoc\((\w+)\)', r'await \1.delete()', content)

# Step 7: Fix updateDoc -> .update()
content = re.sub(r'await updateDoc\(([^,]+),', r'await \1.update(', content)

# Step 8: Fix .exists() -> .exists
content = content.replace('.exists)', '.exists')
content = content.replace('if (!certDoc.exists', 'if (!certDoc.exists')
content = content.replace('if (!userDoc.exists', 'if (!userDoc.exists')

with open(filepath, 'w') as f:
    f.write(content)

print("✓ Migrated certificates.ts")
