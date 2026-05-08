import * as dotenv from "dotenv";
import path from "path";

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../lib/firebase-admin";
import { COLLECTIONS } from "../lib/types/firestore";
import { logger } from "../lib/logger";

/**
 * Migration Script: Platform-Wide Version Backfill
 * 
 * Ensures all existing core documents have a _version: 1 field
 * to support optimistic locking.
 */
async function backfillVersions() {
    console.log("Starting version backfill migration...");

    let totalUpdated = 0;

    // 1. Cooperative Members
    console.log("Processing Cooperative Members...");
    const membersSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).get();
    console.log(`Found ${membersSnap.size} total cooperative members.`);
    const memberBatch = db.batch();
    let memberBatchCount = 0;

    for (const doc of membersSnap.docs) {
        const data = doc.data();
        if (!data._version) {
            memberBatch.update(doc.ref, { _version: 1 });
            memberBatchCount++;
            totalUpdated++;
        }
    }

    if (memberBatchCount > 0) {
        await memberBatch.commit();
        console.log(`Updated ${memberBatchCount} cooperative members.`);
    }

    // 2. Academy Progress (Subcollections)
    console.log("Processing Academy Progress...");
    // Using collectionGroup to find all 'courses' documents regardless of parent user
    const progressSnap = await db.collectionGroup("courses").get();
    console.log(`Found ${progressSnap.size} total progress documents.`);
    
    // Process in chunks of 500 for batch limits
    const progressDocs = progressSnap.docs.filter(d => !d.data()._version);
    console.log(`Found ${progressDocs.length} progress documents requiring backfill.`);

    for (let i = 0; i < progressDocs.length; i += 500) {
        const batch = db.batch();
        const chunk = progressDocs.slice(i, i + 500);
        
        for (const doc of chunk) {
            batch.update(doc.ref, { _version: 1 });
            totalUpdated++;
        }
        
        await batch.commit();
        console.log(`Committed batch of ${chunk.length} progress documents.`);
    }

    console.log(`Migration complete. Total documents updated: ${totalUpdated}`);
}

backfillVersions().catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
});
