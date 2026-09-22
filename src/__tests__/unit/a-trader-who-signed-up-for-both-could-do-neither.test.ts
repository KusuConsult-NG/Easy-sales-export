/**
 * @jest-environment node
 */

/**
 *   #844 NINETY-ONE PEOPLE SIGNED UP AS "BOTH" AND NOT ONE OF THEM COULD DO
 *   BOTH.
 *
 *   Measured in production, every account with `accountType: "both"`:
 *
 *       90   NEITHER role — no marketplace capability at all
 *        1   can only SELL — buyer role missing
 *        0   can actually do both
 *
 *   The form offers "buyer", "seller" or "both". _mp_onboarding branches on
 *
 *       const isBuyerOnly = accountType === "buyer";
 *
 *   so "both" falls into the SELLER path, which grants no role at all until an
 *   admin approves the verification — and the approval in
 *   actions/admin/_marketplace granted exactly `arrayUnion("seller")`.
 *   `marketplace_buyer` was never granted to a "both" account on ANY path.
 *
 *   So what somebody signed up as and what she can do disagreed, and the admin
 *   members screen reported the INTENT — it reads `accountType` before roles —
 *   rather than the capability. The screen said "both"; the account could do
 *   neither.
 *
 * ── WHY THE BUYER ROLE IS GRANTED AT SIGNUP AND THE SELLER ROLE IS NOT ──────
 *
 *   The buyer-only branch already grants `marketplace_buyer` and marks the
 *   registration `active` immediately, because nothing needs checking before
 *   somebody is allowed to BUY. A "both" applicant is a buyer on exactly those
 *   terms; only her seller half needs review. Making her wait for seller
 *   verification before she can buy withholds a capability that was never gated
 *   on it.
 *
 *   `status` stays "pending" deliberately — it describes the SELLER application
 *   under review, and marketplace/seller/layout.tsx reads it to decide whether
 *   to admit her to the seller area. Widening it would let an unverified seller
 *   list products, which is a far worse defect than the one being fixed.
 *
 * ── AND ONE CLAIM OF MINE THAT THE DATA KILLED ──────────────────────────────
 *
 *   I had called `module-access-check` omitting `marketplace_seller` "a
 *   separate, worse bug". The breakdown shows that spelling has ZERO accounts:
 *   buyer 3, marketplace_buyer 598, seller 1022, marketplace_seller absent. The
 *   omission is harmless, and the worry existed only because it was reasoned
 *   from a list rather than measured. Recorded so nobody re-raises it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const ONBOARDING = 'src/app/actions/marketplace/_mp_onboarding.ts';
const APPROVAL = 'src/app/actions/admin/_marketplace.ts';

describe('#844 — a "both" applicant can buy immediately', () => {
    /**
     *   ANCHORED ON `if (accountType === "both") {`, NOT ON THE BARE COMPARISON.
     *
     *   The first version of these two cases sliced from
     *   `indexOf('accountType === "both"')` and failed against correct code: the
     *   FIRST occurrence in this file is line 258,
     *
     *       const isSeller = accountType === "seller" || accountType === "both";
     *
     *   two hundred and seventy lines above the grant. That is this audit's most
     *   repeated test defect — an assertion satisfied, or in this case defeated,
     *   by the wrong occurrence — and it is worth the comment because I know
     *   that trap by name and walked into it anyway.
     */
    const grantBlock = (src: string): string => {
        const at = src.indexOf('if (accountType === "both") {');
        expect(at).toBeGreaterThan(-1);
        return src.slice(at, at + 400);
    };

    it('THE SIGNUP GRANTS marketplace_buyer FOR "both"', () => {
        expect(grantBlock(code(ONBOARDING))).toContain('marketplace_buyer');
    });

    it('AND THE GRANT IS INSIDE THE GUARD, not beside it', () => {
        /*
         *   The guard is the point. Granting the buyer role to every non-buyer
         *   applicant would hand it to plain sellers too, which is a different
         *   defect and one nobody asked for. Proved by taking the guarded block
         *   and checking the grant is within it.
         */
        const block = grantBlock(code(ONBOARDING));
        const closes = block.indexOf('}', block.indexOf('marketplace_buyer'));

        expect(closes).toBeGreaterThan(-1);
        expect(block.slice(0, closes)).toContain('existingRoles');
    });

    it('AND THE SELLER ROLE STILL WAITS FOR VERIFICATION', () => {
        /*
         *   The half that must not regress. An unverified seller listing
         *   products is worse than the defect being fixed, so signup grants the
         *   BUYER role only and the registration status stays "pending".
         */
        const src = code(ONBOARDING);
        const at = src.indexOf('if (accountType === "both") {');
        const branch = src.slice(at, at + 400);

        expect(branch).not.toContain('arrayUnion("seller")');
        expect(branch).not.toMatch(/roles.*"seller"/);
    });
});

describe('#844 — and gets both roles when the admin approves', () => {
    it('APPROVAL GRANTS BOTH ROLES FOR A "both" APPLICANT', () => {
        /*
         *   #908 RUN, NOT READ. This asserted the two source substrings of the
         *   ternary this finding added. The ternary is gone — the rule moved to
         *   lib/marketplace-approval-roles so that BOTH approval doors could
         *   ask it, which is the repair #908 is about: this fix landed here and
         *   the API route the admin UI actually calls kept granting "seller"
         *   alone.
         *
         *   A source assertion could not have caught that. It pinned the
         *   spelling in one file and said nothing about the other.
         */
        const { rolesGrantedOnSellerApproval } = require('@/lib/marketplace-approval-roles');

        expect(rolesGrantedOnSellerApproval('both').sort())
            .toEqual(['marketplace_buyer', 'seller']);
    });

    it('AND STILL GRANTS ONLY seller TO A PLAIN SELLER', () => {
        //   The other arm — a seller-only approval must not quietly start
        //   handing out buyer roles.
        const { rolesGrantedOnSellerApproval } = require('@/lib/marketplace-approval-roles');

        expect(rolesGrantedOnSellerApproval('seller')).toEqual(['seller']);
        expect(rolesGrantedOnSellerApproval(undefined)).toEqual(['seller']);
    });

    it('AND THIS DOOR ASKS THAT RULE RATHER THAN RESTATING IT', () => {
        //   #908 The half that made the original fix ineffective. Both
        //   approvers must reach the same function; one_dashboard_each covers
        //   the route, this covers the action it was written for.
        const src = code(APPROVAL);

        expect(src).toContain('rolesGrantedOnSellerApproval');
        expect(src).not.toMatch(/arrayUnion\("seller", *"marketplace_buyer"\)/);
    });

    it('AND THE FIELD IT BRANCHES ON IS ONE THE RECORD ACTUALLY CARRIES', () => {
        /*
         *   The check that makes the fix real rather than decorative. If the
         *   verification document had no `accountType`, the ternary above would
         *   always take the seller-only arm and nothing would change — a fix
         *   that reads a field nobody writes is this audit's most common
         *   false positive.
         *
         *   _mp_onboarding writes it onto the verification record at submission.
         */
        const src = code(ONBOARDING);
        const record = src.slice(src.indexOf('const verificationData = {'));
        expect(record.slice(0, 900)).toContain('accountType');
    });
});
