#!/bin/bash

##############################################################################
# Admin User Setup Script
# 
# This script helps you create or configure an admin user in Firebase
# so you can access the admin portal.
#
# Usage: ./scripts/create-admin-user.sh
##############################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                                                              ║${NC}"
echo -e "${BLUE}║              Admin User Setup Script                         ║${NC}"
echo -e "${BLUE}║          Easy Sales Export Admin Portal Access              ║${NC}"
echo -e "${BLUE}║                                                              ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${GREEN}This script will guide you through setting up admin access.${NC}"
echo ""

# Check if Firebase Admin SDK is configured
echo -e "${BLUE}[1/4]${NC} Checking Firebase configuration..."
if ! grep -q "^FIREBASE_PROJECT_ID=" .env.local || grep -q "^FIREBASE_PROJECT_ID=your-" .env.local; then
    echo -e "${RED}✗ Firebase Admin SDK not configured${NC}"
    echo -e "${YELLOW}  Please configure Firebase Admin SDK in .env.local first${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Firebase Admin SDK configured${NC}"
echo ""

# Admin access options
echo -e "${BLUE}[2/4]${NC} Admin Access Configuration"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "There are ${GREEN}TWO${NC} ways to grant admin access:"
echo ""
echo -e "${GREEN}OPTION 1: Role-Based Access (Recommended)${NC}"
echo -e "   - Set user role to 'super_admin' or 'admin' in Firestore"
echo -e "   - Path: ${BLUE}users/{userId}${NC}"
echo -e "   - Field: ${GREEN}role = 'super_admin'${NC}"
echo ""
echo -e "${GREEN}OPTION 2: Permission-Based Access${NC}"
echo -e "   - Add user to admin_users collection"
echo -e "   - Path: ${BLUE}admin_users/{userId}${NC}"
echo -e "   - Fields: permissions array with admin rights"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Get user email
echo -e "${BLUE}[3/4]${NC} Enter your email address to grant admin access:"
read -r ADMIN_EMAIL

if [ -z "$ADMIN_EMAIL" ]; then
    echo -e "${RED}✗ Email is required${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Email: $ADMIN_EMAIL${NC}"
echo ""

# Instructions
echo -e "${BLUE}[4/4]${NC} Manual Setup Required"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}STEP 1: Register the user (if not already registered)${NC}"
echo -e "   1. Go to: ${BLUE}http://localhost:3000/auth/register${NC}"
echo -e "   2. Register with email: ${GREEN}$ADMIN_EMAIL${NC}"
echo -e "   3. Complete the registration process"
echo ""
echo -e "${GREEN}STEP 2: Grant admin access in Firebase Console${NC}"
echo -e "   1. Visit: ${BLUE}https://console.firebase.google.com/${NC}"
echo -e "   2. Select your project"
echo -e "   3. Go to ${GREEN}Firestore Database${NC}"
echo -e "   4. Find the ${BLUE}users${NC} collection"
echo -e "   5. Locate user document for: ${GREEN}$ADMIN_EMAIL${NC}"
echo -e "   6. Edit the document:"
echo -e "      - Add field: ${GREEN}role${NC}"
echo -e "      - Value: ${GREEN}super_admin${NC}"
echo -e "      (or create custom_claims field with admin: true)"
echo -e "   7. ${GREEN}Save${NC} the changes"
echo ""
echo -e "${GREEN}STEP 3: Access the admin portal${NC}"
echo -e "   1. Go to: ${BLUE}http://localhost:3000/admin${NC}"
echo -e "   2. Sign in with: ${GREEN}$ADMIN_EMAIL${NC}"
echo -e "   3. You should now have access to the admin dashboard"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Alternative using Firebase Admin SDK (if Node.js script exists)
echo -e "${BLUE}ALTERNATIVE: Automated Setup (Advanced)${NC}"
echo ""
echo -e "If you have Node.js and Firebase Admin SDK set up, you can run:"
echo -e "  ${GREEN}node scripts/set-admin-role.js $ADMIN_EMAIL${NC}"
echo ""
echo -e "This would automatically set the admin role in Firestore."
echo ""

# Summary
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                      SUMMARY                                 ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Admin Email: $ADMIN_EMAIL${NC}"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo -e "  1. Register user (if needed)"
echo -e "  2. Set role = 'super_admin' in Firestore"
echo -e "  3. Access admin portal at http://localhost:3000/admin"
echo ""
echo -e "${GREEN}After setup, you'll have full admin access!${NC} 🚀"
echo ""
