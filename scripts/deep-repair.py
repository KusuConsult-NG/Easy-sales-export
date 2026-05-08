import os
import re

actions_dir = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions"

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # 1. Fix unterminated template literals (often caused by my regex eating the closing backtick)
    # If a line has success: true as const and a backtick but no closing backtick on the same line
    lines = content.split('\n')
    new_lines = []
    for line in lines:
        if 'success: true as const' in line and '`' in line:
            # Check if there is a closing backtick
            if line.count('`') % 2 != 0:
                # Remove the trailing backtick and garbage
                line = re.sub(r'success:\s*true\s*as\s*const.*$', r'success: true as const, data: null };', line)
        new_lines.append(line)
    content = '\n'.join(new_lines)

    # 2. Fix malformed return objects with data: null and meta: null
    content = re.sub(r'return\s*\{\s*error:\s*null\s*,\s*success:\s*true\s*as\s*const\s*\}\s*,\s*meta:\s*null\s*\};', r'return { error: null, success: true as const, data: null, meta: null };', content)
    
    # 3. Fix the catch block structural breaks
    content = re.sub(r'\}\s*,\s*meta:\s*null\s*\};\s*\}\s*catch', r' };\n    } catch', content)

    # 4. Final check for any remaining success: true as const without data: null
    def add_data_null(match):
        obj = match.group(0)
        if 'data:' not in obj:
            return obj.replace('}', ', data: null }')
        return obj

    content = re.sub(r'return\s*\{\s*error:\s*null\s*,\s*success:\s*true\s*as\s*const.*?;', add_data_null, content, flags=re.DOTALL)

    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False

modified_count = 0
for root, dirs, files in os.walk(actions_dir):
    for file in files:
        if file.endswith('.ts') or file.endswith('.tsx'):
            if fix_file(os.path.join(root, file)):
                modified_count += 1

print(f"Deep repair applied to {modified_count} files.")
