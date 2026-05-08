import { adminAuth } from "@/lib/firebase-admin";
import fs from "fs";
import path from "path";

/**
 * Orphaned Auth Purge Utility
 * 
 * Reads the list of UIDs from 'orphaned_auth_uids.json' and deletes them
 * from Firebase Auth in batches of 1000.
 */
async function purgeOrphans() {
    const filePath = path.join(process.cwd(), 'orphaned_auth_uids.json');
    
    if (!fs.existsSync(filePath)) {
        console.error("Error: 'orphaned_auth_uids.json' not found. Please run the audit script first.");
        return;
    }

    const orphans: string[] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const totalToPurge = orphans.length;

    if (totalToPurge === 0) {
        console.log("No orphans found to purge. Your Auth vs. DB is already in sync!");
        return;
    }

    console.log(`--- Starting Purge of ${totalToPurge} Ghost Users ---`);
    
    // Firebase deleteUsers allows maximum 1000 UIDs per call
    const batchSize = 1000;
    let purgedCount = 0;

    for (let i = 0; i < orphans.length; i += batchSize) {
        const batch = orphans.slice(i, i + batchSize);
        
        try {
            const result = await adminAuth.deleteUsers(batch);
            purgedCount += result.successCount;
            
            console.log(`Progress: Purged ${purgedCount}/${totalToPurge} records...`);
            
            if (result.failureCount > 0) {
                console.warn(`Warning: ${result.failureCount} deletions failed in this batch.`);
                result.errors.forEach(err => console.error(` - Error: ${err.error.message}`));
            }
        } catch (error) {
            console.error(`Critical error in batch ${i / batchSize}:`, error);
        }
    }

    console.log("\n--- Purge Complete ---");
    console.log(`Total Successfully Purged: ${purgedCount}`);
    console.log(`New Auth Total (Expected): ~36,924`);
    console.log("----------------------\n");
}

purgeOrphans();
