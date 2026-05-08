import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def cleanup_duplicates(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    modified = False
    # Use a more robust regex to find duplicate error in Promise or interface blocks
    # We look for blocks like: Promise<{ ... error: ... error: ... }>
    
    def fix_block(match):
        block = match.group(0)
        if block.count('error:') > 1:
            # We have a duplicate.
            # 1. Remove error?: string or error?: string | null
            new_block = re.sub(r'error\??:\s*(string\s*\|\s*null|string|null);?\s*,?\s*', '', block)
            # 2. Ensure one error: string | null is present
            if 'success: true | false' in new_block:
                new_block = new_block.replace('success: true | false', 'error: string | null, success: boolean')
            elif 'success: boolean' in new_block:
                new_block = new_block.replace('success: boolean', 'error: string | null, success: boolean')
            else:
                # Add it at the start of the block
                new_block = re.sub(r'(\{|Promise<\{)', r'\1 error: string | null,', new_block)
            return new_block
        return block

    # Match blocks like Promise<{ ... }> or type ... = { ... }
    new_content = re.sub(r'(Promise<\{[^{}]*\}>|type\s+\w+\s*=\s*\{[^{}]*\})', fix_block, content, flags=re.DOTALL)
    
    if new_content != content:
        with open(filepath, 'w') as f:
            f.write(new_content)
        return True
    return False

    if modified:
        with open(filepath, 'w') as f:
            f.writelines([l for l in new_lines if l.strip() or l == '\n'])
        return True
    return False

modified_count = 0
for root, dirs, files in os.walk(actions_dir):
    for file in files:
        if file.endswith('.ts'):
            if cleanup_duplicates(os.path.join(root, file)):
                modified_count += 1

print(f"Cleaned up {modified_count} files.")
