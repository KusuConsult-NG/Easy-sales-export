/**
 * Platform-wide `_version` backfill, so optimistic locking has a value to
 * compare against.
 *
 *     npx tsx src/scripts/backfill_versions.ts            # report only
 *     npx tsx src/scripts/backfill_versions.ts --apply
 *
 * IT CALLED A TRUNCATED PAGE THE TOTAL — #329.
 *
 * Both reads were unlimited:
 *
 *     const membersSnap = await db.collection(COOPERATIVE_MEMBERS).get();
 *     console.log(`Found ${membersSnap.size} total cooperative members.`);
 *
 *     const progressSnap = await db.collectionGroup("courses").get();
 *     console.log(`Found ${progressSnap.size} total progress documents.`);
 *
 * A query with no explicit .limit() stops at the adapter's 5,000-row default,
 * so `size` is the size of the first page and the word "total" is wrong in both
 * lines. "Migration complete. Total documents updated: N" then reported a
 * partial run as a finished one. .all() is the adapter's escape hatch for
 * exactly this.
 *
 * The exit handling here was already right — this script exits 1 on failure,
 * unlike its three siblings — and is kept, now through the shared runner.
 *
 * WHY THIS IS A REPAIR AND NOT AN OUTAGE
 * --------------------------------------
 * A missing `_version` does not break the lock. versionedUpdate passes
 * `expectedVersion: undefined` straight through to claim_versioned_update,
 * which then "asserts nothing but still takes the lock" — so rows the truncated
 * run never reached are still written safely, just without the staleness check.
 * That is why this went unnoticed; it is worth completing, not urgent.
 */

import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { supabaseDb as db } from "../lib/supabase-db";
import { COLLECTIONS } from "../lib/types/firestore";
import { isApply, targetHost, modeBanner, runScript } from "../../scripts/_maintenance-guard";

const CHUNK = 500;

export async function backfillVersions(): Promise<{ members: number; progress: number }> {
    const apply = isApply();
    console.log(modeBanner("🔢 _version backfill", apply, targetHost()));

    // 1. Cooperative Members
    console.log("Processing Cooperative Members...");
    // .all(): "total" has to mean total.
    const membersSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).all().get();
    console.log(`   ${membersSnap.size} cooperative members read.`);

    const memberIds = membersSnap.docs.filter((d) => !(d.data() as any)._version).map((d) => d.id);
    console.log(`   ${memberIds.length} need _version.`);

    // 2. Academy Progress (collectionGroup across every user's courses)
    console.log("Processing Academy Progress...");
    const progressSnap = await db.collectionGroup("courses").all().get();
    console.log(`   ${progressSnap.size} progress documents read.`);

    const progressDocs = progressSnap.docs.filter((d) => !(d.data() as any)._version);
    console.log(`   ${progressDocs.length} need _version.`);

    if (!apply) {
        console.log("\nNothing written. Re-run with --apply once the counts above look right.");
        return { members: memberIds.length, progress: progressDocs.length };
    }

    for (let i = 0; i < memberIds.length; i += CHUNK) {
        const chunk = memberIds.slice(i, i + CHUNK);
        const batch = db.batch();
        for (const id of chunk) {
            batch.update(db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(id), { _version: 1 });
        }
        await batch.commit();
        console.log(`   members: committed ${chunk.length} (${Math.min(i + CHUNK, memberIds.length)}/${memberIds.length})`);
    }

    for (let i = 0; i < progressDocs.length; i += CHUNK) {
        const chunk = progressDocs.slice(i, i + CHUNK);
        const batch = db.batch();
        for (const doc of chunk) {
            batch.update(doc.ref, { _version: 1 });
        }
        await batch.commit();
        console.log(`   progress: committed ${chunk.length} (${Math.min(i + CHUNK, progressDocs.length)}/${progressDocs.length})`);
    }

    return { members: memberIds.length, progress: progressDocs.length };
}

if (require.main === module) {
    runScript("_version backfill", backfillVersions);
}
