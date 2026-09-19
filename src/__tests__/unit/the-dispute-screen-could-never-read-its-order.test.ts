/**
 * @jest-environment node
 */

/**
 *   #801 THE ADMIN DISPUTE SCREEN HAS NEVER BEEN ABLE TO READ ITS ORDER.
 *
 *   getOrderByIdAction guarded itself with one line:
 *
 *       if (orderData?.buyerId !== session.user.id) return "Unauthorized";
 *
 *   The BUYER, and nobody else. /admin/marketplace/disputes/[id] calls it —
 *   signed in as an administrator — so the comparison was false on every
 *   visit, the read returned "Unauthorized", the Order Information panel
 *   rendered EMPTY, and the dispute's context amount fell back to ₦0.
 *
 *   Not an intermittent failure. Every dispute, every administrator, always,
 *   for as long as that screen has existed.
 *
 * ── HOW IT WAS FOUND, INCLUDING THE PART I GOT WRONG ────────────────────────
 *
 *   #797 made the screen withhold the Resolve control when its context had not
 *   loaded. CI then failed on `Admin can resolve dispute`, and my first reading
 *   was that #797 was too strict — that "no escrow row" was being treated as a
 *   failed read. That was ONE real defect and I fixed it.
 *
 *   The screenshot said otherwise about the rest: Order Information was empty
 *   on an order that certainly exists. The honest reading was not "my guard is
 *   too strict" but "my guard is right, and this screen was ALWAYS blind". The
 *   behaviour #797 replaced was a full-width "Resolve Dispute" button offered
 *   over two empty panels and a ₦0 total.
 *
 *   So #797's own claim — "an administrator deciding blind" — was not the
 *   occasional bad minute I described it as. It was the normal case.
 *
 * ── THE PERMISSION IS THE ONE THE WRITE ALREADY REQUIRES ────────────────────
 *
 *   updateDisputeStatusAction, the door that actually moves the escrow, gates
 *   on `finance:resolve_disputes` — super_admin and admin, nobody else. This
 *   read asks the same question, so it can never be wider than the decision it
 *   informs, and no one gains sight of an order who could not already refund or
 *   release it.
 *
 *   NOT isAdmin(), which also admits moderator, support and six module admins
 *   to every buyer's order — admin-permissions warns in as many words against
 *   reaching for the broad predicate where a narrow one belongs.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the admin branch removed (the original defect)                   KILLED
 *     the permission widened to isAdmin()                              KILLED
 *     the buyer check removed, so any signed-in caller reads any order KILLED
 *     the permission swapped for one a support role holds              KILLED
 *     reword this header                                   SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { hasAdminPermission } from '@/lib/admin-permissions';

const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), 'utf8'));

const ORDERS = 'src/app/actions/orders.ts';

/** The slice of _getOrderByIdAction that decides who may read. */
function authBlock(): string {
    const src = read(ORDERS);
    const from = src.indexOf('async function _getOrderByIdAction');
    const to = src.indexOf('const escrowQuery', from);
    return src.slice(from, to);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#801 — who may read an order', () => {
    it('the action is still there and still guards itself', () => {
        //   Vacuity guard: every assertion below is trivially true of a slice
        //   that no longer contains an authorisation check at all.
        const block = authBlock();
        expect(block.length).toBeGreaterThan(200);
        expect(block).toContain('Unauthorized');
    });

    it('THE BUYER IS STILL THE PRIMARY READER', () => {
        //   The narrow case must survive. A fix that admitted admins by
        //   dropping the buyer comparison would open every order to every
        //   signed-in account.
        //   #904 — the buyer comparison is still here and still first; it now
        //   resolves the ORDER's buyer forward, so a buyer whose order names a
        //   superseded profile is not pushed down the admin arm and then
        //   refused their own order. The narrow case this guards is intact.
        expect(authBlock()).toMatch(/isOwnedBySession\(orderData\?\.buyerId, session\.user\.id\)/);
    });

    it('AND AN ADMIN WHO MAY RESOLVE THE DISPUTE MAY READ THE ORDER', () => {
        //   The defect: this branch did not exist, so the admin dispute screen
        //   got "Unauthorized" on every load.
        const block = authBlock();
        expect(block).toMatch(/hasAdminPermission\(/);
        expect(block).toMatch(/"finance:resolve_disputes"/);
    });

    it('AND IT IS NOT isAdmin(), which would admit six module admins', () => {
        /*
         *   The cheap fix was `isAdmin(roles)`. That predicate covers all ten
         *   admin roles including moderator and support, none of whom can
         *   resolve a dispute — so it would hand every buyer's order to
         *   accounts that have no decision to inform.
         */
        const block = authBlock();
        expect(block).not.toMatch(/\bisAdmin\s*\(/);
    });

    it('EXECUTED: the permission admits exactly who resolves disputes', () => {
        /*
         *   The assertions above read source, which is the trap this audit has
         *   met repeatedly. This one runs the predicate, so "the right string
         *   is present" cannot stand in for "the right people are admitted".
         */
        expect(hasAdminPermission(['super_admin'], 'finance:resolve_disputes')).toBe(true);
        expect(hasAdminPermission(['admin'], 'finance:resolve_disputes')).toBe(true);

        //   And the roles that must NOT gain sight of a buyer's order.
        for (const role of ['moderator', 'support', 'marketplace_admin', 'academy_admin']) {
            expect({ role, allowed: hasAdminPermission([role], 'finance:resolve_disputes') })
                .toEqual({ role, allowed: false });
        }
        expect(hasAdminPermission([], 'finance:resolve_disputes')).toBe(false);
    });

    it('AND IT IS THE SAME PERMISSION THE WRITE DOOR ASKS FOR', () => {
        /*
         *   The invariant that keeps this honest as both sides change: a read
         *   that informs a decision must not be wider than the decision. If
         *   updateDisputeStatusAction is ever re-gated, this fails and whoever
         *   moved it has to move this too.
         */
        const disputes = read('src/app/actions/disputes.ts');
        const resolve = disputes.slice(disputes.indexOf('async function _updateDisputeStatusAction'));
        const writePermission = /hasAdminPermission\([^,]+,\s*"([^"]+)"\)/.exec(resolve)?.[1];

        expect(writePermission).toBe('finance:resolve_disputes');
        expect(authBlock()).toContain(`"${writePermission}"`);
    });
});
