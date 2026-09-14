/**
 * A backlog count that may not grow — and may not quietly leave room to.
 *
 *   #743 FIVE OF THIS AUDIT'S OWN RATCHETS HAD DRIFTED OPEN, BY SIXTY-SEVEN
 *        BETWEEN THEM.
 *
 *   Several findings could not fix a whole class in one change — the owner's
 *   standing brief exists to prevent exactly that sweep — so they measured what
 *   remained and pinned it as a CEILING, with the intent stated plainly:
 *
 *       "Ceilings, not targets. Each number is what the sweep measured after
 *        #293/#294 were fixed. ADDING A NEW SITE FAILS HERE, which is the whole
 *        point: the pattern stops growing while the backlog is worked down."
 *
 *   That intent holds only while the ceiling EQUALS the measurement. Every
 *   later fix lowers the real count and leaves the ceiling where it was, so the
 *   gap between them becomes an allowance nobody granted:
 *
 *       D1  success checked, error never read       ceiling 87   actual 61
 *       D2  result captured, never inspected        ceiling 29   actual 17
 *       D4  fetch response never checked for ok     ceiling 54   actual 40
 *       D5  a catch that swallows the failure       ceiling 55   actual 44
 *       #532 admin gates still on the stale JWT     ceiling 88   actual 84
 *
 *   Sixty-seven new instances of five defect classes could be added with every
 *   test green. The ratchets got weaker precisely as the codebase got better,
 *   which is the worst possible direction for that relationship to run.
 *
 * ── WHY NOT SIMPLY PIN THE NUMBER ───────────────────────────────────────────
 *
 *   #532 answered that itself, and the objection is a fair one:
 *
 *       "Not pinned to an exact number: converting one is progress and must not
 *        fail a test."
 *
 *   It is the right worry and the wrong conclusion. A test that fails on
 *   progress is only a problem if the failure is unhelpful. So this pins
 *   exactly and distinguishes the two directions in what it SAYS:
 *
 *       grew      — a new instance was added; fix it, do not raise the number
 *       improved  — one was fixed; lower the number and the ledger keeps grip
 *
 *   The second costs one line and RECORDS the progress. The ceiling absorbed it
 *   silently instead, which is how 87 came to mean 61.
 */

/** What a ledger reads when the count is exactly what was recorded. */
export const LEDGER_HELD = "held at the recorded count";

/**
 * Compares a measured backlog against the number recorded in the test.
 *
 * Returns {@link LEDGER_HELD} when they agree, and otherwise a sentence naming
 * the direction and the next step — which is what a reader sees in the diff of
 * a failing assertion.
 */
export function ledgerVerdict(actual: number, recorded: number): string {
    if (actual === recorded) return LEDGER_HELD;

    if (actual > recorded) {
        return (
            `GREW to ${actual}, above the recorded ${recorded}. A new instance of this ` +
            `class was added — fix it rather than raising the number.`
        );
    }

    return (
        `IMPROVED to ${actual}, below the recorded ${recorded}. Lower the recorded ` +
        `count to ${actual}, or the difference becomes room for ${recorded - actual} ` +
        `new instances that no test would notice.`
    );
}
