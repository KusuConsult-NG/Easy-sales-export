/**
 * @jest-environment node
 */

/**
 * The Paystack webhook must not claim the reference its handlers claim.
 *
 * WHAT WAS WRONG
 * --------------
 * The route pre-claimed the payment reference:
 *
 *     await processedRef.create({ status: "processing", ... });
 *
 * and then called a handler which claims the SAME reference with
 * claimPaymentOnce — INSERT ... ON CONFLICT DO NOTHING on
 * processed_payments.id. The row already existed, so the handler got
 * claimed: false, logged "already processed", and returned WITHOUT
 * FULFILLING. The route then marked the row completed and answered 200.
 *
 * Every webhook-delivered payment would have been recorded as completed with
 * nothing granted. It stayed invisible only because the webhook URL pointed at
 * a host that rejects POST with 405, so no delivery ever arrived — correcting
 * the URL would have activated it.
 *
 * These tests assert the handler RAN. Asserting on the 200 response would have
 * passed against the broken code, because returning 200 is exactly what it did.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import crypto from 'node:crypto';

const mockProcessCoop = jest.fn() as jest.Mock<any>;
const mockProcessOrder = jest.fn() as jest.Mock<any>;
const mockClaimPaymentOnce = jest.fn() as jest.Mock<any>;
const mockCreate = jest.fn() as jest.Mock<any>;
const mockUpdate = jest.fn() as jest.Mock<any>;

jest.mock('@/infrastructure/payments/service', () => ({
    processMarketplaceOrder: (...a: any[]) => mockProcessOrder(...a),
    processExportInvestment: jest.fn(),
    processCooperativeRegistration: (...a: any[]) => mockProcessCoop(...a),
    processAcademyRegistration: jest.fn(),
    processCooperativeContribution: jest.fn(),
}));

jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (...a: any[]) => mockClaimPaymentOnce(...a),
}));

jest.mock('@/lib/supabase-db', () => ({
    supabaseDb: {
        collection: () => ({
            doc: () => ({
                create: (...a: any[]) => mockCreate(...a),
                update: (...a: any[]) => mockUpdate(...a),
                get: async () => ({ exists: false, data: () => ({}) }),
                set: async () => {},
            }),
        }),
    },
}));

jest.mock('@/lib/whatsapp-invites', () => ({ generateAndSendWhatsAppInvite: jest.fn() }));
jest.mock('@/lib/redis', () => ({ deleteCache: jest.fn(), deleteCachePattern: jest.fn() }));

const SECRET = 'sk_test_webhook_secret';

function signedRequest(event: any) {
    const body = JSON.stringify(event);
    const signature = crypto.createHmac('sha512', SECRET).update(body).digest('hex');
    return {
        text: async () => body,
        headers: { get: (h: string) => (h === 'x-paystack-signature' ? signature : null) },
    } as any;
}

function chargeSuccess(type: string, reference = 'ref-1') {
    return {
        event: 'charge.success',
        data: {
            reference,
            amount: 1_000_000,
            paid_at: '2026-08-10T00:00:00.000Z',
            metadata: { userId: 'user-1', type, membershipTier: 'Member' },
        },
    };
}

describe('paystack webhook — the claim belongs to the handler', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env.PAYSTACK_SECRET_KEY = SECRET;
        mockClaimPaymentOnce.mockResolvedValue({ claimed: true, status: null });
    });

    it('does not pre-claim the reference before dispatching', async () => {
        // THE test. The pre-claim is what made every handler see the reference
        // as already processed and skip fulfilment.
        const { POST } = await import('@/app/api/webhooks/paystack/route');
        await POST(signedRequest(chargeSuccess('cooperative_membership_registration')));

        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('actually invokes the fulfilment handler', async () => {
        // Asserting on the 200 response would pass against the broken code —
        // returning 200 while fulfilling nothing is precisely what it did.
        const { POST } = await import('@/app/api/webhooks/paystack/route');
        await POST(signedRequest(chargeSuccess('cooperative_membership_registration')));

        expect(mockProcessCoop).toHaveBeenCalledTimes(1);
        expect(mockProcessCoop.mock.calls[0][0]).toBe('ref-1');
    });

    it('does not overwrite the status the handler recorded', async () => {
        // processExportInvestment deliberately records "overfunded_review" to
        // keep an overfunded payment out of the revenue total. A blanket
        // "completed" from this route would put it back in.
        const { POST } = await import('@/app/api/webhooks/paystack/route');
        await POST(signedRequest(chargeSuccess('marketplace_order')));

        expect(mockProcessOrder).toHaveBeenCalledTimes(1);
        const statusWrites = mockUpdate.mock.calls.filter(
            (c: any) => c[0] && typeof c[0] === 'object' && 'status' in c[0]
        );
        expect(statusWrites).toHaveLength(0);
    });

    it('records an unhandled type rather than dropping it, and not as revenue', async () => {
        const { POST } = await import('@/app/api/webhooks/paystack/route');
        await POST(signedRequest(chargeSuccess('some_new_product')));

        expect(mockClaimPaymentOnce).toHaveBeenCalledTimes(1);
        const claim = mockClaimPaymentOnce.mock.calls[0][0] as any;
        expect(claim.status).toBe('unhandled_type');
        expect(claim.status).not.toBe('completed');
        expect(claim.reference).toBe('ref-1');
    });

    it('does not claim anything for a type it does handle', async () => {
        const { POST } = await import('@/app/api/webhooks/paystack/route');
        await POST(signedRequest(chargeSuccess('cooperative_membership_registration')));

        expect(mockClaimPaymentOnce).not.toHaveBeenCalled();
    });

    it('rejects a forged signature without dispatching', async () => {
        const body = JSON.stringify(chargeSuccess('cooperative_membership_registration'));
        const req = {
            text: async () => body,
            headers: { get: (h: string) => (h === 'x-paystack-signature' ? 'deadbeef' : null) },
        } as any;

        const { POST } = await import('@/app/api/webhooks/paystack/route');
        const res = await POST(req);

        expect(res.status).toBe(401);
        expect(mockProcessCoop).not.toHaveBeenCalled();
    });
});
