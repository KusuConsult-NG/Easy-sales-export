/**
 * Mark academy registrations that were never paid for as "unpaid" explicitly.
 *
 *     npx tsx src/scripts/mark-unpaid.ts            # report only
 *     npx tsx src/scripts/mark-unpaid.ts --apply
 *
 * FOUR DEFECTS, ALL OF THE SAME SHAPE AS THE REST OF #329.
 *
 *   IT WROTE TO PRODUCTION ON IMPORT. No --apply, no report, no confirmation.
 *       `db` here is src/lib/firebase-admin.ts line 169 —
 *       `export const db: AdminDb = supabaseDb` — the live Supabase project,
 *       not a shim. Running the file was the whole confirmation.
 *
 *   THE READ WAS CAPPED. `db.collection(USERS).get()` with no .limit() stops at
 *       the adapter's 5,000-row default and returns the truncated page as the
 *       collection, so "Successfully marked N users" described the first page.
 *       .all() lifts it.
 *
 *   A FAILED RUN EXITED 0. It ended `markUnpaid().catch(console.error)`. The
 *       error was logged and the process reported success, so anything
 *       wrapping it saw a clean run. runScript exits 1.
 *
 *   AN AWAITED QUERY SAT INSIDE THE BATCH LOOP. Each matching user triggered a
 *       separate round trip for their application row while the batch was
 *       being built, so the batch was assembled at one query per user. The
 *       lookups are collected first now, and the batch is built from the
 *       result.
 *
 * ON THE SCOPE, WHICH THE MESSAGE OVERSTATED
 * ------------------------------------------
 * The original announced "Starting script to explicitly mark 99 bypassed users
 * as 'unpaid'". It is not scoped to those 99 or to anyone else: it marks every
 * user with an academy status whose paymentStatus is not "completed" — which
 * includes rows where the field is simply absent. That is probably what was
 * wanted, but the report should describe what the predicate does, so it now
 * lists the rows and their current value before writing anything.
 */

import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../lib/firebase-admin";
import { COLLECTIONS } from "../lib/types/firestore";
import { isApply, targetHost, modeBanner, runScript } from "../../scripts/_maintenance-guard";

interface Target {
    userId: string;
    current: string;
    applicationId: string | null;
}

export async function markUnpaid(): Promise<Target[]> {
    const apply = isApply();
    console.log(modeBanner("💳 Academy payment-status repair", apply, targetHost()));

    // .all(), not a bare .get() — see the note above.
    const usersSnap = await db.collection(COLLECTIONS.USERS).all().get();
    console.log(`${usersSnap.size} users read.`);

    const candidates: { userId: string; current: string }[] = [];
    for (const doc of usersSnap.docs) {
        const academy = (doc.data() as any)?.serviceRegistrations?.academy;
        if (academy && academy.status && academy.paymentStatus !== "completed") {
            candidates.push({
                userId: doc.id,
                current: academy.paymentStatus === undefined ? "(absent)" : String(academy.paymentStatus),
            });
        }
    }

    // The application lookups happen here rather than inside the write loop,
    // where each one blocked the batch being assembled.
    const targets: Target[] = [];
    for (const { userId, current } of candidates) {
        const appSnap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
            .where("userId", "==", userId)
            .limit(1)
            .get();
        targets.push({
            userId,
            current,
            applicationId: appSnap.empty ? null : appSnap.docs[0].id,
        });
    }

    console.log(`\n${targets.length} academy registrations are not 'completed':`);
    for (const t of targets) {
        console.log(`   ${t.userId}  currently "${t.current}"  application: ${t.applicationId ?? "none"}`);
    }

    if (targets.length === 0) return targets;

    if (!apply) {
        console.log("\nNothing written. Re-run with --apply once the list above looks right.");
        return targets;
    }

    const batch = db.batch();
    for (const { userId, applicationId } of targets) {
        batch.update(db.collection(COLLECTIONS.USERS).doc(userId), {
            "serviceRegistrations.academy.paymentStatus": "unpaid",
        });
        if (applicationId) {
            batch.update(db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId), {
                paymentStatus: "unpaid",
            });
        }
    }
    await batch.commit();

    console.log(`\nMarked ${targets.length} registrations 'unpaid'.`);
    return targets;
}

if (require.main === module) {
    runScript("Academy payment-status repair", markUnpaid);
}
