/**
 * @jest-environment node
 */

/**
 *   "AND IF THEY APPLY AS BOTH THEN THEY SEE THE 2 DASHBOARDS?"
 *
 *   THE OWNER, in full: "Did you verify that a user who signs up as a seller
 *   only sees seller's dashboard and same applies to buyer and also if they
 *   apply as both then they see the 2 dashboards?"
 *
 *   Verified, and the answer was no on both halves.
 *
 *   ── HALF ONE: THE ROLE A `both` APPLICANT WAS GRANTED ──────────────────────
 *
 *   There are two approvers and #844 repaired one of them:
 *
 *       actions/admin/_marketplace.ts          arrayUnion("seller",
 *                                              "marketplace_buyer") on "both".
 *       api/admin/marketplace/approve-seller   roles: ["seller"]. Never read
 *                                              accountType at all.
 *
 *   And _marketplace.ts says, eight lines from #844's fix and about a different
 *   field, which of the two is live: "the admin sellers page calls the API
 *   route". So every approval an administrator has clicked went through the
 *   unrepaired half, and a `both` applicant came out holding the selling role
 *   alone — filed by the admin console (correctly, by its own #854 rule) under
 *   "Sellers Only".
 *
 *   ── HALF TWO: THE DASHBOARD WAS NOT IN THE NAVIGATION ──────────────────────
 *
 *   MARKETPLACE_NAV has "Seller Dashboard", gated. It has no buyer dashboard
 *   entry at all. /marketplace/buyer/dashboard was reachable only through the
 *   redirect at /marketplace/dashboard, which sends `accountType: "both"` to
 *   the SELLER side — so somebody who applied as both landed on one of their
 *   two dashboards with no link to the other, whatever their roles said.
 *
 *   ── AND THE SELLER GATE READ ONE SPELLING ──────────────────────────────────
 *
 *   `isSeller = roles.includes("seller")`, while `marketplace_seller` is a
 *   first-class UserRole that canonicalRoles does not fold into `seller`. #885
 *   found the same half-written pair behind four other doors. Nothing grants
 *   the newer spelling today, so this half is latent — asserted here anyway,
 *   because leaving one spelling out is how the other four happened.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    rolesGrantedOnSellerApproval,
    accountTypeOnSellerApproval,
} from '@/lib/marketplace-approval-roles';
import { navItemAllowedForRoles } from '@/lib/nav-visibility';
import { MARKETPLACE_BUYER_ROLES } from '@/lib/role-app-mapping';

const ROUTE = 'src/app/api/admin/marketplace/approve-seller/route.ts';
const ACTION = 'src/app/actions/admin/_marketplace.ts';
const SIDEBAR = 'src/components/layout/ModuleSidebar.tsx';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });

/** The MARKETPLACE_NAV array, as source. */
function marketplaceNav(): string {
    const src = code(SIDEBAR);
    const at = src.indexOf('const MARKETPLACE_NAV');
    expect(at).toBeGreaterThan(-1);
    return src.slice(at, src.indexOf('];', at));
}

/** One entry of that array, by its visible name. */
function navEntry(name: string): string {
    const nav = marketplaceNav();
    const at = nav.indexOf(`name: "${name}"`);
    expect({ entry: name, found: at > -1 }).toEqual({ entry: name, found: true });
    return nav.slice(nav.lastIndexOf('{', at), nav.indexOf('},', at) + 1);
}

describe('what an approval grants', () => {
    it('A `both` APPLICANT GETS BOTH ROLES', () => {
        expect(rolesGrantedOnSellerApproval('both').sort())
            .toEqual(['marketplace_buyer', 'seller']);
    });

    it('AND A PLAIN SELLER GETS ONE — the control', () => {
        //   Without this, `() => ["seller", "marketplace_buyer"]` passes the
        //   assertion above and hands every seller a buyer role they did not
        //   ask for.
        expect(rolesGrantedOnSellerApproval('seller')).toEqual(['seller']);
        expect(rolesGrantedOnSellerApproval(undefined)).toEqual(['seller']);
        expect(rolesGrantedOnSellerApproval('')).toEqual(['seller']);
    });

    it('AND THE VALUE IS READ AS STORED, not as typed', () => {
        //   The verification record is written by onboarding and edited by
        //   admins; " Both " is the same application as "both".
        expect(rolesGrantedOnSellerApproval(' Both ').sort())
            .toEqual(['marketplace_buyer', 'seller']);
        expect(accountTypeOnSellerApproval('BOTH')).toBe('both');
    });

    it('AND AN UNRECOGNISED accountType IS PRESERVED, not rewritten', () => {
        /*
         *   The first draft folded anything unknown to "seller" and the
         *   behaviour suite caught it — admin-marketplace-behaviour approves a
         *   record carrying "wholesale" and asserts the registration still says
         *   so. That test is right: serviceRegistrations records what somebody
         *   applied for, and /marketplace/dashboard already falls through to
         *   the roles for a value it does not know. A guess written into the
         *   database is worse than no match.
         */
        expect(accountTypeOnSellerApproval('wholesale')).toBe('wholesale');
        //   The default applies only when there is nothing stored.
        expect(accountTypeOnSellerApproval(null)).toBe('seller');
        expect(accountTypeOnSellerApproval('   ')).toBe('seller');
    });

    it('AND BOTH APPROVAL DOORS ASK THE SAME FUNCTION', () => {
        /*
         *   THE point of the module. Two doors decided this independently, they
         *   drifted, and the fix landed on the one nobody calls. A grep is the
         *   right assertion here: what matters is that neither file states the
         *   rule for itself.
         */
        for (const rel of [ROUTE, ACTION]) {
            const src = code(rel);
            expect({ file: rel, asks: src.includes('rolesGrantedOnSellerApproval') })
                .toEqual({ file: rel, asks: true });
            //   And neither hardcodes the grant beside it.
            expect(src).not.toMatch(/arrayUnion\("seller", *"marketplace_buyer"\)/);
            expect(src).not.toMatch(/roles: *\["seller"\]/);
        }
    });

    it('AND THE ROUTE RECORDS THE accountType IT APPROVED', () => {
        //   It wrote none, so /marketplace/dashboard's first read — the
        //   authoritative one, per its own comment — found nothing for every
        //   seller approved through the admin UI.
        expect(code(ROUTE)).toContain('serviceRegistrations.marketplace.accountType');
    });
});

describe('what each kind of account sees in the marketplace navigation', () => {
    const SELLER_DASHBOARD = { name: 'Seller Dashboard', sellerOnly: true };
    const BUYER_DASHBOARD = { name: 'Buyer Dashboard', rolesAny: MARKETPLACE_BUYER_ROLES };

    function dashboardsFor(roles: string[]) {
        return {
            seller: navItemAllowedForRoles(SELLER_DASHBOARD, roles),
            buyer: navItemAllowedForRoles(BUYER_DASHBOARD, roles),
        };
    }

    it('A SELLER-ONLY ACCOUNT SEES THE SELLER DASHBOARD AND NOT THE BUYER ONE', () => {
        expect(dashboardsFor(['seller'])).toEqual({ seller: true, buyer: false });
    });

    it('A BUYER-ONLY ACCOUNT SEES THE BUYER DASHBOARD AND NOT THE SELLER ONE', () => {
        expect(dashboardsFor(['marketplace_buyer'])).toEqual({ seller: false, buyer: true });
        expect(dashboardsFor(['buyer'])).toEqual({ seller: false, buyer: true });
    });

    it('AND AN ACCOUNT THAT APPLIED AS BOTH SEES BOTH', () => {
        //   The owner's question, end to end: the roles an approval grants,
        //   fed to the predicate the sidebar filters with.
        const granted = rolesGrantedOnSellerApproval('both');

        expect(dashboardsFor(granted)).toEqual({ seller: true, buyer: true });
    });

    it('AND BOTH ENTRIES ARE REALLY IN THE NAV, gated the way this test assumed', () => {
        /*
         *   THE vacuity guard. Every assertion above runs against literals
         *   declared in this file; if MARKETPLACE_NAV did not carry these two
         *   entries, or carried them ungated, all five would still pass and no
         *   dashboard would be reachable.
         */
        expect(navEntry('Seller Dashboard')).toContain('sellerOnly: true');

        const buyer = navEntry('Buyer Dashboard');
        expect(buyer).toContain('/marketplace/buyer/dashboard');
        expect(buyer).toContain('rolesAny: MARKETPLACE_BUYER_ROLES');
    });

    it('AND THE SELLER GATE ACCEPTS BOTH SPELLINGS OF THE SELLING ROLE', () => {
        //   #885's pair, on the door that still read one half of it.
        expect(navItemAllowedForRoles(SELLER_DASHBOARD, ['marketplace_seller'])).toBe(true);
        expect(navItemAllowedForRoles(SELLER_DASHBOARD, ['seller'])).toBe(true);
        //   And it is still a gate.
        expect(navItemAllowedForRoles(SELLER_DASHBOARD, ['investor'])).toBe(false);
    });
});
