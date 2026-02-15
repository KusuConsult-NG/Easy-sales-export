#!/bin/bash

# Production Logging Cleanup Script
# Replaces console.error with logger.error throughout the codebase

echo "🔧 Production Logging Cleanup Script"
echo "====================================="
echo ""

# Count current console.error occurrences
TOTAL=$(grep -r "console.error" src/app --include="*.ts" --include="*.tsx" | wc -l | tr -d ' ')
echo "Found $TOTAL console.error statements"
echo ""

# Add logger import to files that don't have it
echo "Step 1: Adding logger imports..."
for file in $(grep -rl "console.error" src/app --include="*.ts" --include="*.tsx"); do
    # Check if logger import already exists
    if ! grep -q "import.*logger.*from.*@/lib/logger" "$file"; then
        # Check if file has other imports
        if grep -q "^import" "$file"; then
            # Add after last import
            sed -i '' '/^import/!b;:a;n;/^import/ba;i\
import { logger } from "@/lib/logger";
' "$file"
        else
            # Add at top of file
            sed -i '' '1i\
import { logger } from "@/lib/logger";\
' "$file"
        fi
        echo "  ✓ Added import to $file"
    fi
done

echo ""
echo "Step 2: Replacing console.error with logger.error..."

# Replace console.error with logger.error
find src/app -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' \
    -e 's/console\.error(/logger.error(/g' {} \;

echo "  ✓ Replaced all console.error calls"

# Count remaining console.error
REMAINING=$(grep -r "console.error" src/app --include="*.ts" --include="*.tsx" | wc -l | tr -d ' ')
echo ""
echo "Results:"
echo "--------"
echo "Before: $TOTAL console.error statements"
echo "After:  $REMAINING console.error statements"
echo "Fixed:  $((TOTAL - REMAINING)) statements"
echo ""

if [ "$REMAINING" -eq 0 ]; then
    echo "✅ SUCCESS: All console.error statements replaced!"
else
    echo "⚠️  WARNING: $REMAINING console.error statements remain"
    echo "Run: grep -rn 'console.error' src/app --include='*.ts' --include='*.tsx'"
fi

echo ""
echo "🔍 Next Steps:"
echo "1. Run: npm run build"
echo "2. Fix any TypeScript errors"
echo "3. Test locally"
echo "4. Commit changes"
