# Firebase Cleanup Script Usage

## Purpose
Delete ALL Firebase Auth users and Firestore data for fresh testing.

⚠️ **DANGER**: This permanently deletes everything! Use only in development.

---

## Prerequisites

1. **Install tsx** (if not already installed):
   ```bash
   npm install -D tsx
   ```

2. **Verify Firebase Project**:
   Check `.env.local` to ensure you're NOT using production:
   ```bash
   grep NEXT_PUBLIC_FIREBASE_PROJECT_ID .env.local
   ```
   
   **Safety**: Script blocks deletion if project ID contains "prod" or "production"

---

## How to Run

### Step 1: Navigate to Project
```bash
cd /Users/mac/Easy\ sales\ Export/easy-sales-export-nextjs
```

### Step 2: Run Script
```bash
npx tsx src/scripts/cleanup-firebase.ts
```

### Step 3: Confirm Prompts
1. Type `yes` when asked for confirmation
2. Type your Firebase project ID exactly as shown
3. Wait 3 seconds (last chance to cancel with Ctrl+C)
4. Script deletes all data

---

## What Gets Deleted

### Firebase Authentication
- All user accounts

### Firestore Collections
- `users`
- `marketplace_sellers`, `marketplace_products`, `marketplace_orders`
- `export_participants`, `export_orders`, `export_windows`
- `wave_members`, `wave_applications`
- `cooperative_members`, `cooperative_savings`, `cooperative_loans`, `cooperative_withdrawals`
- `land_listings`, `property_inquiries`
- `academy_courses`, `academy_enrollments`, `certificates`
- `messages`, `notifications`, `testimonials`
- `admin_logs`

**Total**: 22 collections + all Auth users

---

## Expected Output

```
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║     🚨 FIREBASE DATA CLEANUP SCRIPT 🚨                ║
║                                                       ║
║     WARNING: This will DELETE ALL data!              ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝

Firebase Project: your-project-id

Are you ABSOLUTELY SURE you want to delete all data? (type "yes"): yes
Type the project ID to confirm: your-project-id

🔥 Starting deletion in 3 seconds...

🔥 Deleting all Firebase Auth users...
   ✓ Deleted user: user1@example.com
   ✓ Deleted user: user2@example.com
✅ Deleted 2 Auth users

🔥 Deleting all Firestore collections...
   ✓ users: 5 documents deleted
   ✓ marketplace_sellers: 3 documents deleted
   ...

✅ Deleted 150 total Firestore documents

╔═══════════════════════════════════════════════════════╗
║                                                       ║
║     ✅ CLEANUP COMPLETED                              ║
║                                                       ║
║     Auth Users Deleted: 2                            ║
║     Firestore Docs Deleted: 150                      ║
║                                                       ║
║     Your Firebase is now clean! 🎉                    ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
```

---

## After Cleanup

1. **Test Registration**: Go to `/marketplace/register` or any module
2. **Create Fresh User**: All data is clean, start from scratch
3. **Redirect Check**: After registration, user goes to `/dashboard` ✅

---

## Troubleshooting

### Error: "Cannot find module 'readline'"
```bash
npm install @types/node
```

### Error: "Firebase Admin not initialized"
Make sure `.env.local` has all Firebase Admin credentials:
```
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=
```

### Script Hangs
- Press `Ctrl+C` to cancel
- Check Firebase console for manual deletion

---

## Manual Alternative

If the script fails, manually delete via Firebase Console:

1. **Auth**: Firebase Console → Authentication → Users → Delete all
2. **Firestore**: Firebase Console → Firestore → Each collection → Delete collection
