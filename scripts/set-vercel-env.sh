#!/usr/bin/env bash
# =============================================================================
# set-vercel-env.sh
# Sets all required environment variables on Vercel for Easy Sales Export.
# Run from the project root: bash scripts/set-vercel-env.sh
#
# Prerequisites:
#   npm i -g vercel
#   vercel login
#   vercel link   (link this directory to your Vercel project)
# =============================================================================

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
prompt()  { echo -e "${YELLOW}[INPUT]${NC} $1"; }

# Helper: set a Vercel env var for all environments (production, preview, development)
# Usage: set_env KEY VALUE
set_env() {
  local KEY="$1"
  local VALUE="$2"
  if [ -z "$VALUE" ]; then
    warn "Skipping $KEY — no value provided"
    return
  fi
  # Remove existing entries to avoid duplicates
  vercel env rm "$KEY" production --yes 2>/dev/null || true
  vercel env rm "$KEY" preview    --yes 2>/dev/null || true
  vercel env rm "$KEY" development --yes 2>/dev/null || true

  # Add for all environments
  echo "$VALUE" | vercel env add "$KEY" production
  echo "$VALUE" | vercel env add "$KEY" preview
  echo "$VALUE" | vercel env add "$KEY" development
  info "Set $KEY ✓"
}

echo ""
echo "============================================="
echo "  Easy Sales Export — Vercel Env Setup"
echo "============================================="
echo ""
warn "You will be prompted for values. Press ENTER to skip any variable you've already set."
echo ""

# ─── Firebase Client (Public) ─────────────────────────────────────────────────
prompt "NEXT_PUBLIC_FIREBASE_API_KEY:"; read -r V; set_env "NEXT_PUBLIC_FIREBASE_API_KEY" "$V"
prompt "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN (e.g. your-project.firebaseapp.com):"; read -r V; set_env "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN" "$V"
prompt "NEXT_PUBLIC_FIREBASE_PROJECT_ID:"; read -r V; set_env "NEXT_PUBLIC_FIREBASE_PROJECT_ID" "$V"
prompt "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET (e.g. your-project.firebasestorage.app):"; read -r STORAGE_BUCKET; set_env "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET" "$STORAGE_BUCKET"
prompt "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:"; read -r V; set_env "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID" "$V"
prompt "NEXT_PUBLIC_FIREBASE_APP_ID:"; read -r V; set_env "NEXT_PUBLIC_FIREBASE_APP_ID" "$V"

# ─── Firebase Admin (Server-side) ─────────────────────────────────────────────
prompt "FIREBASE_PROJECT_ID (same as NEXT_PUBLIC_FIREBASE_PROJECT_ID):"; read -r V; set_env "FIREBASE_PROJECT_ID" "$V"
prompt "FIREBASE_CLIENT_EMAIL (service account email):"; read -r V; set_env "FIREBASE_CLIENT_EMAIL" "$V"
prompt "FIREBASE_PRIVATE_KEY (paste full PEM key, one line with \\n):"; read -r V; set_env "FIREBASE_PRIVATE_KEY" "$V"

# FIREBASE_STORAGE_BUCKET — critical for server-side uploads (same value as public bucket)
if [ -n "$STORAGE_BUCKET" ]; then
  set_env "FIREBASE_STORAGE_BUCKET" "$STORAGE_BUCKET"
  info "FIREBASE_STORAGE_BUCKET set to same value as NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"
else
  prompt "FIREBASE_STORAGE_BUCKET (e.g. your-project.firebasestorage.app):"; read -r V; set_env "FIREBASE_STORAGE_BUCKET" "$V"
fi

# ─── NextAuth ─────────────────────────────────────────────────────────────────
prompt "NEXTAUTH_URL (e.g. https://easy-sales-export.vercel.app):"; read -r V; set_env "NEXTAUTH_URL" "$V"
prompt "NEXTAUTH_SECRET (run: openssl rand -base64 48):"; read -r V; set_env "NEXTAUTH_SECRET" "$V"

# ─── Paystack ─────────────────────────────────────────────────────────────────
prompt "NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY (pk_live_... or pk_test_...):"; read -r V; set_env "NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY" "$V"
prompt "PAYSTACK_SECRET_KEY (sk_live_... or sk_test_...):"; read -r V; set_env "PAYSTACK_SECRET_KEY" "$V"
prompt "PAYSTACK_WEBHOOK_SECRET:"; read -r V; set_env "PAYSTACK_WEBHOOK_SECRET" "$V"
prompt "NEXT_PUBLIC_PAYSTACK_LIVE_MODE (true or false):"; read -r V; set_env "NEXT_PUBLIC_PAYSTACK_LIVE_MODE" "$V"

# ─── Resend (Email) ───────────────────────────────────────────────────────────
prompt "RESEND_API_KEY (re_...):"; read -r V; set_env "RESEND_API_KEY" "$V"
prompt "EMAIL_FROM (e.g. Easy Sales Export <noreply@yourdomain.com>):"; read -r V; set_env "EMAIL_FROM" "$V"

# ─── Redis / Upstash ──────────────────────────────────────────────────────────
prompt "UPSTASH_REDIS_REST_URL:"; read -r V; set_env "UPSTASH_REDIS_REST_URL" "$V"
prompt "UPSTASH_REDIS_REST_TOKEN:"; read -r V; set_env "UPSTASH_REDIS_REST_TOKEN" "$V"

# ─── Security ─────────────────────────────────────────────────────────────────
prompt "MFA_SECRET_KEY (openssl rand -base64 48):"; read -r V; set_env "MFA_SECRET_KEY" "$V"
prompt "QR_ENCRYPTION_KEY (openssl rand -base64 48):"; read -r V; set_env "QR_ENCRYPTION_KEY" "$V"

# ─── App URL ──────────────────────────────────────────────────────────────────
prompt "NEXT_PUBLIC_URL (e.g. https://easy-sales-export.vercel.app):"; read -r V; set_env "NEXT_PUBLIC_URL" "$V"

echo ""
echo "============================================="
info "All environment variables set!"
echo ""
warn "Next steps:"
echo "  1. Go to Vercel dashboard → Settings → Environment Variables to verify"
echo "  2. Redeploy: vercel --prod"
echo "  3. For FIREBASE_STORAGE_BUCKET specifically — make sure the bucket"
echo "     name matches exactly what's shown in Firebase Console → Storage"
echo "     (it may end in .appspot.com OR .firebasestorage.app)"
echo "============================================="
