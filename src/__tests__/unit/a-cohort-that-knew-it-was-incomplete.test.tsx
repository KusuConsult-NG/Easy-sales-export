/**
 *   #838 THE ACTION KNEW THE COHORT WAS INCOMPLETE AND THE SCREEN DID NOT SAY SO.
 *
 *   First finding of the cooperative pass of docs/module-audit-checklist.md,
 *   under A2.1 (a figure that could not be fully read must not be drawn as a
 *   total) and A6.1 (a capped list reports its cap).
 *
 *   `getStandardCooperativeMembersAction` already does its half properly. It
 *   computes `cohortTruncated`, returns it as `truncated` with the `rowCap`
 *   beside it, and logs at ERROR level:
 *
 *       "the filtered cohort hit the 5000-row cap — the list AND the stats
 *        beside it are INCOMPLETE. Narrow the filters."
 *
 *   NOTHING ON THE PAGE READ EITHER FIELD. So the four tiles — Pending,
 *   Approved, Total Paid Members, Unpaid Members — and the member list beneath
 *   them were drawn identically whether they described the whole cooperative or
 *   the newest five thousand rows of it. The only place the incompleteness
 *   appeared was a server log nobody reads while looking at the screen.
 *
 * ── WHY THIS IS THE AUDIT'S SIGNATURE SHAPE ─────────────────────────────────
 *
 *   The SIBLING screen already does it. The cooperative admin dashboard renders
 *   this exact banner from its own `stats.truncated`, and the note above it
 *   records that the field existed there too and "NOTHING READ IT" until
 *   somebody wired it up.
 *
 *   So a correct rule reached one of the two screens it names. That is the
 *   defect this audit has now filed more times than any other — #774's acronym
 *   took five sweeps, #824 found an eighth site, #835's own fix missed the
 *   canonical status list. Finding it here is the checklist working.
 *
 * ── WHAT IS DELIBERATELY NOT DONE ───────────────────────────────────────────
 *
 *   The figures are NOT blanked or hidden. A floor is useful to an
 *   administrator working a members list, and this is not a compliance report
 *   whose numbers get quoted outward. What changes is only that a floor can no
 *   longer be mistaken for a total.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const PAGE = 'src/app/admin/cooperatives/members/page.tsx';
const ACTION = 'src/app/actions/cooperative/_coop_admin_members.ts';
const DASHBOARD = 'src/app/admin/cooperatives/dashboard/page.tsx';

describe('#838 — a partial cohort says so on the members screen', () => {
    it('THE ACTION STILL REPORTS truncated AND rowCap', () => {
        /*
         *   The half that was already right, asserted so the page's new banner
         *   cannot be left reading a field that stopped being sent.
         */
        const src = code(ACTION);

        expect(src).toContain('truncated: cohortTruncated');
        expect(src).toContain('rowCap: fetchLimit');
    });

    it('AND THE PAGE READS IT', () => {
        const src = code(PAGE);
        expect(src).toMatch(/meta\?\.truncated/);
    });

    it('AND SAYS THE FIGURES ARE PARTIAL, in the admin\'s own terms', () => {
        /*
         *   "truncated" is a word about a query. An administrator needs to know
         *   that the number in front of her is a floor and what to do about it —
         *   which is the same standard #457's consequence map set for the
         *   startup log.
         */
        const src = code(PAGE);

        expect(src).toContain('These figures are partial');
        expect(src.toLowerCase()).toContain('floor');
        expect(src.toLowerCase()).toContain('narrow the filters');
    });

    it('AND THE FIGURES ARE STILL SHOWN', () => {
        /*
         *   Not blanked. A floor is useful on a members list; the fix is that it
         *   is labelled, not that it is withheld.
         */
        const src = code(PAGE);

        expect(src).toContain('displayStats.pendingMembers');
        expect(src).toContain('displayStats.activeMembers');
    });

    it('CONTROL: the sibling dashboard still carries the same treatment', () => {
        /*
         *   The reason this finding exists is that one of two screens had it.
         *   If the dashboard's banner is ever removed, this pair drifts apart
         *   again and the next reader has no way to know they were meant to
         *   match.
         */
        const src = code(DASHBOARD);

        expect(src).toMatch(/stats\?\.truncated/);
        expect(src).toContain('These totals are partial');
    });
});
