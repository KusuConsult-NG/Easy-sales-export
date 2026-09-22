/**
 * @jest-environment node
 */

/**
 * A seller with a shopping cart.
 *
 *   THE OWNER: "when users sign up as sellers they can't have buyers features
 *   on their dashboards. for users to have both sellers and buyers features
 *   they need to sign up as both."
 *
 *   HALF THE RULE WAS APPLIED. Every selling entry carried `sellerOnly`, so a
 *   buyer never saw them. Not one buying entry carried anything, so Shopping
 *   Cart, My Orders and My Quotes sat in every seller's sidebar. #908 noticed
 *   the asymmetry in passing — "the buyer nav is ungated" — and gated only the
 *   buyer DASHBOARD it was adding at the time.
 *
 *   Browse Products stays open to everybody, as a judgement call recorded at
 *   the nav: it is the shop floor rather than a buying screen, a seller needs
 *   to see the market they list into, and its /buyer/ path is a URL accident.
 */

import { describe, it, expect } from '@jest/globals';
import { navItemAllowedForRoles } from '@/lib/nav-visibility';
import { MARKETPLACE_BUYER_ROLES } from '@/lib/role-app-mapping';

const BUYER_ITEM = { rolesAny: MARKETPLACE_BUYER_ROLES };
const SELLER_ITEM = { sellerOnly: true };
const OPEN_ITEM = {};

const SELLER_ONLY = ['seller'];
const BUYER_ONLY = ['marketplace_buyer'];
const BOTH = ['seller', 'marketplace_buyer'];

describe('a seller with a shopping cart', () => {
    it('A SELLER-ONLY ACCOUNT SEES NO BUYING SCREENS', () => {
        expect(navItemAllowedForRoles(BUYER_ITEM, SELLER_ONLY)).toBe(false);
        expect(navItemAllowedForRoles(SELLER_ITEM, SELLER_ONLY)).toBe(true);
    });

    it('A BUYER-ONLY ACCOUNT SEES NO SELLING SCREENS', () => {
        expect(navItemAllowedForRoles(SELLER_ITEM, BUYER_ONLY)).toBe(false);
        expect(navItemAllowedForRoles(BUYER_ITEM, BUYER_ONLY)).toBe(true);
    });

    it('"BOTH" SEES BOTH — which is the owner\'s whole point', () => {
        expect(navItemAllowedForRoles(SELLER_ITEM, BOTH)).toBe(true);
        expect(navItemAllowedForRoles(BUYER_ITEM, BOTH)).toBe(true);
    });

    it('THE SHOP FLOOR IS OPEN TO EVERYBODY', () => {
        for (const roles of [SELLER_ONLY, BUYER_ONLY, BOTH, []]) {
            expect(navItemAllowedForRoles(OPEN_ITEM, roles)).toBe(true);
        }
    });

    it('BOTH SPELLINGS OF EACH ROLE COUNT — #885 five times over', () => {
        expect(navItemAllowedForRoles(SELLER_ITEM, ['marketplace_seller'])).toBe(true);
        expect(navItemAllowedForRoles(BUYER_ITEM, ['buyer'])).toBe(true);
    });

    it('AND THE NAV DOES NOT DECIDE FROM THE TOKEN', async () => {
        /*
         *   The gate is only as good as what it reads. #878's objection was
         *   precisely that `session.user.roles` is a JWT claim with an 8-hour
         *   maxAge, so gating on it hides screens from a member approved five
         *   minutes ago. If this component ever goes back to deciding from the
         *   claim alone, the gates above become that defect.
         */
        const { readFileSync } = await import('fs');
        const src = readFileSync('src/components/layout/ModuleSidebar.tsx', 'utf8');

        expect(src).toContain('getMyLiveRoles');
        //   The claim is the INITIAL value, not the decider.
        expect(src).toContain('const roles = liveRoles ?? claimedRoles;');
    });

    it('AND THE MARKETPLACE NAV ACTUALLY CARRIES THE GATES', async () => {
        //   Running the predicate proves the rule; this proves the rule is
        //   APPLIED. The nav is a client module, so the source is read rather
        //   than imported — see nav-visibility's header for why.
        const { readFileSync } = await import('fs');
        const src = readFileSync('src/components/layout/ModuleSidebar.tsx', 'utf8');

        /*
         *   MY ORDERS AND MY QUOTES ARE BACK ON THIS LIST.
         *
         *   They were left off on #878's authority — it forbids gating a list of
         *   your own things on a claim that goes stale. That objection was about
         *   the MECHANISM, and the owner restated the rule after hearing it:
         *   "A buyer can only see the buyers features and the seller can only
         *   see sellers features."
         *
         *   So the mechanism was fixed instead: ModuleSidebar reads roles LIVE
         *   from the document now (getMyLiveRoles), not from the 8-hour token,
         *   and #878's hazard went with the claim it was about.
         */
        for (const entry of ['Shopping Cart', 'My Orders', 'My Quotes', 'Buyer Dashboard']) {
            const line = src.split('\n').find(l => l.includes(`"${entry}"`));
            //   The entry name is folded into the asserted value, so a failure
            //   names which screen is ungated rather than just "undefined".
            expect(`${entry}: ${line ?? 'MISSING FROM THE NAV'}`)
                .toContain('MARKETPLACE_BUYER_ROLES');
        }
    });
});
