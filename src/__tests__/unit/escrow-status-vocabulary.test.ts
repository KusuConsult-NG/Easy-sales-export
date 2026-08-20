/**
 * One escrow vocabulary, and the money that leaked through the gap between two.
 *
 * TWO UNIONS, DISAGREEING
 * -----------------------
 * `EscrowTransaction.status` declared five values:
 *
 *     pending | funded | released | refunded | disputed
 *
 * while _escrow_actions.ts validated with a Zod enum of eight, adding
 * `in_transit`, `delivered` and `cancelled` — and _confirmOrderReceiptAction
 * writes "delivered" on every receipt confirmation. So the TYPE asserted that
 * states could not occur which the application writes on its main path. The same
 * defect LandListingStatus had (#26, #28).
 *
 * Every caller then hand-wrote its own from-set, and they did not line up:
 *
 *   dispute freeze          from: "funded"                        (createDispute)
 *   dispute resolution      ["funded", "disputed", "pending"]
 *   admin release           from: "funded"                        (_escrow_lifecycle)
 *   user release            ["delivered", "disputed", "funded"]   (_escrow_actions)
 *   order release           ["delivered", "disputed", "funded"]   (order-management)
 *   refund                  ["funded", "in_transit", "disputed"]
 *   disputeable             ["funded", "in_transit", "delivered"]
 *
 * Seven opinions. What they cost:
 *
 * 1. A DISPUTE AFTER DELIVERY FROZE NOTHING
 *    createDisputeAction searched only `funded | disputed | pending`, so an
 *    escrow at `in_transit` or `delivered` was not even found. Meanwhile two
 *    release paths release from "delivered". Buyer confirms receipt, finds a
 *    problem, disputes — dispute recorded, escrow not frozen, seller paid. That
 *    is the hole the freeze was written to close, left open for two of the three
 *    statuses a dispute can be raised from.
 *
 * 2. THE ADMIN COULD NOT RELEASE AFTER A BUYER CONFIRMED RECEIPT
 *    The admin release claimed `from: "funded"` alone and failed with "expected
 *    'funded', got 'delivered'". The normal flow disabled the admin's button.
 *
 * 3. A DELIVERED ORDER COULD NOT BE REFUNDED
 *    The refund set omitted "delivered" — exactly when a problem with goods comes
 *    to light.
 *
 * 4. A DISPUTE ON AN UNFUNDED ESCROW PAID OUT REAL MONEY
 *    The resolution set INCLUDED "pending". No payment ever reached the platform
 *    in that state, and both branches credit a wallet with the escrow's `amount`,
 *    which is written at creation regardless.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    ESCROW_STATUSES,
    ESCROW_FREEZABLE_STATUSES,
    ESCROW_DISPUTEABLE_STATUSES,
    ESCROW_RELEASABLE_FROM,
    ESCROW_REFUNDABLE_FROM,
    ESCROW_SETTLED_STATUSES,
    ESCROW_ACTIVE_STATUSES,
    isActiveEscrowStatus,
    isFreezableEscrowStatus,
    isSettledEscrowStatus,
    normaliseEscrowStatus,
} from '@/lib/escrow-status';

function code(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

describe('the union covers what the application writes', () => {
    it('includes the three the type omitted', () => {
        for (const written of ['in_transit', 'delivered', 'cancelled']) {
            expect(ESCROW_STATUSES).toContain(written);
        }
    });

    it('and the declared type uses it rather than a local list', () => {
        const src = code('src/lib/types/marketplace-escrow.ts');

        expect(src).toContain('status: EscrowStatus;');
        expect(src).not.toContain('"pending" | "funded" | "released" | "refunded" | "disputed"');
    });

    it('and the Zod enum is the same list, not a second copy', () => {
        const src = code('src/app/actions/marketplace/_escrow_actions.ts');

        expect(src).toContain('z.enum(ESCROW_STATUSES)');
    });
});

describe('the sets are consistent with each other', () => {
    it('anything releasable can be frozen by a dispute', () => {
        // THE invariant. If money can be released from a status but a dispute
        // cannot freeze that status, the dispute is decorative — which is exactly
        // what "funded" alone meant while releases came from "delivered".
        for (const status of ESCROW_RELEASABLE_FROM) {
            if (status === 'disputed') continue; // frozen by definition
            expect(ESCROW_FREEZABLE_STATUSES).toContain(status);
        }
    });

    it('anything refundable can be frozen too', () => {
        for (const status of ESCROW_REFUNDABLE_FROM) {
            if (status === 'disputed') continue;
            expect(ESCROW_FREEZABLE_STATUSES).toContain(status);
        }
    });

    it('a settled escrow is never releasable, refundable or freezable', () => {
        for (const settled of ESCROW_SETTLED_STATUSES) {
            expect(ESCROW_RELEASABLE_FROM).not.toContain(settled);
            expect(ESCROW_REFUNDABLE_FROM).not.toContain(settled);
            expect(ESCROW_FREEZABLE_STATUSES).not.toContain(settled);
            expect(ESCROW_ACTIVE_STATUSES).not.toContain(settled);
        }
    });

    it('an UNFUNDED escrow is never releasable or refundable', () => {
        // The money test. "pending" means no payment reached the platform, and
        // both dispute outcomes credit a wallet with the escrow's `amount`, which
        // is written at creation regardless.
        expect(ESCROW_RELEASABLE_FROM).not.toContain('pending');
        expect(ESCROW_REFUNDABLE_FROM).not.toContain('pending');
        expect(ESCROW_FREEZABLE_STATUSES).not.toContain('pending');
    });

    it('but a pending escrow is still ACTIVE, so it is found and not double-created', () => {
        // Vacuity guard on the line above: excluding "pending" from the payout
        // sets must not make an unfunded escrow invisible to the lookup, or a
        // second escrow gets created for the same order.
        expect(ESCROW_ACTIVE_STATUSES).toContain('pending');
        expect(isActiveEscrowStatus('pending')).toBe(true);
    });

    it('disputeable and freezable are the same question', () => {
        expect([...ESCROW_DISPUTEABLE_STATUSES].sort()).toEqual([...ESCROW_FREEZABLE_STATUSES].sort());
    });

    it('every set member is a real status', () => {
        const all = [
            ...ESCROW_FREEZABLE_STATUSES,
            ...ESCROW_RELEASABLE_FROM,
            ...ESCROW_REFUNDABLE_FROM,
            ...ESCROW_SETTLED_STATUSES,
            ...ESCROW_ACTIVE_STATUSES,
        ];
        for (const s of all) expect(ESCROW_STATUSES).toContain(s);
    });
});

describe('the predicates', () => {
    it('freezable covers exactly the three live-money states', () => {
        expect([...ESCROW_FREEZABLE_STATUSES].sort()).toEqual(['delivered', 'funded', 'in_transit']);
        expect(isFreezableEscrowStatus('delivered')).toBe(true);
        expect(isFreezableEscrowStatus('released')).toBe(false);
        expect(isFreezableEscrowStatus(undefined)).toBe(false);
    });

    it('settled means the money has gone', () => {
        expect(isSettledEscrowStatus('released')).toBe(true);
        expect(isSettledEscrowStatus('refunded')).toBe(true);
        expect(isSettledEscrowStatus('cancelled')).toBe(true);
        expect(isSettledEscrowStatus('funded')).toBe(false);
    });

    it('normalises the adjacent vocabularies rather than dropping them', () => {
        expect(normaliseEscrowStatus('paid')).toBe('funded');
        expect(normaliseEscrowStatus('shipped')).toBe('in_transit');
        expect(normaliseEscrowStatus('completed')).toBe('released');
        expect(normaliseEscrowStatus('DELIVERED')).toBe('delivered');
        expect(normaliseEscrowStatus('nonsense')).toBeNull();
        expect(normaliseEscrowStatus(null)).toBeNull();
    });
});

describe('every caller reads the shared sets', () => {
    const SITES: Array<[string, string]> = [
        ['src/app/actions/disputes.ts', 'ESCROW_FREEZABLE_STATUSES'],
        ['src/app/actions/marketplace/_escrow_lifecycle.ts', 'ESCROW_RELEASABLE_FROM'],
        ['src/app/actions/marketplace/_escrow_actions.ts', 'ESCROW_RELEASABLE_FROM'],
        ['src/app/actions/marketplace/_escrow_actions.ts', 'ESCROW_REFUNDABLE_FROM'],
        ['src/app/actions/marketplace/_escrow_actions.ts', 'ESCROW_DISPUTEABLE_STATUSES'],
        ['src/app/actions/order-management.ts', 'ESCROW_RELEASABLE_FROM'],
    ];

    it.each(SITES)('%s uses %s', (rel: string, symbol: string) => {
        expect(code(rel)).toContain(symbol);
    });

    it('and no caller still hand-writes its own escrow from-set', () => {
        // The literals each of the seven used. Any of them reappearing means a
        // caller has drifted off the shared vocabulary again.
        const literals = [
            '["funded", "disputed", "pending"]',
            '["delivered", "disputed", "funded"]',
            '["funded", "in_transit", "disputed"]',
            'const disputeableStatuses = ["funded", "in_transit", "delivered"]',
        ];

        for (const rel of [
            'src/app/actions/disputes.ts',
            'src/app/actions/marketplace/_escrow_actions.ts',
            'src/app/actions/marketplace/_escrow_lifecycle.ts',
            'src/app/actions/order-management.ts',
        ]) {
            const src = code(rel);
            for (const literal of literals) {
                expect(src).not.toContain(literal);
            }
        }
    });

    it('the admin release no longer claims from funded alone', () => {
        const src = code('src/app/actions/marketplace/_escrow_lifecycle.ts');
        const release = src.slice(src.indexOf('to: "released"') - 600, src.indexOf('to: "released"') + 100);

        expect(release).toContain('claimStatusTransitionFromAny(');
        expect(release).not.toContain('from: "funded"');
    });
});

describe('confirming receipt', () => {
    const BUYER = 'src/app/actions/marketplace/_buyer.ts';

    it('claims the order transition instead of checking then writing', () => {
        // The check ran inside runTransaction, which takes no lock in this
        // adapter, so two clicks both passed and both wrote.
        const src = code(BUYER);
        const fn = src.slice(src.indexOf('async function _confirmOrderReceiptAction'));

        expect(fn.slice(0, 2500)).toContain('claimStatusTransitionFromAny({');
        expect(fn.slice(0, 2500)).not.toContain('transaction.update(orderRef');
    });

    it('and only touches escrows that are still active', () => {
        // It updated EVERY escrow row for the order, including already released
        // or refunded ones — writing "delivered" over a settled status.
        const src = code(BUYER);
        const fn = src.slice(src.indexOf('async function _confirmOrderReceiptAction'));

        expect(fn.slice(0, 3000)).toContain('isActiveEscrowStatus(doc.data()?.status)');
    });
});
