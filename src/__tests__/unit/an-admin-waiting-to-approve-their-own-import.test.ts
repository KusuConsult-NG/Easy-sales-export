/**
 * @jest-environment node
 */

/**
 * An admin waiting to approve a member they created themselves.
 *
 *   THE OWNER: "Legacy members don't need to be approved since they are added
 *   by admin."
 *
 *   The legacy import writes an application row per module. Four of the five
 *   said `status: "approved"` outright — academy, export, wave, farm nation —
 *   and so did the USERS document it writes alongside them:
 *
 *       serviceRegistrations.marketplace = { status: "approved", … }
 *
 *   The marketplace VERIFICATION row asked a question instead:
 *
 *       const sellerStatus = data.roles.includes("seller")
 *           ? "approved" : "pending";
 *
 *   So one import produced two records with opposite answers, and the
 *   disagreement was not cosmetic: checkModuleAccess and _mp_onboarding both
 *   read the verification row, so the admin was shown an application waiting
 *   for their approval — of a member they had themselves created.
 *
 *   AND THE accountType NOW TRAVELS WITH THE ROW. checkModuleAccess grants
 *   marketplace roles from it and falls back to "seller" when the field is
 *   absent, deliberately, so rows predating the field are not demoted. These
 *   rows are written here and can carry it — without which a legacy marketplace
 *   BUYER would be handed selling rights by that fallback, which is the defect
 *   fixed in #256 arriving through a different door.
 *
 * WHAT THIS RUNS.
 *
 *   The import itself is a long transaction over five collections. The rules
 *   that were WRONG are two pure derivations — what status an admin-created row
 *   lands on, and what accountType a set of legacy roles means — so those are
 *   stated here against the source of the writer, and the sibling modules are
 *   compared to it so the next module added cannot quietly disagree again.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';

const SRC = readFileSync('src/app/actions/admin/_legacy.ts', 'utf8');

describe('an admin waiting to approve their own import', () => {
    it('THE MARKETPLACE VERIFICATION ROW NO LONGER ASKS', () => {
        //   The exact expression that made an admin-created member pending.
        expect(SRC).not.toMatch(/data\.roles\.includes\("seller"\)\s*\?\s*"approved"\s*:\s*"pending"/);
        expect(SRC).toContain('const sellerStatus = "approved";');
    });

    it('NO LEGACY APPLICATION ROW IS WRITTEN pending', () => {
        /*
         *   Scoped to the `legacy_` writes, not the whole file. This module also
         *   creates an INVITE, and an invite genuinely is pending — nobody has
         *   accepted it yet. A file-wide sweep flagged that and was wrong to;
         *   the rule is about rows an admin's import decides, not every row.
         */
        const lines = SRC.split('\n');
        const offenders: string[] = [];

        lines.forEach((line, i) => {
            if (!line.includes('`legacy_${userRecord.uid}`')) return;
            //   The document literal follows its .doc() call; 40 lines covers
            //   the longest of the five without reaching the next.
            const block = lines.slice(i, i + 40);
            block.forEach((bodyLine, j) => {
                if (/status:\s*["']pending["']/.test(bodyLine)) {
                    offenders.push(`line ${i + j + 1}: ${bodyLine.trim()}`);
                }
            });
        });

        expect(offenders).toEqual([]);
    });

    it('THE FIVE MODULES AGREE — four already did, and the fifth now does', () => {
        //   The sibling rows, named so a reader can see the symmetry that was
        //   broken rather than take it on trust.
        for (const collection of [
            'ACADEMY_APPLICATIONS',
            'EXPORT_APPLICATIONS',
            'WAVE_APPLICATIONS',
            'FARM_NATION_APPLICATIONS',
            'SELLER_VERIFICATIONS',
        ]) {
            expect(SRC).toContain(`COLLECTIONS.${collection}).doc(\`legacy_\${userRecord.uid}\`)`);
        }
    });

    it('THE accountType IS DERIVED ONCE AND USED BY BOTH WRITES', () => {
        //   It used to be a `let` inside the marketplace branch, invisible to the
        //   verification row three hundred lines below — which is why that row
        //   carried no accountType at all.
        expect(SRC).toContain('const marketplaceAccountType =');
        expect(SRC).toContain('accountType: marketplaceAccountType,');

        //   Both writes, not one.
        const uses = SRC.split('accountType: marketplaceAccountType,').length - 1;
        expect(uses).toBe(2);
    });

    it('AND THE DERIVATION ITSELF IS RIGHT — buyer, seller and both', () => {
        //   Re-stated as the rule the source encodes, and run, so "both" cannot
        //   silently collapse to one of its halves.
        const accountTypeFor = (roles: string[]): string =>
            roles.includes('seller')
                ? (roles.includes('marketplace_buyer') ? 'both' : 'seller')
                : 'buyer';

        expect(accountTypeFor(['seller'])).toBe('seller');
        expect(accountTypeFor(['marketplace_buyer'])).toBe('buyer');
        expect(accountTypeFor(['seller', 'marketplace_buyer'])).toBe('both');
        expect(accountTypeFor([])).toBe('buyer');

        //   The source says the same thing.
        expect(SRC).toContain('data.roles.includes("seller")\n            ? (data.roles.includes("marketplace_buyer") ? "both" : "seller")\n            : "buyer"');
    });
});
