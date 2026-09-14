/**
 * What a forensic check may honestly claim, given how much of the collection it
 * actually read.
 *
 *   #728 ONE CHECK OF ELEVEN KNEW THAT A SWEEP WHICH STOPS SHORT CANNOT REPORT
 *        "CLEAN". THE OTHERS SAMPLED AND SAID "PASS".
 *
 *   The Investment Cap check states the rule, in its own comment, and does the
 *   right thing:
 *
 *       ".all(), because a forensic sweep that stops at the default cap reports
 *        'no breaches' for the windows it did not read."
 *
 *   Every other limited check does the opposite. Seeding the academy check with
 *   exactly fifty active enrolments — its `.limit(50)` ceiling — and no problem
 *   among them produced:
 *
 *       status  : pass
 *       details : "Scanned 50 active enrolments against checkCourseAccess.
 *                  Found 0 on a course their plan does not open."
 *
 *   A green tick. If that collection holds five thousand enrolments, four
 *   thousand nine hundred and fifty were never examined and the owner has been
 *   told the platform is clean.
 *
 * ── THIS IS THE FIFTH TIME THIS PLATFORM HAS FOUND THE SAME DEFECT ──────────
 *
 *   #331 found TWO forensic checks "reporting 'pass' for questions they could
 *   not ask". #372 found a third. #373 found a fourth and wrote the rule as
 *   plainly as it can be written: "reporting 'no breach' for them is the same
 *   false green line."
 *
 *   Each of those was a check that could not ask its question because it read a
 *   field nothing writes. This is the same sentence with a different cause: the
 *   check asks the right question, of five percent of the rows, and answers for
 *   all of them.
 *
 *   supabase-db already says it too, on the snapshot field built for it: "A
 *   truncated result looks identical to a complete one, which is how a repair
 *   script reports success having processed a fraction of the table."
 *
 * ── WHY THE SNAPSHOT'S OWN `truncated` FLAG DOES NOT COVER THIS ─────────────
 *
 *   It looks like it should, and it cannot. The adapter computes:
 *
 *       const truncated = this._unbounded
 *           ? fetchedSoFar >= UNBOUNDED_CEILING
 *           : this._limit == null && fetchedSoFar >= DEFAULT_QUERY_LIMIT;
 *
 *   `this._limit == null` — so a query carrying an explicit `.limit(50)` has
 *   `truncated === false` however many rows the collection holds. The flag
 *   answers "did this query hit the DEFAULT cap", which is a different question
 *   from "did this sample see everything". Reading it in a sampling check would
 *   be a guard that cannot fire.
 *
 *   So the ceiling has to be compared against the count returned, which is what
 *   this module does.
 *
 * ── AND WHY THE FIX IS NOT SIMPLY `.all()` EVERYWHERE ───────────────────────
 *
 *   Sampling is a deliberate and defensible choice here. The forensics page
 *   says so: "It runs on demand. The scan reads across eight collections;
 *   firing it on navigation would charge that cost to every visit." Turning ten
 *   sampled checks into unbounded sweeps would charge the operator a full-table
 *   read of every collection on every press, which is how a report becomes one
 *   nobody runs.
 *
 *   THE DEFECT IS NOT THE SAMPLING. It is saying "pass" about a population the
 *   sample never reached. A sampled check that says so remains useful; one that
 *   claims completeness it does not have is worse than no check, because the
 *   owner stops looking.
 */

/** The four states a forensic result may hold. Mirrors ScanResult["status"]. */
export type ForensicStatus = "pass" | "fail" | "warning" | "inconclusive";

export interface SampleScope {
    /** Rows the check actually examined. */
    scanned: number;
    /** The ceiling the query was given. */
    ceiling: number;
    /** True only when the scan is known to have seen the whole population. */
    complete: boolean;
}

/**
 * How much of the collection this scan saw.
 *
 * STRICTLY LESS THAN THE CEILING, deliberately. A scan that returned exactly
 * its ceiling cannot tell "there are precisely this many" from "there are more
 * and I stopped" — those two worlds produce an identical result. Treating the
 * boundary as complete would make the honest case indistinguishable from the
 * dishonest one at exactly the point where it matters.
 *
 * `>=` rather than `===` for the incomplete side so that an adapter returning
 * one row more than asked for cannot slip through as complete.
 */
export function sampleOf(scanned: number, ceiling: number): SampleScope {
    return { scanned, ceiling, complete: scanned < ceiling };
}

/**
 * The verdict this scan is entitled to.
 *
 * THE ASYMMETRY IS THE WHOLE POINT, and it is not a compromise:
 *
 *   A PROBLEM FOUND IN A SAMPLE IS REAL. Five orphaned products among two
 *   hundred are five orphaned products, whatever the other four thousand hold.
 *   So a hit reports `fail` or `warning` exactly as before — this change never
 *   downgrades a finding, and never hides one.
 *
 *   NO PROBLEM FOUND IN A SAMPLE IS NOT PROOF OF NONE. Absence in five percent
 *   of the rows is not absence. That is the only case whose verdict changes,
 *   and it changes from a claim the check cannot support to the status this
 *   codebase already created for exactly that situation.
 */
export function verdictFor(
    scope: SampleScope,
    problems: number,
    whenFound: "fail" | "warning",
): ForensicStatus {
    if (problems > 0) return whenFound;
    return scope.complete ? "pass" : "inconclusive";
}

/**
 * The sentence describing what was read, for the operator.
 *
 * #671's rule — "the reconciliation says what it found before it says what it
 * did not" — means this has to be a sentence somebody can act on, not a
 * disclaimer. A complete scan says so plainly; an incomplete one says what it
 * would take to finish, because "some rows were not read" with no number is the
 * kind of hedge an operator learns to skip.
 */
export function describeSample(scope: SampleScope, noun: string): string {
    if (scope.complete) {
        return `Scanned all ${scope.scanned} ${noun}.`;
    }
    return `Scanned ${scope.scanned} ${noun} — this scan's ceiling, so the rest of the `
        + `collection was NOT examined and a clean result here is not a clean collection.`;
}
