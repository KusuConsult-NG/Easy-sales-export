/**
 * @jest-environment node
 */

/**
 *   #853 THE PRODUCT MODERATION QUEUE KNEW FIVE OF EIGHT STATUSES, AND KEPT ITS
 *   LIST TWICE.
 *
 *   Marketplace pass 1 of docs/module-audit-checklist.md, items A1.7 and A2.1.
 *
 *   The same five strings, in the same order, in two files that must agree:
 *
 *       admin/marketplace/products/page.tsx   const TABS     = ["pending", …]
 *       actions/admin/_marketplace.ts         const countable = ["pending", …]
 *
 *   One renders a tab per entry and reads `stats[tab]`; the other decides which
 *   counts exist. They agreed because somebody typed them identically, and
 *   NOTHING WOULD FAIL IF AN EDIT REACHED ONE OF THEM: a tab whose status the
 *   server does not count shows no badge, and a status the server counts with no
 *   tab is a number nobody sees. Both failures are silent.
 *
 *   AND BOTH WERE A SUBSET OF PRODUCT_STATUSES, which has eight. That is #846's
 *   finding — lists exhaustive by coincidence — and this module has already paid
 *   for it once. #647's header:
 *
 *       "archived — WRITTEN BY TWO DOORS AND DECLARED BY NEITHER LIST … So a
 *        status the code writes was not a status the code knew. The seller's own
 *        products page … labelled a deleted listing 'Active'."
 *
 *   Derived by subtraction now, so a status added to the canonical union appears
 *   in the queue BY DEFAULT rather than making every product carrying it
 *   invisible to the people whose job is to act on it.
 *
 * ── AND A SECOND, SMALLER ONE ON THE SAME SCREEN ────────────────────────────
 *
 *   A failed load left the PREVIOUS tab's counts on the tabs. The product LIST
 *   was already gated correctly — `!loading && !error && products.length > 0` —
 *   so a failure hid it and showed a banner. The badges read `stats[t]`
 *   unconditionally, and `stats` is only ever written on success.
 *
 *   So an administrator on "pending" who switched to "rejected" and hit a
 *   failure saw the banner, no list, and pending's counts still sitting on every
 *   tab as though they described the catalogue now. One of two treatments inside
 *   a single file — this audit's most repeated shape at its smallest scale.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    PRODUCT_STATUSES,
    PRODUCT_MODERATION_STATUSES,
    PRODUCT_RETIRED_STATUSES,
    PRODUCT_DECISION_LOCKED,
} from '@/lib/product-status';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });

const PAGE = 'src/app/admin/marketplace/products/page.tsx';
const ACTION = 'src/app/actions/admin/_marketplace.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#853 — the moderation list is derived, not typed twice', () => {
    it('THE MODERATION LIST IS THE CANONICAL ONE MINUS THE RETIRED PAIR', () => {
        expect([...PRODUCT_MODERATION_STATUSES].sort()).toEqual(
            PRODUCT_STATUSES.filter((s) => !PRODUCT_RETIRED_STATUSES.includes(s)).slice().sort(),
        );
    });

    it('AND IT COVERS EVERY STATUS THAT IS NOT RETIRED — no coincidences', () => {
        /*
         *   The property the derivation buys. Asserted as a partition rather
         *   than as a list, so adding a value to PRODUCT_STATUSES puts it in one
         *   side or the other and never in neither.
         */
        const union = [...PRODUCT_MODERATION_STATUSES, ...PRODUCT_RETIRED_STATUSES].sort();
        expect(union).toEqual([...PRODUCT_STATUSES].slice().sort());

        const both = PRODUCT_MODERATION_STATUSES
            .filter((s) => PRODUCT_RETIRED_STATUSES.includes(s));
        expect(both).toEqual([]);
    });

    it('AND THE FIVE IT USED TO KNOW ARE ALL STILL THERE', () => {
        //   The change must not have REMOVED a tab an administrator uses.
        for (const s of ['pending', 'active', 'rejected', 'suspended', 'draft']) {
            expect({ s, present: (PRODUCT_MODERATION_STATUSES as readonly string[]).includes(s) })
                .toEqual({ s, present: true });
        }
    });

    it('AND out_of_stock IS NOW ACCOUNTED FOR, which it was not', () => {
        /*
         *   A real state a listing can be in — #647 made it visible to buyers
         *   and refused at checkout. Nothing writes it today, so the tab reads
         *   zero, which is a true statement about the catalogue rather than
         *   noise. It was in neither hand-written list.
         */
        expect([...PRODUCT_MODERATION_STATUSES]).toContain('out_of_stock');
    });

    it('AND THE RETIRED PAIR IS EXCLUDED FOR A REASON, not for tidiness', () => {
        /*
         *   A queue that lists rows nobody can action is #658's "warning nobody
         *   can act on". PRODUCT_DECISION_LOCKED already refuses to act on
         *   `deleted`, so listing it would offer buttons that cannot work.
         */
        expect([...PRODUCT_RETIRED_STATUSES].sort()).toEqual(['archived', 'deleted']);
        expect([...PRODUCT_MODERATION_STATUSES]).not.toContain('deleted');
        expect([...PRODUCT_MODERATION_STATUSES]).not.toContain('archived');
        //   The reason, asserted rather than asserted about.
        expect([...PRODUCT_DECISION_LOCKED]).toContain('deleted');
    });

    it('AND BOTH THE SCREEN AND THE ACTION READ IT, rather than their own copy', () => {
        const page = code(PAGE);
        const action = code(ACTION);

        expect(page).toContain('const TABS = PRODUCT_MODERATION_STATUSES');
        expect(action).toContain('const countable = PRODUCT_MODERATION_STATUSES');

        //   The literal that was in both files. Its return in either is the
        //   regression this case exists to catch.
        const typedOut = '["pending", "active", "rejected", "suspended", "draft"]';
        expect(page).not.toContain(typedOut);
        expect(action).not.toContain(typedOut);
    });

    it('AND THE COUNTS ARE STILL SERVER-SIDE, which #37 is the record of', () => {
        /*
         *   The half that must not regress while the list changes. A moderation
         *   badge computed from the fetched page would be #845 on a new screen —
         *   and this action's own comment names the mistake.
         */
        const action = code(ACTION);
        const at = action.indexOf('const countable = PRODUCT_MODERATION_STATUSES');
        const block = action.slice(at, at + 400);

        expect(block).toContain('.count().get()');
        expect(block).not.toContain('.length');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#853 — a failed load does not leave the last one on screen', () => {
    it('THE FAILURE PATHS CLEAR THE COUNTS AND THE LIST', () => {
        const src = code(PAGE);

        //   Both arms: the action returning `success: false`, and a throw.
        const returned = src.indexOf('setError(result.error');
        const threw = src.indexOf('setError("An unexpected error occurred."');

        expect(returned).toBeGreaterThan(-1);
        expect(threw).toBeGreaterThan(-1);
        expect(src.slice(returned, returned + 120)).toContain('clearOnFailure()');
        expect(src.slice(threw, threw + 120)).toContain('clearOnFailure()');
    });

    it('AND CLEARING MEANS "NOT MEASURED", not zero', () => {
        /*
         *   #753's rule. `setStats({})` leaves each badge undefined, and the
         *   badge renders only for `typeof stats[t] === "number"` — so it
         *   disappears rather than reading 0. A `setStats({pending: 0, …})`
         *   would satisfy "cleared" and assert something false about the
         *   catalogue.
         */
        const src = code(PAGE);
        const at = src.indexOf('const clearOnFailure');
        const body = src.slice(at, at + 220);

        expect(body).toContain('setStats({})');
        expect(body).toContain('setProducts([])');

        //   And the guard that turns absence into no badge is still there.
        expect(src).toContain('typeof stats[t] === "number"');
    });

    it('AND THE LIST WAS ALREADY GATED — the half that was right', () => {
        /*
         *   Recorded so the finding is not overstated. The product list already
         *   rendered under `!loading && !error`, which is why the defect was
         *   the counts alone and not the whole screen.
         */
        const src = code(PAGE);
        expect(src).toContain('!loading && !error && products.length > 0');
    });
});
