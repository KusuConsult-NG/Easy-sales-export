/**
 * How many people have applied to a module — one definition, for every module.
 *
 *   #835 THE COMPLIANCE SCREEN UNDER-REPORTED WAVE BY 95%, AND THE FIRST FIX
 *   FOR IT PUT A FALSE STATEMENT ON THE SCREEN.
 *
 *   The owner, reading /admin/wave/compliance: "the numbers are more than this
 *   and the application is far more than 15k" — beside a card showing 716.
 *
 *   716 was a true count of rows in WAVE_APPLICATIONS. It was not the number of
 *   people who had applied, because WAVE_APPLICATIONS holds the DETAILED FORM
 *   and only for the enrolment route that writes one.
 *
 * ── THE MISTAKE THIS MODULE EXISTS TO STOP REPEATING ────────────────────────
 *
 *   The first attempt reported the difference as "14,655 members without an
 *   approved application". That sentence was not measured. It was lifted from a
 *   comment in _wv_admin_applications.ts — "the 14,654 without an application
 *   may well be real members" — and hardened into a claim printed on screen
 *   about fourteen thousand real women.
 *
 *   The owner: "14k+ without application is a false statement … all the users
 *   had applications submitted."
 *
 *   That is the same class as the invented ₦80,500,000 funding ledger #829
 *   removed — an inference presented as a measurement — committed while fixing
 *   an instance of it. A count that cannot see a record is evidence about THE
 *   QUERY, never about the person.
 *
 * ── WHERE THE APPLICANT REGISTER ACTUALLY IS ────────────────────────────────
 *
 *   `serviceRegistrations.<module>.status` ON THE USER is the field every
 *   enrolment path maintains:
 *
 *     the module's own apply action  writes it "pending" on submit, and the
 *                                    admin approve/reject actions move it on
 *     actions/admin/_legacy.ts       writes it "approved" on import
 *
 *   So it is complete where a module's detail collection is partial, and it is
 *   the same shape for all six modules. The detail collections stay exactly as
 *   they are and stay the source for per-application detail; what they must
 *   stop being is the answer to "how many people are in this programme".
 *
 * ── WHY ONE MODULE RATHER THAN SIX CORRECTIONS ──────────────────────────────
 *
 *   This audit's most repeated finding is a correct rule applied to some of the
 *   places it names — #774's acronym took five sweeps, #824 found the eighth.
 *   Six separately written count queries would drift the same way, and the
 *   alias handling below is exactly the kind of detail one of them would miss.
 */

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";

/** The modules a person can apply to. */
export type ModuleKey =
    | "wave" | "academy" | "export" | "cooperative" | "farmNation" | "marketplace";

/**
 * The `serviceRegistrations` keys each module is written under.
 *
 * TWO OF THEM ARE WRITTEN UNDER BOTH SPELLINGS, and that is not tidiable from
 * here. _legacy.ts sets `cooperative` AND `cooperatives`, `farmNation` AND
 * `farm_nation`, with the note "Write BOTH keys so farm_nation-based queries
 * (broadcast-logic) and farmNation-based queries (admin actions) both resolve".
 * Live data therefore contains both, and a count that reads one spelling misses
 * whoever was written under the other.
 *
 *   AND THE SAME ACCOUNT CARRIES BOTH. _legacy.ts assigns ONE `coopState` object
 *   to both keys on the same user, so these aliases OVERLAP rather than
 *   partition. The first version of this module summed them and would have
 *   reported every legacy-imported cooperative member TWICE — a number roughly
 *   double the truth, on the same class of screen this finding exists to
 *   correct. Counted by inclusion-exclusion below for exactly that reason.
 */
const REGISTRATION_KEYS: Record<ModuleKey, readonly string[]> = {
    wave: ["wave"],
    academy: ["academy"],
    export: ["export"],
    cooperative: ["cooperative", "cooperatives"],
    farmNation: ["farmNation", "farm_nation"],
    marketplace: ["marketplace"],
};

/**
 * The statuses that mean "waiting for a decision".
 *
 * Spelled out because the modules do not agree: WAVE writes `pending`, the
 * dashboard's own reader also admits `under_review`, `pending_review` and
 * `pending_approval`, and the cooperative flow adds `paid`. A reader that knows
 * only its own module's spelling reports the others as neither pending nor
 * approved — they simply vanish from the funnel.
 */
export const PENDING_STATUSES = [
    "pending", "under_review", "pending_review", "pending_approval",
    "paid", "legacy_pending_onboarding",
] as const;

/** The statuses that mean the application was accepted. */
export const APPROVED_STATUSES = ["approved", "active", "verified"] as const;

/**
 * Sent back to the applicant for changes.
 *
 * NOT folded into `pending`: the queue an administrator works through is what
 * "pending review" means on these screens, and this application is waiting on
 * the APPLICANT, not on a reviewer. Counting it as pending inflates the review
 * backlog with work nobody at the programme can action.
 */
export const REVISION_STATUSES = ["revision_required", "changes_requested"] as const;

export interface ApplicantCounts {
    /** Everyone carrying a registration for this module, whatever its status. */
    total: number | null;
    approved: number | null;
    pending: number | null;
    rejected: number | null;
    revisionRequired: number | null;
    /**
     * Applicants whose status matches none of the buckets above.
     *
     *   THE BUCKETS ARE MADE EXHAUSTIVE ON PURPOSE, by subtraction rather than
     *   by a longer list. #824's lesson is that an enumerated list cannot catch
     *   a value nobody has invented yet — it cost that finding an eighth wrong
     *   acronym — and these vocabularies are demonstrably still growing: export
     *   alone writes `pending_approval` and `revision_required`, neither of
     *   which any other module uses.
     *
     *   So a status no list here anticipates lands in `other` and stays VISIBLE,
     *   instead of making the person disappear from the funnel. The invariant a
     *   caller can rely on:
     *
     *       approved + pending + rejected + revisionRequired + other === total
     */
    other: number | null;
    /**
     * False when a count threw.
     *
     * Every figure is then null rather than 0 — a failed count rendered as zero
     * says the programme is empty, which is the confusion lib/admin-stat-display
     * exists to prevent and the reason these are nullable at the source.
     */
    counted: boolean;
}

const EMPTY: ApplicantCounts = {
    total: null, approved: null, pending: null, rejected: null,
    revisionRequired: null, other: null, counted: false,
};

/**
 * Count the people who have applied to a module.
 *
 * @param module    which programme
 * @param since     optional lower bound on the account's `createdAt`, so a
 *                  timeframe filter narrows this population the same way it
 *                  narrows the detail collection beside it. Without it, "This
 *                  Month" shows every applicant ever against one month of
 *                  applications — a fresh inconsistency introduced by the fix
 *                  for the old one.
 */
export async function countModuleApplicants(
    module: ModuleKey,
    since?: Date | null,
): Promise<ApplicantCounts> {
    const keys = REGISTRATION_KEYS[module];
    if (!keys) return EMPTY;

    const base = (key: string) => {
        let q: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.USERS);
        if (since) q = q.where("createdAt", ">=", since);
        return { q, path: `serviceRegistrations.${key}.status` };
    };

    try {
        /**
         * INCLUSION-EXCLUSION, not a sum.
         *
         *   |A ∪ B| = |A| + |B| − |A ∩ B|
         *
         * because the two dual-written modules put BOTH spellings on the SAME
         * account (see REGISTRATION_KEYS). A plain sum double-counts every one
         * of those accounts. The intersection is a single query — the adapter
         * ANDs `.where` clauses — so this costs one extra count per bucket and
         * removes an error that would have been invisible on the screen.
         */
        const bucketCount = async (
            predicate: (q: import("@/lib/supabase-db").SupabaseQuery, path: string) =>
                import("@/lib/supabase-db").SupabaseQuery,
        ): Promise<number> => {
            const singles = await Promise.all(keys.map(async (key) => {
                const { q, path } = base(key);
                return (await predicate(q, path).count().get()).data().count ?? 0;
            }));
            let n = singles.reduce((a, b) => a + b, 0);

            //   Subtract every pairwise overlap. In practice `keys` is one or two
            //   entries, so this is at most a single extra query.
            for (let i = 0; i < keys.length; i += 1) {
                for (let j = i + 1; j < keys.length; j += 1) {
                    const a = base(keys[i]);
                    const b = base(keys[j]);
                    const overlap = await predicate(
                        predicate(a.q, a.path), b.path,
                    ).count().get();
                    n -= overlap.data().count ?? 0;
                }
            }
            return Math.max(0, n);
        };

        const [total, approved, pending, rejected, revisionRequired] = await Promise.all([
            bucketCount((q, path) => q.where(path, "!=", null)),
            bucketCount((q, path) => q.where(path, "in", [...APPROVED_STATUSES])),
            bucketCount((q, path) => q.where(path, "in", [...PENDING_STATUSES])),
            bucketCount((q, path) => q.where(path, "==", "rejected")),
            bucketCount((q, path) => q.where(path, "in", [...REVISION_STATUSES])),
        ]);

        //   Never negative: if a future status were somehow matched by two of the
        //   lists above, the named buckets could exceed the total, and a negative
        //   "other" on an admin card is worse than an understated one.
        const other = Math.max(0, total - approved - pending - rejected - revisionRequired);

        return { total, approved, pending, rejected, revisionRequired, other, counted: true };
    } catch (e) {
        logger.error(`[applicant-count] ${module} applicant counts could not be computed`, e);
        return EMPTY;
    }
}

/**
 * Whether the applicant register can be trusted as the headline for this module,
 * given what the module's own detail collection holds.
 *
 *   #835 THE FIRST WIRING OF THIS TURNED A REAL TOTAL INTO ZERO.
 *
 *   Each module's stats action was changed to read
 *
 *       totalApplications: applicants.total ?? detailCount
 *
 *   and `??` only falls back on null. So a module whose register held NOTHING
 *   reported `0 ?? 5` — which is 0 — while five applications sat in its detail
 *   collection. An existing academy suite caught it immediately by seeding
 *   applications without the matching user records.
 *
 *   That is this audit's own signature defect, committed inside the fix for it:
 *   a figure that could not be read rendered as a confident zero. #753 and
 *   lib/admin-stat-display exist for precisely that, and the rule they set is
 *   that "nil" and "not measured" must never render alike.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 *   Both sources are LOWER BOUNDS on the same population: a person who applied
 *   appears in the register, in the detail collection, or in both. In production
 *   the register is the superset, because every enrolment path writes it.
 *
 *   So the register is preferred only when it is at least as complete as the
 *   detail collection. When it is not — an unpopulated register, a module whose
 *   writes have drifted, a test fixture — the module keeps its own counts and
 *   says so, rather than reporting a smaller number with more confidence.
 */
export function registerIsUsable(
    applicants: ApplicantCounts,
    detailCount: number,
): boolean {
    return applicants.counted
        && applicants.total !== null
        && applicants.total >= detailCount;
}
