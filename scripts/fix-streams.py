import os
import re

files = [
    'src/app/actions/broadcast.ts',
    'src/app/actions/in-app-broadcast.ts',
    'src/app/actions/sms-broadcast.ts',
    'src/app/actions/admin-communications.ts',
    'src/app/actions/cooperative-admin.ts'
]

for filepath in files:
    if not os.path.exists(filepath):
        continue
    with open(filepath, 'r') as f:
        content = f.read()

    # 1. Replace all .stream() with .get()
    content = content.replace('.stream()', '.get()')

    # 2. Replace for await (const D of STREAM as any) {
    # with for (const D of (await STREAM).docs) {
    def repl_for(m):
        docName = m.group(1)
        streamVar = m.group(2)
        return f"for (const {docName} of (await {streamVar}).docs) {{"
    
    content = re.sub(r'for\s*await\s*\(\s*const\s+(\w+)\s+of\s+(\w+)\s*(?:as any)?\s*\)\s*\{', repl_for, content)

    with open(filepath, 'w') as f:
        f.write(content)

print("Done")
