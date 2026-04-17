import re
import sys

def patch_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    if "for await" not in content:
        return
        
    start_pos = 0
    while True:
        match = re.search(r"for await \(\s*const\s+(\w+)\s+of\s+([a-zA-Z0-9_\.]+)(?:\s+as\s+any)?\s*\)\s*\{", content[start_pos:])
        if not match:
            break
            
        real_start = start_pos + match.start()
        real_end = start_pos + match.end()
        
        var_name = match.group(1)
        stream_name = match.group(2)
        
        header_replacement = f"await iterateStream({stream_name}, async ({var_name}: any) => {{"
        
        search_start = real_end
        brace_count = 1
        pos = search_start
        while pos < len(content):
            if content[pos] == '{':
                brace_count += 1
            elif content[pos] == '}':
                brace_count -= 1
                if brace_count == 0:
                    break
            pos += 1
            
        inner_block = content[real_end:pos]
        new_inner_block = re.sub(r"\bcontinue\s*;", "return;", inner_block)
        
        content = content[:real_start] + header_replacement + new_inner_block + "});" + content[pos+1:]
        
        start_pos = real_start + len(header_replacement) + len(new_inner_block) + 3
        
    if "iterateStream" in content and "import { iterateStream" not in content:
        content = "import { iterateStream } from '@/lib/firestore-stream';\n" + content
        
    with open(filepath, 'w') as f:
        f.write(content)
    print(f"Patched {filepath}")

for f in sys.argv[1:]:
    patch_file(f)
