/**
 * @jest-environment node
 */

/**
 * Which of an order's escrow rows is THE escrow.
 *
 * An order can carry more than one — a refunded attempt beside a live one, or a
 * duplicate created before the claim primitives went in. Three read paths took
 * `escrowQuery.docs[0]`, which is whichever row the database returned first.
 *
 *   orders.ts:250              set `order.escrowTransactionId` from it, so the
 *   order-management.ts:503    order page could link to a REFUNDED escrow as
 *                              though it were the one holding the money.
 *
 *   _escrow_messages.ts:174    returned it from
 *                              getEscrowTransactionByOrderIdAction — and then
 *                              ran the participant authorisation check against
 *                              that arbitrary row.
 *
 * AND ONE WORSE FLAG
 * ------------------
 * orders.ts also computed
 *
 *     order.escrowReleased = escrowQuery.docs.every(d => d.data().status === "released")
 *
 * across EVERY row. An order whose live escrow had been released but which also
 * carried an earlier refunded attempt reported `escrowReleased: false` — the
 * seller had been paid and the order said otherwise.
 *
 * A NOTE ON MY OWN FIX
 * --------------------
 * getEscrowTransactionByOrderIdAction's query was `.limit(1)`. Swapping
 * `docs[0]` for pickOrderEscrow there would have been decorative: with one row
 * fetched there is nothing to choose between, and that one row is still whatever
 * came back first. The limit was widened in the same change, which is what makes
 * the selection mean anything.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { pickOrderEscrow } from '@/lib/escrow-status';

function code(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

/** A snapshot-shaped row. */
const row = (id: string, status: string, createdAt?: any) => ({
    id,
    data: () => ({ status, createdAt }),
});

describe('picking the escrow', () => {
    it('prefers the active one over a settled one that came back first', () => {
        // THE test. `docs[0]` here is the refunded row.
        const docs = [row('refunded-1', 'refunded'), row('live-1', 'funded')];

        expect(pickOrderEscrow(docs)?.id).toBe('live-1');
    });

    it('and over a released one', () => {
        const docs = [row('old', 'released'), row('live', 'delivered')];

        expect(pickOrderEscrow(docs)?.id).toBe('live');
    });

    it('treats every active status as live, not just funded', () => {
        for (const status of ['pending', 'funded', 'in_transit', 'delivered', 'disputed']) {
            const docs = [row('settled', 'released'), row('live', status)];
            expect(pickOrderEscrow(docs)?.id).toBe('live');
        }
    });

    it('falls back to the MOST RECENT settled row when none is active', () => {
        // Still better than the first one returned: if every attempt is finished,
        // the latest is the one that decided the outcome.
        const docs = [
            row('older', 'refunded', '2026-01-01T00:00:00.000Z'),
            row('newer', 'released', '2026-08-01T00:00:00.000Z'),
        ];

        expect(pickOrderEscrow(docs)?.id).toBe('newer');
    });

    it('and that fallback reads every createdAt shape', () => {
        const ms = Date.parse('2026-08-01T00:00:00.000Z');
        const docs = [
            row('iso', 'refunded', '2026-01-01T00:00:00.000Z'),
            row('ts', 'refunded', { seconds: ms / 1000 }),
        ];

        expect(pickOrderEscrow(docs)?.id).toBe('ts');
    });

    it('returns null for no rows rather than throwing', () => {
        expect(pickOrderEscrow([])).toBeNull();
        expect(pickOrderEscrow(undefined as any)).toBeNull();
    });

    it('does not mutate the caller\'s array', () => {
        const docs = [row('a', 'refunded', '2026-01-01'), row('b', 'refunded', '2026-08-01')];
        pickOrderEscrow(docs);

        expect(docs[0].id).toBe('a');
    });
});

describe('the read paths use it', () => {
    it.each([
        'src/app/actions/orders.ts',
        'src/app/actions/order-management.ts',
        'src/app/actions/marketplace/_escrow_messages.ts',
    ])('%s picks the active escrow', (rel: string) => {
        const src = code(rel);

        expect(src).toContain('pickOrderEscrow(escrowQuery.docs)');
    });

    it('and orders.ts no longer reports released across every row', () => {
        // `.every()` over all rows reported false whenever any earlier attempt
        // had been refunded — the seller paid, the order saying otherwise.
        const src = code('src/app/actions/orders.ts');

        expect(src).not.toContain('escrowQuery.docs.every(doc => doc.data().status === "released")');
        expect(src).toContain('orderEscrow.data()?.status === "released"');
    });

    it('and the by-order lookup actually fetches more than one row', () => {
        // Without this the selection above is decorative.
        const src = code('src/app/actions/marketplace/_escrow_messages.ts');
        const fn = src.slice(src.indexOf('getEscrowTransactionByOrderIdAction'));

        expect(fn.slice(0, 900)).not.toContain('.limit(1)');
        expect(fn.slice(0, 900)).toContain('.limit(10)');
    });

    it('and it still refuses when the order has no escrow at all', () => {
        // pickOrderEscrow returns null there, and the action must not carry on
        // with an undefined document.
        const src = code('src/app/actions/marketplace/_escrow_messages.ts');
        const fn = src.slice(src.indexOf('getEscrowTransactionByOrderIdAction'));

        expect(fn.slice(0, 1600)).toContain('if (!escrowDoc) {');
    });
});
