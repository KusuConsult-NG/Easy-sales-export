/**
 * @jest-environment node
 */

/**
 * _confirmEscrowPaymentAction — three defects compounding.
 *
 * It marks an escrow "funded", which is the platform's record that a buyer's
 * money is secured and the seller may ship. Escrow release later pays the seller
 * out of that belief.
 *
 * 1. THE SESSION WAS OPTIONAL
 *    `requireSession().catch(() => null)` — an authentication failure produced
 *    null and execution carried on.
 *
 * 2. NOBODY CHECKED WHOSE ESCROW IT WAS
 *    escrowId came from the caller and was never compared to them.
 *    _createEscrowAction in the same file has always checked
 *    `session.user.id !== data.buyerId`. This function did not.
 *
 * 3. THE PAYMENT REFERENCE WAS NEVER CLAIMED
 *    The only tests were "Paystack says this reference succeeded" and "the
 *    amount matches within ₦1". Both are satisfied by ANY successful payment of
 *    that amount — including one the caller made for something else entirely,
 *    and including one already used.
 *
 * Together: pay ₦5,000 once, then mark any number of unrelated ₦5,000 escrows
 * as funded, without being logged in. The platform believes N escrows are
 * funded having received the money once.
 *
 * atomic-money-migration.md lists this transition as deliberately unconverted,
 * on the grounds that "a double-apply duplicates notifications rather than
 * money". That was true only while the reference was unclaimed and the caller
 * unverified — the reasoning was about concurrency, and the hole was authz.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const BUYER = 'buyer-1';
const ATTACKER = 'attacker-1';

const mockClaimPayment = jest.fn() as jest.Mock<any>;
const mockClaimStatus = jest.fn() as jest.Mock<any>;
const mockVerify = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (...a: any[]) => mockClaimPayment(...a),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    claimVersionedUpdate: jest.fn(), claimIdempotencyKey: jest.fn(),
    incrementWithinCeiling: jest.fn(), decrementManyOrFail: jest.fn(),
    claimSingleOpenLoanApplication: jest.fn(),
}));
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: (...a: any[]) => mockClaimStatus(...a),
    claimStatusTransitionFromAny: jest.fn(),
}));
jest.mock('@/lib/paystack-server', () => ({
    verifyPaystackPayment: (...a: any[]) => mockVerify(...a),
}));
jest.mock('@/lib/africastalking', () => ({ smsEscrowReleased: jest.fn(), smsDisputeResolved: jest.fn() }));
jest.mock('@/lib/fcm', () => ({ pushEscrowReleased: jest.fn(), pushDisputeResolved: jest.fn() }));
jest.mock('@/app/actions/notifications', () => ({ createNotificationAction: jest.fn(async () => ({})) }));

function setSession(id: string | null) {
    (global as any).mockRequireSession.mockImplementation(() =>
        id === null
            ? Promise.resolve({ session: null, error: { error: 'Authentication required' } })
            : Promise.resolve({ session: { user: { id, email: `${id}@e.com`, roles: [] } }, error: null })
    );
}

/** An escrow owned by BUYER, awaiting payment, for ₦5,000. */
function setEscrow(overrides: Record<string, any> = {}) {
    const doc = { buyerId: BUYER, sellerId: 'seller-1', amount: 5000, status: 'pending', productName: 'Yams', ...overrides };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [], data: () => doc,
    }));
    return doc;
}

async function confirm(escrowId = 'esc-1', ref = 'PAY-REF-1') {
    const { confirmEscrowPaymentAction } = await import('@/app/actions/marketplace/_escrow_lifecycle');
    return confirmEscrowPaymentAction(escrowId, ref);
}

describe('_confirmEscrowPaymentAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        /**
         * #398 retired this whole lifecycle behind a flag — none of its four
         * actions has ever been reached, and its create writes a random escrow
         * id that no release, refund or cron can address.
         *
         * The flag is ARMED here rather than these tests being deleted. What
         * they assert is #111's payment-reference ownership check, and that has
         * to hold if the lifecycle is ever brought back. A refusal in front of
         * it would make them pass vacuously.
         */
        process.env.MARKETPLACE_ESCROW_LIFECYCLE_ACTIONS = 'enabled';
        setSession(BUYER);
        setEscrow();
        // The payment identifies the buyer. It carried no identity at all until
        // #111 — which is the finding: nothing compared the reference's payer to
        // the caller, so a stranger's reference of the same amount funded this
        // escrow. escrow-lifecycle-behaviour.test.ts owns that case; here the
        // fixture simply has to be a payment the buyer actually made.
        mockVerify.mockResolvedValue({
            data: {
                status: 'success', amount: 500000, channel: 'card',
                metadata: { userId: BUYER }, customer: { email: `${BUYER}@e.com` },
            },
        });
        mockClaimPayment.mockResolvedValue({ claimed: true, status: 'escrow_funding' });
        mockClaimStatus.mockResolvedValue({ claimed: true, status: 'funded' });
    });

    it('refuses an unauthenticated caller', async () => {
        // The session failure used to be swallowed by .catch(() => null).
        setSession(null);

        const r: any = await confirm();

        expect(r.success).toBe(false);
        expect(mockClaimStatus).not.toHaveBeenCalled();
    });

    it('refuses a caller who is not the buyer', async () => {
        // THE test. escrowId came from the caller and was never checked.
        setSession(ATTACKER);

        const r: any = await confirm();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/unauthori[sz]ed/i);
        expect(mockClaimStatus).not.toHaveBeenCalled();
    });

    it('refuses a payment reference that has already funded something', async () => {
        // One reference, one escrow. Without the claim, a single real payment
        // could be replayed across every escrow of the same amount.
        mockClaimPayment.mockResolvedValue({ claimed: false, status: 'escrow_funding' });

        const r: any = await confirm();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/already been applied/i);
        expect(mockClaimStatus).not.toHaveBeenCalled();
    });

    it('does not record escrow funding as revenue', async () => {
        // platform_revenue_totals() sums processed_payments rows with status
        // "completed". Money moving INTO escrow is not revenue — rule 4 of
        // atomic-money-migration.md.
        await confirm();

        const [args] = mockClaimPayment.mock.calls[0] as [any];
        expect(args.status).toBe('escrow_funding');
        expect(args.status).not.toBe('completed');
    });

    it('claims pending → funded rather than reading and writing the status', async () => {
        await confirm();

        expect(mockClaimStatus).toHaveBeenCalledWith(expect.objectContaining({
            from: 'pending',
            to: 'funded',
            id: 'esc-1',
        }));
    });

    it('reports a lost status claim rather than reporting success', async () => {
        mockClaimStatus.mockResolvedValue({ claimed: false, status: 'funded' });

        const r: any = await confirm();

        expect(r.success).toBe(false);
    });

    it('funds the escrow for the real buyer', async () => {
        // Vacuity guard: the refusals above must not be satisfied by an action
        // that rejects everyone.
        const r: any = await confirm();

        expect(r.success).toBe(true);
        expect(mockClaimStatus).toHaveBeenCalledTimes(1);
    });

    it('still refuses when Paystack has not confirmed the payment', async () => {
        mockVerify.mockResolvedValue({ data: { status: 'abandoned', amount: 500000 } });

        const r: any = await confirm();

        expect(r.success).toBe(false);
        expect(mockClaimPayment).not.toHaveBeenCalled();
    });

    it('still refuses when the amount does not match the escrow', async () => {
        mockVerify.mockResolvedValue({ data: { status: 'success', amount: 100000, channel: 'card' } });

        const r: any = await confirm();

        expect(r.success).toBe(false);
        expect(mockClaimPayment).not.toHaveBeenCalled();
    });
});
