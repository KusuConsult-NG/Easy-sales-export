import os
import re

def process_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception:
        return

    # Looking for \w+Result.success && \w+Result.(products|orders|stats|verification|analytics|message)
    # Be careful not to replace `result.success` itself.
    
    # We want to replace `result.products` with `result.data?.products`
    # and `result.orders` with `result.data?.orders`, etc.
    # We will do this globally but carefully. We only target files in specific folders.
    
    replacements = ['products', 'orders', 'stats', 'verification', 'analytics', 'product', 'wallet', 'newBalance', 'withdrawalId', 'transactions', 'hasMore', 'admins', 'escrowId', 'disputeId', 'authorizationUrl', 'reference', 'lastId']
    
    # regex for `result.orders` -> `result.data?.orders` or `result.data.orders` depending on context?
    # Better to just use `result.data?.orders`.
    
    new_content = content
    for word in replacements:
        # e.g., result.orders
        # we only do this if it's accompanied by an Action call in the file?
        # A simpler way: Find `\w+\.` + word. 
        # But `orders.map` shouldn't become `data?.orders.map`
        # We look for variables ending in `Result` or `result` or `res` or `updated` or `data`?
        pass

    # A better targeted approach: Find `.success` checks.
    # if (result.success && result.products) { setProducts(result.products) }
    
    def replacer(match):
        var_name = match.group(1) # e.g. result
        attr = match.group(2)     # e.g. products
        return f"{var_name}.data?.{attr}"

    # Target: result.products -> result.data?.products
    # Condition: var_name must be something that holds the action result. Usually 'result', 'res', '\w+Result'
    pattern = r"\b([a-zA-Z0-9_]*result|[a-zA-Z0-9_]*Result|res|updated)\.(products|orders|stats|verification|analytics|product|wallet|newBalance|withdrawalId|transactions|hasMore|admins|escrowId|disputeId|authorizationUrl|reference|lastId|message)\b"
    
    new_content = re.sub(pattern, replacer, content)

    # Some false positives might happen if `result.products` already became `result.data?.products` earlier. The regex matches `updated.products`
    # Wait, `product.sellerName` might be replaced if variable is `res.product`.
    # Let's clean up any double substitutions like `result.data?.data?.xxx`
    new_content = new_content.replace(".data?.data?.", ".data?.")
    
    if content != new_content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Updated: {filepath}")

targets = ['src/app/marketplace', 'src/app/vendor', 'src/app/admin/marketplace']

for target in targets:
    for root, dirs, files in os.walk(target):
        for file in files:
            if file.endswith('.tsx') or file.endswith('.ts'):
                process_file(os.path.join(root, file))

