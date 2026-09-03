/**
 * @jest-environment node
 */

/**
 * THE LIST COULD SEE THE ACCOUNT AND THE PAYOUT COULD NOT — IN THREE OF THE
 * FOUR PLACES THAT PAY ANYBODY.
 *
 * A USERS document can hold its bank details in either of two shapes, and which
 * one a member has depends only on how they were onboarded:
 *
 *   admin/_legacy.ts            writes the TOP-LEVEL `bankAccountNumber`
 *   admin/_applications.ts      writes `bankDetails.accountNumber` — this is
 *                               the admin CORRECTION screen, the thing support
 *                               uses when a payout fails
 *   the module forms            write a nested `bankDetails` block too
 *
 * lib/canonical/normalizer.ts's extractCanonicalUser exists to resolve that: it
 * walks the whole chain, verificationProfile first, then bankDetails, then the
 * flat keys, then bankAccount. Every admin LIST in the platform hydrates through
 * it.
 *
 * Four code paths actually send money through Paystack. ONE of them resolved the
 * destination that way. wave/_wv_admin_withdrawals.ts found the defect and its
 * comment states the shape exactly:
 *
 *     "This read `userData.bankCode` — a TOP-LEVEL field that no WAVE path
 *      writes... extractCanonicalUser is this file's own resolver: it is already
 *      imported and already used, forty lines up, to build the bank details
 *      shown in the admin LIST. The list could see the account and the payout
 *      could not."
 *
 * That fix reached one path. The other three still read the top-level keys:
 *
 *   admin/_loans.ts         `borrowerData?.bankAccountNumber && borrowerData?.bankCode`
 *   admin/_withdrawals.ts   `userData?.bankAccountNumber && userData?.bankCode`
 *   order-management.ts     `sellerData?.bankAccountNumber && sellerData?.bankCode`
 *
 * EXECUTED, on the loan path, before any change: a borrower carrying only
 * `bankDetails: { accountNumber, bankCode }` — the shape the admin correction
 * screen writes — had their loan APPROVED, parked with
 * `pendingManualDisbursement: true` and the note "Borrower bank details not
 * configured", and paystackPayout was never called. The canonical resolver reads
 * that same document and returns the account number.
 *
 * THE MARKETPLACE ONE IS THE WORST OF THE THREE. There the check gates
 * `sellerAmount`, and the caller guards the transfer on `sellerAmount > 0`. So
 * the seller was not parked for manual handling and no error was raised — the
 * order completed and they were simply paid nothing.
 *
 * NOT CHANGED: wallet.ts. It reads `txnData.bankDetails`, the destination
 * captured on the withdrawal transaction itself at request time, which is a
 * different and correct source. Asserted below so the exemption is on the
 * record rather than an omission.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { extractCanonicalUser } from '@/lib/canonical/normalizer';

jest.mock('@/lib/redis', () => ({
    redis: null,
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    CACHE_TTL: {},
}));
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateAdminGlobalStats: jest.fn(async () => undefined),
    invalidateCooperativeCache: jest.fn(async () => undefined),
    invalidateUserCache: jest.fn(async () => undefined),
}));
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: jest.fn(async () => ({ success: true })),
}));
jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: jest.fn(async () => ({})),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
    logAuditAction: jest.fn(async () => undefined),
}));

const paystackPayout = jest.fn(
    async (_destination: any, _amount: number, _reason: string, _reference: string) =>
        ({ success: true, transferCode: 'TRF_1' } as any));
jest.mock('@/lib/require-admin', () => ({
    requireAdmin: jest.fn(async () => ({ userId: 'admin-1' })),
}));

jest.mock('@/lib/paystack-transfer', () => ({
    paystackPayout: (a: any, b: number, c: string, d: string) => paystackPayout(a, b, c, d),
    payoutReference: (prefix: string, id: string) => `${prefix}_${id}`,
}));

let store: FakeDbHandle;

/** The Postgres CAS, backed by the same in-memory store. */
const claim = jest.fn(async (args: any) => {
    const { collection, id, fromAny, to, patch } = args;
    const doc = store.get(collection, id);
    if (!doc) return { claimed: false, exists: false, status: null };
    const current = doc.status ?? null;
    if (!fromAny.includes(current)) return { claimed: false, exists: true, status: current };
    store.seed(collection, id, { ...doc, ...(patch ?? {}), status: to });
    return { claimed: true, exists: true, status: to };
});
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransitionFromAny: (args: any) => claim(args),
    claimStatusTransition: (args: any) => claim({ ...args, fromAny: [args.from] }),
}));

declare const global: any;

const ACCOUNT = '0123456789';
const BANK_CODE = '058';

/** The shape admin/_applications.ts — the correction screen — writes. */
const NESTED_ONLY = {
    email: 'member@example.com',
    fullName: 'Ada Obi',
    name: 'Ada Obi',
    bankDetails: {
        bankName: 'GTB', accountNumber: ACCOUNT, accountName: 'Ada Obi', bankCode: BANK_CODE,
    },
};

/** The shape admin/_legacy.ts writes for a bulk-imported member. */
const FLAT_ONLY = {
    email: 'member@example.com',
    fullName: 'Ada Obi',
    name: 'Ada Obi',
    bankName: 'GTB',
    bankAccountNumber: ACCOUNT,
    bankAccountName: 'Ada Obi',
    bankCode: BANK_CODE,
};

function actAs(roles: string[] = ['super_admin']) {
    global.mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: 'admin-1', roles, email: 'admin@example.com', name: 'Admin' } },
        error: null,
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs();
});

describe('the premise: both shapes exist and the resolver reads both', () => {
    it.each([
        ['the nested shape the correction screen writes', NESTED_ONLY],
        ['the flat shape the legacy importer writes', FLAT_ONLY],
    ])('extractCanonicalUser finds the account in %s', (_label, doc) => {
        const canonical = extractCanonicalUser(doc);

        expect(canonical.bankDetails.accountNumber).toBe(ACCOUNT);
        expect(canonical.bankDetails.bankCode).toBe(BANK_CODE);
    });

    it('and the flat key genuinely is absent from the nested shape', () => {
        // Which is why the old guard could not pass. Asserted so the finding
        // rests on the document, not on a reading of it.
        expect((NESTED_ONLY as any).bankAccountNumber).toBeUndefined();
        expect((NESTED_ONLY as any).bankCode).toBeUndefined();
    });
});

describe('the loan disbursement', () => {
    async function approve(borrower: Record<string, unknown>) {
        store.seed(COLLECTIONS.USERS, 'm1', borrower);
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'L1', {
            userId: 'm1', amount: 100_000, contributionAmount: 400_000, status: 'pending',
            userEmail: 'member@example.com', durationMonths: 6, interestRate: 3,
            monthlyPayment: 18_000, totalRepayment: 108_000, loanProduct: 'cooperative',
        });
        const { approveLoanApplication } = await import('@/app/actions/admin/_loans');
        const res = (await approveLoanApplication('L1')) as any;
        return { res, loan: store.get(COLLECTIONS.LOAN_APPLICATIONS, 'L1') ?? {} };
    }

    it('PAYS OUT A BORROWER IN THE NESTED SHAPE — this parked them for manual handling', async () => {
        const { loan } = await approve(NESTED_ONLY);

        expect(paystackPayout).toHaveBeenCalled();
        expect(paystackPayout.mock.calls[0][0]).toMatchObject({
            accountNumber: ACCOUNT, bankCode: BANK_CODE,
        });
        expect(loan.pendingManualDisbursement).not.toBe(true);
        expect(loan.status).toBe('disbursed');
    });

    it('and still pays out a borrower in the flat shape', async () => {
        await approve(FLAT_ONLY);

        expect(paystackPayout.mock.calls[0][0]).toMatchObject({
            accountNumber: ACCOUNT, bankCode: BANK_CODE,
        });
    });

    it('and when there really is no account, says WHICH part is missing', async () => {
        const { loan } = await approve({ email: 'm@example.com', fullName: 'Ada Obi' });

        expect(paystackPayout).not.toHaveBeenCalled();
        expect(loan.pendingManualDisbursement).toBe(true);
        expect(String(loan.disbursementNote)).toContain('account number and bank code');
    });

    it('and a bank code stored without an account number names only that', async () => {
        const { loan } = await approve({
            email: 'm@example.com', fullName: 'Ada Obi',
            bankDetails: { bankName: 'GTB', accountNumber: ACCOUNT, accountName: 'Ada Obi' },
        });

        expect(String(loan.disbursementNote)).toContain('no bank code');
        expect(String(loan.disbursementNote)).not.toContain('account number and');
    });
});

describe('the marketplace seller payout', () => {
    async function completeOrder(seller: Record<string, unknown>) {
        // The buyer confirms delivery — that is the door this payout is behind.
        global.mockRequireSession.mockImplementation(() => Promise.resolve({
            session: { user: { id: 'b1', roles: ['general_user'], email: 'b@example.com' } },
            error: null,
        }));
        store.seed(COLLECTIONS.USERS, 's1', { ...seller, roles: ['seller'] });
        store.seed(COLLECTIONS.MARKETPLACE_ORDERS, 'O1', {
            id: 'O1', sellerId: 's1', buyerId: 'b1', totalAmount: 100_000,
            status: 'delivered', paymentStatus: 'paid', _version: 0,
        });
        const { confirmDeliveryAction } = await import('@/app/actions/order-management');
        return (await confirmDeliveryAction('O1')) as any;
    }

    it('RESOLVES A SELLER IN THE NESTED SHAPE — this paid them nothing, silently', async () => {
        // The worst of the three: the old check gated `sellerAmount`, and the
        // transfer is guarded on `sellerAmount > 0`, so there was no failure to
        // see — the order completed and the seller was simply not paid.
        await completeOrder(NESTED_ONLY).catch(() => undefined);

        const destinations = paystackPayout.mock.calls.map((c) => c[0]);
        expect(destinations).toContainEqual(
            expect.objectContaining({ accountNumber: ACCOUNT, bankCode: BANK_CODE }),
        );
    });
});

describe('the admin withdrawal payout', () => {
    async function process(payee: Record<string, unknown>) {
        store.seed(COLLECTIONS.USERS, 'm1', payee);
        store.seed(COLLECTIONS.WITHDRAWALS, 'W1', {
            userId: 'm1', amount: 25_000, status: 'pending', _version: 0,
            requestedAt: '2026-01-05T00:00:00.000Z',
        });
        const { processWithdrawalAction } = await import('@/app/actions/admin/_withdrawals');
        const res = (await processWithdrawalAction('W1', 'approve')) as any;
        return { res, withdrawal: store.get(COLLECTIONS.WITHDRAWALS, 'W1') ?? {} };
    }

    it('PAYS OUT A MEMBER IN THE NESTED SHAPE — this reported no bank details', async () => {
        await process(NESTED_ONLY);

        expect(paystackPayout).toHaveBeenCalled();
        expect(paystackPayout.mock.calls[0][0]).toMatchObject({
            accountNumber: ACCOUNT, bankCode: BANK_CODE,
        });
    });

    it('and still pays out a member in the flat shape', async () => {
        await process(FLAT_ONLY);

        expect(paystackPayout.mock.calls[0][0]).toMatchObject({
            accountNumber: ACCOUNT, bankCode: BANK_CODE,
        });
    });

    it('and when there really is no account, says WHICH part is missing', async () => {
        const { withdrawal } = await process({ email: 'm@example.com', fullName: 'Ada Obi' });

        expect(paystackPayout).not.toHaveBeenCalled();
        expect(JSON.stringify(withdrawal)).toContain('account number and bank code');
    });
});

describe('every payout path resolves the destination the same way', () => {
    const PAYS_THROUGH_THE_USER_DOCUMENT = [
        'src/app/actions/admin/_loans.ts',
        'src/app/actions/admin/_withdrawals.ts',
        'src/app/actions/order-management.ts',
        'src/app/actions/wave/_wv_admin_withdrawals.ts',
    ];

    it.each(PAYS_THROUGH_THE_USER_DOCUMENT.map((f) => [f]))(
        '%s resolves through extractCanonicalUser',
        (file) => {
            const code = readFileSync(join(process.cwd(), file), 'utf-8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/^\s*\/\/.*$/gm, '');

            expect(code).toContain('extractCanonicalUser(');

            // And the narrow guard that was the defect is gone: a payout may no
            // longer decide it has no account by looking at one flat key.
            expect(code).not.toMatch(/\?\.bankAccountNumber\s*&&\s*\w+\?\.bankCode/);
        },
    );

    it('and wallet.ts is deliberately NOT on that list', () => {
        // It reads the destination captured on the withdrawal transaction
        // itself, not the user document — a different and correct source. On
        // the record so the exemption is a decision rather than an oversight.
        const code = readFileSync(join(process.cwd(), 'src/app/actions/wallet.ts'), 'utf-8');

        expect(code).toContain('txnData.bankDetails');
    });
});
