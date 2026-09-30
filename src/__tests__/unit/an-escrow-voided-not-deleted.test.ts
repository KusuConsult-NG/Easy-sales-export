/**
 * @jest-environment node
 */

/**
 *   #971 A TEST PAYMENT THAT COULD HAVE BECOME A REAL PAYOUT.
 *
 *   #968 gave dispatch a payout clock: an escrow at `funded` or `in_transit`
 *   whose order is marked shipped is released to the seller five days later.
 *
 *   The production sweep on 2026-09-28 found one row at `funded` —
 *   ESC-ORD-5h5e2cagmi-x10x9, ₦300,000 — which the owner identified as test data
 *   rather than a customer transaction. It carries no `shippedAt`, so #968's loop
 *   cannot reach it today. But `funded` IS in ESCROW_DISPATCH_RELEASABLE_FROM, so
 *   the day anyone marks that order shipped, the dispatch branch stamps it and the
 *   cron pays ₦300,000 of test money to a real seller.
 *
 *   scripts/void-test-escrow.ts closes that path. This suite is what keeps it
 *   from becoming a blunter instrument than it is.
 *
 * ── WHAT IS ASSERTED, AND WHY EACH ONE MATTERS ──────────────────────────────
 *
 *   IT VOIDS, IT DOES NOT DELETE. The owner's standing instruction on this
 *   repository is that wrongly-programmed data is repaired rather than destroyed
 *   and data is kept safe. A DELETE would also close the payout path, and it
 *   would take the record of a ₦300,000 row with it. `cancelled` is terminal —
 *   in neither ESCROW_RELEASABLE_FROM nor ESCROW_REFUNDABLE_FROM — so the money
 *   cannot move, and the row still says what it was.
 *
 *   IT CLAIMS, IT DOES NOT UPDATE. The status it writes from is the one it
 *   reported, so a row that was released, refunded or disputed between the report
 *   and the --apply is NOT voided. Voiding a row whose money has already moved
 *   would make the record lie about where the money went, and overwriting a
 *   dispute would overwrite a person's decision.
 *
 *   IT TAKES NO DEFAULT ID. A maintenance script that voids escrows and defaults
 *   to any of them is one keystroke from voiding the wrong one.
 *
 *   MUTATION-TESTED. Against a green baseline:
 *
 *     swap the claim for a bare update (drop the status predicate)   KILLED
 *     widen the voidable set to include 'delivered'                  KILLED
 *     widen it to include 'disputed'                                 KILLED
 *     give the id argument a default                                 KILLED
 *     replace the status write with a row delete                     KILLED
 *     reword this header                                             SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    ESCROW_RELEASABLE_FROM,
    ESCROW_REFUNDABLE_FROM,
    ESCROW_SETTLED_STATUSES,
    ESCROW_DISPATCH_RELEASABLE_FROM,
} from '@/lib/escrow-status';

const SCRIPT = 'scripts/void-test-escrow.ts';
const src = readFileSync(join(process.cwd(), SCRIPT), 'utf-8');
const code = stripComments(src, { label: SCRIPT });

/** The set the script will void, read out of its own source. */
const voidable = (): string[] => {
    const m = /const VOIDABLE = \[([^\]]*)\]/.exec(code);
    expect(m).not.toBeNull();
    return [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#971 — the void closes the payout path without destroying the record', () => {
    it('THE test: "cancelled" is in NEITHER the releasable nor the refundable set', () => {
        /*
         *   This is the whole reason `cancelled` is the right target. If it were
         *   in either set, voiding would leave the row payable by some other path
         *   and the script would be decorative.
         */
        expect(ESCROW_RELEASABLE_FROM).not.toContain('cancelled');
        expect(ESCROW_REFUNDABLE_FROM).not.toContain('cancelled');
        expect(ESCROW_SETTLED_STATUSES).toContain('cancelled');
    });

    it('AND IT WRITES A STATUS, NOT A DELETE', () => {
        //   The standing instruction on this repository: repair rather than
        //   destroy, and keep the data safe. A delete would close the path and
        //   take a ₦300,000 record with it.
        expect(code).toContain("status: 'cancelled'");
        expect(code).not.toMatch(/\.delete\(\)/);
        expect(code).not.toMatch(/\bDELETE\b/);
    });

    it('AND IT KEEPS EVERY FIELD THE ROW HAD', () => {
        //   Spread first, then the three fields it sets. Replacing raw_data
        //   instead would silently drop amount, buyerId, orderId — everything an
        //   auditor would later want.
        expect(code).toMatch(/\.\.\.row,/);
        expect(code).toContain('voidReason');
        expect(code).toContain('cancelledAt');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('it claims rather than updates', () => {
    it('THE WRITE IS CONDITIONAL ON THE STATUS IT REPORTED', () => {
        /*
         *   The adapter's runTransaction takes no lock, which is why every money
         *   path in this codebase claims. Here the race is slower but the harm is
         *   worse: between the report a human reads and the --apply they then
         *   type, the row can be released or disputed.
         */
        expect(code).toContain("eq('raw_data->>status', status)");
    });

    it('AND A LOST CLAIM IS A REFUSAL, NOT A SHRUG', () => {
        //   Zero rows updated means the status moved. Reporting success there
        //   would tell an operator a ₦300,000 row was voided when it was paid.
        expect(code).toMatch(/claimed\.length === 0/);
        expect(code).toMatch(/was NOT voided/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('what it refuses', () => {
    it('IT VOIDS ONLY PRE-DELIVERY, UNDISPUTED, UNSETTLED STATUSES', () => {
        expect(voidable().sort()).toEqual(['funded', 'in_transit', 'pending']);
    });

    it('AND NOT "delivered" — a buyer who confirmed is owed goods or a refund', () => {
        expect(voidable()).not.toContain('delivered');
    });

    it('AND NOT "disputed" — a person is deciding, and this must not overwrite them', () => {
        expect(voidable()).not.toContain('disputed');
    });

    it('AND NOT A SETTLED STATUS — the money has gone and the record must say where', () => {
        for (const settled of ESCROW_SETTLED_STATUSES) {
            expect({ settled, voidable: voidable().includes(settled) })
                .toEqual({ settled, voidable: false });
        }
    });

    it('AND IT COVERS EVERY STATUS THE DISPATCH CLOCK CAN PAY FROM', () => {
        /*
         *   The point of the script. A status the five-day release can pay from
         *   but this cannot void is a payout path with no way to close it — which
         *   is the situation ESC-ORD-5h5e2cagmi-x10x9 was in.
         */
        for (const payable of ESCROW_DISPATCH_RELEASABLE_FROM) {
            expect({ payable, voidable: voidable().includes(payable) })
                .toEqual({ payable, voidable: true });
        }
    });

    it('AND IT TAKES NO DEFAULT ESCROW ID', () => {
        //   One keystroke from voiding the wrong row. The argument is required and
        //   the refusal says what to pass.
        expect(code).toMatch(/if \(!id\)/);
        expect(code).not.toMatch(/escrowId\s*=\s*['"]ESC-/);
        expect(code).not.toMatch(/\|\|\s*['"]ESC-/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('it follows the maintenance-script convention', () => {
    it('IT PRINTS THE MODE AND THE TARGET HOST BEFORE DOING ANYTHING', () => {
        //   #448: three of eleven writing scripts skipped this, and all three were
        //   the ones an operator reaches for when repairing live data. An operator
        //   with the wrong .env loaded got a report identical to the right one.
        expect(code).toContain('modeBanner(');
        expect(code).toContain('targetHost()');
        expect(code).toContain('isApply()');
    });

    it('AND IT WRITES NOTHING WITHOUT --apply', () => {
        expect(code).toMatch(/if \(!APPLY\)/);
        expect(code).toMatch(/Nothing was written/);
    });

    it('AND THE VOIDABLE SET IT DUPLICATES IS PINNED TO lib/escrow-status', () => {
        /*
         *   scripts/ is outside the `@/` alias, and reaching through it has broken
         *   the docker build context check twice (#427, #967), so the script
         *   restates this set. A duplicated constant is acceptable only while
         *   something fails when the copies drift — this is that.
         *
         *   Asserted as a relationship rather than a literal list: the voidable
         *   set is exactly the statuses that are neither settled nor 'delivered'
         *   nor 'disputed'.
         */
        const notVoidable = new Set<string>([
            ...ESCROW_SETTLED_STATUSES, 'delivered', 'disputed',
        ]);
        const expected = ['pending', 'funded', 'in_transit', 'delivered', 'disputed',
            'released', 'refunded', 'cancelled']
            .filter((s) => !notVoidable.has(s));

        expect(voidable().sort()).toEqual(expected.sort());
    });
});
