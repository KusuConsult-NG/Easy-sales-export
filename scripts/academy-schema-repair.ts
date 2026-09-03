/**
 * The two repairs firebase-schema-fix.ts performs, split out so they can be
 * imported and executed by a test without that script's entrypoint — which
 * runs main() on import and calls process.exit().
 *
 * Same split, same reason, as export-funding-goal-kind.ts.
 *
 * WHY THIS CODE EXISTS AT ALL — #328
 * ----------------------------------
 * It was inside scripts/firebase-schema-fix.ts, written against
 * `import * as admin from 'firebase-admin'`. That specifier does not resolve to
 * Google's SDK in this repository: package.json points it at
 * ./src/lib/shims/firebase-admin, whose index.js is
 *
 *     module.exports = { auth: () => ({}) };
 *
 * so `admin.apps.length` on line 9 threw before anything below it ran, and the
 * script's closing "🎉 All fixes applied successfully" was unreachable.
 * tsconfig.json excluded `scripts` and eslint.config.mjs ignored `scripts/**`,
 * which is why a one-second typecheck had never been run over it.
 *
 * Rewritten against supabaseDb — the database this platform has.
 */

import { supabaseDb as db } from "../src/lib/supabase-db";
import { COLLECTIONS } from "../src/lib/types/firestore";
import { FieldValue } from "../src/lib/firestore-compat";
import { normaliseAcademyPlan, ACADEMY_PLANS } from "../src/lib/academy-plan";
import { ACADEMY_CONFIG } from "../src/lib/constants";
import { isApply } from "./_maintenance-guard";

/** Supabase batches far more than this; 400 keeps each round trip small. */
export const CHUNK = 400;

export interface PlanRepair {
    id: string;
    from: string;
    to: string;
}

/**
 * Rewrites any academy plan stored under a name the platform no longer sells
 * onto the name every reader already resolves it to.
 *
 * The original hard-coded `if (academyPlan === "advanced")`. It goes through
 * normaliseAcademyPlan now — the single definition of what an academy plan is,
 * which the enrolment gate, the fee calculation and the admin screens all
 * share — so the stored spelling and the read spelling cannot drift apart
 * again. "advanced" → "standard" is still exactly what that helper does.
 *
 * Only rows whose value CHANGES are written, so a re-run is free and a
 * correctly-spelled row does not collect a new updatedAt for nothing.
 */
export async function migrateLegacyAcademyPlans(
    log: (msg: string) => void = () => {},
    apply: boolean = isApply(),
): Promise<PlanRepair[]> {
    // .all(), not a bare .get().
    //
    // A query with no explicit .limit() stops at the adapter's 5,000-row
    // default (supabase-db.ts DEFAULT_QUERY_LIMIT) and hands back the truncated
    // page as though it were the collection. For a migration that turns
    // "repaired every user" into "repaired the first 5,000 and said so" —
    // the exact wording of the trap SupabaseQuery.all() was added to close.
    const usersSnap = await db.collection(COLLECTIONS.USERS).all().get();
    log(`   ${usersSnap.size} users read.`);

    const pending: PlanRepair[] = [];

    for (const doc of usersSnap.docs) {
        const stored = (doc.data() as any)?.serviceRegistrations?.academy?.plan;
        if (stored === undefined || stored === null || stored === "") continue;

        const normalised = normaliseAcademyPlan(stored);

        // null means the value is not a plan at all — "registration", say,
        // which resolveApplicationPlan handles on read. Choosing a tier for it
        // here would grant a paid plan nobody bought, so it is left alone.
        if (!normalised) continue;
        if (normalised === stored) continue;

        pending.push({ id: doc.id, from: String(stored), to: normalised });
    }

    log(`   ${pending.length} users need their plan spelling repaired.`);

    // Report-only until --apply, the convention every writing script in this
    // repository now shares — see scripts/_maintenance-guard.ts and #329.
    if (!apply) {
        log("   report only — nothing written. Re-run with --apply.");
        return pending;
    }

    for (let i = 0; i < pending.length; i += CHUNK) {
        const chunk = pending.slice(i, i + CHUNK);

        // A FRESH BATCH PER CHUNK, AND EVERY COMMIT AWAITED — #328.
        //
        // The original built one batch outside the loop, called
        // `batch.commit()` inside it with no `await`, and kept adding to the
        // same object afterwards. A committed batch cannot be reused: past 400
        // matching users the final commit re-sent everything the first had
        // already sent, and because neither commit was awaited neither failure
        // could be seen.
        const batch = db.batch();
        for (const { id, to } of chunk) {
            batch.update(db.collection(COLLECTIONS.USERS).doc(id), {
                "serviceRegistrations.academy.plan": to,
                updatedAt: FieldValue.serverTimestamp(),
            });
        }
        await batch.commit();
        log(`   committed ${chunk.length} (${Math.min(i + CHUNK, pending.length)}/${pending.length})`);
    }

    return pending;
}

/** Days each tier runs for. Not part of ACADEMY_CONFIG; carried from the original. */
const DURATION_DAYS: Record<(typeof ACADEMY_PLANS)[number], number> = {
    foundation: 30,
    standard: 60,
    elite: 90,
};

const LEVEL: Record<(typeof ACADEMY_PLANS)[number], string> = {
    foundation: "beginner",
    standard: "intermediate",
    elite: "advanced",
};

/**
 * Creates a course row for any sold plan that has none.
 *
 * THE SEEDED PRICES DISAGREED WITH WHAT CHECKOUT CHARGES — #328.
 *
 * The original hard-coded 25,000 / 50,000 / 100,000, with the aside
 * "Or whatever default is, standard was 50000". ACADEMY_CONFIG — the constant
 * the payment paths actually bill against — says 45,000 / 90,000 / 270,000. A
 * catalogue advertising a third of the fee is not a cosmetic difference, and
 * two hand-typed copies of a price will always end up as two prices.
 *
 * Title, description and price all come from the config now.
 */
export async function initializeAcademyCourses(
    log: (msg: string) => void = () => {},
    apply: boolean = isApply(),
): Promise<string[]> {
    const coursesRef = db.collection(COLLECTIONS.ACADEMY_COURSES);
    const created: string[] = [];

    for (const tier of ACADEMY_PLANS) {
        const plan = ACADEMY_CONFIG.plans[tier];
        const existing = await coursesRef.where("tier", "==", tier).limit(1).get();

        if (!existing.empty) {
            log(`   ✅ ${tier} course already exists.`);
            continue;
        }

        if (!apply) {
            log(`   WOULD CREATE ${tier} course at ₦${plan.fee.toLocaleString()}.`);
            created.push(tier);
            continue;
        }

        log(`   Missing ${tier} course. Creating at ₦${plan.fee.toLocaleString()}...`);
        await coursesRef.add({
            title: plan.name,
            description: plan.description,
            instructor: "Easy Sales Export Team",
            duration: `${DURATION_DAYS[tier]} days`,
            level: LEVEL[tier],
            tier,
            price: plan.fee,
            modules: [],
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        created.push(tier);
    }

    return created;
}
