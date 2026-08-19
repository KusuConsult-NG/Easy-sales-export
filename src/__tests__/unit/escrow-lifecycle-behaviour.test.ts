/**
 * @jest-environment node
 */

/**
 * _escrow_lifecycle.ts, EXECUTED — create, fund, request release, admin release.
 *
 * The file was at 0% executed. escrow-confirm-authz.test.ts drives one of the
 * four functions against hand-built snapshot stubs; nothing had ever run the
 * others, or run any of them against a store that remembers what was written.
 * Three findings came out of doing that:
 *
 *   #111 _confirmEscrowPaymentAction never checked WHOSE payment the reference
 *        was. "Paystack says it succeeded", "the amount is within ₦1 of this
 *        escrow" and "the escrow is mine" are all satisfied by a stranger's
 *        reference — and the caller picks the escrow's amount when they create
 *        it, so they can match any payment they have seen a reference for.
 *        claimPaymentOnce runs first and stops the same reference being spent
 *        twice, so the theft also burns the real payer's payment. Every other
 *        verifier in the codebase compares the payment's identity to the
 *        session; this one did not.
 *
 *   #112 The amount check was `Math.abs(paid - expected) > 1` against a value
 *        taken straight off the document. An escrow with no numeric `amount`
 *        makes that NaN, `NaN > 1` is false, and the mismatch branch is skipped
 *        — so the one comparison guarding the amount funds the escrow for any
 *        sum at all.
 *
 *   #113 The admin release credits `sellerPayout` (net of the platform fee,
 *        since #109) but told the seller `tx.amount` — the gross — by
 *        notification, by SMS and in the financial audit row.
 *
 * The claim primitives are stateful here. A stub that always claims cannot tell
 * a working guard from a missing one.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { ESCROW_RELEASABLE_FROM } from '@/lib/escrow-status';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('@/lib/auth', () => ({
    auth: async () => null,
    signIn: async () => undefined,
    signOut: async () => undefined,
    handlers: {},
}));

const mockNotify = jest.fn(async () => ({})) as jest.Mock<any>;
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: (...a: any[]) => mockNotify(...a),
}));

const mockSms = jest.fn(async () => undefined) as jest.Mock<any>;
const mockPush = jest.fn(async () => undefined) as jest.Mock<any>;
jest.mock('@/lib/africastalking', () => ({
    smsEscrowReleased: (...a: any[]) => mockSms(...a),
    smsDisputeResolved: jest.fn(),
}));
jest.mock('@/lib/fcm', () => ({
    pushEscrowReleased: (...a: any[]) => mockPush(...a),
    pushDisputeResolved: jest.fn(async () => undefined),
}));

const mockVerify = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/paystack-server', () => ({
    verifyPaystackPayment: (...a: any[]) => mockVerify(...a),
}));

/** Stateful: the reference may be spent once, exactly as claim_payment_once is. */
const spent = new Set<string>();
const mockClaimPayment = jest.fn(async (p: any) => {
    if (spent.has(p.reference)) return { claimed: false, status: 'escrow_funding' };
    spent.add(p.reference);
    return { claimed: true, status: p.status };
}) as jest.Mock<any>;
const mockMarkFailed = jest.fn(async () => undefined) as jest.Mock<any>;
const mockCredit = jest.fn(async (p: any) => ({ claimed: true, balance: 100000 + Number(p.amount) })) as jest.Mock<any>;
jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (...a: any[]) => mockClaimPayment(...a),
    creditWalletOnce: (...a: any[]) => mockCredit(...a),
    markFulfilmentFailed: (...a: any[]) => mockMarkFailed(...a),
    debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    incrementWithinCeiling: jest.fn(), decrementManyOrFail: jest.fn(),
}));

/** Reads the row and applies from/fromAny, exactly as the SQL functions do. */
let store: FakeDbHandle;
const claimFrom = jest.fn(async (p: any) => {
    const current = store.get(p.collection, p.id);
    if (!current) return { claimed: false, status: null };
    const status = String(current.status ?? '');
    const allowed: string[] = p.fromAny ?? [p.from];
    if (!allowed.includes(status)) return { claimed: false, status };
    store.seed(p.collection, p.id, { ...current, ...(p.patch ?? {}), status: p.to });
    // The real primitive reports the status AFTER the call.
    return { claimed: true, status: p.to };
}) as jest.Mock<any>;
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: (p: unknown) => claimFrom(p),
    claimStatusTransitionFromAny: (p: unknown) => claimFrom(p),
}));

const mockAdmin = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/require-admin', () => ({
    requireAdmin: (...a: any[]) => mockAdmin(...a),
}));

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const ADMIN = 'admin-1';
const ESCROW = 'esc-1';
const REF = 'PAY-REF-1';

const ESCROWS = COLLECTIONS.ESCROW_TRANSACTIONS;
const WALLET_TXNS = COLLECTIONS.WALLET_TRANSACTIONS;
const LEDGER = COLLECTIONS.TRANSACTIONS;

function actAs(id: string | null, email = `${id}@e.com`): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, email, roles: ['general_user'] } }, error: null },
    ));
}

/** A successful ₦5,000 payment made by BUYER, identified the way Paystack does. */
const paystackOk = (over: Record<string, unknown> = {}) => ({
    status: true,
    data: {
        status: 'success', amount: 500000, channel: 'card',
        metadata: { userId: BUYER },
        customer: { email: `${BUYER}@e.com` },
        ...over,
    },
});

beforeEach(() => {
    jest.clearAllMocks();
    spent.clear();
    store = installFakeDb();
    actAs(BUYER);
    mockVerify.mockResolvedValue(paystackOk());
    mockAdmin.mockResolvedValue({ user: { id: ADMIN, roles: ['super_admin'] } });
});

const lifecycle = () => import('@/app/actions/marketplace/_escrow_lifecycle');

const seedEscrow = (over: Record<string, unknown> = {}) =>
    store.seed(ESCROWS, ESCROW, {
        buyerId: BUYER, sellerId: SELLER, amount: 5000, status: 'pending',
        productName: 'Yams', buyerEmail: `${BUYER}@e.com`, sellerEmail: `${SELLER}@e.com`,
        ...over,
    });

const escrow = () => store.get(ESCROWS, ESCROW) as Record<string, any>;

// ─────────────────────────────────────────────────────────────────────────────
describe('createEscrowAction', () => {
    const create = async (over: Record<string, unknown> = {}) =>
        (await (await lifecycle()).createEscrowAction({
            buyerId: BUYER, buyerEmail: `${BUYER}@e.com`,
            sellerId: SELLER, sellerEmail: `${SELLER}@e.com`,
            amount: 5000, productName: 'Yams', productDescription: '50kg bag',
            ...over,
        } as never)) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await create()).toMatchObject({ success: false });
        expect(store.size(ESCROWS)).toBe(0);
    });

    it('refuses to create an escrow in somebody else\'s name', async () => {
        actAs('somebody-else');
        expect(await create()).toMatchObject({ success: false, error: 'Unauthorized' });
        expect(store.size(ESCROWS)).toBe(0);
    });

    it.each([0, -5000, NaN, Infinity, '5000' as unknown as number])(
        'refuses the amount %p', async (amount) => {
            // The parameter type is TypeScript and is erased at the wire.
            expect(await create({ amount })).toMatchObject({ success: false, error: 'Invalid escrow amount' });
            expect(store.size(ESCROWS)).toBe(0);
        });

    it('refuses a seller who is the buyer, and a missing seller', async () => {
        expect(await create({ sellerId: BUYER })).toMatchObject({ success: false, error: 'Invalid seller' });
        expect(await create({ sellerId: '' })).toMatchObject({ success: false, error: 'Invalid seller' });
        expect(store.size(ESCROWS)).toBe(0);
    });

    it('creates it pending, with both parties as participants', async () => {
        const res = await create();
        expect(res.success).toBe(true);

        const [, doc] = store.all(ESCROWS)[0];
        expect(doc).toMatchObject({
            buyerId: BUYER, sellerId: SELLER, amount: 5000,
            status: 'pending', _version: 0,
            participants: [BUYER, SELLER],
        });
    });

    it('writes ONLY the named fields, never what the caller invented', async () => {
        // This spread `...data` and set the security-relevant fields after,
        // resting on later keys winning. Ordering was one half; the other is
        // that `data` is whatever arrived over the wire, so any OTHER field the
        // caller invented landed on the escrow — netAmount, platformFee,
        // releasedAt, disputeId. None of those are named below, so none of them
        // were overwritten.
        await create({
            status: 'funded', netAmount: 999999, platformFee: 0,
            releasedAt: '2020-01-01', disputeId: 'nope', _version: 42,
        });

        const [, doc] = store.all(ESCROWS)[0] as [string, Record<string, any>];
        expect(doc.status).toBe('pending');
        expect(doc._version).toBe(0);
        expect(doc.netAmount).toBeUndefined();
        expect(doc.platformFee).toBeUndefined();
        expect(doc.releasedAt).toBeUndefined();
        expect(doc.disputeId).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('confirmEscrowPaymentAction', () => {
    const confirm = async (id = ESCROW, ref = REF) =>
        (await (await lifecycle()).confirmEscrowPaymentAction(id, ref)) as any;

    beforeEach(() => { seedEscrow(); });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await confirm()).toMatchObject({ success: false });
        expect(escrow().status).toBe('pending');
    });

    it('refuses an escrow that does not exist', async () => {
        expect(await confirm('nope')).toMatchObject({ success: false, error: 'Escrow transaction not found' });
    });

    it('refuses a caller who is not the buyer', async () => {
        actAs('attacker-1');
        mockVerify.mockResolvedValue(paystackOk({ metadata: { userId: 'attacker-1' }, customer: { email: 'attacker-1@e.com' } }));

        expect(await confirm()).toMatchObject({ success: false, error: 'Unauthorized' });
        expect(escrow().status).toBe('pending');
        expect(mockClaimPayment).not.toHaveBeenCalled();
    });

    it.each(['failed', 'abandoned'])('refuses a %s Paystack payment', async (status) => {
        mockVerify.mockResolvedValue(paystackOk({ status }));

        const res = await confirm();
        expect(res.success).toBe(false);
        expect(res.error).toContain(status);
        expect(mockClaimPayment).not.toHaveBeenCalled();
    });

    it('reports a verification that throws instead of crashing', async () => {
        mockVerify.mockRejectedValue(new Error('Paystack unreachable'));

        expect(await confirm()).toMatchObject({ success: false });
        expect(mockClaimPayment).not.toHaveBeenCalled();
    });

    // ── #111 ────────────────────────────────────────────────────────────────
    it('REFUSES A REFERENCE BELONGING TO SOMEBODY ELSE', async () => {
        // The escrow is mine, Paystack says the reference succeeded, and the
        // amount matches — because I chose it. The money is not mine.
        mockVerify.mockResolvedValue(paystackOk({
            metadata: { userId: 'a-stranger' },
            customer: { email: 'stranger@e.com' },
        }));

        const res = await confirm();

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/not made by you/i);
        expect(escrow().status).toBe('pending');
        // And the real payer's reference must NOT be burned in the attempt.
        expect(mockClaimPayment).not.toHaveBeenCalled();
    });

    it('refuses a payment that identifies nobody at all', async () => {
        mockVerify.mockResolvedValue(paystackOk({ metadata: {}, customer: {} }));

        expect(await confirm()).toMatchObject({ success: false });
        expect(escrow().status).toBe('pending');
    });

    it('accepts a payment identified only by the customer email', async () => {
        // Nothing in the app initialises an escrow payment, so metadata may be
        // absent entirely; the customer Paystack recorded is then the identity.
        mockVerify.mockResolvedValue(paystackOk({ metadata: {}, customer: { email: `${BUYER}@E.com  ` } }));

        expect(await confirm()).toMatchObject({ success: true });
        expect(escrow().status).toBe('funded');
    });

    it('trusts metadata.userId over the email when both are present', async () => {
        // A stranger's payment made from an address the caller also controls
        // must not pass on the email alone.
        mockVerify.mockResolvedValue(paystackOk({
            metadata: { userId: 'a-stranger' }, customer: { email: `${BUYER}@e.com` },
        }));

        expect(await confirm()).toMatchObject({ success: false });
        expect(escrow().status).toBe('pending');
    });

    // ── #112 ────────────────────────────────────────────────────────────────
    it.each([undefined, null, 'five thousand', NaN, 0, -1])(
        'REFUSES AN ESCROW WHOSE AMOUNT IS %p', async (amount) => {
            // `Math.abs(paid - expected) > 1` is FALSE when expected is NaN, so
            // the mismatch branch was skipped and any payment funded it.
            seedEscrow({ amount });
            mockVerify.mockResolvedValue(paystackOk({ amount: 100 }));   // ₦1

            const res = await confirm();
            expect(res.success).toBe(false);
            expect(String(res.error)).toMatch(/no valid amount/i);
            expect(escrow().status).toBe('pending');
            expect(mockClaimPayment).not.toHaveBeenCalled();
        });

    it('refuses an underpayment and an overpayment beyond ₦1', async () => {
        mockVerify.mockResolvedValue(paystackOk({ amount: 100000 }));    // ₦1,000
        expect((await confirm()).success).toBe(false);

        mockVerify.mockResolvedValue(paystackOk({ amount: 900000 }));    // ₦9,000
        expect((await confirm()).success).toBe(false);

        expect(escrow().status).toBe('pending');
    });

    it('allows the ₦1 rounding tolerance in both directions', async () => {
        mockVerify.mockResolvedValue(paystackOk({ amount: 499900 }));    // ₦4,999
        expect((await confirm()).success).toBe(true);

        seedEscrow();
        mockVerify.mockResolvedValue(paystackOk({ amount: 500100 }));    // ₦5,001
        expect((await confirm(ESCROW, 'PAY-REF-2')).success).toBe(true);
    });

    it('funds the escrow, recording the reference and the paid time', async () => {
        expect(await confirm()).toMatchObject({ success: true });

        expect(escrow()).toMatchObject({ status: 'funded', paymentReference: REF });
        expect(escrow().paidAt).toBeTruthy();
    });

    it('does not record escrow funding as revenue', async () => {
        await confirm();

        expect(mockClaimPayment).toHaveBeenCalledWith(expect.objectContaining({
            status: 'escrow_funding', amount: 5000, userId: BUYER,
        }));
    });

    it('spends one reference on one escrow', async () => {
        expect((await confirm()).success).toBe(true);

        store.seed(ESCROWS, 'esc-2', {
            buyerId: BUYER, sellerId: SELLER, amount: 5000, status: 'pending', productName: 'More yams',
        });
        const second = await confirm('esc-2', REF);

        expect(second.success).toBe(false);
        expect(String(second.error)).toMatch(/already been applied/i);
        expect(store.get(ESCROWS, 'esc-2')?.status).toBe('pending');
    });

    it('flags a payment it took but could not apply', async () => {
        // The reference is burned by the time the status claim runs, so a bare
        // error leaves real money recorded against an unfunded escrow with
        // nothing to find it by. markFulfilmentFailed is what reconciliation
        // and the admin act on.
        seedEscrow({ status: 'cancelled' });

        const res = await confirm();

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/flagged for refund/i);
        expect(mockMarkFailed).toHaveBeenCalledWith(REF, expect.stringContaining('cancelled'));
    });

    it('does not fund an escrow twice', async () => {
        expect((await confirm()).success).toBe(true);
        expect((await confirm(ESCROW, 'PAY-REF-2')).success).toBe(false);
        expect(escrow().status).toBe('funded');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('requestEscrowReleaseAction', () => {
    const request = async (id = ESCROW, sellerId = SELLER) =>
        (await (await lifecycle()).requestEscrowReleaseAction(id, sellerId)) as any;

    beforeEach(() => {
        seedEscrow({ status: 'funded' });
        actAs(SELLER);
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await request()).toMatchObject({ success: false });
    });

    it('refuses a caller asking on another seller\'s behalf', async () => {
        actAs('someone-else');
        expect(await request()).toMatchObject({ success: false, error: 'Unauthorized' });
        expect(escrow().releaseRequestedBy).toBeUndefined();
    });

    it('refuses when the session matches the argument but the escrow does not', async () => {
        // sellerId is caller-supplied on both sides; the escrow decides.
        seedEscrow({ status: 'funded', sellerId: 'the-real-seller' });

        expect(await request()).toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('refuses an escrow that does not exist', async () => {
        expect(await request('nope')).toMatchObject({ success: false, error: 'Escrow transaction not found' });
    });

    it.each(['pending', 'released', 'refunded', 'disputed'])(
        'refuses to request release on a %s escrow', async (status) => {
            seedEscrow({ status, sellerId: SELLER });

            const res = await request();
            expect(res.success).toBe(false);
            expect(res.error).toContain(status);
        });

    it('records the request and notifies the buyer', async () => {
        expect(await request()).toMatchObject({ success: true });

        expect(escrow()).toMatchObject({ releaseRequestedBy: SELLER, status: 'funded' });
        expect(escrow().releaseRequestedAt).toBeTruthy();
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ userId: BUYER }));
    });

    it('does not release anything by itself', async () => {
        await request();
        expect(mockCredit).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('releaseEscrowAction', () => {
    const release = async (id = ESCROW) =>
        (await (await lifecycle()).releaseEscrowAction(id, ADMIN)) as any;

    beforeEach(() => {
        seedEscrow({ status: 'funded', amount: 10000, netAmount: 9500, platformFee: 500 });
        store.seed(COLLECTIONS.USERS, SELLER, { phone: '+2348012345678' });
        store.seed(COLLECTIONS.USERS, BUYER, { phone: '+2348098765432' });
    });

    it('refuses a caller who is not an admin', async () => {
        mockAdmin.mockResolvedValue({ error: 'Admin access required' });

        expect(await release()).toMatchObject({ success: false, error: 'Admin access required' });
        expect(mockCredit).not.toHaveBeenCalled();
    });

    it('refuses an escrow that does not exist', async () => {
        expect(await release('nope')).toMatchObject({ success: false, error: 'Escrow transaction not found' });
        expect(mockCredit).not.toHaveBeenCalled();
    });

    it.each([...ESCROW_RELEASABLE_FROM])('releases from %s — the shared set', async (status) => {
        // This claimed `from: "funded"` alone, so the moment a buyer confirmed
        // receipt — which moves the escrow to "delivered" — the admin release
        // failed and the seller's money sat there.
        seedEscrow({ status, amount: 10000, netAmount: 9500, platformFee: 500 });

        expect(await release()).toMatchObject({ success: true });
        expect(escrow()).toMatchObject({ status: 'released', releasedBy: ADMIN });
    });

    it.each(['pending', 'released', 'refunded', 'cancelled'])(
        'refuses to release a %s escrow', async (status) => {
            seedEscrow({ status, amount: 10000 });

            const res = await release();
            expect(res.success).toBe(false);
            expect(res.error).toContain(status);
            expect(mockCredit).not.toHaveBeenCalled();
        });

    it('credits the seller the NET, through the ledger primitive', async () => {
        // #110: this read the wallet and wrote a computed balance, with no
        // idempotency reference. #109: it credited the gross.
        expect(await release()).toMatchObject({ success: true });

        expect(mockCredit).toHaveBeenCalledWith(expect.objectContaining({
            reference: `escrow-release:${ESCROW}`,
            userId: SELLER,
            amount: 9500,
            status: 'disbursement',
        }));
    });

    it('falls back to the gross when no net was ever stored', async () => {
        seedEscrow({ status: 'funded', amount: 10000 });

        await release();

        expect(mockCredit).toHaveBeenCalledWith(expect.objectContaining({ amount: 10000 }));
    });

    it('cannot release the same escrow twice', async () => {
        expect((await release()).success).toBe(true);
        expect((await release()).success).toBe(false);
        expect(mockCredit).toHaveBeenCalledTimes(1);
    });

    it('writes both ledger rows under ids derived from the escrow', async () => {
        // Derived, not auto-generated: a retry overwrites the row instead of
        // showing the seller two payouts.
        await release();

        expect(store.get(WALLET_TXNS, `escrow-release-${ESCROW}`)).toMatchObject({
            userId: SELLER, amount: 9500, balanceBefore: 100000, balanceAfter: 109500,
        });
        expect(store.get(LEDGER, `ESCROW-RELEASE-${ESCROW}`)).toMatchObject({
            userId: SELLER, amount: 9500, type: 'escrow_payout', status: 'completed',
        });
    });

    // ── #113 ────────────────────────────────────────────────────────────────
    it('TELLS THE SELLER THE FIGURE IT ACTUALLY PAID', async () => {
        // The credit is net of the platform fee; the notification, the SMS and
        // the push all quoted the gross.
        await release();

        const sellerNote = mockNotify.mock.calls
            .map(([a]: any[]) => a)
            .find((a: any) => a.userId === SELLER);
        expect(sellerNote.message).toContain('9,500');
        expect(sellerNote.message).not.toContain('10,000');

        expect(mockSms).toHaveBeenCalledWith('+2348012345678', ESCROW, 9500);
        expect(mockPush).toHaveBeenCalledWith(SELLER, ESCROW, 9500, ESCROW);
    });

    it('records the payout, the gross and the fee in the financial audit row', async () => {
        await release();

        const financialAudit = (globalThis as unknown as {
            mockLogAdminFinancialAction: jest.Mock<any>;
        }).mockLogAdminFinancialAction;

        expect(financialAudit).toHaveBeenCalledWith(
            'escrow_released', ADMIN, 9500, ESCROW,
            expect.objectContaining({ sellerId: SELLER, buyerId: BUYER, gross: 10000, platformFee: 500 }),
        );
    });

    it('notifies the buyer as well as the seller', async () => {
        await release();

        const recipients = mockNotify.mock.calls.map(([a]: any[]) => a.userId);
        expect(recipients).toEqual(expect.arrayContaining([SELLER, BUYER]));
    });

    it('still releases when the seller has no phone on file', async () => {
        store.seed(COLLECTIONS.USERS, SELLER, {});

        expect(await release()).toMatchObject({ success: true });
        expect(mockSms).not.toHaveBeenCalled();
        expect(mockPush).toHaveBeenCalled();
    });
});
