/**
 *   #915 IT AUDITED FIVE THOUSAND OF FORTY-ONE THOUSAND USERS AND PRINTED A
 *   TOTAL.
 *
 *   `db.collection(USERS).get()` with no `.limit()` does NOT read the table.
 *   supabase-db caps an unbounded query at DEFAULT_QUERY_LIMIT — 5,000 — and
 *   its own header names the size of the table this runs against: "a single
 *   page load against the 41,000-row users table". So this script read about
 *   12% of the users and printed the counts as answers.
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
import * as fs from 'fs';


/**
 *   #915 EXPORTED, AND THE EXIT MOVED OUT OF IT.
 *
 *   The body used to run at import and call `process.exit(0)` on the way out, so
 *   nothing could import it to check what it reads — the reason the truncated
 *   sweep above went unnoticed for as long as it did. Same arrangement
 *   scripts/firebase-schema-fix got in #328, and for the same reason: a
 *   maintenance tool nobody can call is a maintenance tool nobody can test.
 */
export async function runAudit() {
    console.log("Starting audit...");
    const usersSnap = await db.collection(COLLECTIONS.USERS).all().get();
    console.log(`Read ${usersSnap.docs.length} user rows.`);
    let bypassedCount = 0;
    const bypassedUsers: any[] = [];

    usersSnap.forEach(doc => {
        const data = doc.data();
        const academy = data.serviceRegistrations?.academy;
        
        // If they have academy status but NO paymentStatus === 'completed'
        if (academy && academy.status) {
            if (academy.paymentStatus !== 'completed') {
                bypassedCount++;
                bypassedUsers.push({
                    id: doc.id,
                    email: data.email,
                    status: academy.status,
                    paymentStatus: academy.paymentStatus || 'missing',
                    plan: academy.plan || 'missing'
                });
            }
        }
    });

    console.log(`Total users with Academy registration: ${usersSnap.docs.filter(d => d.data().serviceRegistrations?.academy).length}`);
    console.log(`Total users who bypassed payment: ${bypassedCount}`);
    
    //   The directory, first. writeFileSync throws ENOENT on a missing folder,
    //   and it throws AFTER the counts above have been printed — so the run
    //   looked like it worked and the report it exists to produce was gone.
    fs.mkdirSync('scratch', { recursive: true });
    fs.writeFileSync('scratch/academy_unpaid_report.json', JSON.stringify(bypassedUsers, null, 2));
    console.log("Report saved to scratch/academy_unpaid_report.json");
    return { read: usersSnap.docs.length, bypassed: bypassedUsers };
}

if (require.main === module) {
    runAudit().then(() => process.exit(0)).catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
