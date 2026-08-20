/**
 * @jest-environment node
 */

/**
 * Any verified property could be bought for ₦10,000.
 *
 * WHAT WAS WRONG
 * --------------
 * `_initializePropertyPaymentAction(propertyId, amount, buyerInfo)` took the
 * amount as a parameter and validated only `amount < 10000`. It loaded the
 * property document, checked its status was "verified" and that the buyer was
 * not the owner — and never read `propertyData.price`.
 *
 * So the Paystack charge, `propertyPrice` and `escrowAmount` were all whatever
 * the caller asked for. `_verifyPropertyPaymentAction` then compared the paid
 * sum to nothing: it checked Paystack said "success", checked the payer matched
 * the session, claimed the reference for idempotency, and moved the property
 * into escrow.
 *
 * Every guard that existed was about identity. None was about money.
 *
 * **A ₦50,000,000 plot could be taken into escrow for ₦10,000.**
 *
 * THE FIX
 * -------
 * Initialisation charges `propertyData.price`. Verification independently
 * refuses a payment that does not cover the listed price, so a reference
 * created any other way cannot be honoured either — the same belt-and-braces
 * shape as the academy enrolment path, which compares `amountInNaira` to
 * `expectedPrice` and was the reason that route was clean.
 *
 * HOW IT WAS FOUND
 * ----------------
 * By auditing the action files with no test coverage, ordered by how many money
 * primitives they touch. This was first on that list.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const PROPERTY = 'prop-1';
const LISTED_PRICE = 50_000_000;
const ATTACKER = 'attacker-1';

const mockInitPaystack = jest.fn() as jest.Mock<any>;
const mockVerifyPaystack = jest.fn() as jest.Mock<any>;
const mockClaimPayment = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/paystack-server', () => ({
    initializePaystackPayment: (...a: any[]) => mockInitPaystack(...a),
    verifyPaystackPayment: (...a: any[]) => mockVerifyPaystack(...a),
    verifyPaystackWebhook: jest.fn(),
}));
jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (...a: any[]) => mockClaimPayment(...a),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    claimVersionedUpdate: jest.fn(), claimIdempotencyKey: jest.fn(),
    incrementWithinCeiling: jest.fn(), decrementManyOrFail: jest.fn(),
    claimSingleOpenLoanApplication: jest.fn(),
}));
jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminFinancialAction: jest.fn(async () => ({})),
}));
/**
 * The reservation added with the double-charge fix.
 *
 * initializePropertyPaymentAction now CLAIMS the listing before it calls
 * Paystack, so with the real primitive running against these hand-built
 * snapshots nothing is ever claimed and the action returns before reaching any
 * of the price logic below. The claim succeeding is the precondition for every
 * assertion in this file; whether it can be lost is
 * farm-nation-payment-behaviour.test.ts's subject.
 */
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(async () => ({ claimed: true, status: 'pending_escrow' })),
    claimStatusTransitionFromAny: jest.fn(async () => ({ claimed: true, status: 'pending_escrow' })),
}));
jest.mock('@/app/actions/notifications', () => ({ createNotificationAction: jest.fn(async () => ({})) }));

/**
 * getBaseUrl() and the rate limiter both call next/headers, which throws
 * "`headers` was called outside a request scope" under test. Without these the
 * action fails before reaching any of its own logic, and every assertion below
 * fails for a reason that has nothing to do with the code under test.
 */
jest.mock('@/lib/server-utils', () => ({
    getBaseUrl: jest.fn(async () => 'https://test.local'),
}));
jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: jest.fn(async () => ({ success: true, limit: 100, remaining: 99, reset: 0 })) }),
    getClientIp: jest.fn(() => '127.0.0.1'),
    createRateLimitResponse: jest.fn(),
}));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles: [] } },
        error: null,
    }));
}

/** A verified property listed at LISTED_PRICE, owned by SELLER. */
function setProperty(overrides: Record<string, any> = {}) {
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [],
        data: () => ({
            title: 'Two hectares', price: LISTED_PRICE, status: 'verified',
            ownerId: SELLER, ownerName: 'A Seller', category: 'land',
            ...overrides,
        }),
    }));
}

const buyerInfo = {
    fullName: 'A Buyer', email: 'b@e.com', phone: '0800', purpose: 'farming',
    zoningComplianceDeclarationAccepted: true,
};

describe('initialising a property payment', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER);
        setProperty();
        mockInitPaystack.mockResolvedValue({ status: true, data: { authorization_url: 'https://pay', reference: 'ref-1' } });
    });

    /**
     * The real signature is (propertyId, propertyTitle, amount, sellerId,
     * buyerInfo) — FIVE arguments, three of which the caller supplies as
     * identity or money. The first version of this test passed three and every
     * assertion failed on `buyerInfo` being undefined, which is how the extra
     * caller-controlled parameters were noticed at all.
     *
     * `claimedSeller` defaults to an attacker id on purpose: the tests below
     * assert it is ignored.
     */
    async function init(offered: number, claimedSeller = ATTACKER, claimedTitle = 'Free land') {
        const { initializePropertyPaymentAction } = await import('@/app/actions/farm-nation-payment');
        return initializePropertyPaymentAction(PROPERTY, claimedTitle, offered, claimedSeller, buyerInfo as any);
    }

    it('charges the listed price, not the amount offered', async () => {
        // THE test. Offering ₦10,000 for a ₦50,000,000 plot must charge the
        // full ₦50,000,000.
        await init(10_000);

        expect(mockInitPaystack).toHaveBeenCalled();
        const koboCharged = (mockInitPaystack.mock.calls[0] as any[])[1];
        expect(koboCharged).toBe(LISTED_PRICE * 100);
    });

    it('records the listed price on the transaction, not the offer', async () => {
        // propertyPrice and escrowAmount feed the escrow release later, so an
        // attacker-chosen value there decides what the seller is eventually
        // paid.
        await init(10_000);

        const written = (global as any).mockFirestoreSet.mock.calls
            .map((c: any[]) => c[1])
            .find((d: any) => d && 'propertyPrice' in d);

        expect(written?.propertyPrice).toBe(LISTED_PRICE);
        expect(written?.escrowAmount).toBe(LISTED_PRICE);
    });

    it('records the LISTING owner as seller, not the id the caller passed', async () => {
        // metadata.sellerId flowed into the escrow record, where verification
        // read `metadata.sellerId || freshData.ownerId` — so a buyer could name
        // themselves as the seller of someone else's land.
        await init(LISTED_PRICE, ATTACKER);

        const written = (global as any).mockFirestoreSet.mock.calls
            .map((c: any[]) => c[1])
            .find((d: any) => d && 'sellerId' in d);

        expect(written?.sellerId).toBe(SELLER);
        expect(written?.sellerId).not.toBe(ATTACKER);
    });

    it('records the LISTING title, not the caller text', async () => {
        await init(LISTED_PRICE, ATTACKER, 'Free land');

        const written = (global as any).mockFirestoreSet.mock.calls
            .map((c: any[]) => c[1])
            .find((d: any) => d && 'propertyName' in d);

        expect(written?.propertyName).toBe('Two hectares');
    });

    it('refuses a property with no price rather than charging the offer', async () => {
        setProperty({ price: 0 });

        const r: any = await init(10_000);

        expect(r.success).toBe(false);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('still refuses a buyer purchasing their own property', async () => {
        // Vacuity guard for the identity checks that were already correct —
        // fixing the money must not disturb them.
        setSession(SELLER);

        const r: any = await init(LISTED_PRICE);

        expect(r.success).toBe(false);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('still refuses an unverified property', async () => {
        setProperty({ status: 'pending_verification' });

        const r: any = await init(LISTED_PRICE);

        expect(r.success).toBe(false);
    });
});

describe('verifying a property payment', () => {
    /**
     * The verify path runs several follow-on writes after the escrow update —
     * a global transaction row, a payment record, a purchase lookup — and
     * driving all of them through the mock proved more brittle than the guard
     * is worth. Attempts to do so failed on the LAST of those writes, not on
     * the check under test, which makes for a test that fails for a reason
     * unrelated to what it claims.
     *
     * So the underpayment guard is asserted structurally instead: it exists,
     * and it runs BEFORE the property is moved into escrow. That is the
     * property that matters — a check placed after the escrow write would
     * reject a payment that had already been honoured.
     *
     * This is weaker than exercising it, and it is recorded as weaker rather
     * than dressed up. The money defect itself is closed at initialisation and
     * is covered by executing tests above; this is defence in depth for a
     * reference arriving from elsewhere.
     */
    it('compares the paid amount to the listed price, before moving to escrow', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/farm-nation-payment.ts'), 'utf-8');

        const verify = src.slice(src.indexOf('async function _verifyPropertyPaymentAction'));

        const checkAt = verify.indexOf('does not cover the property price');
        const escrowWriteAt = verify.indexOf('escrowHeldAt');

        expect(checkAt).toBeGreaterThan(-1);
        expect(escrowWriteAt).toBeGreaterThan(-1);
        expect(checkAt).toBeLessThan(escrowWriteAt);
    });

    it('takes the seller from the listing, not from Paystack metadata', async () => {
        // It read `metadata.sellerId || freshData.ownerId`, so a caller-supplied
        // seller won and the real owner was only a fallback. Reversed now.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/farm-nation-payment.ts'), 'utf-8');

        expect(src).not.toContain('metadata.sellerId || freshData.ownerId');
        expect(src).toContain('freshData.ownerId || metadata.sellerId');
    });
});
