/*
 * delete-abandoned-cooperative.js
 * 
 * Cleans up invalid Cooperative Memberships where payment was abandoned or never verified.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from 'dotenv';

// Load .env.local
config({ path: '.env.local' });

const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!serviceAccountStr) {
    console.error("FIREBASE_SERVICE_ACCOUNT_KEY is mission from .env.local");
    process.exit(1);
}

const serviceAccount = JSON.parse(serviceAccountStr);

initializeApp({
    credential: cert(serviceAccount),
});

const db = getFirestore();

async function cleanupAbandonedMembers() {
    console.log("Starting abandoned cooperative membership cleanup...");

    try {
        const membershipsRef = db.collection('cooperative_members');
        const snapshot = await membershipsRef.get();

        console.log(`Analyzing ${snapshot.size} total cooperative records...`);

        let deletedCount = 0;
        let validCount = 0;
        let failedDeletes = 0;

        const batchSize = 400;
        let batches = [];
        let currentBatch = db.batch();
        let currentBatchCount = 0;

        snapshot.forEach((doc) => {
            const data = doc.data();

            // Check if paymentStatus is strictly "completed"
            // If it is anything else (pending, failed, missing), flag for deletion
            if (data.paymentStatus !== 'completed') {
                currentBatch.delete(doc.ref);
                currentBatchCount++;
                deletedCount++;

                if (currentBatchCount >= batchSize) {
                    batches.push(currentBatch);
                    currentBatch = db.batch();
                    currentBatchCount = 0;
                }
            } else {
                validCount++;
            }
        });

        if (currentBatchCount > 0) {
            batches.push(currentBatch);
        }

        console.log(`Found ${deletedCount} abandoned records to delete.`);
        console.log(`Found ${validCount} fully paid and valid memberships.`);

        if (deletedCount > 0) {
            console.log(`Executing ${batches.length} batch deletions...`);
            for (let i = 0; i < batches.length; i++) {
                try {
                    await batches[i].commit();
                    console.log(`Batch ${i + 1}/${batches.length} committed successfully.`);
                } catch (batchErr) {
                    console.error(`Error deleting batch ${i + 1}:`, batchErr.message);
                    failedDeletes += (i === batches.length - 1 ? currentBatchCount : batchSize);
                }
            }
        }

        console.log("=== CLEANUP REPORT ===");
        console.log(`Total Records Scanned: ${snapshot.size}`);
        console.log(`Valid Members Kept: ${validCount}`);
        console.log(`Abandoned Records Successfully Deleted: ${deletedCount - failedDeletes}`);
        if (failedDeletes > 0) {
            console.log(`Failed Deletions (Error): ${failedDeletes}`);
        }
        console.log("======================");

    } catch (error) {
        console.error("Cleanup script failed:", error);
    }
}

cleanupAbandonedMembers().then(() => {
    console.log('Done.');
    process.exit(0);
});
