/**
 * Give approved academy learners with no recorded tier the platform's default.
 *
 *     npx tsx src/scripts/backfill_academy_plans.ts            # report only
 *     npx tsx src/scripts/backfill_academy_plans.ts --apply
 *
 * IT GRANTED THE ₦270,000 TIER TO EVERYONE MISSING A VALUE — #329.
 *
 * The write was:
 *
 *     if (academy && !academy.plan) {
 *         await doc.ref.update({ "serviceRegistrations.academy.plan": "elite", ... });
 *     }
 *
 * "elite" is the most expensive thing this platform sells — ACADEMY_CONFIG puts
 * it at ₦270,000 against foundation's ₦45,000 — and it opens every course tier
 * (see academyPlanCourseTiers). So a field that was absent became the top
 * entitlement, for free, for every approved learner the script found.
 *
 * The platform already has an answer for "nothing usable was recorded", and it
 * is the opposite one. lib/academy-plan.ts:
 *
 *     /** The default when nothing usable was recorded. The cheapest, deliberately. *\/
 *     export const DEFAULT_ACADEMY_PLAN: AcademyPlan = "foundation";
 *
 * This script now writes that constant. If elite really is the right tier for
 * these learners it is a decision about who paid what, made from the payment
 * records, not a default a backfill picks.
 *
 * TWO MORE, BOTH THE SAME SHAPE AS THE REST OF #329:
 *
 *   THE READ WAS CAPPED AND THE REPORT SAID OTHERWISE. A query with no
 *       explicit .limit() stops at the adapter's 5,000-row default, so
 *       "Found N approved Academy users" was the size of the first page, and
 *       "Backfill complete" described a subset. .all() lifts the cap.
 *
 *   IT WROTE IMMEDIATELY. No --apply, no report step; running the file was the
 *       whole confirmation, against whatever .env.local pointed at.
 *
 * One update per user is kept rather than a batch: the population is small and
 * a failure mid-run leaves a partial, re-runnable state either way.
 */

import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { supabaseDb as db } from "../lib/supabase-db";
import { COLLECTIONS } from "../lib/types/firestore";
import { DEFAULT_ACADEMY_PLAN } from "../lib/academy-plan";
import { isApply, targetHost, modeBanner, runScript } from "../../scripts/_maintenance-guard";

export async function backfillAcademyPlans(): Promise<string[]> {
    const apply = isApply();
    console.log(modeBanner("🎓 Academy plan backfill", apply, targetHost()));

    // .all(): a backfill that covers the first 5,000 of the matching rows and
    // reports completion is the trap SupabaseQuery.all() exists to close.
    const usersSnap = await db.collection(COLLECTIONS.USERS)
        .where("serviceRegistrations.academy.status", "==", "approved")
        .all()
        .get();

    console.log(`Found ${usersSnap.size} approved Academy users.`);

    const missing: string[] = [];
    for (const doc of usersSnap.docs) {
        const academy = (doc.data() as any)?.serviceRegistrations?.academy;
        if (academy && !academy.plan) missing.push(doc.id);
    }

    console.log(
        `${missing.length} have no plan recorded; ` +
        `${usersSnap.size - missing.length} already do and are left alone.`,
    );

    if (!apply) {
        for (const id of missing) {
            console.log(`   WOULD SET ${id} → "${DEFAULT_ACADEMY_PLAN}"`);
        }
        return missing;
    }

    for (const id of missing) {
        await db.collection(COLLECTIONS.USERS).doc(id).update({
            "serviceRegistrations.academy.plan": DEFAULT_ACADEMY_PLAN,
            updatedAt: new Date(),
        });
        console.log(`   ${id} → "${DEFAULT_ACADEMY_PLAN}"`);
    }

    return missing;
}

if (require.main === module) {
    runScript("Academy plan backfill", backfillAcademyPlans);
}
