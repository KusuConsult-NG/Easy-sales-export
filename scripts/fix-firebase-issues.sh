#!/bin/bash

# Firebase Issues Fix Script
# This script identifies and helps fix common Firebase/Firestore issues

set -e

echo "🔥 Firebase Issues Diagnostic & Fix Script"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Must be run from the project root directory${NC}"
    exit 1
fi

echo -e "${BLUE}Step 1: Checking Firebase Configuration...${NC}"
echo ""

# Check for Firebase config
if [ ! -f "src/lib/firebase.ts" ]; then
    echo -e "${RED}❌ firebase.ts not found${NC}"
    exit 1
else
    echo -e "${GREEN}✓ Firebase configuration file exists${NC}"
fi

# Check environment variables
echo ""
echo -e "${BLUE}Step 2: Checking Environment Variables...${NC}"
echo ""

REQUIRED_VARS=(
    "NEXT_PUBLIC_FIREBASE_API_KEY"
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID"
    "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"
    "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"
    "NEXT_PUBLIC_FIREBASE_APP_ID"
    "FIREBASE_PROJECT_ID"
    "FIREBASE_CLIENT_EMAIL"
    "FIREBASE_PRIVATE_KEY"
)

MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if grep -q "^${var}=" .env.local 2>/dev/null; then
        echo -e "${GREEN}✓ ${var}${NC}"
    else
        echo -e "${RED}✗ ${var} - MISSING${NC}"
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo ""
    echo -e "${YELLOW}⚠️  Missing environment variables detected${NC}"
    echo "Add these to your .env.local file"
fi

echo ""
echo -e "${BLUE}Step 3: Scanning for Firestore Queries Requiring Indexes...${NC}"
echo ""

# Search for complex queries that likely need indexes
echo "Searching for queries with where() + orderBy()..."
grep -rn "where(" src/ --include="*.ts" --include="*.tsx" | grep "orderBy" > /tmp/firebase_queries.txt 2>/dev/null || true

if [ -s /tmp/firebase_queries.txt ]; then
    echo -e "${YELLOW}Found queries that may require indexes:${NC}"
    cat /tmp/firebase_queries.txt
else
    echo -e "${GREEN}No obvious complex queries found${NC}"
fi

echo ""
echo -e "${BLUE}Step 4: Known Index Requirements${NC}"
echo ""

echo "📋 Required Firestore Composite Indexes:"
echo ""
echo "1. Notifications Index:"
echo "   Collection: notifications"
echo "   Fields: userId (Ascending), createdAt (Descending)"
echo "   🔗 https://console.firebase.google.com/v1/r/project/easy-sales-hub/firestore/indexes?create_composite=ClRwcm9qZWN0cy9lYXN5LXNhbGVzLWh1Yi9kYXRhYmFzZXMvKGRlZmF1bHQpL2NvbGxlY3Rpb25Hcm91cHMvbm90aWZpY2F0aW9ucy9pbmRleGVzL18QARoKCgZ1c2VySWQQARoNCgljcmVhdGVkQXQQAhoMCghfX25hbWVfXxAC"
echo ""

echo "2. Audit Logs Index (if needed):"
echo "   Collection: audit_logs"
echo "   Fields: userId (Ascending), timestamp (Descending)"
echo ""

echo "3. Export Windows Index (if needed):"
echo "   Collection: export_windows"
echo "   Fields: status (Ascending), deadline (Ascending)"
echo ""

echo ""
echo -e "${BLUE}Step 5: Checking for Firebase Initialization Issues...${NC}"
echo ""

# Check if firebase is initialized properly
if grep -q "getApps().length === 0" src/lib/firebase.ts; then
    echo -e "${GREEN}✓ Firebase lazy initialization pattern detected${NC}"
else
    echo -e "${YELLOW}⚠️  Firebase initialization pattern not detected${NC}"
    echo "   Ensure Firebase is initialized with lazy pattern to avoid SSR issues"
fi

echo ""
echo -e "${BLUE}Step 6: Security Rules Check${NC}"
echo ""

if [ -f "firestore.rules" ]; then
    echo -e "${GREEN}✓ firestore.rules file exists${NC}"
    echo ""
    echo "📄 Current rules preview:"
    head -20 firestore.rules
else
    echo -e "${YELLOW}⚠️  firestore.rules file not found${NC}"
    echo ""
    echo "Create firestore.rules with proper security:"
    cat << 'EOF'
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users collection
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == userId;
    }
    
    // Notifications collection
    match /notifications/{notificationId} {
      allow read: if request.auth != null && 
                     resource.data.userId == request.auth.uid;
      allow write: if request.auth != null && 
                      request.auth.token.role in ['admin', 'super_admin'];
    }
    
    // Add other collections...
  }
}
EOF
fi

echo ""
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✅ Firebase Diagnostic Complete${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

echo "📝 Action Items:"
echo ""
echo "1. ✅ Create missing Firestore indexes by clicking the links above"
echo "2. ✅ Verify all environment variables are set in Vercel"
echo "3. ✅ Deploy updated security rules if needed"
echo "4. ✅ Check browser console for any remaining Firebase errors"
echo ""

# Generate firestore.indexes.json
echo -e "${BLUE}Step 7: Generating firestore.indexes.json${NC}"
echo ""

cat > firestore.indexes.json << 'EOF'
{
  "indexes": [
    {
      "collectionGroup": "notifications",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "userId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "createdAt",
          "order": "DESCENDING"
        }
      ]
    },
    {
      "collectionGroup": "audit_logs",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "userId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "timestamp",
          "order": "DESCENDING"
        }
      ]
    },
    {
      "collectionGroup": "export_windows",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "status",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "deadline",
          "order": "ASCENDING"
        }
      ]
    },
    {
      "collectionGroup": "cooperatives",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "members",
          "arrayConfig": "CONTAINS"
        },
        {
          "fieldPath": "createdAt",
          "order": "DESCENDING"
        }
      ]
    }
  ],
  "fieldOverrides": []
}
EOF

echo -e "${GREEN}✓ Created firestore.indexes.json${NC}"
echo ""
echo "You can deploy these indexes using:"
echo -e "${YELLOW}firebase deploy --only firestore:indexes${NC}"
echo ""

echo "🎉 Script complete! Check the action items above."
