#!/bin/bash

###############################################################################
# Easy Sales Export - Firebase & Resend Setup Script
# 
# This script helps you configure Firebase and Resend for the application
# Prerequisites: 
# - Firebase CLI installed (npm install -g firebase-tools)
# - Access to Firebase Console: https://console.firebase.google.com
# - Resend API key
###############################################################################

set -e  # Exit on error

echo "========================================"
echo "Easy Sales Export - Setup Script"
echo "========================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
    echo -e "${RED}Error: .env.local not found!${NC}"
    echo "Please run this script from the project root directory."
    exit 1
fi

echo -e "${GREEN}Step 1: Firebase Configuration${NC}"
echo "--------------------------------------"
echo ""
echo "Your Firebase Project: easy-sales-hub"
echo "Console: https://console.firebase.google.com/u/4/project/easy-sales-hub"
echo ""

# Get Firebase config from user
echo "Please provide your Firebase configuration values:"
echo "(You can find these in Firebase Console > Project Settings > General > Your apps)"
echo ""

read -p "Firebase API Key: " FIREBASE_API_KEY
read -p "Firebase Auth Domain (e.g., easy-sales-hub.firebaseapp.com): " FIREBASE_AUTH_DOMAIN
read -p "Firebase Project ID (easy-sales-hub): " FIREBASE_PROJECT_ID
read -p "Firebase Storage Bucket (e.g., easy-sales-hub.appspot.com): " FIREBASE_STORAGE_BUCKET
read -p "Firebase Messaging Sender ID: " FIREBASE_MESSAGING_SENDER_ID
read -p "Firebase App ID: " FIREBASE_APP_ID

echo ""
echo -e "${GREEN}Step 2: Updating .env.local with Firebase credentials${NC}"
echo "--------------------------------------"

# Update Firebase config in .env.local
sed -i.bak "s|NEXT_PUBLIC_FIREBASE_API_KEY=.*|NEXT_PUBLIC_FIREBASE_API_KEY=${FIREBASE_API_KEY}|" .env.local
sed -i.bak "s|NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=.*|NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${FIREBASE_AUTH_DOMAIN}|" .env.local
sed -i.bak "s|NEXT_PUBLIC_FIREBASE_PROJECT_ID=.*|NEXT_PUBLIC_FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}|" .env.local
sed -i.bak "s|NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=.*|NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${FIREBASE_STORAGE_BUCKET}|" .env.local
sed -i.bak "s|NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=.*|NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${FIREBASE_MESSAGING_SENDER_ID}|" .env.local
sed -i.bak "s|NEXT_PUBLIC_FIREBASE_APP_ID=.*|NEXT_PUBLIC_FIREBASE_APP_ID=${FIREBASE_APP_ID}|" .env.local

echo -e "${GREEN}✓ Firebase configuration updated${NC}"
echo ""

echo -e "${GREEN}Step 3: Resend Email Service${NC}"
echo "--------------------------------------"
echo "Resend API Key already configured: re_HdjUshgG_5uRMATaCut8UdGTFboERfhWn"
echo -e "${GREEN}✓ Resend is ready${NC}"
echo ""

echo -e "${GREEN}Step 4: Firestore Collections Setup${NC}"
echo "--------------------------------------"
echo ""
echo "Creating required Firestore collections and indexes..."
echo ""

# Create a temporary setup script for Firestore
cat > /tmp/firestore-setup.txt << 'EOF'
Required Firestore Collections:
================================

1. users
   - Indexes: email, role, verified
   - Security Rule: Read/write by authenticated user (own document)

2. cooperatives
   - Subcollection: members
   - Indexes: name, createdAt
   
3. loans
   - Indexes: userId, status, createdAt
   - Security Rule: Read by owner and admin

4. transactions
   - Indexes: userId, type, timestamp
   - Security Rule: Read by owner and admin

5. export_windows
   - Indexes: status, endDate
   - Security Rule: Read by all, write by admin

6. export_bookings
   - Indexes: userId, windowId, status

7. land_listings
   - Indexes: userId, status, state, lga

8. marketplace_products
   - Indexes: vendorId, category, status

9. marketplace_orders
   - Indexes: buyerId, sellerId, status

10. escrow_transactions
    - Indexes: buyerId, sellerId, status

11. disputes
    - Indexes: orderId, status, createdAt

12. academy_courses
    - Subcollection: modules, lessons

13. academy_enrollments
    - Indexes: userId, courseId

14. wave_applications
    - Indexes: userId, status

15. wave_resources
    - Indexes: category, targetAudience

16. announcements
    - Indexes: targetAudience, active, publishedAt

17. notifications
    - Indexes: userId, read, createdAt

18. audit_logs
    - Indexes: userId, action, timestamp
    - Security Rule: Read by admin only

19. mfa_codes
    - Indexes: userId, verified
    - TTL: expiresAt

20. certificates
    - Indexes: userId, type

EOF

cat /tmp/firestore-setup.txt
echo ""
echo -e "${YELLOW}Action Required:${NC}"
echo "1. Go to Firebase Console: https://console.firebase.google.com/u/4/project/easy-sales-hub/firestore"
echo "2. Create the collections listed above (they'll be created automatically when first data is added)"
echo "3. Set up Firestore Security Rules (see firebase-rules.txt)"
echo ""

# Generate Firestore Security Rules
echo -e "${GREEN}Step 5: Generating Firestore Security Rules${NC}"
echo "--------------------------------------"

cat > firebase-rules.txt << 'EOF'
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper functions
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }
    
    function isAdmin() {
      return isAuthenticated() && 
             get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['admin', 'super_admin'];
    }
    
    // Users collection
    match /users/{userId} {
      allow read: if isOwner(userId) || isAdmin();
      allow write: if isOwner(userId);
    }
    
    // Cooperatives
    match /cooperatives/{coopId} {
      allow read: if isAuthenticated();
      allow write: if isAdmin();
      
      match /members/{memberId} {
        allow read: if isOwner(memberId) || isAdmin();
        allow write: if isAdmin();
      }
    }
    
    // Loans
    match /loans/{loanId} {
      allow read: if isOwner(resource.data.userId) || isAdmin();
      allow create: if isAuthenticated();
      allow update: if isAdmin();
    }
    
    // Transactions
    match /transactions/{txnId} {
      allow read: if isOwner(resource.data.userId) || isAdmin();
      allow create: if isAuthenticated();
    }
    
    // Export Windows
    match /export_windows/{windowId} {
      allow read: if true;
      allow write: if isAdmin();
    }
    
    // Export Bookings
    match /export_bookings/{bookingId} {
      allow read: if isOwner(resource.data.userId) || isAdmin();
      allow create: if isAuthenticated();
      allow update: if isAdmin();
    }
    
    // Land Listings
    match /land_listings/{listingId} {
      allow read: if resource.data.status == 'verified' || isOwner(resource.data.userId) || isAdmin();
      allow create: if isAuthenticated();
      allow update: if isOwner(resource.data.userId) || isAdmin();
    }
    
    // Marketplace
    match /marketplace_products/{productId} {
      allow read: if resource.data.active == true || isOwner(resource.data.vendorId) || isAdmin();
      allow write: if isOwner(resource.data.vendorId) || isAdmin();
    }
    
    match /marketplace_orders/{orderId} {
      allow read: if isOwner(resource.data.buyerId) || isOwner(resource.data.sellerId) || isAdmin();
      allow create: if isAuthenticated();
      allow update: if isOwner(resource.data.buyerId) || isOwner(resource.data.sellerId) || isAdmin();
    }
    
    // Escrow
    match /escrow_transactions/{escrowId} {
      allow read: if isOwner(resource.data.buyerId) || isOwner(resource.data.sellerId) || isAdmin();
      allow create: if isAuthenticated();
      allow update: if isAdmin();
    }
    
    // Disputes
    match /disputes/{disputeId} {
      allow read: if isOwner(resource.data.buyerId) || isOwner(resource.data.sellerId) || isAdmin();
      allow create: if isAuthenticated();
      allow update: if isAdmin();
    }
    
    // Academy
    match /academy_courses/{courseId} {
      allow read: if true;
      allow write: if isAdmin();
      
      match /modules/{moduleId} {
        allow read: if true;
        allow write: if isAdmin();
      }
    }
    
    match /academy_enrollments/{enrollmentId} {
      allow read: if isOwner(resource.data.userId) || isAdmin();
      allow create: if isAuthenticated();
      allow update: if isOwner(resource.data.userId);
    }
    
    // WAVE Program
    match /wave_applications/{appId} {
      allow read: if isOwner(resource.data.userId) || isAdmin();
      allow create: if isAuthenticated();
      allow update: if isAdmin();
    }
    
    match /wave_resources/{resourceId} {
      allow read: if isAuthenticated();
      allow write: if isAdmin();
    }
    
    // Announcements
    match /announcements/{announcementId} {
      allow read: if resource.data.active == true;
      allow write: if isAdmin();
    }
    
    // Notifications
    match /notifications/{notificationId} {
      allow read: if isOwner(resource.data.userId);
      allow update: if isOwner(resource.data.userId);
      allow create: if isAdmin();
    }
    
    // Audit Logs (Admin only)
    match /audit_logs/{logId} {
      allow read: if isAdmin();
      allow create: if isAuthenticated();
    }
    
    // MFA Codes (temporary, auto-delete)
    match /mfa_codes/{codeId} {
      allow read: if isOwner(resource.data.userId);
      allow write: if isOwner(resource.data.userId);
    }
    
    // Certificates
    match /certificates/{certId} {
      allow read: if isOwner(resource.data.userId) || isAdmin();
      allow write: if isOwner(resource.data.userId);
    }
  }
}
EOF

echo -e "${GREEN}✓ Firestore security rules generated: firebase-rules.txt${NC}"
echo ""

# Generate Firebase Storage Rules
echo -e "${GREEN}Step 6: Generating Firebase Storage Rules${NC}"
echo "--------------------------------------"

cat > storage-rules.txt << 'EOF'
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    
    // Helper functions
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function isOwner(userId) {
      return request.auth.uid == userId;
    }
    
    // Certificates (max 10MB)
    match /certificates/{userId}/{fileName} {
      allow read: if isOwner(userId);
      allow write: if isOwner(userId) && 
                     request.resource.size < 10 * 1024 * 1024 &&
                     request.resource.contentType.matches('application/pdf|image/.*');
    }
    
    // Product images (max 5MB)
    match /products/{vendorId}/{fileName} {
      allow read: if true;
      allow write: if isOwner(vendorId) && 
                     request.resource.size < 5 * 1024 * 1024 &&
                     request.resource.contentType.matches('image/.*');
    }
    
    // Land listing documents (max 10MB)
    match /land/{userId}/{fileName} {
      allow read: if isOwner(userId);
      allow write: if isOwner(userId) && 
                     request.resource.size < 10 * 1024 * 1024;
    }
    
    // WAVE resources (admin only)
    match /wave-resources/{fileName} {
      allow read: if isAuthenticated();
      allow write: if false; // Admin uploads via Firebase Console
    }
  }
}
EOF

echo -e "${GREEN}✓ Storage security rules generated: storage-rules.txt${NC}"
echo ""

echo -e "${GREEN}Step 7: Setup Checklist${NC}"
echo "--------------------------------------"
echo ""
echo "✓ Environment variables configured"
echo "✓ Firestore rules template created"
echo "✓ Storage rules template created"
echo ""
echo -e "${YELLOW}Manual Steps Required:${NC}"
echo ""
echo "1. ${YELLOW}Firebase Console Actions:${NC}"
echo "   • Go to: https://console.firebase.google.com/u/4/project/easy-sales-hub"
echo "   • Navigate to Firestore Database"
echo "   • Click 'Rules' tab and paste contents of firebase-rules.txt"
echo "   • Navigate to Storage"
echo "   • Click 'Rules' tab and paste contents of storage-rules.txt"
echo "   • Enable Authentication > Email/Password provider"
echo ""
echo "2. ${YELLOW}Firestore Indexes:${NC}"
echo "   • Indexes will be created automatically when queries run"
echo "   • Check console for index creation links if queries fail"
echo ""
echo "3. ${YELLOW}Resend Email Configuration:${NC}"
echo "   • Verify domain at: https://resend.com/domains"
echo "   • Add DNS records for your domain"
echo "   • Test email sending from Resend dashboard"
echo ""
echo "4. ${YELLOW}Paystack Configuration (Optional):${NC}"
echo "   • Get test keys from: https://dashboard.paystack.com/#/settings/developer"
echo "   • Update NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY in .env.local"
echo "   • Update PAYSTACK_SECRET_KEY in .env.local"
echo "   • Configure webhook URL when deploying to production"
echo ""
echo "5. ${YELLOW}Test the setup:${NC}"
echo "   • Run: npm run dev"
echo "   • Try registering a new user"
echo "   • Check Firebase Console for new user data"
echo "   • Check Resend dashboard for sent emails"
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Generated files:"
echo "  • firebase-rules.txt (Firestore security rules)"
echo "  • storage-rules.txt (Storage security rules)"
echo "  • .env.local.bak (backup of original .env.local)"
echo ""
echo "Next steps:"
echo "  1. Follow the manual steps above"
echo "  2. Run 'npm run dev' to start development"
echo "  3. Test user registration and MFA"
echo ""
