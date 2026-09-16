/**
 * @jest-environment node
 */

/**
 *   #803 A PLOT OF LAND COULD BE LISTED AT A NEGATIVE PRICE. #794, IN FARM NATION.
 *
 *   Four doors write a land listing's price. ONE bounded it:
 *
 *     listPropertyAction        farmNationListingSchema —
 *                               `price: z.number().positive()`
 *                               `size:  z.number().positive()`            ✓
 *     submitLandListingAction   a session check, an access check, then
 *                               `price: data.price` written straight through ✗
 *     createLandListingAction   the same, for drafts                        ✗
 *     /api/farm-nation/create-listing
 *                               `!pricePerUnit || !totalPrice`              ✗
 *
 *   `!value` is falsy for exactly 0 and NaN. It ACCEPTS -5000000, and it
 *   accepts Infinity — parseCurrencyStringToFloat is parseFloat underneath, so
 *   "1e400" parses to Infinity and JSON.stringify later writes that as null.
 *
 *   THE LIVE ONE IS submitLandListingAction. /farm-nation/list-land uploads its
 *   files and calls it. A server action is callable directly, so whatever the
 *   form checks in the browser is not a guard.
 *
 * ── WHAT IT REACHES ─────────────────────────────────────────────────────────
 *
 *   initiatePropertyPurchaseAction reads the stored price as BOTH figures:
 *
 *       propertyPrice: propData.price,
 *       escrowAmount:  propData.price,
 *
 *   so the number written here becomes a purchase request and an escrow row.
 *
 *   STATED ACCURATELY, because this audit has over-claimed severity twice: I
 *   have NOT traced a path from here to money leaving the platform, and I am
 *   not claiming one. What is certain is that a listing can be created that
 *   nobody can correctly buy, and that the one door which does validate treats
 *   these exact bounds as worth having.
 *
 * ── THE RETIRED DOOR IS FIXED TOO, AND THAT IS NOT OVER-REACH ───────────────
 *
 *   /api/farm-nation/create-listing answers 410 unless
 *   LEGACY_LAND_LISTING_API=enabled, so its gap is LATENT rather than live.
 *   Its own header states the policy this follows: "the placeholder writes are
 *   corrected below regardless, so reviving it does not revive the defect."
 *   The same now goes for its numbers.
 *
 * ── ONE GUARD, IMPORTED ─────────────────────────────────────────────────────
 *
 *   checkProductPricing is #794's, extracted then precisely because this
 *   codebase's creators keep writing a bound on one door and not its sibling.
 *   It has now been found missing from a door in TWO separate modules, which is
 *   the argument for the module rather than against it.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the guard removed from submitLandListingAction (the live defect)  KILLED
 *     the guard removed from createLandListingAction                    KILLED
 *     `value < 0` relaxed to truthiness inside the guard                KILLED
 *     size dropped from the submit door's checks                        KILLED
 *     the guard placed AFTER the write instead of before                KILLED
 *     reword this header                                    SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { checkProductPricing } from '@/lib/product-pricing-guard';

const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), 'utf8'));

const LAND = 'src/app/actions/land-listings.ts';
const ROUTE = 'src/app/api/farm-nation/create-listing/route.ts';

/** The body of one action, bounded to it. */
function actionBody(src: string, name: string): string {
    const from = src.indexOf(`async function ${name}(`);
    expect(from).toBeGreaterThan(-1);
    //   Bounded to the NEXT action, not to end of file — #741's trap is an
    //   assertion satisfied by the wrong occurrence, and this audit has met it
    //   ten times, every one of them a slice that ran too far.
    const next = src.indexOf('\nasync function _', from + 10);
    return src.slice(from, next > -1 ? next : src.length);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#803 — the guard itself, executed', () => {
    it('REFUSES A NEGATIVE PRICE, which truthiness admits', () => {
        //   The whole finding in one case: `!(-5000000)` is false, so the old
        //   check let this through.
        const verdict = checkProductPricing([{ label: 'price', value: -5_000_000 }]);
        expect(verdict.ok).toBe(false);
        expect(verdict.message).toMatch(/cannot be negative/i);
    });

    it('REFUSES Infinity, which truthiness also admits', () => {
        //   "1e400" through parseFloat. Truthy, and JSON.stringify writes it
        //   as null, so the amount goes missing rather than looking wrong.
        const verdict = checkProductPricing([{ label: 'price', value: Infinity }]);
        expect(verdict.ok).toBe(false);
    });

    it('REFUSES zero, and says something a seller can act on', () => {
        const verdict = checkProductPricing([{ label: 'price', value: 0 }]);
        expect(verdict.ok).toBe(false);
        expect(verdict.message).toMatch(/greater than zero/i);
    });

    it('CONTROL: a real land price is accepted', () => {
        //   Or the fix would be "no land can be listed", which is worse than
        //   the defect.
        const verdict = checkProductPricing([
            { label: 'price', value: 4_500_000 },
            { label: 'size', value: 2.5 },
        ]);
        expect(verdict).toEqual({ ok: true, message: '' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#803 — and every door that writes a price asks it', () => {
    const DOORS: ReadonlyArray<{ name: string; file: string; fn?: string }> = [
        { name: 'submitLandListingAction (LIVE)', file: LAND, fn: '_submitLandListingAction' },
        { name: 'createLandListingAction (draft)', file: LAND, fn: '_createLandListingAction' },
        { name: '/api/farm-nation/create-listing (retired)', file: ROUTE },
    ];

    it.each(DOORS)('$name CALLS THE SHARED GUARD', ({ name, file, fn }) => {
        const src = read(file);
        const body = fn ? actionBody(src, fn) : src;

        expect({ name, guarded: body.includes('checkProductPricing(') })
            .toEqual({ name, guarded: true });
    });

    it.each(DOORS)('$name GUARDS BEFORE IT WRITES, not after', ({ name, file, fn }) => {
        /*
         *   Order is the property. A bound checked after the row is built
         *   changes nothing — the same point #793 had to make about a flag set
         *   after edit mode was already entered.
         */
        const src = read(file);
        const body = fn ? actionBody(src, fn) : src;

        const guard = body.indexOf('checkProductPricing(');
        //   The first place the price reaches the record.
        const write = Math.min(
            ...[body.indexOf('price: data.price'), body.indexOf('pricePerUnit,')]
                .filter(i => i > -1)
                .concat([Number.MAX_SAFE_INTEGER]),
        );

        expect({ name, ordered: guard > -1 && guard < write })
            .toEqual({ name, ordered: true });
    });

    it('THE LIVE DOOR CHECKS SIZE AS WELL AS PRICE', () => {
        //   The price per hectare is quoted against the size, so a negative or
        //   infinite size describes a plot nobody can price. The one door that
        //   already validated bounds both.
        const body = actionBody(read(LAND), '_submitLandListingAction');
        const call = body.slice(body.indexOf('checkProductPricing('));

        expect(call).toMatch(/label:\s*"price"/);
        expect(call).toMatch(/label:\s*"size"/);
    });

    it('CONTROL: the door that was ALREADY right still validates its own way', () => {
        /*
         *   listPropertyAction bounds through farmNationListingSchema. This
         *   finding must not quietly replace a working zod check with an
         *   imported one and call that progress — the schema also carries the
         *   state and LGA rules.
         */
        const src = read('src/lib/validations/land.ts');
        expect(src).toMatch(/price:\s*z\.number\(\)\.positive\(/);
        expect(src).toMatch(/size:\s*z\.number\(\)\.positive\(/);
    });
});
