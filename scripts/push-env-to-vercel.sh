#!/usr/bin/env bash
# Pushes all env vars from .env.local to Vercel (all environments)
# Run from project root: bash scripts/push-env-to-vercel.sh

set -e
ENVFILE=".env.local"
ENVS=("production" "preview" "development")

echo "Reading from $ENVFILE..."

while IFS= read -r line || [ -n "$line" ]; do
  # Skip comments and blank lines
  [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue

  KEY="${line%%=*}"
  VALUE="${line#*=}"

  # Strip surrounding quotes from value
  VALUE="${VALUE%\"}"
  VALUE="${VALUE#\"}"

  [ -z "$KEY" ] && continue

  echo "Setting $KEY..."
  for ENV in "${ENVS[@]}"; do
    vercel env rm "$KEY" "$ENV" --yes 2>/dev/null || true
    printf '%s' "$VALUE" | vercel env add "$KEY" "$ENV" 2>/dev/null
  done
done < "$ENVFILE"

# Also set FIREBASE_STORAGE_BUCKET (server-side alias for the public bucket var)
BUCKET=$(grep "^NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=" "$ENVFILE" | cut -d= -f2-)
if [ -n "$BUCKET" ]; then
  echo "Setting FIREBASE_STORAGE_BUCKET=$BUCKET..."
  for ENV in "${ENVS[@]}"; do
    vercel env rm "FIREBASE_STORAGE_BUCKET" "$ENV" --yes 2>/dev/null || true
    printf '%s' "$BUCKET" | vercel env add "FIREBASE_STORAGE_BUCKET" "$ENV" 2>/dev/null
  done
fi

# Set production NEXTAUTH_URL to the Vercel deployment URL
PROD_URL="https://easysalesexport.com"
echo "Setting NEXTAUTH_URL=$PROD_URL for production..."
vercel env rm "NEXTAUTH_URL" "production" --yes 2>/dev/null || true
printf '%s' "$PROD_URL" | vercel env add "NEXTAUTH_URL" "production" 2>/dev/null

echo ""
echo "✅ All env vars pushed to Vercel!"
echo "Run 'vercel --prod' to redeploy with the new vars."
