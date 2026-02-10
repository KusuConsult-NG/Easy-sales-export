#!/bin/bash

# Generate Production Secrets Script
# Generates cryptographically secure secrets for Easy Sales Export platform
#
# Usage: ./scripts/generate-secrets.sh

set -e

echo "🔐 Generating Production Secrets for Easy Sales Export"
echo "========================================================"
echo ""

# Check if openssl is available
if ! command -v openssl &> /dev/null; then
    echo "❌ Error: openssl is not installed"
    echo "   Install it using: brew install openssl (macOS) or apt-get install openssl (Linux)"
    exit 1
fi

echo "Generating cryptographically secure secrets..."
echo ""

# Generate secrets
NEXTAUTH_SECRET=$(openssl rand -base64 48)
MFA_SECRET_KEY=$(openssl rand -base64 48)
QR_ENCRYPTION_KEY=$(openssl rand -base64 48)

echo "✅ Secrets generated successfully!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "NEXTAUTH_SECRET"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "$NEXTAUTH_SECRET"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "MFA_SECRET_KEY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "$MFA_SECRET_KEY"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "QR_ENCRYPTION_KEY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "$QR_ENCRYPTION_KEY"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 INSTRUCTIONS:"
echo ""
echo "1. Copy each secret above to your .env.local file"
echo "2. For production deployment (Vercel/Railway/etc):"
echo "   - Add these as environment variables in your dashboard"
echo "   - NEVER commit .env.local to git"
echo ""
echo "3. Verify .env.local is ignored:"
echo "   git check-ignore .env.local"
echo "   (should output: .env.local)"
echo ""
echo "⚠️  IMPORTANT SECURITY NOTES:"
echo ""
echo "   • These secrets are displayed ONCE - save them securely"
echo "   • Store production secrets in a password manager"
echo "   • Rotate secrets every 90 days"
echo "   • Never share secrets via email or Slack"
echo ""
echo "✅ Generation complete!"
