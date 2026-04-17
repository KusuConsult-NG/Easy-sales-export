import os
import re

FILES = [
    'src/app/actions/broadcast.ts',
    'src/app/actions/in-app-broadcast.ts',
    'src/app/actions/sms-broadcast.ts',
    'src/app/actions/admin-communications.ts',
    'src/app/actions/cooperative-admin.ts'
]

for file_path in FILES:
    if not os.path.exists(file_path):
        continue
    with open(file_path, 'r') as f:
        content = f.read()
    
    # Replace .stream() with .get()
    # It typically looks like:
    # const stream = ...stream();
    # for await (const d of stream as any) {
    
    content = re.sub(r'\.stream\(\);', r'.get();', content)
    
    # Replace for await (const d of stream as any) with for (const d of (await stream).docs)
    # But wait, wait! The variable name might not be stream.
    # Often it is: const stream = ...get(); for await (const d of stream as any) -> this would have `await` on a Promise?
    # No, if it's async we await the get().
    # Let's do it carefully.
    
