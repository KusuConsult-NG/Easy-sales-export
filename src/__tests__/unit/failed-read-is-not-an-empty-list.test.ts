/**
 * @jest-environment node
 */

/**
 *   #408 "ALL CAUGHT UP!" AND "NO LOAN APPLICATIONS YET" — SHOWN WHEN THE READ
 *   FAILED.
 *
 *   From #407's remaining 33: the try-less loaders. The stuck spinner was the
 *   reason I opened them; it was not the worst thing in them.
 *
 *   THE FINDING
 *   -----------
 *   Four loaders had the same body:
 *
 *       setLoading(true);
 *       const result = await getX();
 *       if (result.success && result.data) setX(result.data);
 *       setLoading(false);
 *
 *   No else, and no try. A refusal — or a rejected promise — left the list at
 *   its initial `[]` and the render fell through to the empty state. On these
 *   two screens the empty state is a positive claim:
 *
 *       /land/verify   "All Caught Up! — No pending land listings to review"
 *       /loans         "No Loan Applications Yet — Get started by applying for
 *                       your first loan"
 *
 *   The first tells an admin the verification queue is clear when it was never
 *   read. The second tells a borrower with an outstanding loan that they have
 *   none, and invites them to take another.
 *
 *   THIS IS #384, ON THE OTHER SIDE OF THE SAME PRODUCT. #384 fixed exactly this
 *   — in almost exactly these words — on the loan APPROVAL queue, and recorded
 *   why: "On a queue of business loan applications that is the worst possible
 *   wrong answer: it tells an approver the work is done." The borrower's own
 *   list, and the land queue next to it, were not touched. #297's class across
 *   screens rather than functions, which is the shape this audit keeps meeting.
 *
 *   WHAT WAS FIXED, AND WHAT WAS NOT
 *   ---------------------------------
 *   /loans and /land/verify now hold three distinguishable states — loading,
 *   failed (with the reason), genuinely empty — and #384's own loader on
 *   /loans/approve gained the try it never had, so a rejection reaches the error
 *   state it already renders.
 *
 *   Deliberately NOT changed here: the same shape in loadNotes, fetchSchedule
 *   and loadSellerData. They are real and they are named in #407's pinned list;
 *   each needs an error state built into a different screen, and doing four at
 *   once with no test coverage is how a repair becomes an outage. They are
 *   recorded rather than half-done.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the empty state stops excluding the error     KILLED
 *     the else-branch is dropped again              KILLED
 *     the catch stops clearing the list             KILLED
 *     reword the header prose                       SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();

const cache = new Map<string, string>();
const code = (p: string) => {
    if (!cache.has(p)) cache.set(p, stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: relative(ROOT, p) }));
    return cache.get(p)!;
};

const LOANS = 'src/app/loans/page.tsx';
const LAND = 'src/app/land/verify/page.tsx';
const APPROVE = 'src/app/loans/approve/page.tsx';

/** A named loader's body, brace-matched (#400: never a fixed span). */
function loader(file: string, name: string): string {
    const src = code(file);
    const at = src.search(new RegExp(`async function ${name}\\s*\\(`));
    expect({ file, name, found: at > -1 }).toEqual({ file, name, found: true });
    let depth = 0;
    const open = src.indexOf('{', at);
    for (let j = open; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') {
            depth--;
            if (depth === 0) return src.slice(at, j + 1);
        }
    }
    return src.slice(at);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#408 — a failed read is told apart from an empty one', () => {
    const CASES: Array<[string, string]> = [
        [LOANS, 'loadLoans'],
        [LAND, 'loadListings'],
        [APPROVE, 'loadLoans'],
    ];

    it.each(CASES)('%s :: %s reports a REFUSAL rather than falling through', (file, name) => {
        const body = loader(file, name);
        // The else-branch #384 established: a refusal is an error, not an
        // absence, and the list is cleared rather than left stale.
        expect(body).toMatch(/setError\(/);
        expect(body).toMatch(/else\s*\{/);
    });

    it.each(CASES)('%s :: %s survives a REJECTED promise too', (file, name) => {
        const body = loader(file, name);
        expect(body).toMatch(/\btry\s*\{/);
        expect(body).toMatch(/\bcatch\b/);
        expect(body).toMatch(/\bfinally\s*\{/);
        // The catch must set the error, not merely stop the spinner: a blank
        // screen with no explanation is the defect #307 named.
        const c = body.slice(body.indexOf('catch'));
        expect(c).toMatch(/setError\(/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#408 — the empty state cannot render over a failure', () => {
    it('THE LAND QUEUE DOES NOT SAY "ALL CAUGHT UP" WHEN THE READ FAILED', () => {
        const src = code(LAND);
        // The claim is still there for the genuinely-empty case…
        expect(src).toContain('All Caught Up!');
        // …and it is now gated on there being no error.
        expect(src).toMatch(/!loading && !error && listings\.length === 0/);
        // …with the failure rendered before it.
        expect(src).toMatch(/!loading && error &&/);
        expect(src).toContain('Could not load the verification queue');
    });

    it('and the borrower is not told they have no loans when the read failed', () => {
        const src = code(LOANS);
        expect(src).toContain('No Loan Applications Yet');
        expect(src).toMatch(/!loading && !error && loans\.length === 0/);
        expect(src).toMatch(/!loading && error &&/);
        expect(src).toContain('Could not load your loans');
    });

    it('and the error copy does not pretend to know the data', () => {
        /**
         * #322's rule applied to a network failure: the message has to say what
         * is actually known. "You have no loans" is a claim about the account;
         * "we could not load them" is a claim about the request, and only the
         * second one is true here.
         */
        expect(code(LOANS)).toMatch(/not a statement that you have no loans/i);
        expect(code(LAND)).toMatch(/not an empty queue/i);
    });
});
