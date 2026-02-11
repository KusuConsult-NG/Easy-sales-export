#!/bin/bash

# Firebase Admin Migration Script
# Automatically migrates Server Actions from Client SDK to Admin SDK

echo "Starting Firebase Admin SDK migration..."

# List of files to migrate (excluding already migrated ones)
FILES=(
  "academy-payment.ts"
  "cooperative-payment.ts"
  "export-payment.ts"
  "farm-nation-payment.ts"
  "marketplace-payment.ts"
  "escrow-actions.ts"
  "escrow.ts"
  "reviews.ts"
  "vendor.ts"
  "feature-toggles.ts"
  "admin-content.ts"
  "audit-log-actions.ts"
  "disputes.ts"
  "cms.ts"
  "export.ts"
  "loan-actions.ts"
  "academy.ts"
  "orders.ts"
  "profile.ts"
  "ai-actions.ts"
  "marketplace-buyer.ts"
  "farm-nation.ts"
  "certificates.ts"
  "export-investments.ts"
  "land-listings.ts"
  "platform.ts"
  "setup.ts"
  "admin-analytics.ts"
  "order-management.ts"
  "export-aggregation.ts"
  "dashboard.ts"
  "export-status.ts"
  "land.ts"
  "resource-actions.ts"
  "land-actions.ts"
  "cooperative-admin.ts"
  "course-actions.ts"
)

cd "src/app/actions" || exit 1

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "Processing $file..."
    
    # Step 1: Replace import statement
    sed -i '' 's/from "@\/lib\/firebase"/from "@\/lib\/firebase-admin"/g' "$file"
    
    # Step 2: Remove Client SDK firestore imports
    sed -i '' '/from "firebase\/firestore"/d' "$file"
    
    # Step 3: Add Admin SDK FieldValue import if needed (check if serverTimestamp or increment is used)
    if grep -q "serverTimestamp\|increment" "$file"; then
      # Add import after the firebase-admin import
      sed -i '' '/from "@\/lib\/firebase-admin"/a\
import { FieldValue, Timestamp } from "firebase-admin/firestore";
' "$file"
    fi
    
    echo "✓ $file imports updated"
  fi
done

echo ""
echo "Phase 1 Complete: Import replacements done"
echo "⚠️  Manual review required for method call updates"
echo ""
echo "Next steps:"
echo "1. Review each file for Client SDK → Admin SDK method conversions"
echo "2. Run 'npm run build' to check for type errors"
echo "3. Fix any remaining compilation issues"
