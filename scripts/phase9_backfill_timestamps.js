/**
 * Phase 9: Legacy Document Backfill
 * Safely injects missing `createdAt` and `updatedAt` timestamps into legacy documents
 * to align with the Phase 5 strict Zod schemas and Next.js frontend dependencies.
 */
const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: privateKey,
        }),
    });
}

const db = admin.firestore();

// Target Collections
const COLLECTIONS = [
    'users',
    'wave_applications',
    'academy_enrollments',
    'products'
];

async function backfillTimestamps() {
    console.log("==================================================");
    console.log("🚀 STARTING FIRESTORE LEGACY TIMESTAMP BACKFILL");
    console.log("==================================================\n");

    try {
        let totalModified = 0;

        for (const collectionName of COLLECTIONS) {
            console.log(`Scanning collection: [${collectionName}]`);
            const snapshot = await db.collection(collectionName).get();
            let modifiedInCollection = 0;

            const batch = db.batch(); // Use batch for atomic writes

            snapshot.forEach(doc => {
                const data = doc.data();
                const needsCreatedAt = !data.createdAt;
                const needsUpdatedAt = !data.updatedAt;

                if (needsCreatedAt || needsUpdatedAt) {
                    const updatePayload = {};
                    if (needsCreatedAt) updatePayload.createdAt = admin.firestore.FieldValue.serverTimestamp();
                    if (needsUpdatedAt) updatePayload.updatedAt = admin.firestore.FieldValue.serverTimestamp();

                    batch.update(doc.ref, updatePayload);
                    modifiedInCollection++;
                }
            });

            if (modifiedInCollection > 0) {
                console.log(`  -> Found ${modifiedInCollection} legacy documents. Executing batch update...`);
                await batch.commit();
                console.log(`  -> ✅ ${modifiedInCollection} documents patched successfully.`);
                totalModified += modifiedInCollection;
            } else {
                console.log(`  -> All documents are up-to-date.`);
            }
            console.log("------------------------------------------");
        }

        console.log(`\n🎉 PHASE 9 BACKFILL COMPLETE: ${totalModified} TOTAL DOCUMENTS PATCHED.`);

    } catch (error) {
        console.error("❌ Fatal Error during backfill:", error);
    } finally {
        process.exit(0);
    }
}

backfillTimestamps();
