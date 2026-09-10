/**
 * @jest-environment node
 */

/**
 *   #591 THREE FLAGS THAT MEAN SOMEBODY IS OWED MONEY, WRITTEN AND READ BY
 *        NOTHING.
 *
 *   Each is set by a money path that could not finish, and each is the only
 *   record that it did not:
 *
 *     pendingManualDisbursement  admin/_loans.ts sets it when an approved
 *                                loan's Paystack transfer fails, or when the
 *                                borrower has no bank details configured. The
 *                                borrower has an APPROVED loan and no money,
 *                                and the only trace of that is this boolean.
 *
 *     overpaymentStatus          payments/service.ts records "pending_review"
 *                                with the surplus when somebody pays MORE than
 *                                the order. Its own comment says the money was
 *                                previously untracked "so nobody could find the
 *                                money owed back without re-reading Paystack" —
 *                                and then nothing read what it wrote.
 *
 *     escrowNeedsReconciliation  order-management.ts sets it when an escrow
 *                                release came back DUPLICATE or INDETERMINATE:
 *                                the seller may already have been paid, and a
 *                                retry could pay them twice. Its own comment
 *                                says "a human has to check Paystack before
 *                                anyone releases again". Its weaker sibling
 *                                escrowPendingManualRelease IS read by
 *                                cron/reconcile-fulfilment. This one is not.
 *
 *   So three separate modules each record "this money did not arrive", in a
 *   field no screen draws, no job reads and no report counts.
 *
 * ── HOW THEY WERE FOUND, AND HOW THE INSTRUMENT WAS WRONG FIRST ─────────────
 *
 *   By sweep: every field written into a document payload anywhere on the
 *   server, against every mention of that name anywhere in the codebase. 451
 *   fields written, 85 never read — most of the rest being audit trail (*By,
 *   *At) that is legitimately write-only.
 *
 *   THE FIRST VERSION OF THAT SWEEP WAS WRONG, and this check was nearly built
 *   on it. It listed `disbursementTransferCode` as never read; a plain grep
 *   finds ten readers, because the quoting inside the generated grep misfired.
 *   The second version is validated against known answers before its output is
 *   used at all — including `billOfLading`, whose only reader had been added
 *   hours earlier, so the instrument is shown to RESPOND to a change rather
 *   than merely to agree with me.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   NO MONEY IS MOVED AND NOTHING IS REPAIRED. Paying a borrower, refunding a
 *   surplus and deciding whether a seller was already paid are decisions with
 *   money on the other end; this makes them visible, which is what was missing.
 *
 *   TWO OF THE FOUR FLAGS I STARTED WITH ARE ALREADY COVERED, and saying
 *   otherwise would have been the louder, falser finding: `paid_awaiting_refund`
 *   and `escrowPendingManualRelease` are both read by cron/reconcile-fulfilment.
 *   That job's own schedule is a separate matter — the workflow that would run
 *   it has its `on: schedule:` block commented out pending two repository
 *   secrets — and it is recorded for the owner rather than claimed here.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the affected ids emptied                   KILLED (4 tests)
 *     a finding reported as a pass               KILLED (3)
 *     the loan query dropped                     KILLED (2)
 *     the overpayment query dropped              KILLED (2)
 *     the escrow query dropped                   KILLED (2)
 *     the disbursement reason dropped            KILLED
 *     reword the finding comment                 SURVIVED, as intended
 *
 *   No mutant survived. THE HARNESS NEEDED A FIX BEFORE ANY OF THIS COULD BE
 *   TESTED: a query's `.get()` reported only its COLLECTION to the fixture, so
 *   the overpayment and escrow checks — both reading marketplace_orders — were
 *   indistinguishable, and the first seeding answered both. The shared mock
 *   passes the where-clauses now, additively, on the same precedent the doc
 *   read already set. Any suite with two queries against one collection was
 *   measuring the wrong one before this.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { COLLECTIONS } from '@/lib/types/firestore';

const CHECK = 'Money Waiting For A Human';

function setSession(roles: string[]) {
    (global as any).mockRequireSession.mockResolvedValue({
        session: { user: { id: 'admin-1', roles, email: 'a@b.c' } },
        response: null,
    });
}

/**
 * Seed the three queries this check makes, and answer every other query in the
 * scan with an empty world.
 *
 * The adapter mock is told apart by COLLECTION and by the WHERE clause, because
 * two of the three read the same collection — a harness that keyed on the
 * collection alone would hand the overpayment rows to the escrow query and
 * report a finding twice.
 */
function seed(opts: { loans?: any[]; overpaid?: any[]; escrow?: any[] } = {}) {
    const empty = { exists: false, empty: true, size: 0, docs: [], data: () => ({}) };
    const snap = (rows: any[]) => ({
        exists: false, empty: rows.length === 0, size: rows.length, truncated: false,
        docs: rows.map((r) => ({ id: r.id, data: () => r.data })),
        data: () => ({}),
    });

    (global as any).mockFirestoreGet.mockImplementation((collection: string, filters?: any) => {
        const where = JSON.stringify(filters ?? '');
        if (collection === COLLECTIONS.LOAN_APPLICATIONS && where.includes('pendingManualDisbursement')) {
            return Promise.resolve(snap(opts.loans ?? []));
        }
        if (collection === COLLECTIONS.MARKETPLACE_ORDERS && where.includes('overpaymentStatus')) {
            return Promise.resolve(snap(opts.overpaid ?? []));
        }
        if (collection === COLLECTIONS.MARKETPLACE_ORDERS && where.includes('escrowNeedsReconciliation')) {
            return Promise.resolve(snap(opts.escrow ?? []));
        }
        return Promise.resolve(empty);
    });
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(empty));
}

async function scanFor(check: string) {
    const { runForensicScanAction } = await import('@/app/actions/forensics');
    const result: any = await runForensicScanAction();
    return (result.results ?? []).find((r: any) => r.check === check);
}

beforeEach(() => {
    jest.clearAllMocks();
    setSession(['super_admin']);
    seed();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#591 — the money nobody was told about', () => {
    it('AN APPROVED LOAN THAT WAS NEVER DISBURSED IS REPORTED', async () => {
        //   THE defect. The borrower has an approved loan and no money, and the
        //   only record of that was a boolean nothing read.
        seed({
            loans: [{ id: 'loan-1', data: { pendingManualDisbursement: true, disbursementError: 'Transfer failed: insufficient balance' } }],
        });

        const found = await scanFor(CHECK);

        expect(found?.status).toBe('warning');
        expect(found?.affectedIds.join(' ')).toContain('loan-1');
        //   And WHY, because "a loan is stuck" without a reason is another
        //   trip through the logs.
        expect(found?.affectedIds.join(' ')).toContain('insufficient balance');
    });

    it('AND SO IS AN OVERPAYMENT NOBODY REFUNDED', async () => {
        seed({
            overpaid: [{ id: 'order-9', data: { overpaymentStatus: 'pending_review', overpaidBy: 15_000 } }],
        });

        const found = await scanFor(CHECK);

        expect(found?.status).toBe('warning');
        expect(found?.affectedIds.join(' ')).toContain('order-9');
        expect(found?.affectedIds.join(' ')).toContain('15,000');
    });

    it('AND SO IS AN ESCROW RELEASE THAT MAY HAVE PAID THE SELLER TWICE', async () => {
        seed({
            escrow: [{ id: 'order-4', data: { escrowNeedsReconciliation: true } }],
        });

        const found = await scanFor(CHECK);

        expect(found?.status).toBe('warning');
        expect(found?.affectedIds.join(' ')).toContain('order-4');
        expect(found?.affectedIds.join(' ')).toMatch(/paystack/i);
    });

    it('AND ALL THREE AT ONCE ARE ALL THREE', async () => {
        //   Each query is separate; a check that reported only the first would
        //   hide the other two behind a warning that looked handled.
        seed({
            loans: [{ id: 'loan-1', data: { pendingManualDisbursement: true } }],
            overpaid: [{ id: 'order-9', data: { overpaymentStatus: 'pending_review', overpaidBy: 1 } }],
            escrow: [{ id: 'order-4', data: { escrowNeedsReconciliation: true } }],
        });

        const found = await scanFor(CHECK);

        expect(found?.affectedIds).toHaveLength(3);
        expect(found?.details).toContain('1 approved loans');
        expect(found?.details).toContain('1 overpayments');
    });

    it('AND A CLEAN PLATFORM PASSES', async () => {
        //   THE vacuity guard, and the one this file's own history demands:
        //   #331, #372 and #373 each found a forensic check that reported "pass"
        //   for a question it could not ask. A check that warns unconditionally
        //   is the same fault in the other direction.
        const found = await scanFor(CHECK);

        expect(found?.status).toBe('pass');
        expect(found?.affectedIds).toEqual([]);
        expect(found?.details).toContain('0 approved loans');
    });

    it('AND THE CHECK IS PRESENT IN EVERY SCAN, UNDER A MODULE THAT NAMES IT', async () => {
        const { runForensicScanAction } = await import('@/app/actions/forensics');
        const result: any = await runForensicScanAction();

        const found = (result.results ?? []).find((r: any) => r.check === CHECK);
        expect(found?.module).toBe('Finance');
    });
});
