/**
 * @jest-environment node
 */

/**
 *   #743 FIVE OF THIS AUDIT'S OWN RATCHETS HAD DRIFTED OPEN, BY SIXTY-SEVEN
 *        BETWEEN THEM.
 *
 *   Several findings could not fix a whole class in one change — the owner's
 *   standing brief exists to prevent exactly that sweep — so each measured what
 *   remained and pinned it as a CEILING. The intent is stated plainly in
 *   client-reads-the-answer:
 *
 *       "Ceilings, not targets. Each number is what the sweep measured after
 *        #293/#294 were fixed. ADDING A NEW SITE FAILS HERE, which is the whole
 *        point: the pattern stops growing while the backlog is worked down."
 *
 *   That holds only while the ceiling EQUALS the measurement. Every later fix
 *   lowers the real count and leaves the ceiling untouched, so the gap between
 *   them becomes an allowance nobody granted:
 *
 *       D1   success checked, error never read       ceiling 87   actual 61
 *       D2   result captured, never inspected        ceiling 29   actual 17
 *       D4   fetch response never checked for ok     ceiling 54   actual 40
 *       D5   a catch that swallows the failure       ceiling 55   actual 44
 *       #532 admin gates still on the stale JWT      ceiling 88   actual 84
 *
 *   SIXTY-SEVEN new instances of five defect classes could be added today with
 *   every test green. The ratchets got weaker precisely as the codebase got
 *   better, which is the worst direction for that relationship to run — and it
 *   needs nobody to have done anything wrong. Each fix that closed one of these
 *   silently widened the door for the next.
 *
 *   The stale-JWT one is the sharpest. #356 established what that class costs:
 *   a JWT role claim "keeps its value for hours after the database loses it",
 *   so a revoked admin still passes the gate. Four free slots on that.
 *
 * ── THE OBJECTION, WHICH WAS RIGHT, AND ITS ANSWER ──────────────────────────
 *
 *   #532 wrote the reasoning down, which is why this was findable at all:
 *
 *       "Not pinned to an exact number: converting one is progress and must not
 *        fail a test."
 *
 *   A test that fails on progress is only a problem if the FAILURE is
 *   unhelpful. So the ledger pins exactly and distinguishes the directions in
 *   what it says: "GREW — fix it rather than raising the number", or "IMPROVED
 *   — lower the recorded count, or the difference becomes room for N new
 *   instances no test would notice". The second costs one line and records the
 *   progress; the ceiling absorbed it silently instead, which is how 87 came to
 *   mean 61.
 *
 * ── AND WHAT IS DELIBERATELY NOT CHANGED ────────────────────────────────────
 *
 *   Fifteen of the twenty numeric ceilings in the suites are BEHAVIOURAL bounds
 *   — a page size of 25, a retry-after of 60 seconds, a rate limit of 5, a
 *   query count of 6 — and `toBeLessThanOrEqual` is exactly right for those: the
 *   claim is "no more than this", not "this many remain". Converting them would
 *   turn a correct bound into a brittle equality. Only the seven POPULATION
 *   ledgers moved.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file. The table
 *   was written BEFORE the sweep ran, which is the wrong order and is recorded
 *   rather than tidied away; the sweep was then run in full and every row below
 *   is its actual result.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { ledgerVerdict, LEDGER_HELD } from '@/lib/testing/ledger';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

/** Every suite whose numbers count a remaining backlog rather than bound a behaviour. */
const LEDGER_SUITES = [
    'src/__tests__/unit/client-reads-the-answer.test.ts',
    'src/__tests__/unit/half-converted-off-the-stale-token.test.ts',
    'src/__tests__/unit/admin-route-authority.test.ts',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#743 — the ledger tells the two directions apart', () => {
    it('AN UNCHANGED COUNT HOLDS', () => {
        expect(ledgerVerdict(61, 61)).toBe(LEDGER_HELD);
    });

    it('AND A GROWN COUNT SAYS SO, AND SAYS NOT TO RAISE THE NUMBER', () => {
        //   The direction that was already caught. It must keep failing.
        const v = ledgerVerdict(62, 61);

        expect(v).not.toBe(LEDGER_HELD);
        expect(v).toContain('GREW to 62');
        expect(v).toContain('rather than raising the number');
    });

    it('AND AN IMPROVED COUNT ALSO FAILS — the whole finding', () => {
        /*
         *   THE test. Under a ceiling this was silence, and the silence is what
         *   let 87 come to mean 61. It has to fail, and it has to fail in a way
         *   that makes lowering the number the obvious next move rather than an
         *   annoyance.
         */
        const v = ledgerVerdict(61, 87);

        expect(v).not.toBe(LEDGER_HELD);
        expect(v).toContain('IMPROVED to 61');
        expect(v).toContain('Lower the recorded count to 61');
    });

    it('AND IT NAMES WHAT THE SLACK WOULD HAVE COST', () => {
        //   26, not "some". A reader deciding whether to bother needs the size.
        expect(ledgerVerdict(61, 87)).toContain('room for 26');
    });

    it('AND A CEILING WOULD HAVE PASSED EVERY ONE OF THOSE', () => {
        /*
         *   The old shape, exercised beside the new one so the difference is a
         *   demonstration rather than an assertion about history. This is what
         *   was green while five ratchets sat open.
         */
        for (const [actual, ceiling] of [[61, 87], [17, 29], [40, 54], [44, 55], [84, 88]]) {
            expect(actual <= ceiling).toBe(true);                       // old: passes
            expect(ledgerVerdict(actual, ceiling)).not.toBe(LEDGER_HELD); // new: fails
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#743 — and every population ledger is on it', () => {
    it('NONE OF THEM STILL CAPS A BACKLOG WITH toBeLessThanOrEqual', () => {
        /*
         *   These three suites carry no behavioural bounds — every number in
         *   them counts a remaining backlog — so the absence is exact and
         *   checkable. The fifteen behavioural ceilings elsewhere are left
         *   alone, deliberately, and are not in this list.
         */
        const offenders = LEDGER_SUITES.filter((f) => /toBeLessThanOrEqual\(\s*\d/.test(code(f)));
        expect(offenders).toEqual([]);
    });

    it('AND EACH ONE ACTUALLY CALLS THE LEDGER', () => {
        //   Vacuity guard: deleting the assertions would satisfy the test above
        //   just as well as converting them.
        for (const f of LEDGER_SUITES) {
            expect({ f, uses: /ledgerVerdict\(/.test(code(f)) }).toEqual({ f, uses: true });
        }
    });

    it('AND THE NUMBERS RECORDED ARE THE ONES THE SWEEPS NOW MEASURE', () => {
        /*
         *   Stated here as well as at each site, because this is the fact that
         *   rotted. The suites themselves assert it every run — if any of these
         *   drifts again, THAT suite goes red, not this one. What this pins is
         *   that the recorded numbers are still written down where a reader can
         *   see them, rather than having become a variable nobody can check.
         */
        const cra = code('src/__tests__/unit/client-reads-the-answer.test.ts');

        expect(cra).toContain("ledgerVerdict(n('D1'), 61)");
        expect(cra).toContain("ledgerVerdict(n('D2'), 17)");
        expect(cra).toContain("ledgerVerdict(n('D3'), 6)");
        //   40 → 39 when #796 converted the certificate verification page.
        //   This line moving is the mechanism working, the same way the JWT
        //   ledger's did below: the sweep REPORTED the improvement instead of
        //   absorbing it, and the number had to be lowered by hand in both
        //   places it is written down.
        //
        //   39 → 38 when the second BVN field went from export onboarding,
        //   taking its POST to /api/kyc/verify-bvn with it — the wizard asked
        //   for the same eleven digits twice, and that copy blocked nothing
        //   and reached no record. See lib/export-identity. Reported, not
        //   absorbed, and moved by hand here as well: the whole point of
        //   writing the number down twice is that a sweep cannot quietly
        //   widen its own ceiling.
        expect(cra).toContain("ledgerVerdict(n('D4'), 38)");
        //   44 → 43 when #804 converted admin/settings/logs, then 43 → 41 when
        //   checkout's delivery address lost its two Google geocoder wrappers —
        //   each of which logged to the console and fell through to the state
        //   centroid without telling the buyer the lookup had failed. Moved by
        //   hand in both places the number is written down, which is the point
        //   of this second statement of it.
        expect(cra).toContain("ledgerVerdict(n('D5'), 41)");

        expect(code('src/__tests__/unit/half-converted-off-the-stale-token.test.ts'))
            //   84 → 80 when #748 converted the four money-OUT gates. The ledger
            //   REPORTED that improvement — 'IMPROVED to 80… lower the recorded
            //   count' — which under the old `<= 88` ceiling would have been
            //   silent. This line moving is the mechanism working, one finding on.
            .toContain('ledgerVerdict(jwtOnly.length, 60)');
    });

    it('AND THE BEHAVIOURAL BOUNDS ARE LEFT AS BOUNDS', () => {
        /*
         *   The other half of the decision, asserted so it reads as a choice
         *   rather than an omission. A page size of 25 is "no more than this",
         *   and pinning it to equality would fail the first time a test fixture
         *   returned 24.
         */
        expect(code('src/__tests__/unit/message-user-search.test.ts'))
            .toContain('toBeLessThanOrEqual(25)');
        expect(code('src/__tests__/unit/rate-limit-namespaces.test.ts'))
            .toContain('toBeLessThanOrEqual(5)');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   keyed by FULL PATH (#742's harness was keyed by basename and overwrote a
 *   file), each mutant proving its edit landed by a unique string on disk.
 *
 *     MUTANT                                                        RESULT
 *     ledgerVerdict accepts an improved count as held                KILLED
 *     ledgerVerdict accepts a grown count as held                    KILLED
 *     the improved message stops naming the new number               KILLED
 *     the improved message stops naming the slack                    KILLED
 *     one ledger goes back to a ceiling                              KILLED
 *     one ledger's recorded number is raised again                   KILLED
 *     the D1 recorded count is put back to 87                        KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 */
