#!/usr/bin/env python3
"""Fix all userDoc.data() null safety issues across Server Actions"""

import os
import re
import glob

action_files = glob.glob("src/app/actions/*.ts")
action_files = [f for f in action_files if ".bak" not in f]

fixed_count = 0

for filepath in action_files:
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # Pattern: if (!userDoc.exists || userDoc.data().role !== "admin")
    # Should be: const userData = userDoc.data(); if (!userDoc.exists || !userData || userData.role !== "admin")
    
    # Find all instances where we check userDoc.data().role without null check
    # Pattern 1: if (!userDoc.exists || userDoc.data().role !== "...")
    pattern1 = r'if \(!userDoc\.exists \|\| userDoc\.data\(\)\.role !== (["\'][^"\']+["\'])\)'
    
    def replace_func1(match):
        role = match.group(1)
        return f'const userData = userDoc.data();\n        if (!userDoc.exists || !userData || userData.role !== {role})'
    
    # Check if this pattern exists
    if re.search(pattern1, content):
        # Replace the pattern
        content = re.sub(pattern1, replace_func1, content)
        
    # Save if changed
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        fixed_count += 1
        print(f"✓ Fixed: {filepath}")

print(f"\n=== Null Safety Fix Complete ===")
print(f"✓ Fixed: {fixed_count} files")
