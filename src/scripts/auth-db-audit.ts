import { adminAuth } from "@/lib/firebase-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * Auth vs. Firestore Integrity Audit
 * 
 * Identifies "Ghost Auth" records — users who exist in Firebase Auth 
 * but have no corresponding document in the Firestore 'users' collection.
 * 
 * Total Auth: ~44,000
 * Total Firestore: ~36,923
 * Expected Gap: ~7,077
 */
async function auditAuthGap() {
    console.log("--- Starting Auth vs. DB Gap Audit ---");
    
    let totalAuthUsers = 0;
    const orphans: string[] = [];
    let nextPageToken: string | undefined;

    try {
        do {
            // Fetch 1000 users at a time from Firebase Auth
            const listUsersResult = await adminAuth.listUsers(1000, nextPageToken);
            totalAuthUsers += listUsersResult.users.length;

            const uids = listUsersResult.users.map(u => u.uid);
            
            // Check existence in Firestore for this batch
            // Note: Using individual gets is slow for 44k, but 'in' query has 30 limit.
            // We use Promise.all for the batch.
            const existenceChecks = await Promise.all(
                uids.map(async (uid) => {
                    const doc = await db.collection(COLLECTIONS.USERS).doc(uid).get();
                    return { uid, exists: doc.exists };
                })
            );

            const batchOrphans = existenceChecks.filter(c => !c.exists).map(c => c.uid);
            orphans.push(...batchOrphans);

            console.log(`Processed ${totalAuthUsers} users... Found ${orphans.length} orphans so far.`);
            
            nextPageToken = listUsersResult.pageToken;
        } while (nextPageToken);

        console.log("\n--- Audit Report ---");
        console.log(`Total Auth Users: ${totalAuthUsers}`);
        console.log(`Total Firestore Documents: ${totalAuthUsers - orphans.length}`);
        console.log(`Total Orphaned Auth Records: ${orphans.length}`);
        console.log("---------------------\n");

        if (orphans.length > 0) {
            console.log("Sample Orphan UIDs:", orphans.slice(0, 10));
            // Save to a file for review
            const fs = require('fs');
            fs.writeFileSync('orphaned_auth_uids.json', JSON.stringify(orphans, null, 2));
            console.log("Full list of orphan UIDs saved to orphaned_auth_uids.json");
        }

    } catch (error) {
        console.error("Audit failed:", error);
    }
}

auditAuthGap();
