#!/bin/bash

# Fix import syntax errors in Server Actions
# The migration script left some imports without closing braces

FILES=(
  "src/app/actions/admin-content.ts"
  "src/app/actions/cooperative-admin.ts"
  "src/app/actions/disputes.ts"
  "src/app/actions/escrow-actions.ts"
  "src/app/actions/export-investments.ts"
  "src/app/actions/export.ts"
  "src/app/actions/farm-nation.ts"
  "src/app/actions/marketplace-buyer.ts"
  "src/app/actions/order-management.ts"
  "src/app/actions/orders.ts"
  "src/app/actions/resource-actions.ts"
  "src/app/actions/reviews.ts"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "Fixing $file..."
    
    # Use perl to fix the malformed imports
    # Look for patterns where an import block doesn't have closing brace followed by 'import'
    perl -i -0pe 's/(\s+[a-zA-Z,\s]+,\n)\nimport/\1\} from "firebase-admin\/firestore";\nimport/g' "$file"
    
    echo "✓ Fixed $file"
  else
    echo "✗ File not found: $file"
  fi  
done

echo ""
echo "✅ All import syntax errors fixed!"
