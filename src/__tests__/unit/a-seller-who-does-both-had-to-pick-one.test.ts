/**
 * @jest-environment node
 */

/**
 *   A SELLER WHO DOES BOTH HAD TO PICK THE ONE THEY DID LESS OF.
 *
 *   THE OWNER: "select both wholesale and retail should be enabled during
 *   onboarding on marketplace."
 *
 *   The onboarding step drew two mutually exclusive buttons — clicking one
 *   replaced the other — over a field typed `"wholesale" | "retail"`. The
 *   ACCOUNT type directly above it has offered buyer / seller / BOTH all along.
 *   This is the same question one field down and it had no third answer.
 *
 * ── WHY A THIRD STRING WAS NOT ENOUGH ───────────────────────────────────────
 *
 *   `sellerCategory` is not a label. It is stamped onto every one of the
 *   seller's products, and it is QUERIED BY EQUALITY:
 *
 *       sms-broadcast.ts      q.where("sellerCategory", "==", "wholesale")
 *       in-app-broadcast.ts   q.where("sellerCategory", "==", "retail")
 *
 *   Allowing "both" and stopping there would have matched that seller in
 *   NEITHER audience — dropping them out of every wholesale broadcast AND
 *   every retail one at the same time, silently. _mp_seller_verification's own
 *   comment describes exactly this shape: "an unrecognised string removes the
 *   seller's whole catalogue from both the wholesale and the retail view at
 *   once — and nothing here would have refused it."
 *
 *   That is the mutant at the foot of this file, and it is the one worth
 *   having: it passes every "can a seller choose both" test and breaks the
 *   thing nobody would have looked at.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    SELLER_CATEGORIES,
    isSellerCategory,
    sellerCategoryMatches,
    sellerCategoryLabel,
    sellerCategoryFor,
    kindsOf,
} from '@/lib/seller-category';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
describe('a seller can say they do both', () => {
    it('"both" IS A STORED VALUE — the defect was that it was not', () => {
        expect([...SELLER_CATEGORIES]).toContain('both');
        expect(isSellerCategory('both')).toBe(true);
    });

    it('AND TWO TICKS BECOME IT', () => {
        expect(sellerCategoryFor(['wholesale', 'retail'])).toBe('both');
        expect(sellerCategoryFor(['retail', 'wholesale'])).toBe('both');
    });

    it('AND ONE TICK IS STILL ITSELF', () => {
        expect(sellerCategoryFor(['wholesale'])).toBe('wholesale');
        expect(sellerCategoryFor(['retail'])).toBe('retail');
    });

    it('and no tick is null, which is what the "must choose" guard tests', () => {
        expect(sellerCategoryFor([])).toBeNull();
    });

    it('and the round trip holds, so unticking one leaves the other', () => {
        expect([...kindsOf('both')].sort()).toEqual(['retail', 'wholesale']);
        expect([...kindsOf('wholesale')]).toEqual(['wholesale']);
        expect([...kindsOf(undefined)]).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and "both" reaches both audiences', () => {
    it('A BOTH SELLER MATCHES THE WHOLESALE AUDIENCE', () => {
        expect([...sellerCategoryMatches('wholesale')]).toContain('both');
        expect([...sellerCategoryMatches('wholesale')]).toContain('wholesale');
    });

    it('AND THE RETAIL AUDIENCE', () => {
        expect([...sellerCategoryMatches('retail')]).toContain('both');
        expect([...sellerCategoryMatches('retail')]).toContain('retail');
    });

    it('AND THE BROADCASTS QUERY BY MEMBERSHIP, NOT EQUALITY — the trap', () => {
        //   The assertion that catches "allow the value and stop". An `==`
        //   query against a three-value field drops the third value from every
        //   list, and nothing would have reported it.
        for (const rel of ['src/app/actions/sms-broadcast.ts', 'src/app/actions/in-app-broadcast.ts']) {
            const src = code(rel);

            expect({ rel, equality: src.includes('where("sellerCategory", "==", "wholesale")') })
                .toEqual({ rel, equality: false });
            expect({ rel, equality: src.includes('where("sellerCategory", "==", "retail")') })
                .toEqual({ rel, equality: false });
            expect({ rel, shared: src.includes('sellerCategoryMatches(') })
                .toEqual({ rel, shared: true });
        }
    });

    it('and the wholesale audience does not silently become everyone', () => {
        //   The opposite failure: dropping the filter entirely would also make
        //   "both" sellers appear, and would send every wholesale broadcast to
        //   retail-only sellers too.
        expect([...sellerCategoryMatches('wholesale')]).not.toContain('retail');
        expect([...sellerCategoryMatches('retail')]).not.toContain('wholesale');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and every screen that names it can name all three', () => {
    it('THE LABEL HAS THREE ANSWERS', () => {
        expect(sellerCategoryLabel('wholesale')).toBe('Wholesale');
        expect(sellerCategoryLabel('retail')).toBe('Retail');
        expect(sellerCategoryLabel('both')).toBe('Wholesale & Retail');
    });

    it('AND THE ADMIN LIST USES IT rather than a two-way ternary', () => {
        //   It read `category === "wholesale" ? "Wholesale" : "Retail"`, which
        //   is a two-answer question asked of a three-answer field — a "both"
        //   seller would have been labelled Retail.
        const src = code('src/app/admin/marketplace/sellers/page.tsx');

        expect(src).toContain('sellerCategoryLabel(');
        expect(src).not.toContain('=== "wholesale" ? "Wholesale" : "Retail"');
    });

    it('and an unknown value names nothing rather than guessing', () => {
        expect(sellerCategoryLabel(undefined)).toBe('');
        expect(sellerCategoryLabel('nonsense')).toBe('');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and the guards that must not move', () => {
    it('POSITIVE CONTROL: THE SERVER STILL REFUSES AN UNKNOWN CATEGORY', () => {
        //   The check the shared vocabulary feeds. Widening the type must not
        //   have widened this to anything.
        const src = code('src/app/actions/marketplace/_mp_seller_verification.ts');

        expect(src).toContain('SELLER_CATEGORIES');
        expect(src).toContain('Invalid seller category');
        expect(isSellerCategory('anything-else')).toBe(false);
        expect(isSellerCategory('')).toBe(false);
        expect(isSellerCategory(null)).toBe(false);
    });

    it('POSITIVE CONTROL: the two original values still work', () => {
        //   A change that made everything "both" would satisfy most of the
        //   above and destroy the distinction the field exists for.
        expect(isSellerCategory('wholesale')).toBe(true);
        expect(isSellerCategory('retail')).toBe(true);
        expect(sellerCategoryFor(['wholesale'])).not.toBe('both');
    });

    it('POSITIVE CONTROL: the onboarding step still requires a choice', () => {
        const src = code('src/app/marketplace/onboarding/steps/AccountTypeStep.tsx');

        expect(src).toContain('!sellerCategory');
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   drop "both" from SELLER_CATEGORIES —         4  '"both" IS A STORED VALUE'
 *   the defect
 *
 *   allow "both" but leave the broadcasts on     1  "AND THE BROADCASTS QUERY
 *   `==` (the fix that looks complete and           BY MEMBERSHIP, NOT
 *   silently empties both audiences)                EQUALITY"
 *
 *   sellerCategoryMatches returns [kind] only    3  "A BOTH SELLER MATCHES THE
 *                                                   WHOLESALE AUDIENCE"
 *
 *   it returns all three for either kind         1  "and the wholesale audience
 *   (over-wide: every broadcast to everyone)        does not silently become
 *                                                   everyone"
 *
 *   sellerCategoryFor returns "both" always      2  "AND ONE TICK IS STILL
 *                                                   ITSELF"
 *
 *   the admin ternary is restored                1  "AND THE ADMIN LIST USES
 *                                                   IT"
 *
 *   isSellerCategory returns true for anything   1  "POSITIVE CONTROL: THE
 *                                                   SERVER STILL REFUSES"
 *
 *   CONTROL — SHOULD SURVIVE
 *   reword the module header                     0  SURVIVED ✓
 */
