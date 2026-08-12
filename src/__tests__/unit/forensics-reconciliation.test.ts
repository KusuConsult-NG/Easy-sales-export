/**
 * @jest-environment node
 */

/**
 * The platform's financial reconciliation check reconciled nothing.
 *
 * forensics.ts runs one scan across every module, and its Cooperative section
 * is the only automated check anywhere in this codebase that compares a stored
 * money balance against the ledger that should explain it. It was wrong on both
 * sides of the comparison.
 *
 * THE BALANCE SIDE
 * ----------------
 *     const profileBalance = doc.data().cooperativeProfile?.savingsBalance || 0;
 *
 * read off the USER document. Nothing in the codebase writes
 * `cooperativeProfile` — not one line, checked by grep across src. The
 * maintained balance lives on the COOPERATIVE_MEMBERS document as
 * `savingsBalance`: it is what debitJsonbBalanceWithFloor debits for a
 * withdrawal, and what user.ts reads before allowing account deletion.
 *
 * So `|| 0` turned "this field does not exist" into "the balance is zero", for
 * every member, forever. Same shape as a test asserting against an empty array:
 * the check ran, reported, and could not fail for the right reason.
 *
 * THE LEDGER SIDE
 * ---------------
 * It summed types `deposit`, `contribution` and `loan_repayment_excess`, and
 * subtracted `withdrawal`.
 *
 * `_makeContributionAction` is what credits savingsBalance, and it writes its
 * row with type **"savings"** — not in the list. And `withdrawal` is never
 * written at all: a withdrawal moves savings into lockedBalance and records a
 * cooperative_withdrawals document.
 *
 * WHAT THE FIX DOES
 * -----------------
 * Reads the member document, counts "savings" among the credit types, includes
 * lockedBalance (money reserved for a pending withdrawal is still the member's),
 * and reports a member with no membership record as a finding rather than
 * silently scoring them zero.
 *
 * The `details` string now states the sample size and exactly what was
 * compared, so a "pass" cannot be read as more than it is — 20 members sampled
 * is not the same as the cooperative being sound.
 *
 * WHY THIS MATTERS BEYOND ITSELF
 * ------------------------------
 * PR #110 fixed a read-adjust-write on cooperative savings that could silently
 * lose a member's contribution. This is the check that exists to catch exactly
 * that class of drift, and it could not have.
 *
 * A NOTE ON WHICH TESTS PROVE WHAT
 * --------------------------------
 * Only four of these fail against the old code, and the two "passes when they
 * match" cases pass against BOTH versions — for opposite reasons. The old check
 * compared 0 (a field that does not exist) against 0 (no rows of a type it
 * counted), so it passed everything put in front of it.
 *
 * That is the shape of the whole problem: a check that always passes looks
 * identical to a healthy system. The tests that carry the weight here are the
 * ones asserting a mismatch IS reported.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const ADMIN = 'admin-1';
const MEMBER = 'member-1';

jest.mock('@/lib/firebase-admin', () => ({
    adminAuth: { listUsers: jest.fn(async () => ({ users: [] })) },
    getAdminAuth: () => ({ listUsers: jest.fn(async () => ({ users: [] })) }),
}));
jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));

function setSession(id: string, roles: string[]) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles } },
        error: null,
    }));
}

/**
 * The scan touches many collections. Everything that is not part of the
 * cooperative reconciliation returns empty, so the other checks pass quietly and
 * the assertions below are about the one section under test.
 */
function setWorld(opts: {
    memberDoc?: Record<string, any> | null;
    ledger?: Array<{ type: string; amount: number }>;
} = {}) {
    const memberDoc = opts.memberDoc === undefined ? { savingsBalance: 50_000, lockedBalance: 0 } : opts.memberDoc;
    const ledger = opts.ledger ?? [];

    (global as any).mockFirestoreGet.mockImplementation((idOrCollection: string) => {
        // The users query that selects cooperative members.
        if (idOrCollection === 'users') {
            return Promise.resolve({
                exists: false, empty: false,
                docs: [{ id: MEMBER, data: () => ({ roles: ['cooperative_member'] }) }],
                data: () => ({}),
            });
        }
        // The ledger query.
        if (idOrCollection === 'cooperative_transactions') {
            return Promise.resolve({
                exists: false, empty: ledger.length === 0,
                docs: ledger.map((row, i) => ({ id: `tx-${i}`, data: () => ({ ...row, status: 'completed' }) })),
                data: () => ({}),
            });
        }
        // The membership document, fetched by id.
        if (idOrCollection === MEMBER) {
            return Promise.resolve(
                memberDoc === null
                    ? { exists: false, empty: true, docs: [], data: () => undefined }
                    : { exists: true, empty: false, docs: [], data: () => memberDoc }
            );
        }
        // Everything else the scan touches.
        return Promise.resolve({ exists: false, empty: true, docs: [], data: () => ({}) });
    });
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: false, empty: true, docs: [], data: () => ({}),
    }));
}

async function scan() {
    const { runForensicScanAction } = await import('@/app/actions/forensics');
    return runForensicScanAction();
}

function reconciliation(result: any) {
    const results = result?.data?.results ?? result?.results ?? [];
    return results.find((r: any) => r.check === 'Financial Reconciliation (Balance vs Txs)');
}

describe('the cooperative reconciliation compares the balance that exists', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(ADMIN, ['admin']);
    });

    it('passes when the member document matches the ledger', async () => {
        // ₦50,000 held, and a savings row for ₦50,000 to explain it.
        setWorld({
            memberDoc: { savingsBalance: 50_000, lockedBalance: 0 },
            ledger: [{ type: 'savings', amount: 50_000 }],
        });

        const check = reconciliation(await scan());

        expect(check).toBeDefined();
        expect(check.status).toBe('pass');
    });

    it('counts "savings" rows, which the old list omitted', async () => {
        // THE ledger-side test. _makeContributionAction — the function that
        // actually credits savingsBalance — writes type "savings", and the old
        // check counted deposit/contribution/loan_repayment_excess only. With
        // that list a matching member reads as a mismatch.
        setWorld({
            memberDoc: { savingsBalance: 120_000, lockedBalance: 0 },
            ledger: [{ type: 'savings', amount: 100_000 }, { type: 'savings', amount: 20_000 }],
        });

        const check = reconciliation(await scan());

        expect(check.status).toBe('pass');
    });

    it('reports a member whose held balance exceeds the ledger', async () => {
        // Real drift: money on the account that no completed transaction
        // explains. This is the class of fault the check exists for.
        setWorld({
            memberDoc: { savingsBalance: 90_000, lockedBalance: 0 },
            ledger: [{ type: 'savings', amount: 50_000 }],
        });

        const check = reconciliation(await scan());

        expect(check.status).toBe('fail');
        expect(String(check.affectedIds)).toContain(MEMBER);
    });

    it('reports a ledger that exceeds the held balance', async () => {
        // The direction PR #110's lost-contribution race would have produced:
        // the receipt exists, the balance never moved.
        setWorld({
            memberDoc: { savingsBalance: 50_000, lockedBalance: 0 },
            ledger: [{ type: 'savings', amount: 50_000 }, { type: 'savings', amount: 25_000 }],
        });

        const check = reconciliation(await scan());

        expect(check.status).toBe('fail');
    });

    it('counts money locked for a pending withdrawal as still the member\'s', async () => {
        // A withdrawal request moves savings into lockedBalance and writes no
        // ledger row. Ignoring lockedBalance would report every pending
        // withdrawal as a discrepancy.
        setWorld({
            memberDoc: { savingsBalance: 20_000, lockedBalance: 30_000 },
            ledger: [{ type: 'savings', amount: 50_000 }],
        });

        const check = reconciliation(await scan());

        expect(check.status).toBe('pass');
    });

    it('reports a member with no membership record instead of scoring them zero', async () => {
        // The precise failure being fixed: an absent field or document used to
        // become the number 0, which matched an empty ledger and passed.
        setWorld({ memberDoc: null, ledger: [] });

        const check = reconciliation(await scan());

        expect(check.status).toBe('fail');
        expect(String(check.affectedIds)).toMatch(/no membership record/i);
    });

    it('says what it compared and how many it sampled', async () => {
        // A "pass" over 20 sampled members is not the cooperative being sound,
        // and the check now says so itself rather than leaving the reader to
        // assume.
        setWorld({ memberDoc: { savingsBalance: 0, lockedBalance: 0 }, ledger: [] });

        const check = reconciliation(await scan());

        expect(check.details).toMatch(/sampled/i);
        expect(check.details).toMatch(/savingsBalance/);
        expect(check.details).toMatch(/savings/);
    });
});

describe('the scan itself', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setWorld();
    });

    it('refuses a caller who is not an admin', async () => {
        setSession(MEMBER, ['cooperative_member']);

        const r: any = await scan();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/admin/i);
    });

    it('runs for a super_admin', async () => {
        // The guard reads
        //   !roles.includes("super_admin") && (!roles.includes("admin") && !roles.includes("super_admin"))
        // which is redundant but correct — it allows admin OR super_admin.
        // Asserted rather than reasoned about, since the shape invites a
        // misreading.
        setSession('super-1', ['super_admin']);

        const r: any = await scan();

        expect(r.success).toBe(true);
    });

    it('runs for a plain admin', async () => {
        setSession(ADMIN, ['admin']);

        const r: any = await scan();

        expect(r.success).toBe(true);
    });
});
