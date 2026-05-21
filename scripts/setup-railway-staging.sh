#!/usr/bin/env bash
# ============================================================
# Railway Staging Setup Script
# Run this ONCE after: railway login
#
# Usage:
#   railway login        (opens browser to authenticate)
#   bash scripts/setup-railway-staging.sh
# ============================================================

set -e

STAGING_ENV_FILE=".env.staging"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "🚂 Railway Staging Environment Setup"
echo "======================================"

# ── 1. Verify railway is logged in ─────────────────────────────────────────
echo ""
echo "1️⃣  Checking Railway login..."
railway whoami || { echo "❌ Not logged in. Run: railway login"; exit 1; }

# ── 2. Link to the Easy Sales Export Railway project ───────────────────────
echo ""
echo "2️⃣  Listing Railway projects..."
railway list 2>&1 | head -20
echo ""
echo "   If you see your project above, note the project ID."
echo "   If not, create a new Railway project at https://railway.app/new"
echo ""

# ── 3. Create or identify the staging service ──────────────────────────────
echo "3️⃣  To complete staging setup, run these Railway commands:"
echo ""
echo "   # Link this directory to your Railway project:"
echo "   railway link"
echo ""
echo "   # Create a new staging service (if it doesn't exist):"
echo "   railway add --service easy-sales-export-staging"
echo ""
echo "   # After creating the service, get its ID:"
echo "   railway status"
echo ""

# ── 4. Upload env vars from .env.staging ───────────────────────────────────
echo "4️⃣  Uploading environment variables from .env.staging to Railway..."

if [ ! -f "$REPO_ROOT/$STAGING_ENV_FILE" ]; then
  echo "❌ .env.staging not found at $REPO_ROOT/$STAGING_ENV_FILE"
  exit 1
fi

# Read .env.staging and set each variable
while IFS= read -r line; do
  # Skip comments and blank lines
  [[ "$line" =~ ^#.*$ ]] && continue
  [[ -z "$line" ]] && continue
  
  # Extract key=value
  key="${line%%=*}"
  value="${line#*=}"
  # Remove surrounding quotes if present
  value="${value%\"}"
  value="${value#\"}"
  
  if [ -n "$key" ] && [ -n "$value" ]; then
    railway variables set "$key=$value" 2>/dev/null && echo "  ✅ $key" || echo "  ⚠️  $key (skipped)"
  fi
done < "$REPO_ROOT/$STAGING_ENV_FILE"

echo ""
echo "✅ Environment variables uploaded."
echo ""
echo "5️⃣  Next steps:"
echo ""
echo "   a) Get your Railway API token from: https://railway.app/account/tokens"
echo "   b) Get the staging service ID from: railway status"
echo "   c) Set these GitHub secrets:"
echo "      gh secret set RAILWAY_API_TOKEN --body '<your-token>'"
echo "      gh secret set RAILWAY_STAGING_SERVICE_ID --body '<service-id>'"
echo ""
echo "   d) Add a Railway cron trigger:"
echo "      URL: https://staging.easysalesexport.com/api/cron/reconcile-paystack"
echo "      Header: Authorization: Bearer \$(railway variables get CRON_SECRET)"
echo "      Schedule: 0 6 * * * (6am daily WAT)"
echo ""
echo "🎉 Done! Push to the 'develop' branch to trigger your first staging deployment."
