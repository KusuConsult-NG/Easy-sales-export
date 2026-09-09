/**
 * @jest-environment node
 */

/**
 *   #493 THE DELIVERY ESTIMATE PROMISES A MINUTE, AND THE NOTE SAYING IT HAS NO
 *        WRITER IS WRONG.
 *
 *   `estimatedDeliveryDate` has been carried on this audit's list as "read by
 *   three order screens and written by nothing", recorded in
 *   lib/validations/marketplace.ts:
 *
 *       "estimatedDeliveryDate is READ BY THREE ORDER SCREENS AND WRITTEN BY
 *        NOTHING. Recorded, not invented … Giving it a real value is a product
 *        decision about who promises a delivery date, not a repair."
 *
 *   IT HAS A WRITER, AND IT IS LIVE. _updateOrderStatusAction:
 *
 *       if (newStatus === "shipped") {
 *           const estimatedDate = new Date();
 *           estimatedDate.setDate(estimatedDate.getDate() + 7);
 *           updateData.estimatedDeliveryDate = estimatedDate;
 *       }
 *
 *   reached from /marketplace/seller/orders/[id] every time a seller marks an
 *   order shipped. So the field is written on the ordinary path, and the note
 *   says it never is.
 *
 *   THAT KIND OF NOTE IS NOT HARMLESS. A field recorded as having no writer is
 *   a field somebody deletes — along with the three screens that read it — on
 *   the strength of a sentence in a schema. Correcting it is most of this
 *   finding.
 *
 * ── AND THE VALUE IT WRITES IS A PROMISE TO THE MINUTE ──────────────────────
 *
 *   `new Date()` then `setDate(+7)` keeps the current TIME OF DAY. Two of the
 *   three screens render it with formatDateTime, which prints hour and minute:
 *
 *       Est. Delivery    12 Sep 2026, 14:32
 *
 *   14:32 is the moment the seller clicked a button. It says nothing about when
 *   anything arrives, and it is shown to the buyer as a delivery time.
 *
 *   THE THREE SCREENS ALSO DISAGREE. seller/orders/[id] and buyer/orders/[id]
 *   use formatDateTime; marketplace/orders/[id] uses formatLocalDate. The same
 *   stored value, three screens, two answers — and the buyer can reach two of
 *   them.
 *
 * ── WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT ────────────────────
 *
 *   The estimate is stored as a DAY: the end of the seventh day, so a
 *   comparison against "is it late" does not fire at breakfast on the day it
 *   was promised for. And all three screens render it the same way, through one
 *   helper, because a value the buyer and the seller read differently is a
 *   disagreement waiting to become a dispute.
 *
 *   SEVEN DAYS IS NOT CHANGED. Whether a Lagos-to-Lagos order and a
 *   Lagos-to-Maiduguri order deserve the same window is exactly the product
 *   decision the original note was right to refuse — and it is a decision about
 *   logistics this repository has no data for. What changes is that the number
 *   is named, stated once, and no longer implies a precision it does not have.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the estimate stored as a raw `new Date()`      KILLED
 *     the day-end normalisation removed              KILLED
 *     the seven-day window silently changed          KILLED
 *     a screen switched back to formatDateTime       KILLED
 *     the formatter printing a time again            KILLED
 *     the stale "written by nothing" note restored   KILLED
 *     the writer un-named in the corrected note      KILLED
 *     reword this header                             SURVIVED, as intended
 *
 *   TWO SURVIVED THE FIRST RUN, both familiar. The writer assertion named
 *   `estimatedDeliveryFrom` and was satisfied by the IMPORT line while the call
 *   was `new Date()` — fourth time in this audit that a name has stood in for a
 *   rule. And the schema assertion was a `not.toMatch` on the old wording, which
 *   was vacuous: the corrected note QUOTES the old claim to say what was wrong
 *   with it, wrapped across lines differently, so the pattern matched neither
 *   version. kyc-route-bypass.test.ts already recorded that trap — "when both
 *   the claim and its correction are prose, pin the one you want to be true" —
 *   and I walked into it in a different file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    DELIVERY_ESTIMATE_DAYS,
    estimatedDeliveryFrom,
    formatDeliveryEstimate,
} from '@/lib/delivery-estimate';

const code = (rel: string) => stripComments(readFileSync(rel, 'utf-8'), { label: rel });

/** The three screens that render the estimate to a person. */
const SCREENS = [
    'src/app/marketplace/seller/orders/[id]/SellerOrderDetailClient.tsx',
    'src/app/marketplace/orders/[id]/OrderConfirmationClient.tsx',
    'src/app/marketplace/buyer/orders/[id]/BuyerOrderDetailClient.tsx',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#493 — the estimate is a day, not a moment', () => {
    it('IT LANDS AT THE END OF THE SEVENTH DAY, NOT AT THE HOUR IT WAS SET', () => {
        //   THE test. `new Date()` + setDate(+7) carried the click's time of
        //   day into a delivery promise.
        const shippedAt = new Date('2026-09-05T14:32:11.000Z');

        const estimate = estimatedDeliveryFrom(shippedAt);

        expect(estimate.getHours()).toBe(23);
        expect(estimate.getMinutes()).toBe(59);
        expect(estimate.getSeconds()).toBe(59);
    });

    it('AND IT IS THE SEVENTH DAY, WHICHEVER HOUR THE SELLER CLICKED', () => {
        //   Two sellers shipping the same order minutes apart must not promise
        //   different days — and one clicking at 23:58 must not roll over.
        const early = estimatedDeliveryFrom(new Date('2026-09-05T00:01:00.000Z'));
        const late = estimatedDeliveryFrom(new Date('2026-09-05T23:58:00.000Z'));

        expect(early.getFullYear()).toBe(late.getFullYear());
        expect(early.getMonth()).toBe(late.getMonth());
        expect(early.getDate()).toBe(late.getDate());
    });

    it('AND THE WINDOW IS SEVEN DAYS, STATED ONCE', () => {
        //   Unchanged on purpose: whether a Lagos-to-Lagos order deserves the
        //   same window as Lagos-to-Maiduguri is a logistics decision this
        //   repository has no data for. Named, so changing it is one edit.
        expect(DELIVERY_ESTIMATE_DAYS).toBe(7);

        //   CALENDAR days, which is what the constant means. Measuring elapsed
        //   milliseconds gets 7.6 and rounds to 8 — my first version of this
        //   assertion did exactly that and failed on correct code, because
        //   end-of-day on the seventh day IS more than seven times 24 hours
        //   from a nine o'clock shipment. The unit has to match the promise.
        const from = new Date('2026-09-05T09:00:00.000Z');
        const estimate = estimatedDeliveryFrom(from);

        const startOfShippingDay = new Date(from.getTime());
        startOfShippingDay.setHours(0, 0, 0, 0);
        const startOfEstimateDay = new Date(estimate.getTime());
        startOfEstimateDay.setHours(0, 0, 0, 0);

        const calendarDays = Math.round(
            (startOfEstimateDay.getTime() - startOfShippingDay.getTime()) / 86_400_000,
        );
        expect(calendarDays).toBe(DELIVERY_ESTIMATE_DAYS);
    });

    it('and a month boundary is arithmetic, not a guess', () => {
        //   setDate past the end of a month rolls over, which is correct and
        //   worth pinning: 28 Feb + 7 is 7 March, not 35 February.
        const estimate = estimatedDeliveryFrom(new Date('2026-02-25T09:00:00.000Z'));

        expect(estimate.getMonth()).toBe(2);   // March
        expect(estimate.getDate()).toBe(4);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#493 — and every screen says the same thing', () => {
    it('THE FORMATTER PRINTS A DAY AND NO TIME', () => {
        //   "12 Sep 2026, 14:32" was a delivery promise to the minute, and the
        //   minute was when the seller clicked a button.
        const shown = formatDeliveryEstimate(new Date('2026-09-12T23:59:59.000Z'));

        expect(shown).not.toMatch(/\d{1,2}:\d{2}/);
        expect(shown).toMatch(/2026/);
    });

    it('AND ALL THREE SCREENS USE IT', () => {
        //   Two used formatDateTime and one used formatLocalDate — the same
        //   stored value rendered two ways, and the buyer can reach two of the
        //   three. A value the buyer and the seller read differently is a
        //   disagreement waiting to become a dispute.
        for (const rel of SCREENS) {
            const body = code(rel);
            const at = body.indexOf('estimatedDeliveryDate');

            expect({ rel, present: at > -1 }).toEqual({ rel, present: true });
            const region = body.slice(at, at + 400);
            expect({ rel, usesShared: region.includes('formatDeliveryEstimate') })
                .toEqual({ rel, usesShared: true });
            expect({ rel, usesDateTime: /formatDateTime\(order\.estimatedDeliveryDate\)/.test(region) })
                .toEqual({ rel, usesDateTime: false });
        }
    });

    it('and an absent estimate still renders nothing rather than "Unknown"', () => {
        //   formatDateTime answers "Unknown" for a missing value, and these
        //   screens guard on the field before rendering — so the guard, not the
        //   formatter, is what keeps the row off the page. Kept.
        expect(formatDeliveryEstimate(null)).toBe('');
        expect(formatDeliveryEstimate(undefined)).toBe('');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#493 — the writer is named where the field is declared', () => {
    it('THE SCHEMA NO LONGER SAYS THE FIELD HAS NO WRITER', () => {
        //   THE correction. A field recorded as having no writer is a field
        //   somebody deletes — along with the three screens that read it — on
        //   the strength of a sentence in a schema.
        //
        //   IT PINS WHAT MUST BE TRUE, NOT THE ABSENCE OF A PHRASE. The first
        //   version was a `not.toMatch` on the old wording, and it was vacuous:
        //   the corrected note QUOTES the old claim in order to say what was
        //   wrong with it, and the quote wraps across lines differently, so the
        //   pattern matched neither version. A mutant restoring the stale
        //   sentence survived.
        //
        //   This is the trap kyc-route-bypass.test.ts already recorded — "when
        //   both the claim and its correction are prose, pin the one you want to
        //   be true" — met again, in a different file, the same way.
        const schema = readFileSync('src/lib/validations/marketplace.ts', 'utf-8');

        expect(schema).toMatch(/#493 found that wrong/);
        expect(schema).toMatch(/_updateOrderStatusAction writes it on the `shipped` transition/);
    });

    it('AND THE WRITER STILL WRITES IT ON THE SHIPPED TRANSITION', () => {
        //   The vacuity guard: every assertion above is satisfied by a field
        //   nothing sets, which is what the note claimed in the first place.
        //   THE ASSIGNMENT, not the import. The first version of this asserted
        //   that the file contained the word `estimatedDeliveryFrom`, and a
        //   mutant that replaced the call with `new Date()` SURVIVED — the name
        //   was still on the import line. Fourth time in this audit.
        const action = code('src/app/actions/order-management.ts');

        expect(action).toContain('updateData.estimatedDeliveryDate = estimatedDeliveryFrom()');
        expect(action).toMatch(/newStatus === "shipped"/);
    });

    it('and it no longer builds the date by hand', () => {
        const action = code('src/app/actions/order-management.ts');

        expect(action).not.toMatch(/estimatedDate\.setDate\(/);
    });
});
