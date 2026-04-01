#!/usr/bin/env node
/**
 * Legacy User Schema Backfill Script
 * ====================================
 * Normalizes 34k+ legacy user documents to the new structured name schema.
 *
 * What it does (ADDITIVE ONLY — zero data loss):
 *   1. Reads every user document in the `users` collection
 *   2. If a doc is missing `firstName`/`lastName`, splits `fullName` and writes them back
 *   3. If a doc has `verified: true` but no `isVerified`, writes `isVerified: true`
 *
 * This script is idempotent — safe to run multiple times.
 * It NEVER overwrites existing firstName, lastName, or isVerified values.
 *
 * Usage:
 *   node scripts/backfill-legacy-users.js
 *
 * Prerequisites:
 *   - GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service account key
 *   - Or run from an environment where firebase-admin is already initialized
 */

const path = require('path');
// Load env vars from .env.local (same credentials the Next.js app uses)
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

const admin = require('firebase-admin');

// Initialize using the same env vars as the Next.js app (firebase-admin.ts)
if (!admin.apps.length) {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
        console.error('❌ Missing required env vars: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY');
        console.error('   Make sure .env.local exists at the project root.');
        process.exit(1);
    }
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey,
        }),
    });
}

const db = admin.firestore();
const USERS_COLLECTION = 'users';
const BATCH_SIZE = 400; // Firestore batch commit limit is 500

function splitFullName(fullName) {
    if (!fullName || typeof fullName !== 'string') return { firstName: '', lastName: '' };
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { firstName: '', lastName: '' };
    if (parts.length === 1) return { firstName: parts[0], lastName: '' };
    return {
        firstName: parts[0],
        // Everything after the first word becomes lastName (handles multi-word surnames)
        lastName: parts.slice(1).join(' '),
    };
}

async function run() {
    console.log('🔄 Starting legacy user schema backfill...\n');

    let totalRead = 0;
    let totalPatched = 0;
    let totalSkipped = 0;
    let lastDoc = null;
    let hasMore = true;

    while (hasMore) {
        let q = db.collection(USERS_COLLECTION).limit(BATCH_SIZE);
        if (lastDoc) q = q.startAfter(lastDoc);

        const snapshot = await q.get();
        if (snapshot.empty) break;

        lastDoc = snapshot.docs[snapshot.docs.length - 1];
        hasMore = snapshot.docs.length === BATCH_SIZE;

        const batch = db.batch();
        let batchCount = 0;

        for (const doc of snapshot.docs) {
            totalRead++;
            const data = doc.data();
            const update = {};

            // 1. Backfill firstName / lastName from fullName
            const missingFirstName = !data.firstName || data.firstName.trim() === '';
            const missingLastName = !data.lastName || data.lastName.trim() === '';
            if (missingFirstName && missingLastName) {
                const { firstName, lastName } = splitFullName(data.fullName);
                if (firstName) update.firstName = firstName;
                if (lastName) update.lastName = lastName;
            }

            // 2. Backfill isVerified from legacy `verified` field
            if (data.isVerified === undefined && data.verified !== undefined) {
                update.isVerified = Boolean(data.verified);
            }

            if (Object.keys(update).length > 0) {
                update.updatedAt = admin.firestore.FieldValue.serverTimestamp();
                batch.update(doc.ref, update);
                batchCount++;
                totalPatched++;
                if (process.env.VERBOSE) {
                    console.log(`  ✏️  Patching ${doc.id} (${data.email || 'no email'}):`, update);
                }
            } else {
                totalSkipped++;
            }
        }

        if (batchCount > 0) {
            await batch.commit();
            console.log(`  ✅ Committed batch of ${batchCount} patches (total patched: ${totalPatched})`);
        }
    }

    console.log('\n✅ Backfill complete!');
    console.log(`   Total read    : ${totalRead}`);
    console.log(`   Total patched : ${totalPatched}`);
    console.log(`   Total skipped : ${totalSkipped} (already had structured data)`);
}

run().catch(err => {
    console.error('❌ Backfill failed:', err);
    process.exit(1);
});
