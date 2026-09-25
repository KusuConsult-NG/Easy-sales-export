/**
 *   #915 IT AUDITED THE FIRST FIVE THOUSAND APPLICATIONS AND PRINTED A
 *   TOTAL.
 *
 *   `db.collection(USERS).get()` with no `.limit()` does NOT read the table.
 *   supabase-db caps an unbounded query at DEFAULT_QUERY_LIMIT — 5,000 — and
 *   its own header names the size of the table this runs against: "a single
 *   page load against the 41,000-row users table". This one sweeps
 *   ACADEMY_APPLICATIONS rather than USERS, and the cap applies the same way.
 *
 *   SupabaseQuerySnapshot exposes `.truncated` for exactly this, and says why:
 *
 *       "A truncated result looks identical to a complete one, which is how a
 *        repair script reports success having processed a fraction of the table.
 *        Anything that sweeps a whole collection should either use `.all()` or
 *        check this."
 *
 *   `.all()` is the documented escape for "a repair sweep, a migration, a
 *   broadcast" — and a diagnostic is the same shape: reading everything is the
 *   entire point of it. backfill_academy_plans was already fixed this way and
 *   maintenance-scripts-are-inside-the-gates asserts it reads 5,001 rather than
 *   5,000. This script missed that lesson.
 *
 *   The row count is printed now as well. A sweep that says how much it read
 *   cannot quietly become wrong again the day the ceiling changes.
 */

import { db } from "../lib/firebase-admin";
import { COLLECTIONS } from "../lib/types/firestore";


/**
 *   #915 EXPORTED, AND THE EXIT MOVED OUT OF IT.
 *
 *   The body used to run at import and call `process.exit(0)` on the way out, so
 *   nothing could import it to check what it reads — the reason the truncated
 *   sweep above went unnoticed for as long as it did. Same arrangement
 *   scripts/firebase-schema-fix got in #328, and for the same reason: a
 *   maintenance tool nobody can call is a maintenance tool nobody can test.
 */
export async function checkApps() {
    const appsSnap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).all().get();
    console.log(`Read ${appsSnap.docs.length} application rows.`);
    let legacyPaid = 0;
    
    for (const doc of appsSnap.docs) {
        const data = doc.data();
        if (data.paymentStatus === 'completed' || data.paymentReference) {
            const userId = data.userId;
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
            const userData = userDoc.data();
            if (userData?.serviceRegistrations?.academy?.paymentStatus !== 'completed') {
                legacyPaid++;
                console.log(`User ${userId} paid in applications but not in users collection!`);
            }
        }
    }

    console.log(`Total legacy paid missing in users: ${legacyPaid}`);
    return { read: appsSnap.docs.length, legacyPaid };
}

if (require.main === module) {
    checkApps().then(() => process.exit(0)).catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
