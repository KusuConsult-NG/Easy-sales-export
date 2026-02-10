#!/bin/bash

# Update .env.local with production secrets
# This script replaces weak secrets with cryptographically secure ones

echo "🔐 Updating .env.local with production secrets..."

# Generate new secrets
NEXTAUTH_SECRET=$(openssl rand -base64 48)
MFA_SECRET_KEY=$(openssl rand -base64 48)
QR_ENCRYPTION_KEY=$(openssl rand -base64 48)

# Backup original file
cp .env.local .env.local.backup.$(date +%Y%m%d_%H%M%S)

# Update the file
if [ -f .env.local ]; then
    # Replace NEXTAUTH_SECRET
    sed -i '' "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=${NEXTAUTH_SECRET}|g" .env.local
    
    # Replace MFA_SECRET_KEY
    sed -i '' "s|^MFA_SECRET_KEY=.*|MFA_SECRET_KEY=${MFA_SECRET_KEY}|g" .env.local
    
    # Replace QR_ENCRYPTION_KEY
    sed -i '' "s|^QR_ENCRYPTION_KEY=.*|QR_ENCRYPTION_KEY=${QR_ENCRYPTION_KEY}|g" .env.local
    
    echo "✅ Secrets updated successfully!"
    echo ""
    echo "New secrets:"
    echo "NEXTAUTH_SECRET=${NEXTAUTH_SECRET}"
    echo "MFA_SECRET_KEY=${MFA_SECRET_KEY}"
    echo "QR_ENCRYPTION_KEY=${QR_ENCRYPTION_KEY}"
    echo ""
    echo "Backup saved to: .env.local.backup.$(date +%Y%m%d_%H%M%S)"
else
    echo "❌ Error: .env.local not found"
    exit 1
fi
