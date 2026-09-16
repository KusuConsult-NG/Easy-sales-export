/**
 * @jest-environment node
 */

/**
 *   #822 THE CARDS COUNTED WHATEVER PAGE THE ADMIN HAPPENED TO BE STANDING ON.
 *
 *   The owner: "I also noticed the cards are not returning the correct total
 *   numbers", then "ensure that all data reflecting for all modules (WAVE,
 *   Cooperative, Export, Academy, Farm Nation, marketplace) renders the correct
 *   numbers for all the cards."
 *
 *   Swept across the admin surface, the same shape in six places: a stat tile
 *   computed in the BROWSER with `rows.filter(...).length` over an array that
 *   is one cursor page. The numbers were bounded by the page size, and they
 *   CHANGED as the admin paged forward or picked a filter — one platform
 *   reporting different totals depending on where you were standing.
 *
 *       marketplace / reviews     0 / 0 / 0 ALWAYS — see below
 *       marketplace / escrow      4 cards over 50 rows, incl. "Total Held (₦)"
 *       marketplace / disputes    3 cards over 20 rows
 *       …/ disputes / escalated   3 cards over 20 rows
 *       wave / shipments          5 cards over a 500-row cap
 *       academy / applications    4 tiles, silently, whenever stats failed
 *
 *   TWO OF THEM SAID SO IN A COMMENT. The disputes screen carried "To get
 *   accurate global stats you would need a separate stats endpoint since we use
 *   cursor pagination which only returns the current page", and the escalated
 *   one "counts will be local to the current page data". The defect was known
 *   and written down; what was missing was the endpoint.
 *
 * ── THE WORST WAS NOT A PAGE COUNT AT ALL ───────────────────────────────────
 *
 *   /admin/marketplace/reviews read `result.reviews`, `result.stats` and
 *   `result.lastDocId` at the TOP LEVEL of an ActionResponse that nests all
 *   three under `.data`. Every one resolved to undefined, so the table was
 *   EMPTY ALWAYS and the three cards read 0 / 0 / 0 ALWAYS — while the action
 *   ran three exact `.count()` queries whose results nothing read.
 *
 *   It looked plausible because the sibling getAdminDisputesAction returns its
 *   rows BOTH nested and at the top level, so the idiom copied from that screen
 *   works there and silently does nothing here.
 *
 * ── AND A FAILED READ IS NOT A ZERO ─────────────────────────────────────────
 *
 *   The second half of this finding. Export's four tiles initialised to
 *   {0,0,0,0} and were only ever replaced on success — the catch was
 *   `console.error` — so an outage drew an empty queue. The cooperative
 *   dashboard rendered `stats?.x || 0` twelve times, so a permission refusal
 *   drew a real cooperative with no members and ₦0 contributions.
 *
 *   Zero is a plausible answer, which is exactly what makes it dangerous:
 *   nobody questions it. These screens show "—" or "Unavailable" now.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the reviews screen reading result.reviews again (the defect)      KILLED
 *     escrow's totalHeld summed over the page again                     KILLED
 *     the dispute stats action counting only "resolved"                 KILLED
 *     shipments' Total taken from the list length again                 KILLED
 *     export's stats initialised to zeros again                         KILLED
 *     the cooperative tiles falling back to `|| 0`                      KILLED
 *     reword this header                                   SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { DISPUTE_TERMINAL_STATUSES } from '@/lib/dispute-status';
import { statText, statMoney } from '@/lib/admin-stat-display';

const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), 'utf8'));

/** Every admin screen whose cards this finding corrected. */
const SCREENS = {
    reviews: 'src/app/admin/marketplace/reviews/page.tsx',
    escrow: 'src/app/admin/marketplace/escrow/page.tsx',
    disputes: 'src/app/admin/marketplace/disputes/page.tsx',
    escalated: 'src/app/admin/marketplace/disputes/escalated/page.tsx',
    shipments: 'src/app/admin/wave/shipments/page.tsx',
    academy: 'src/app/admin/academy/applications/page.tsx',
    exportApps: 'src/app/admin/export/applications/page.tsx',
    coopDash: 'src/app/admin/cooperatives/dashboard/page.tsx',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
describe('#822 — no card is computed from a page of rows', () => {
    it.each([
        ['escrow', SCREENS.escrow, [
            /transactions\.filter\([^)]*\)\.length/,
            /transactions\s*\n?\s*\.filter\([\s\S]{0,120}\.reduce\(/,
        ]],
        ['disputes', SCREENS.disputes, [/filteredDisputes\.filter\([^)]*\)\.length/]],
        ['escalated disputes', SCREENS.escalated, [/disputes\.filter\(d =>[^)]*\)\.length/]],
        ['wave shipments', SCREENS.shipments, [
            /total:\s*shipments\.length/,
            /shipments\.filter\(s =>[^)]*\)\.length/,
        ]],
    ])('%s no longer tallies its own list', (_name, file, patterns) => {
        /*
         *   THE assertion, and it is about ABSENCE — which is why it names the
         *   exact expressions rather than checking that a stats action is
         *   mentioned. A screen can call the action and still render the old
         *   tally beside it; that is the #741 trap, met repeatedly here.
         */
        const src = read(file);
        const survivors = (patterns as RegExp[]).filter((re) => re.test(src));
        expect({ file, survivors: survivors.map(String) }).toEqual({ file, survivors: [] });
    });

    it.each([
        ['escrow', SCREENS.escrow, 'getEscrowStatsAdmin('],
        ['disputes', SCREENS.disputes, 'getAdminDisputeStatsAction('],
        ['escalated disputes', SCREENS.escalated, 'getAdminDisputeStatsAction('],
    ])('%s asks the database instead', (_name, file, call) => {
        //   The vacuity guard for the assertion above: deleting the cards
        //   entirely would also satisfy "no page tally".
        expect(read(file)).toContain(call);
    });

    it('wave shipments takes its counts from the action, not the list', () => {
        const action = read('src/app/actions/wave/_wv_admin_shipments.ts');
        //   Five real counts, and the list bound kept — it is what holds the
        //   query inside the statement timeout.
        expect((action.match(/\.count\(\)\.get\(\)/g) ?? []).length).toBeGreaterThanOrEqual(5);
        expect(action).toContain('WAVE_SHIPMENT_PAGE_SIZE');
        expect(read(SCREENS.shipments)).toContain('meta?.stats');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#822 — the reviews screen reads the payload where it actually is', () => {
    it('IT READS result.data, NOT result.reviews', () => {
        /*
         *   This is the whole defect on that screen: three cards reading 0/0/0
         *   forever and an empty table, because an ActionResponse nests its
         *   payload under `.data` and every read was one level too high.
         */
        const src = read(SCREENS.reviews);

        expect(src).toContain('(result as any).data');
        expect(src).not.toMatch(/\(result as any\)\.reviews/);
        expect(src).not.toMatch(/\(result as any\)\.stats/);
        expect(src).not.toMatch(/\(result as any\)\.lastDocId/);
    });

    it('AND THE ACTION IS STILL COUNTING EXACTLY, which is what makes that worth reading', () => {
        //   Three `.count()` queries were running correctly the whole time and
        //   nothing consumed them. If they ever go, the fix above is pointless.
        const action = read('src/app/actions/reviews.ts');
        expect((action.match(/\.count\(\)\.get\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    });

    it('AND IT NO LONGER COUNTS THE PAGE WHEN THE STATS ARE ABSENT', () => {
        /*
         *   The stats arrive only on the FIRST page, so paging forward used to
         *   drop them and the cards silently became a tally of twenty rows.
         */
        const src = read(SCREENS.reviews);
        expect(src).not.toMatch(/reviews\.filter\(\(r\) => r\.status === "pending"\)\.length/);
        expect(src).toContain('latchedStats');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#822 — a failed read is not a zero', () => {
    it.each([
        ['export applications', SCREENS.exportApps],
        ['academy applications', SCREENS.academy],
        ['cooperative dashboard', SCREENS.coopDash],
        ['escrow', SCREENS.escrow],
        ['disputes', SCREENS.disputes],
    ])('%s distinguishes "could not read" from "none"', (_name, file) => {
        expect(read(file)).toContain('statsFailed');
    });

    it('export no longer initialises its four tiles to zeros', () => {
        /*
         *   `useState({ pending: 0, approved: 0, rejected: 0, resubmitted: 0 })`
         *   plus a `.catch(console.error)` is an outage rendered as an empty
         *   queue — the more reassuring of the two readings, and the wrong one.
         */
        const src = read(SCREENS.exportApps);
        expect(src).not.toMatch(/useState\(\{\s*pending:\s*0,\s*approved:\s*0/);
        expect(src).not.toMatch(/\.catch\(console\.error\)/);
    });

    it('the cooperative dashboard no longer draws an unreadable figure as 0 or ₦0', () => {
        const src = read(SCREENS.coopDash);
        expect(src).not.toMatch(/stats\?\.\w+\s*\|\|\s*0/);
        expect(src).not.toMatch(/formatCurrency\(stats\?\.\w+\s*\|\|\s*0\)/);
        //   and the partial-total flag its own action returns is finally read
        expect(src).toContain('stats?.truncated');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#822 — a partial payload must not take the screen down', () => {
    /*
     *   THE BUG THIS SUITE MISSED AND #601's CAUGHT.
     *
     *   My first pass wrote `stats ? stats.pending.toLocaleString() : '—'` on
     *   every card. That guards the OBJECT and not the FIELD, so a payload
     *   arriving partial — `{}`, or missing one key — is truthy and throws
     *
     *       TypeError: Cannot read properties of undefined (reading 'toLocaleString')
     *
     *   taking the whole admin screen down. #601's suite mounts every admin
     *   screen against a row carrying only an id and found it at once.
     *
     *   Guarding one and not the other is the same partial-application shape
     *   this finding is ABOUT, committed while fixing it. The cases below are
     *   the ones my own tests should have asked in the first place.
     */
    it.each([
        ['a real count', 1284, false, '1,284'],
        ['zero, which is a real answer', 0, false, '0'],
        ['a missing field', undefined, false, '—'],
        ['a null field', null, false, '—'],
        ['a missing field after a failed read', undefined, true, 'Unavailable'],
        ['NaN', NaN, false, '—'],
        ['a string that looks like a number', '12', false, '—'],
    ])('statText(%s)', (_label, value, failed, expected) => {
        expect(statText(value, failed as boolean)).toBe(expected);
    });

    it('statMoney makes the same distinction', () => {
        const fmt = (n: number) => `NGN ${n}`;
        expect(statMoney(500, fmt)).toBe('NGN 500');
        //   ZERO IS FORMATTED, not swallowed: an escrow balance of ₦0 is a real
        //   and important answer, and must be told apart from an unread one.
        expect(statMoney(0, fmt)).toBe('NGN 0');
        expect(statMoney(undefined, fmt)).toBe('—');
        expect(statMoney(undefined, fmt, true)).toBe('Unavailable');
    });

    it('AND EVERY CARD SCREEN RENDERS THROUGH IT', () => {
        //   Or one screen keeps a hand-rolled ternary and keeps the crash.
        for (const file of Object.values(SCREENS)) {
            expect({ file, usesHelper: read(file).includes('statText(') || read(file).includes('statMoney(') })
                .toEqual({ file, usesHelper: true });
        }
    });

    it('AND NONE OF THEM STILL CALLS toLocaleString ON A STAT DIRECTLY', () => {
        //   The exact expression that threw.
        for (const file of Object.values(SCREENS)) {
            const offenders = read(file).match(/stats\.\w+\.toLocaleString\(\)/g) ?? [];
            expect({ file, offenders }).toEqual({ file, offenders: [] });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#822 — and the dispute tally counts all four statuses', () => {
    it('SETTLED MEANS resolved OR closed, from the constant', () => {
        /*
         *   #629 found this tally omitting `closed`, and lib/dispute-status
         *   exists so that "asking for settled disputes never silently omits
         *   one". Moving the count to the server is exactly where that could
         *   have been lost again.
         */
        expect([...DISPUTE_TERMINAL_STATUSES].sort()).toEqual(['closed', 'resolved']);

        /*
         *   THE USE, NOT THE IMPORT.
         *
         *   The first draft asserted `action.toContain('DISPUTE_TERMINAL_STATUSES')`
         *   and a mutation replacing the count with `where("status", "==",
         *   "resolved")` SURVIVED — because the constant is still imported at
         *   the top of the file and the assertion was satisfied by that line.
         *
         *   "The file mentions the rule" is the weakest assertion in this
         *   codebase's vocabulary. It has let three findings look complete, and
         *   it was in the test written to stop #629 regressing.
         */
        const action = read('src/app/actions/disputes.ts');
        const stats = action.slice(action.indexOf('_getAdminDisputeStatsAction'));

        expect(stats).toMatch(/where\("status", "in", \[\.\.\.DISPUTE_TERMINAL_STATUSES\]\)/);
        //   and it does not quietly count one spelling of the two
        expect(stats).not.toMatch(/where\("status", "==", "resolved"\)/);
        //   respelled inline would drift from the constant the next time
        expect(stats).not.toMatch(/\["resolved", "closed"\]/);
    });
});
