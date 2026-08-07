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

    // ── SAFETY GATE ──────────────────────────────────────────────────────────
    //
    // This script PERMANENTLY deletes auth identities. The list it consumes is
    // produced by auth-db-audit.ts, which classifies a user as an orphan when
    // `db.collection(USERS).doc(uid).get()` reports the document as missing.
    //
    // Until recently that read swallowed EVERY error and returned "does not
    // exist" — a transient failure, a timeout, or a rate limit was
    // indistinguishable from a genuinely absent profile. The audit fires 1,000
    // concurrent reads per batch across tens of thousands of users, which is
    // exactly the load that produces such failures. A bad run therefore
    // produces a list of live users and this script deletes them.
    //
    // Two guards, both deliberate:
    //   1. Deletion requires CONFIRM_AUTH_PURGE=yes-delete-these-users.
    //   2. A list larger than MAX_PURGE_BATCH (default 100) is refused
    //      outright — a large list is far more likely to be a broken audit
    //      than a real backlog of orphans.
    //
    // Re-run the audit and diff two independent runs before trusting any list.
    const confirmed = process.env.CONFIRM_AUTH_PURGE === "yes-delete-these-users";
    const maxBatch = Number(process.env.MAX_PURGE_BATCH ?? 100);

    if (totalToPurge > maxBatch) {
        console.error(
            `REFUSING TO PURGE: the list contains ${totalToPurge} uids, above the ${maxBatch} safety limit.\n` +
            `A list this large usually means the audit misread the database, not that you have ${totalToPurge} orphans.\n` +
            `Verify by re-running the audit twice and comparing the results. Raise MAX_PURGE_BATCH only once you trust it.`
        );
        return;
    }

    if (!confirmed) {
        console.log(
            `DRY RUN — nothing was deleted.\n` +
            `Would permanently delete ${totalToPurge} auth identities:\n` +
            orphans.map(u => `  - ${u}`).join("\n") +
            `\n\nTo proceed, re-run with CONFIRM_AUTH_PURGE=yes-delete-these-users`
        );
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
