#!/bin/bash

# FINAL Logger Import Cleanup Script
# Removes all duplicate 'import { logger } from "@/lib/logger"' statements

echo "🔧 Removing duplicate logger imports from all files..."
echo "=================================================="

FIXED=0
TOTAL=0

# Find all files with duplicate logger imports
while IFS= read -r file; do
    count=$(grep -c "import { logger } from" "$file" 2>/dev/null)
    
    if [ "$count" -gt 1 ]; then
        TOTAL=$((TOTAL + 1))
        
        # Use awk to keep only first occurrence of logger import
        awk '
            !seen && /import \{ logger \} from/ { 
                print; 
                seen=1; 
                next 
            }
            !/import \{ logger \} from/ { print }
        ' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
        
        FIXED=$((FIXED + 1))
        echo "✓ Fixed: $file (had $count imports)"
    fi
done < <(find src/app -type f \( -name "*.ts" -o -name "*.tsx" \))

echo ""
echo "Results:"
echo "--------"
echo "Files with duplicates: $TOTAL"
echo "Files fixed: $FIXED"
echo ""

if [ "$FIXED" -gt 0 ]; then
    echo "✅ SUCCESS: Removed duplicate logger imports from $FIXED files!"
else
    echo "⚠️  No duplicate logger imports found"
fi
