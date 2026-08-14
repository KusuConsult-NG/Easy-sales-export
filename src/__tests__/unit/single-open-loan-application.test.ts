/**
 * @jest-environment node
 */

/**
 * One open loan application per borrower.
 *
 * WHAT WAS WRONG
 * --------------
 * Two actions refuse a borrower who already has an open application:
 *
 *   cooperative/_actions.ts  _applyForLoanAction   -> COOPERATIVE_LOANS
 *   loan-actions.ts          submitLoanApplication -> LOAN_APPLICATIONS
 *
 * Both read BOTH collections, filtered to the open statuses, and refused if
 * either was non-empty. Neither read took a lock — inside runTransaction or out
 * of it — so two applications submitted together both saw an empty result and
 * both inserted.
 *
 * docs/audit/atomic-money-migration.md records this twice and declines to patch
 * it, correctly: "Closing it needs a uniqueness constraint on a borrower's open
 * applications, not a wrapper."
 *
 * WHY A ROW LOCK COULD NOT FIX IT
 * -------------------------------
 * The thing being guarded is the ABSENCE of rows. There is nothing to lock, so
 * FOR UPDATE has no purchase — this is a phantom, not a lost update. A partial
 * unique index does not fit either: the rule spans two tables, and CREATE UNIQUE
 * INDEX fails outright if existing data already violates it, which the defect
 * itself would have caused.
 *
 * Migration 021 takes a per-borrower advisory lock and does the check AND the
 * insert inside one function, so the lock covers both. A second caller for the
 * same borrower blocks, then sees the row the first one wrote.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockClaimLoanApp = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    claimSingleOpenLoanApplication: (...a: any[]) => mockClaimLoanApp(...a),
    debitJsonbBalance: jest.fn(),
    debitJsonbBalanceWithFloor: jest.fn(),
    creditWalletOnce: jest.fn(),
    debitWalletOnce: jest.fn(),
    debitWalletLocked: jest.fn(),
    claimPaymentOnce: jest.fn(),
    claimIdempotencyKey: jest.fn(),
    claimVersionedUpdate: jest.fn(),
    incrementWithinCeiling: jest.fn(),
    decrementManyOrFail: jest.fn(),
}));

jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(),
    claimStatusTransitionFromAny: jest.fn(),
}));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, name: id, email: `${id}@example.com`, roles: ['user'] } },
        error: null,
    }));
}

function setDocs(data: Record<string, any>) {
    const snap = {
        exists: true,
        empty: false,
        docs: [{ id: 'member-1', data: () => data }],
        data: () => data,
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

describe('loan-actions — submitLoanApplication', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('borrower-1');
        setDocs({ userId: 'borrower-1' });
        mockClaimLoanApp.mockResolvedValue({ claimed: true, existingId: null });
    });

    /** Matches loanApplicationSchema in @/lib/validations/loan — the STRICT one. */
    const application = {
        amount: 200_000,
        purpose: 'working_capital',
        repaymentPeriod: 6,
        collateral: {
            type: 'Inventory',
            value: 500_000,
            description: 'Shop inventory held at the Enugu premises',
        },
        businessDetails: {
            name: 'Ada Stores',
            type: 'Retail',
            yearsInOperation: 4,
            annualRevenue: 4_800_000,
        },
        documents: [
            { name: 'ID', url: 'https://example.com/id.pdf', type: 'id' },
        ],
    } as any;

    async function submit(overrides: Record<string, any> = {}) {
        const { submitLoanApplication } = await import('@/app/actions/loan-actions');
        return submitLoanApplication({ ...application, ...overrides });
    }

    it('inserts through the claim, into the generic table with its collection', async () => {
        // A loan_applications document lives in document_collections and is
        // identified by (id, collection_name). Omitting the collection would let
        // the guard read the wrong rows.
        await submit();

        expect(mockClaimLoanApp).toHaveBeenCalledTimes(1);
        const [args] = mockClaimLoanApp.mock.calls[0] as [any];
        expect(args.userId).toBe('borrower-1');
        expect(args.table).toBe('document_collections');
        expect(args.collection).toBe('loan_applications');
        expect(args.row.status).toBeDefined();
    });

    it('refuses when the borrower already has an open application', async () => {
        // THE test. Two applications submitted together both used to see an
        // empty result and both insert.
        mockClaimLoanApp.mockResolvedValue({ claimed: false, existingId: 'existing-loan' });

        const result: any = await submit();

        expect(result.success).toBe(false);
    });

    it('sends no FieldValue sentinels into the row', async () => {
        // The row is passed to Postgres as JSONB and sentinels are NOT resolved
        // there — the same caveat claim_status_transition carries. It fails
        // silently, by storing a plausible-looking object rather than a date.
        await submit();

        const [args] = mockClaimLoanApp.mock.calls[0] as [any];
        for (const key of ['appliedAt', 'createdAt', 'updatedAt']) {
            expect(typeof args.row[key]).toBe('string');
        }
    });
});

describe('cooperative/_actions — _applyForLoanAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('member-1');
        // Membership with enough savings to clear the 3x limit on 10,000.
        //
        // The loan product's terms are on the same fixture because setDocs
        // answers every .get() with one document. _applyForLoanAction now reads
        // the product from COLLECTIONS.LOAN_PRODUCTS and fails closed on a
        // missing or malformed one — it used to read a collection nothing
        // writes and silently default to 5% over 6 months, so this fixture did
        // not need them.
        setDocs({
            userId: 'member-1',
            savingsBalance: 500_000,
            interestRate: 10,
            durationMonths: 12,
        });
        mockClaimLoanApp.mockResolvedValue({ claimed: true, existingId: null });
    });

    function loanForm(amount = 10_000) {
        const fd = new FormData();
        fd.set('productId', 'prod-1');
        fd.set('amount', String(amount));
        fd.set('purpose', 'Stock purchase for my business');
        return fd;
    }

    async function apply(amount = 10_000) {
        const { applyForLoanAction } = await import('@/app/actions/cooperative/_coop_money');
        return applyForLoanAction({} as any, loanForm(amount));
    }

    it('inserts through the claim, into the dedicated table', async () => {
        await apply();

        expect(mockClaimLoanApp).toHaveBeenCalledTimes(1);
        const [args] = mockClaimLoanApp.mock.calls[0] as [any];
        expect(args.userId).toBe('member-1');
        expect(args.table).toBe('cooperative_loans');
        // A dedicated table needs no collection name.
        expect(args.collection).toBeUndefined();
        expect(args.row.memberId).toBe('member-1');
    });

    it('refuses when the borrower already has an open application', async () => {
        mockClaimLoanApp.mockResolvedValue({ claimed: false, existingId: 'coop-loan-9' });

        const result: any = await apply();

        expect(result.success).toBe(false);
    });

    it('still enforces the 3x savings limit before claiming anything', async () => {
        // Policy checks must run before the claim: a refused application should
        // not consume the guard or write a row.
        const result: any = await apply(9_000_000); // 3x 500,000 = 1,500,000

        expect(result.success).toBe(false);
        expect(mockClaimLoanApp).not.toHaveBeenCalled();
    });
});
