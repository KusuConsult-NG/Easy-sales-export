/**
 * @jest-environment node
 */

/**
 *   #854 A COLUMN THAT ANSWERED A DIFFERENT QUESTION FROM ITS NAME — FOR SOME
 *   ROWS AND NOT OTHERS — AND TWO MORE THINGS ON THE SAME SCREEN.
 *
 *   Marketplace pass 1 of docs/module-audit-checklist.md, items A2.1, A2.5 and
 *   A3.1, on /admin/marketplace/buyers.
 *
 * ── 1. A3.1 · THE ROLE COLUMN WAS HALF INTENT ───────────────────────────────
 *
 *   `_getMarketplaceUsersAction` built its `buyerRole` field like this:
 *
 *       if (dbAccountType === "seller")      buyerRole = "seller_only";
 *       else if (dbAccountType === "both")   buyerRole = "both";
 *       else if (hasSellerRole && hasBuyerRole) …
 *
 *   `accountType` is what somebody SIGNED UP AS; the roles are what she can DO.
 *   #844 measured the distance between them: of 91 accounts with
 *   `accountType: "both"`, NINETY held neither marketplace role, and 45 of 48
 *   plain sellers held no seller role — correctly, because that role waits for
 *   verification.
 *
 *   So the column reported intent for the rows that declare one and capability
 *   for the rest. In production at most 183 of the listed accounts carry an
 *   `accountType` at all, against 35,758 marketplace registrations that do not,
 *   so the great majority were classified one way and a minority the other, in
 *   one column, under one heading.
 *
 *   Resolved towards CAPABILITY, because every name on the path says so: the
 *   parameter is `roleFilter`, the field is `buyerRole`, the tiles read "Buyers
 *   Only" and "Sellers Only", and the query admits only holders of one of the
 *   four marketplace ROLES.
 *
 * ── 2. A2.5 · "Total Users" COUNTED MARKETPLACE ROLE-HOLDERS ────────────────
 *
 *   At most 1,623 accounts, against 41,797 on the platform. The number was
 *   right and the sentence over it understated the platform by 96%.
 *
 * ── 3. A2.1 · AND THE PARTIAL-COHORT FLAG WAS COMPUTED AND NEVER READ ───────
 *
 *   The action sweeps with `.all()` because its totals are an aggregate over
 *   the result, sets `stats.truncated` under the comment "So a caller can tell
 *   a complete total from a capped one", and logs at ERROR that "the totals
 *   below are incomplete". The page read none of it.
 *
 *   #838 made this exact correction on the cooperative members screen, and its
 *   note records the cooperative DASHBOARD having had it first — "the same
 *   field existed there and NOTHING READ IT until somebody wired it up". This
 *   is the third place that sentence is true of, which is why the sweep at the
 *   foot of this file is by shape rather than by screen.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });

const ACTION = 'src/app/actions/admin/_marketplace.ts';
const PAGE = 'src/app/admin/marketplace/buyers/page.tsx';

/** The block that decides `buyerRole`, anchored on its declaration. */
const roleBlock = (): string => {
    const src = code(ACTION);
    const at = src.indexOf('let buyerRole = "buyer_only";');
    expect(at).toBeGreaterThan(-1);
    return src.slice(at, at + 500);
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#854 — the role column reports what the account can do', () => {
    it('THE REPORTED CASE: accountType no longer decides the role column', () => {
        /*
         *   Asserted on the BLOCK rather than the file, because `accountType` is
         *   still read elsewhere in this module and must be — the seller
         *   approval in _marketplace grants roles from it (#844), and removing
         *   that would undo the fix that made "both" mean both.
         */
        expect(roleBlock()).not.toContain('dbAccountType');
        expect(roleBlock()).not.toContain('accountType');
    });

    it('AND THE THREE OUTCOMES COME FROM THE ROLES', () => {
        const block = roleBlock();

        expect(block).toContain('hasSellerRole && hasBuyerRole');
        expect(block).toContain('hasSellerRole');
    });

    it('AND accountType IS STILL READ WHERE IT DECIDES ROLES — #844 must not regress', () => {
        /*
         *   The half that must not be lost. #844's fix grants
         *   `arrayUnion("seller", "marketplace_buyer")` on approval when the
         *   VERIFICATION record says "both". A sweep that deleted every mention
         *   of accountType from this file would satisfy the case above and undo
         *   the finding that made a "both" applicant able to do both.
         */
        const src = code(ACTION);

        expect(src).toContain('verificationData.accountType === "both"');
        expect(src).toContain('arrayUnion("seller", "marketplace_buyer")');
    });

    it('AND THE FILTER STILL TREATS "both" AS BOTH', () => {
        //   `roleFilter=seller_only` must include the traders who also buy, or
        //   the seller list silently drops everyone with two capabilities.
        const src = code(ACTION);
        const at = src.indexOf('options.roleFilter === "seller_only"');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 200)).toContain('"both"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#854 — and the screen says what it counted', () => {
    it('THE TILE IS NOT LABELLED "Total Users"', () => {
        /*
         *   A2.5: "'Total' invites the reading 'the whole programme'. If it
         *   counts one table's rows, name it for that." The query behind this
         *   tile admits only holders of a marketplace role.
         */
        const src = code(PAGE);

        expect(src).not.toContain('"Total Users"');
        expect(src).toContain('"Marketplace Accounts"');
    });

    it('AND THE PARTIAL-COHORT BANNER IS RENDERED FROM THE FLAG THE ACTION SETS', () => {
        const src = code(PAGE);

        expect(src).toContain('stats?.truncated');
        expect(src).toContain('These figures are partial.');
    });

    it('AND THE FLAG IS STILL SET, so the banner is not wired to nothing', () => {
        /*
         *   The half that makes the banner real. A screen reading a field the
         *   action stopped writing is this audit's most common false positive —
         *   a fix that reads a field nobody writes.
         */
        const src = code(ACTION);
        const at = src.indexOf('const stats = {');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 400)).toContain('truncated: usersTruncated');
    });

    it('AND THE FIGURES ARE NOT BLANKED WHEN PARTIAL, only qualified', () => {
        /*
         *   #838's choice, kept: a floor is useful to an administrator, and
         *   this is a people list rather than a compliance report. What changes
         *   is that a floor cannot be mistaken for a total. A banner that also
         *   hid the numbers would be a different, worse screen.
         */
        const src = code(PAGE);

        expect(src).toContain('statText(stats?.total');
        expect(src).toContain('statText(stats?.buyerOnly');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#854 — the partial-cohort flag is read wherever it is set', () => {
    /**
     *   BY SHAPE, NOT BY SCREEN. #838 fixed the cooperative members page and its
     *   note records the cooperative dashboard having had the same correction
     *   before it; this finding is the third. Three occurrences of one shape is
     *   the point at which enumerating screens stops being a strategy.
     *
     *   The rule: an action that returns a truncation flag has a screen that
     *   reads it. Checked from the ACTION side, because that is where the flag
     *   is produced and where a new one will appear.
     */
    const PAIRS: Array<{ action: string; page: string; field: string }> = [
        {
            action: 'src/app/actions/admin/_marketplace.ts',
            page: 'src/app/admin/marketplace/buyers/page.tsx',
            field: 'truncated',
        },
        {
            action: 'src/app/actions/cooperative/_coop_admin_members.ts',
            page: 'src/app/admin/cooperatives/members/page.tsx',
            field: 'truncated',
        },
    ];

    it('EVERY ACTION THAT REPORTS TRUNCATION HAS A SCREEN THAT SHOWS IT', () => {
        const missing = PAIRS.filter(({ action, page, field }) => {
            const producesIt = code(action).includes(`${field}:`)
                || code(action).includes(`${field},`);
            const readsIt = code(page).includes(field);
            return producesIt && !readsIt;
        });

        expect(missing).toEqual([]);
    });

    it('AND THE PAIRS ARE REAL — the vacuity guard', () => {
        /*
         *   The case above passes trivially if an action stopped producing the
         *   flag, which would be the regression rather than the fix. Both sides
         *   are asserted to exist.
         */
        for (const { action, page, field } of PAIRS) {
            expect({ action, produces: code(action).includes(field) })
                .toEqual({ action, produces: true });
            expect({ page, reads: code(page).includes(field) })
                .toEqual({ page, reads: true });
        }
    });
});
