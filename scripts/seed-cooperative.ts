/**
 * Seed the Ezichi Farmers Cooperative, and optionally join one member to it.
 *
 *     npm run seed:cooperative                      # report only
 *     npm run seed:cooperative -- --apply           # create the cooperative
 *     npm run seed:cooperative -- you@example.com --apply
 *
 * A RE-RUN ZEROED A LIVE COOPERATIVE'S SAVINGS — #329.
 *
 * The first thing this script did was:
 *
 *     await db.collection("cooperatives").doc(cooperativeId).set({
 *         ...
 *         memberCount: 0,
 *         totalSavings: 0,
 *         totalLoans: 0,
 *         ...
 *     });
 *
 * `set()` without `{ merge: true }` REPLACES the document — supabase-db.ts
 * routes it to supabaseUpsert with the payload as the whole of raw_data. So
 * running this a second time against a cooperative that already had members
 * and savings wrote memberCount, totalSavings and totalLoans back to zero, and
 * printed "✅ Cooperative created successfully".
 *
 * It was `npm run seed:cooperative` — a wired script, one word from a seed that
 * sounds harmless — with no --apply gate, no confirmation, and `.env.local`
 * pointing at production.
 *
 * Two more re-run defects behind it:
 *
 *   THE MEMBER'S BALANCE WAS RESET AND THE TOTALS DOUBLE-COUNTED. The member
 *       document was also written with a bare set(), putting balance back to
 *       ₦10,000 — while `memberCount: increment(1)` and
 *       `totalSavings: increment(10000)` ran unconditionally, so the
 *       cooperative counted the same person twice and credited itself twice.
 *
 *   IT ANNOUNCED SUCCESS FOR WORK IT SKIPPED. Both early returns — no email
 *       given, no user found — fell through to `.then()`, which printed
 *       "✨ Seed complete!" and exited 0.
 *
 * Now: nothing is written without --apply; the cooperative is created with
 * merge and its aggregate totals are seeded ONLY when the document does not
 * already exist; an existing member is reported and left alone rather than
 * reset; and the exit code says what happened.
 */

import * as dotenv from "dotenv";
import { supabaseDb as db } from "../src/lib/supabase-db";
import { FieldValue } from "../src/lib/firestore-compat";
import { isApply, targetHost, modeBanner, runScript } from "./_maintenance-guard";

dotenv.config({ path: ".env.local" });

const COOPERATIVE_ID = "coop-ezichi-farmers";
const INITIAL_SAVINGS = 10000;

/** The email is the first argument that is not a flag. */
export function emailFromArgv(argv: readonly string[] = process.argv): string | undefined {
    return argv.slice(2).find((a) => !a.startsWith("--"));
}

/**
 * Both inputs are parameters rather than reads of `process.argv` inside the
 * body: a function whose behaviour depends on hidden global state cannot be
 * executed by a test without lying to it, and this one moves money.
 */
export async function seedCooperative(
    userEmail: string | undefined = emailFromArgv(),
    apply: boolean = isApply(),
) {
    console.log(modeBanner("🌱 Cooperative seed", apply, targetHost()));

    const coopRef = db.collection("cooperatives").doc(COOPERATIVE_ID);
    const existing = await coopRef.get();

    if (existing.exists) {
        const d = existing.data() ?? {};
        console.log(
            `ℹ️  ${COOPERATIVE_ID} already exists — ` +
            `${d.memberCount ?? 0} members, ₦${Number(d.totalSavings ?? 0).toLocaleString()} savings. ` +
            `Its totals will NOT be touched.`,
        );
    } else if (!apply) {
        console.log(`WOULD CREATE cooperative ${COOPERATIVE_ID} ("Ezichi Farmers Cooperative").`);
    } else {
        console.log(`📝 Creating cooperative ${COOPERATIVE_ID}...`);
        // merge:true, and the counters are only ever written here — on the
        // path where the document is known not to exist.
        await coopRef.set({
            id: COOPERATIVE_ID,
            name: "Ezichi Farmers Cooperative",
            description: "A cooperative society for farmers in the Easy Sales Export community",
            memberCount: 0,
            totalSavings: 0,
            totalLoans: 0,
            monthlyTarget: 50000,
            interestRate: 5, // 5% annual interest
            status: "active",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        console.log("✅ Cooperative created.");
    }

    if (!userEmail) {
        console.log(
            "\nNo email given, so no member was joined.\n" +
            "  npm run seed:cooperative -- you@example.com --apply",
        );
        return;
    }

    console.log(`\n🔍 Finding user with email: ${userEmail}...`);
    const usersSnapshot = await db.collection("users").where("email", "==", userEmail).limit(1).get();

    if (usersSnapshot.empty) {
        // A throw, not a console.log and a return. Asking for a member who does
        // not exist is a failed run, and the exit code should say so.
        throw new Error(`No user found with email ${userEmail}. Register the account first.`);
    }

    const userId = usersSnapshot.docs[0].id;
    console.log(`✅ Found user: ${userId}`);

    const memberRef = coopRef.collection("members").doc(userId);
    const member = await memberRef.get();

    if (member.exists) {
        // The old code overwrote this row and incremented the cooperative's
        // totals again, so a second run reset the member's balance to ₦10,000
        // and double-counted them in memberCount and totalSavings.
        console.log(
            `ℹ️  ${userId} is already a member ` +
            `(balance ₦${Number(member.data()?.balance ?? 0).toLocaleString()}) — left untouched.`,
        );
        return;
    }

    if (!apply) {
        console.log(
            `WOULD JOIN ${userId} with ₦${INITIAL_SAVINGS.toLocaleString()} initial savings, ` +
            `and add that to the cooperative's totals.`,
        );
        return;
    }

    console.log(`\n💰 Joining ${userId} with ₦${INITIAL_SAVINGS.toLocaleString()} initial savings...`);
    await memberRef.set({
        userId,
        balance: INITIAL_SAVINGS,
        loanBalance: 0,
        joinedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // Reached only when the member row did not exist a moment ago, so the
    // increments correspond to a member actually added.
    await coopRef.update({
        memberCount: FieldValue.increment(1),
        totalSavings: FieldValue.increment(INITIAL_SAVINGS),
        updatedAt: FieldValue.serverTimestamp(),
    });

    await db.collection("users").doc(userId).update({
        cooperativeId: COOPERATIVE_ID,
        updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`✅ ${userEmail} is now a member of the Ezichi Farmers Cooperative.`);
}

if (require.main === module) {
    runScript("Cooperative seed", seedCooperative);
}
