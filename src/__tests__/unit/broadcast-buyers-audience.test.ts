/**
 * @jest-environment node
 */

/**
 * The "buyers" audience reached nobody on two of the three channels.
 *
 * THE BUG
 * -------
 * sms-broadcast.ts and in-app-broadcast.ts both selected buyers like this:
 *
 *     .where("marketplaceAccountType", "in", ["buyer", "both"])
 *
 * `marketplaceAccountType` is a top-level user field that NOTHING IN THIS
 * CODEBASE WRITES. Every reference to it is a read — two queries, three
 * `select()` lists, and three defensive `||` fallbacks. A `.where` on a field no
 * writer supplies always returns empty, so the loop over the result ran zero
 * times and the broadcast went to nobody.
 *
 * It failed the way this class always fails: no error, no exception, a
 * recipient count of zero that reads as "nobody is in this audience".
 *
 * HOW IT SURVIVED ON THE THIRD CHANNEL
 * ------------------------------------
 * The email path in broadcast-logic.ts asks the same question in memory:
 *
 *     data.marketplaceAccountType === "buyer"
 *       || data.marketplaceAccountType === "both"
 *       || (data.roles && data.roles.includes("buyer"))
 *
 * The third clause is doing all the work, and always has been. That clause is
 * the real definition of a buyer here, so it moved to
 * @/lib/broadcast-audience and all three channels read it now — which is also
 * what stops them drifting apart again.
 *
 * FOUND BY
 * --------
 * A sweep for `.where("field", ...)` on fields that never appear as a written
 * key. 96 distinct queried fields; 6 never written; 4 of those explained
 * (`__name__` is the document-id sentinel, `resolvedUserId` is a deliberate
 * legacy read documented in collection-field-drift.test.ts, and two more had
 * writers under different spellings). This was the one that was simply wrong.
 *
 * NOT SETTLED HERE
 * ----------------
 * Where a buyer's account type is actually recorded.
 * `serviceRegistrations.marketplace.accountType` is what approve-seller and
 * admin.ts write, and no channel reads it. Adding it changes who receives a
 * broadcast — whether someone who registered as a buyer but holds no buyer role
 * should be messaged — which is a product decision.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isMarketplaceBuyer } from '@/lib/broadcast-audience';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function codeOnly(src: string): string {
    return src
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

const SMS = 'src/app/actions/sms-broadcast.ts';
const IN_APP = 'src/app/actions/in-app-broadcast.ts';
const EMAIL = 'src/lib/broadcast-logic.ts';

describe('no channel queries the field nothing writes', () => {
    it.each([SMS, IN_APP])('%s does not filter on marketplaceAccountType', (file) => {
        // THE test. This exact query returned empty on every run.
        expect(codeOnly(source(file))).not.toContain('.where("marketplaceAccountType"');
    });

    it('and nothing anywhere writes that field, which is why', () => {
        // Vacuity guard for the whole premise: if something started writing it,
        // the original query would have been fine and this fix pointless.
        for (const file of [SMS, IN_APP, EMAIL, 'src/app/actions/admin/_users.ts']) {
            const code = codeOnly(source(file));
            // A write looks like `marketplaceAccountType: value`, not a read.
            expect(`${file}: ${/^\s*marketplaceAccountType\s*:/m.test(code)}`).toBe(`${file}: false`);
        }
    });
});

describe('all three channels share one definition', () => {
    it.each([SMS, IN_APP, EMAIL])('%s uses isMarketplaceBuyer', (file) => {
        expect(source(file)).toContain('isMarketplaceBuyer');
    });

    it('the email path no longer spells the rule out itself', () => {
        // It was the only correct one, and its correctness was accidental —
        // carried entirely by the roles clause.
        expect(codeOnly(source(EMAIL))).not.toContain('data.marketplaceAccountType === "buyer"');
    });
});

describe('the definition itself', () => {
    it('a buyer role is a buyer', () => {
        // THE clause that was doing all the work in the one path that worked.
        expect(isMarketplaceBuyer({ roles: ['buyer'] })).toBe(true);
        expect(isMarketplaceBuyer({ roles: ['general_user', 'buyer'] })).toBe(true);
    });

    it('and so is the account type, if anything ever writes it', () => {
        expect(isMarketplaceBuyer({ marketplaceAccountType: 'buyer' })).toBe(true);
        expect(isMarketplaceBuyer({ marketplaceAccountType: 'both' })).toBe(true);
    });

    it('a seller is not, and neither is nobody', () => {
        // Vacuity guard: a predicate that returns true for everyone would pass
        // every assertion above and send every broadcast to the whole platform.
        expect(isMarketplaceBuyer({ roles: ['seller'] })).toBe(false);
        expect(isMarketplaceBuyer({ marketplaceAccountType: 'seller' })).toBe(false);
        expect(isMarketplaceBuyer({ roles: [] })).toBe(false);
        expect(isMarketplaceBuyer({})).toBe(false);
        expect(isMarketplaceBuyer(null)).toBe(false);
        expect(isMarketplaceBuyer(undefined)).toBe(false);
    });

    it('malformed roles do not throw', () => {
        expect(isMarketplaceBuyer({ roles: null })).toBe(false);
        expect(isMarketplaceBuyer({ roles: 'buyer' as unknown as string[] })).toBe(false);
    });
});

describe('the query that replaced it can actually match', () => {
    it.each([SMS, IN_APP])('%s asks the database for the buyer role', (file) => {
        // The predicate is applied in memory, but the query has to return rows
        // for it to filter. array-contains on roles is what the adapter supports
        // and what #190 used for the same job.
        expect(source(file)).toContain('.where("roles", "array-contains", "buyer")');
    });

    it('and selects the fields the predicate reads', () => {
        // A select() that omitted `roles` would hand isMarketplaceBuyer an
        // object with no roles and reach nobody again, by a different route.
        for (const file of [SMS, IN_APP]) {
            const buyers = source(file).slice(source(file).indexOf('case "buyers"'));
            const select = buyers.slice(buyers.indexOf('.select('), buyers.indexOf('.get()'));
            expect(`${file}: ${select.includes('"roles"')}`).toBe(`${file}: true`);
            expect(`${file}: ${select.includes('"marketplaceAccountType"')}`).toBe(`${file}: true`);
        }
    });
});
