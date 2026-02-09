#!/bin/bash

# Firestore Security Rules Deployment Script
# This script deploys the security rules to Firebase

set -e  # Exit on error

echo "🔐 Deploying Firestore Security Rules..."
echo ""

# Check if Firebase CLI is installed
if ! command -v firebase &> /dev/null; then
    echo "❌ Firebase CLI not found!"
    echo "Please install it with: npm install -g firebase-tools"
    exit 1
fi

# Check if user is logged in
if ! firebase projects:list &> /dev/null; then
    echo "❌ Not logged in to Firebase"
    echo "Please run: firebase login"
    exit 1
fi

# Deploy rules
echo "📤 Deploying firestore.rules..."
firebase deploy --only firestore:rules

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Firestore security rules deployed successfully!"
    echo ""
    echo "Rules deployed include:"
    echo "  - User authentication and authorization"
    echo "  - WAVE applications"
    echo "  - Cooperative memberships and contributions"
    echo "  - Loan applications and withdrawals"
    echo "  - ✨ Conversations and Messages (NEW)"
    echo "  - Academy courses and enrollments"
    echo "  - Land listings and escrow transactions"
    echo "  - Audit logs and announcements"
    echo ""
    echo "🎉 Messaging system is now secure and ready to use!"
else
    echo ""
    echo "❌ Deployment failed. Please check the error message above."
    exit 1
fi
