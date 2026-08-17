/**
 * One amount rule for an order payment, and the reconciler that used to undo it.
 *
 * TWO PATHS, TWO ANSWERS
 * ----------------------
 *   _payment_verify.ts    interactive. Refused a payment outside the CURRENT
 *                         minOrderAmount/maxOrderAmount, and refused any mismatch
 *                         against `metadata.totalAmount` in EITHER direction.
 *
 *   payments/service.ts   processMarketplaceOrder — the Paystack webhook and
 *                         reconcile-paystack's auto-heal. No fee bounds at all,
 *                         and refused only UNDERpayment.
 *
 * They race by design: the interactive path's own comment says the webhook
 * "usually finishes before the user is redirected back". So which one reached a
 * payment first decided whether it was accepted.
 *
 * AND THE REFUSAL WAS NOT FINAL
 * -----------------------------
 * A payment the interactive path refused never reached claimPaymentOnce, so it had
 * no `processed_payments` row. reconcile-paystack compares Paystack's successes
 * against that collection, finds it missing, and auto-heals it by calling
 * processMarketplaceOrder — which does not apply the checks that rejected it. The
 * validation was undone on a schedule, unattended.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { checkOrderPaymentAmount, ORDER_AMOUNT_TOLERANCE } from '@/lib/order-payment-amount';

const INTERACTIVE = 'src/app/actions/marketplace/_payment_verify.ts';
const WEBHOOK = 'src/infrastructure/payments/service.ts';
const ORDERS = 'src/app/actions/marketplace/_payment_orders.ts';

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

describe('the rule', () => {
    it('accepts an exact payment', () => {
        expect(checkOrderPaymentAmount(5000, 5000)).toEqual({ ok: true, overpaidBy: 0 });
    });

    it('refuses underpayment', () => {
        const v = checkOrderPaymentAmount(4000, 5000);
        expect(v.ok).toBe(false);
        expect(v).toMatchObject({ reason: 'underpaid', shortfall: 1000 });
    });

    it('ACCEPTS overpayment, and says by how much', () => {
        // The decision that matters. Refusing leaves a buyer who has been charged
        // with no order and an error — the outcome this codebase treats as the
        // worst one everywhere else. The webhook already behaved this way; the
        // interactive path refused.
        expect(checkOrderPaymentAmount(6000, 5000)).toEqual({ ok: true, overpaidBy: 1000 });
    });

    it('tolerates rounding in both directions', () => {
        expect(checkOrderPaymentAmount(5000.5, 5000).ok).toBe(true);
        expect(checkOrderPaymentAmount(4999.5, 5000).ok).toBe(true);
        expect(checkOrderPaymentAmount(5000.5, 5000)).toMatchObject({ overpaidBy: 0 });
        expect(ORDER_AMOUNT_TOLERANCE).toBe(1);
    });

    it('refuses when the order has no total, rather than accepting anything', () => {
        for (const missing of [null, undefined, 0, NaN, 'abc' as any]) {
            const v = checkOrderPaymentAmount(5000, missing);
            expect(v.ok).toBe(false);
            expect(v).toMatchObject({ reason: 'no_expected_amount' });
        }
    });

    it('refuses a payment amount that cannot be read', () => {
        for (const bad of [0, -100, NaN, undefined as any]) {
            expect(checkOrderPaymentAmount(bad, 5000).ok).toBe(false);
        }
    });

    it('does not consult platform fee bounds at all', () => {
        // It takes two numbers. A rule that cannot see the fee configuration cannot
        // strand a charged buyer when an admin changes it.
        expect(checkOrderPaymentAmount.length).toBe(2);
        expect(code('src/lib/order-payment-amount.ts')).not.toContain('minOrderAmount');
        expect(code('src/lib/order-payment-amount.ts')).not.toContain('getPlatformFees');
    });
});

describe('both fulfilment paths use it', () => {
    it.each([INTERACTIVE, WEBHOOK])('%s calls checkOrderPaymentAmount', (rel: string) => {
        expect(code(rel)).toContain('checkOrderPaymentAmount(');
    });

    it('the interactive path compares against the ORDER total, not the gateway metadata', () => {
        // `metadata.totalAmount` travelled to Paystack and back; the order is the
        // record the goods ship against, and it is what the webhook already used.
        const src = code(INTERACTIVE);

        expect(src).toContain('checkOrderPaymentAmount(amountInNaira, orderData.totalAmount)');
        expect(src).not.toContain('const expectedAmount = metadata.totalAmount;');
        expect(src).not.toMatch(/Math\.abs\(amountInNaira - expectedAmount\)/);
    });

    it('the interactive path no longer re-applies placement-time fee bounds', () => {
        // minOrderAmount is enforced at placement, in _payment_orders.ts. Checking
        // it again after the money is taken prevents nothing and can strand a
        // charged buyer.
        const src = code(INTERACTIVE);

        expect(src).not.toMatch(/amountInNaira < fees\.minOrderAmount/);
        expect(src).not.toMatch(/amountInNaira > fees\.maxOrderAmount/);
    });

    it('but placement still enforces the minimum', () => {
        // Vacuity guard: if the bound were gone entirely rather than moved, this
        // whole change would be a removal of a control.
        const src = code(ORDERS);
        expect((src.match(/totalAmount < fees\.minOrderAmount/g) || []).length).toBeGreaterThanOrEqual(3);
    });

    it('the interactive path still needs the fee percentage for the escrow split', () => {
        // The bounds went; the fee configuration itself is still required.
        const src = code(INTERACTIVE);
        expect(src).toContain('const fees = await getPlatformFees();');
        expect(src).toContain('fees.platformFeePercentage');
    });

    it('the webhook no longer refuses only underpayment by hand', () => {
        const src = code(WEBHOOK);
        expect(src).not.toMatch(/if \(amount < orderData\.totalAmount\) \{/);
    });
});

describe('an overpayment is recorded, not just logged', () => {
    it('on the order', () => {
        const src = code(WEBHOOK);

        expect(src).toContain('overpaidBy: amountVerdict.overpaidBy,');
        expect(src).toContain('overpaymentStatus: "pending_review",');
    });

    it('and in the collection an admin works from', () => {
        // Matching how an overfunded export investment is routed — the same file
        // already does this for that type.
        const src = code(WEBHOOK);

        expect(src).toContain('COLLECTIONS.FAILED_PAYMENTS');
        expect(src).toContain('type: "marketplace_order_overpayment"');
        expect(src).toContain('status: "overfunded_review"');
    });

    it('carries the amounts needed to settle it', () => {
        const src = code(WEBHOOK);
        const block = src.slice(src.indexOf('marketplace_order_overpayment'));

        expect(block.slice(0, 700)).toContain('amountPaid: amount,');
        expect(block.slice(0, 700)).toContain('orderTotal: orderData.totalAmount,');
    });

    it('cannot fail the fulfilment it is recording', () => {
        // The order has already been paid for and updated. Losing the whole
        // fulfilment because the surplus note could not be written would be a
        // strictly worse outcome than an unrecorded surplus.
        const src = code(WEBHOOK);
        const block = src.slice(src.indexOf('marketplace_order_overpayment'));
        expect(block.slice(0, 1200)).toContain('.catch((e) => logger.error(');
    });

    it('only when there is a surplus — both guards', () => {
        // There are TWO of these blocks: the warning, and the FAILED_PAYMENTS
        // write. The first version of this test only required the substring to
        // exist, so weakening one guard to `if (true)` left the other and passed —
        // which would have logged an overpayment warning on every ordinary order.
        const src = code(WEBHOOK);
        expect((src.match(/if \(amountVerdict\.overpaidBy > 0\) \{/g) || []).length).toBe(2);

        // And the order patch is spread conditionally on the same test.
        expect(src).toContain('...(amountVerdict.overpaidBy > 0');
    });
});
