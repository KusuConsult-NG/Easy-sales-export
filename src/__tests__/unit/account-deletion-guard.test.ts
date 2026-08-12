/**
 * @jest-environment node
 */

/**
 * Account deletion must not destroy money.
 *
 * WHAT WAS MISSING
 * ----------------
 * `deleteUserAccountAction` is a careful NDPR soft-delete: it scrubs every PII
 * field, removes KYC and seller verification, and keeps the UID so ledgers and
 * orders do not lose their foreign keys.
 *
 * Nothing checked whether the account still held money or owed any. The batch
 * calls `delete()` on the WALLET document outright, so deleting an account with
 * a balance **destroyed it silently**, leaving no record of what was owed. An
 * outstanding cooperative loan survived while the borrower's name and contact
 * details were scrubbed — worse than either outcome alone.
 *
 * Erasure is a right, not an escape hatch. NDPR does not require a controller to
 * forget a debt or a customer to forfeit a balance; it requires the personal
 * data to go once the relationship is settled.
 *
 * IT ALSO HAD NO UI
 * -----------------
 * The action had no caller, so the right existed in the codebase and not for any
 * actual person. That matters more now: this platform's user export sat in a
 * public repository for 52 days, and the people in it may reasonably want their
 * accounts gone.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const USER = 'user-1';

/**
 * Deletion now revokes sign-in as well as scrubbing the profile, so this suite
 * has a new dependency. Unmocked it reaches the real Supabase admin client,
 * fails, and the action reports failure — which turned "proceeds when nothing
 * is outstanding" red for a reason that has nothing to do with obligations.
 *
 * The revocation itself is covered in auth-revocation.test.ts.
 */
jest.mock('@/lib/auth-revocation', () => ({
    revokeAuthAccess: jest.fn(async () => ({ primaryRevoked: true, legacyRevoked: true })),
    syncAuthEmail: jest.fn(async () => ({ primaryRevoked: true, legacyRevoked: true })),
    resolveSupabaseAuthId: jest.fn(async (id: string) => id),
}));
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: jest.fn(async () => ({})),
    invalidateAdminGlobalStats: jest.fn(async () => ({})),
}));

function setSession(id: string | null) {
    (global as any).mockRequireSession.mockImplementation(() =>
        id === null
            ? Promise.resolve({ session: null, error: { error: 'Authentication required' } })
            : Promise.resolve({ session: { user: { id, email: `${id}@e.com`, roles: [] } }, error: null })
    );
}

/**
 * Shape the reads by collection. The action reads the user, wallet, cooperative
 * member, loans and escrows, all through the same stub.
 */
function setState({
    wallet = 0, savings = 0, locked = 0,
    loanStatuses = [] as string[],          // in LOAN_APPLICATIONS, keyed userId
    coopLoanStatuses = [] as string[],       // in COOPERATIVE_LOANS, keyed memberId
    escrowStatuses = [] as string[],
} = {}) {
    // The harness calls mockFirestoreCollection(name) before .doc(), and
    // mockFirestoreGet(docId) for a doc read — so a doc read carries the ID, not
    // the collection. wallets/:userId and cooperative_members/:userId are
    // therefore indistinguishable by argument alone. Tracking the last
    // collection is what tells them apart.
    let lastCollection = '';
    (global as any).mockFirestoreCollection.mockImplementation((name: string) => { lastCollection = name; });

    (global as any).mockFirestoreGet.mockImplementation((key: string) => {
        const where = lastCollection || key;
        if (where === 'wallets') return Promise.resolve({ exists: true, data: () => ({ balance: wallet }), docs: [], empty: false });
        if (where === 'cooperative_members') return Promise.resolve({ exists: true, data: () => ({ savingsBalance: savings, lockedBalance: locked }), docs: [], empty: false });
        // The two loan collections are stubbed SEPARATELY and deliberately.
        //
        // The first version returned the same docs for whichever collection was
        // asked, so the test and the code agreed on the wrong one: the guard
        // queried COOPERATIVE_LOANS by `userId`, but cooperative loans are
        // created in LOAN_APPLICATIONS and COOPERATIVE_LOANS keys on `memberId`.
        // It matched nothing in production and everything in the test.
        if (where === 'loan_applications') return Promise.resolve({
            exists: true, empty: loanStatuses.length === 0,
            docs: loanStatuses.map((status, i) => ({ id: `app-${i}`, data: () => ({ status }) })),
            data: () => ({}),
        });
        if (where === 'cooperative_loans') return Promise.resolve({
            exists: true, empty: coopLoanStatuses.length === 0,
            docs: coopLoanStatuses.map((status, i) => ({ id: `loan-${i}`, data: () => ({ status }) })),
            data: () => ({}),
        });
        if (where === 'escrow_transactions') return Promise.resolve({
            exists: true, empty: escrowStatuses.length === 0,
            docs: escrowStatuses.map((status, i) => ({ id: `esc-${i}`, data: () => ({ status }) })),
            data: () => ({}),
        });
        // the user document, and the KYC query
        return Promise.resolve({ exists: true, empty: true, docs: [], data: () => ({ fullName: 'A Person' }) });
    });
}

/** Did anything destructive actually run? */
const scrubbed = () => (global as any).mockFirestoreBatchCommit.mock.calls.length > 0;

async function deleteAccount() {
    const { deleteUserAccountAction } = await import('@/app/actions/user');
    return deleteUserAccountAction();
}

describe('deleteUserAccountAction — obligations', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(USER);
        setState();
    });

    it('refuses while a wallet balance remains, and does not scrub', async () => {
        // THE test. The batch calls delete() on the wallet document, so this
        // previously destroyed the balance with no record of it.
        setState({ wallet: 12_500 });

        const r: any = await deleteAccount();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/12,500/);
        expect(scrubbed()).toBe(false);
    });

    it('refuses while cooperative savings remain', async () => {
        setState({ savings: 40_000 });

        const r: any = await deleteAccount();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/cooperative savings/i);
        expect(scrubbed()).toBe(false);
    });

    it('refuses while a withdrawal is still locked', async () => {
        setState({ locked: 5_000 });

        const r: any = await deleteAccount();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/locked/i);
    });

    it('refuses while a loan is outstanding in LOAN_APPLICATIONS', async () => {
        // Where cooperative loans are actually created. Scrubbing the
        // borrower's name while the debt survives is worse than either outcome
        // alone.
        setState({ loanStatuses: ['disbursed'] });

        const r: any = await deleteAccount();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/outstanding loan/i);
        expect(scrubbed()).toBe(false);
    });

    it('refuses while a loan is outstanding in COOPERATIVE_LOANS', async () => {
        // The other collection, keyed on memberId rather than userId. Checking
        // one and not the other is how the first version of this guard let a
        // borrower through.
        setState({ coopLoanStatuses: ['approved'] });

        const r: any = await deleteAccount();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/outstanding loan/i);
        expect(scrubbed()).toBe(false);
    });

    it('refuses while an escrow is live, on either side', async () => {
        // As buyer their money is held; as seller they are owed it.
        setState({ escrowStatuses: ['funded'] });

        const r: any = await deleteAccount();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/escrow/i);
    });

    it('names every blocker at once, not just the first', async () => {
        // Being refused five times in a row, learning one reason each time, is
        // its own kind of broken.
        setState({ wallet: 100, savings: 200, loanStatuses: ['active'] });

        const r: any = await deleteAccount();

        const msg = String(r.error);
        expect(msg).toMatch(/wallet balance/i);
        expect(msg).toMatch(/cooperative savings/i);
        expect(msg).toMatch(/outstanding loan/i);
    });

    it('ignores settled loans and closed escrows', async () => {
        // A repaid loan and a released escrow must not block erasure forever.
        setState({ loanStatuses: ['repaid'], coopLoanStatuses: ['rejected'], escrowStatuses: ['released', 'refunded'] });

        const r: any = await deleteAccount();

        expect(r.success).toBe(true);
    });

    it('proceeds when nothing is outstanding', async () => {
        // Vacuity guard. Every assertion above is satisfied by an action that
        // refuses everyone, which would deny the right entirely — the failure
        // that looks like caution.
        const r: any = await deleteAccount();

        expect(r.success).toBe(true);
        expect(scrubbed()).toBe(true);
    });

    it('still refuses an unauthenticated caller', async () => {
        setSession(null);

        const r: any = await deleteAccount();

        expect(r.success).toBe(false);
        expect(scrubbed()).toBe(false);
    });
});
