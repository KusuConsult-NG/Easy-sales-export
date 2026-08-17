/**
 * Escrow funding: a burned payment reference, and a write that trusted field order.
 *
 * THE PAID-BUT-NOT-FUNDED GAP
 * ---------------------------
 * confirmEscrowPaymentAction claims the payment reference BEFORE it claims the
 * status transition — correct ordering, because claiming the money first is what
 * stops one real payment funding several escrows.
 *
 * But when the status claim then failed, the function returned a bare error. The
 * reference is burned at that point: a retry takes claimPaymentOnce's "already
 * applied" branch, so the buyer can never fund the escrow with money they have
 * already paid. A real payment sat recorded as `escrow_funding` against an escrow
 * that was not funded, with nothing to find it by.
 *
 * Reachable whenever the escrow moves between the read and the claim — cancelled
 * by the other party, or already funded.
 *
 * THE SPREAD
 * ----------
 * _createEscrowAction built the document as `{ ...data, status: "pending", ... }`
 * and relied on later keys winning. The file's own comment said that was "a thin
 * thing to rest on": reversing two lines creates an escrow already `funded`,
 * without payment. And ordering was only half of it — `data` is whatever arrived
 * over the wire, so the spread also wrote any field a caller invented that the
 * lines below never mention.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const LIFECYCLE = 'src/app/actions/marketplace/_escrow_lifecycle.ts';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

describe('a claimed payment that funded nothing is flagged', () => {
    it('marks the processed_payments row as fulfilment_failed', () => {
        const src = code(LIFECYCLE);

        expect(src).toContain('await markFulfilmentFailed(paymentReference, reason);');
        expect(src).toContain('import { claimPaymentOnce, markFulfilmentFailed }');
    });

    it('does so on the branch where the status claim failed', () => {
        // Not somewhere else in the file: the whole point is that this specific
        // failure used to return without recording anything.
        const src = code(LIFECYCLE);
        const branch = src.slice(src.indexOf('if (!statusClaim.claimed) {'));

        expect(branch.slice(0, 1500)).toContain('markFulfilmentFailed(');
    });

    it('names which of the two failures happened', () => {
        // "not found" and "wrong status" need different follow-up, and the reason
        // is what an admin reads off the flagged row.
        const src = code(LIFECYCLE);

        expect(src).toContain('Escrow transaction not found when applying payment');
        expect(src).toContain("not 'pending', when the payment was applied");
    });

    it('does not release the claim or retry', () => {
        // Releasing would let the same reference fund something else — the exact
        // replay the claim exists to prevent.
        const src = code(LIFECYCLE);
        const branch = src.slice(src.indexOf('if (!statusClaim.claimed) {'), src.indexOf('const escrowData'));

        expect(branch).not.toContain('releaseClaim');
        expect(branch).not.toMatch(/claimPaymentOnce\(/);
    });

    it('tells the buyer they were charged, on BOTH outcomes', () => {
        // "Invalid state transition: expected 'pending', got 'funded'" told a buyer
        // who had just paid nothing about their money.
        //
        // Scoped to this branch and counted. The first version asserted the phrase
        // appeared somewhere in the file and that one exact string was absent — so
        // restoring the opaque message without its `error:` prefix passed, while
        // the other branch still carried the phrase.
        //
        // File-wide banning of "Invalid state transition" is not possible:
        // _requestEscrowReleaseAction throws it legitimately for a different
        // transition.
        const src = code(LIFECYCLE);
        const branch = src.slice(src.indexOf('if (!statusClaim.claimed) {'), src.indexOf('const escrowData'));

        expect(branch).not.toContain('Invalid state transition');
        // Both the not-found and the wrong-status replies say it.
        expect((branch.match(/You have been charged/g) || []).length).toBe(2);
    });

    it('logs it findably', () => {
        const src = source(LIFECYCLE);
        expect(src).toContain('PAID BUT NOT FUNDED');
    });

    it('still claims the payment BEFORE the status, which is the right order', () => {
        // Vacuity guard. Reordering to claim the status first would remove this
        // failure mode and reintroduce the one the payment claim exists for: one
        // real payment funding several escrows.
        const src = code(LIFECYCLE);
        const paymentClaim = src.indexOf('const claim = await claimPaymentOnce({');
        const statusClaim = src.indexOf('const statusClaim = await claimStatusTransition({');

        expect(paymentClaim).toBeGreaterThan(-1);
        expect(statusClaim).toBeGreaterThan(paymentClaim);
    });
});

describe('escrow creation does not spread the caller\'s object', () => {
    it('lists the fields it writes', () => {
        const src = code(LIFECYCLE);
        const fn = src.slice(src.indexOf('_createEscrowAction'), src.indexOf('createEscrowAction ='));

        expect(fn).not.toContain('{ ...data,');
        for (const field of [
            'buyerId: data.buyerId,',
            'sellerId: data.sellerId,',
            'amount: data.amount,',
            'productName: data.productName,',
        ]) {
            expect(fn).toContain(field);
        }
    });

    it('still forces the status, and the safety no longer depends on line order', () => {
        const src = code(LIFECYCLE);
        const fn = src.slice(src.indexOf('_createEscrowAction'), src.indexOf('createEscrowAction ='));

        expect(fn).toContain('status: "pending",');
        // With no spread there is nothing for a later key to have to beat.
        expect(fn).not.toMatch(/\.\.\.data/);
    });

    it('keeps the runtime amount and seller validation', () => {
        // Those guards are what stop a negative amount or a self-dealing escrow
        // being created; removing the spread must not remove them.
        const src = code(LIFECYCLE);

        expect(src).toContain('if (!Number.isFinite(data.amount) || data.amount <= 0) {');
        expect(src).toContain('if (!data.sellerId || data.sellerId === data.buyerId) {');
    });
});
