#!/usr/bin/env bash
# scripts/deploy-firestore-indexes.sh
# Deploys the composite indexes defined in firestore.indexes.json to Firebase.
# Run this once after cloning or whenever firestore.indexes.json changes.
#
# Prerequisites:
#   npm install -g firebase-tools   (or: npx firebase-tools)
#   firebase login
#   firebase use <project-id>       (or pass --project flag below)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "📦  Deploying Firestore indexes..."
echo "    Project root: $PROJECT_ROOT"
echo ""

cd "$PROJECT_ROOT"

# Validate the index file is valid JSON before deploying
python3 -c "import json, sys; json.load(open('firestore.indexes.json')); print('  ✅  firestore.indexes.json is valid JSON')"

echo ""
echo "  Pushing indexes to Firebase..."
echo "  (This may take a few minutes for new indexes to build in the background)"
echo ""

npx firebase-tools@latest deploy --only firestore:indexes

echo ""
echo "✅  Done. New indexes are being built by Firebase in the background."
echo "    Monitor build progress at: https://console.firebase.google.com/project/_/firestore/indexes"
