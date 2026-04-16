import os
import re

admin_dir = "src/app/admin"

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # We want to catch instances where a server action result 'result.data' or 'res.data'
    # is being accessed. We will look for common patterns from grep.
    
    # 1. result.data?.transactions -> result.transactions
    # 2. result.data.transactions -> result.transactions
    # 3. result.data! -> result
    # 4. result.data -> result
    # 5. setCourses(result.data) -> setCourses(result.courses) - wait, this is contextual
    
    # Let's see some specific examples:
    # if (result.success && result.data?.reports) { setReports(result.data.reports); }
    # becomes: if (result.success && result.reports) { setReports(result.reports); }
    
    new_content = content
    
    # Replace result.data?.property -> result.property
    new_content = re.sub(r'(result|res|statsRes|reportsRes|activityRes|dataReq)\.data\?\.([a-zA-Z0-9_]+)', r'\1.\2', new_content)
    # Replace result.data.property -> result.property
    new_content = re.sub(r'(result|res|statsRes|reportsRes|activityRes|dataReq)\.data\.([a-zA-Z0-9_]+)', r'\1.\2', new_content)
    
    # Replace result.data! -> result  -- DANGEROUS! Needs context.
    
    if new_content != content:
        with open(filepath, 'w') as f:
            f.write(new_content)
            print(f"Fixed nested property access in {filepath}")
            
    # For standalone result.data, it's safer to flag them
    has_standalone = re.search(r'\b(result|res|data|updated)\.data\b(?!\.)', new_content)
    if has_standalone:
         print(f"File {filepath} still has standalone .data")

for root, _, files in os.walk(admin_dir):
    for filename in files:
        if filename.endswith(".tsx") or filename.endswith(".ts"):
            process_file(os.path.join(root, filename))

