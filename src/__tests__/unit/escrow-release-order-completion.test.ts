/**
 * @jest-environment node
 */

/**
 * releaseEscrowFunds — completing the order it just paid out for.
 *
 * WHAT WAS WRONG
 * --------------
 * The function decided whether to mark the order "completed" by asking whether
 * every OTHER escrow on that order was already released. It asked that of a
 * snapshot taken near the top of the function — BEFORE the release was claimed:
 *
 *     const orderEscrowsQuery = await db.collection(ESCROW_TRANSACTIONS)
 *         .where("orderId", "==", orderId).get();      // <- read here
 *     ...
 *     const claim = await claimStatusTransitionFromAny({...});   // <- claimed here
 *     ...
 *     const otherEscrows = orderEscrowsQuery.docs.filter(...);   // <- used here
 *
 * That answers "were the siblings released before I started?", which is not the
 * question. On a multi-seller order with two escrows released at the same time,
 * both callers held a snapshot taken before either claim, so each saw the other
 * as unreleased and NEITHER completed the order.
 *
 * WHY THAT COSTS MONEY RATHER THAN JUST LOOKING UNTIDY
 * ---------------------------------------------------
 * Every seller has been paid, and the order sits at "delivered". disputes.ts
 * refuses a dispute only on "completed" and "cancelled" — so the order stays
 * disputable indefinitely after all its sellers have taken their money.
 *
 * THE FIX IS A RE-READ, AND IT CLOSES THE RACE RATHER THAN NARROWING IT
 * --------------------------------------------------------------------
 * Each caller re-reads strictly after its own claim commits. For any two
 * callers, the later read therefore follows both claims — so whoever reads last
 * observes every release and completes the order. There is no interleaving in
 * which all callers miss it.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const ADMIN = 'admin-1';
const ORDER_ID = 'ord-1';
const THIS_ESCROW = 'esc-1';
const SIBLING = 'esc-2';

const mockClaimFromAny = jest.fn() as jest.Mock<any>;

/** Escrow rows returned by the NEXT collection query, in call order. */
let escrowQueryResults: Array<Array<{ id: string; status: string }>> = [];
let escrowQueryCount = 0;

jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(),
    claimStatusTransitionFromAny: (...a: any[]) => mockClaimFromAny(...a),
}));
/**
 * The money now moves through credit_wallet_once rather than a hand-rolled
 * wallet write, so the release path has a new dependency. Unmocked it reaches
 * the real Supabase RPC, throws, and the action returns a failure before it ever
 * gets to the order-completion write this file is about — every assertion below
 * would fail for a reason unrelated to order completion.
 */
jest.mock('@/lib/wallet-ledger', () => ({
    creditWalletOnce: jest.fn(async () => ({ claimed: true, balance: 5000 })),
    debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(), claimPaymentOnce: jest.fn(),
    debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    claimVersionedUpdate: jest.fn(), claimIdempotencyKey: jest.fn(),
    incrementWithinCeiling: jest.fn(), decrementManyOrFail: jest.fn(),
    claimSingleOpenLoanApplication: jest.fn(),
}));
jest.mock('@/lib/africastalking', () => ({ smsEscrowReleased: jest.fn(), smsDisputeResolved: jest.fn() }));
jest.mock('@/lib/fcm', () => ({ pushEscrowReleased: jest.fn(), pushDisputeResolved: jest.fn() }));
jest.mock('@/app/actions/notifications', () => ({ createNotificationAction: jest.fn(async () => ({})) }));
jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminFinancialAction: jest.fn(async () => ({})),
}));

function setSession(id: string, roles: string[] = ['admin']) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, roles } },
        error: null,
    }));
}

/**
 * The escrow being released, plus whatever the sibling-escrow query should
 * return on each successive call.
 */
function setup(queryResults: Array<Array<{ id: string; status: string }>>) {
    escrowQueryResults = queryResults;
    escrowQueryCount = 0;

    (global as any).mockFirestoreGet.mockImplementation((idOrCollection: string) => {
        // The harness calls mockFirestoreGet(docId) for .doc(id).get() and
        // mockFirestoreGet(collectionName) for a .where(...).get(). The
        // collection name is therefore how a query is recognised.
        const isQuery = idOrCollection === 'escrow_transactions';
        if (isQuery) {
            const rows = escrowQueryResults[Math.min(escrowQueryCount, escrowQueryResults.length - 1)] ?? [];
            escrowQueryCount += 1;
            return Promise.resolve({
                exists: true,
                empty: rows.length === 0,
                docs: rows.map((r) => ({ id: r.id, data: () => ({ ...r, orderId: ORDER_ID }) })),
                data: () => ({}),
            });
        }
        return Promise.resolve({
            exists: true,
            empty: false,
            docs: [],
            data: () => ({
                orderId: ORDER_ID,
                buyerId: 'buyer-1',
                sellerId: 'seller-1',
                amount: 5000,
                status: 'delivered',
                productName: 'Yams',
            }),
        });
    });

    // The seller's wallet is read with tx.get inside runTransaction. Without
    // this the credit throws on `.exists` and the run never reaches step 5,
    // which would make every completion assertion below pass or fail for the
    // wrong reason.
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: true,
        empty: false,
        docs: [],
        data: () => ({ balance: 0, userId: 'seller-1' }),
    }));
}

/**
 * Every "completed" order patch written by the run.
 *
 * The order write happens as tx.update(ref, fields) inside runTransaction, so it
 * lands on mockFirestoreTxUpdate — with the patch as the SECOND argument.
 * Plain .update() calls are included too, so the assertion does not quietly stop
 * seeing the write if it moves out of the transaction.
 */
function completedOrderPatches(): Record<string, any>[] {
    const calls = [
        ...(global as any).mockFirestoreTxUpdate.mock.calls,
        ...(global as any).mockFirestoreUpdate.mock.calls,
    ];
    return calls
        .map((c: any[]) => c[1])
        .filter((p: any) => p && p.status === 'completed');
}

async function release() {
    const { releaseEscrowFunds } = await import('@/app/actions/marketplace');
    return releaseEscrowFunds(THIS_ESCROW);
}

describe('releaseEscrowFunds — order completion', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(ADMIN);
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'released' });
    });

    it('completes the order when the sibling is released DURING this call', async () => {
        // THE test, and the only one that can tell the two implementations
        // apart. Counting queries cannot: the old code ran one query and so
        // does the new one. What separates them is WHEN it runs.
        //
        // So the sibling's status is tied to whether the claim has happened —
        // "delivered" before, "released" after. That is exactly the concurrent
        // multi-seller case: the other admin's release commits while this call
        // is in flight.
        //
        // Read before the claim  -> sibling looks delivered -> order never completes.
        // Read after the claim   -> sibling looks released  -> order completes.
        let claimed = false;
        mockClaimFromAny.mockImplementation(async () => {
            claimed = true;
            return { claimed: true, status: 'released' };
        });

        setup([]);
        (global as any).mockFirestoreGet.mockImplementation((idOrCollection: string) => {
            if (idOrCollection === 'escrow_transactions') {
                // Captured HERE, at query time — not inside data(). A snapshot
                // holds what the rows looked like when it was taken. Resolving
                // `claimed` lazily inside data() would let a pre-claim snapshot
                // return post-claim values, which is precisely the bug being
                // tested and would make this assertion vacuous.
                const siblingStatus = claimed ? 'released' : 'delivered';
                return Promise.resolve({
                    exists: true, empty: false, data: () => ({}),
                    docs: [
                        { id: THIS_ESCROW, data: () => ({ status: 'released', orderId: ORDER_ID }) },
                        { id: SIBLING, data: () => ({ status: siblingStatus, orderId: ORDER_ID }) },
                    ],
                });
            }
            return Promise.resolve({
                exists: true, empty: false, docs: [],
                data: () => ({
                    orderId: ORDER_ID, buyerId: 'buyer-1', sellerId: 'seller-1',
                    amount: 5000, status: 'delivered', productName: 'Yams',
                }),
            });
        });

        await release();

        expect(completedOrderPatches().length).toBeGreaterThanOrEqual(1);
    });

    it('completes the order when this is the only escrow', async () => {
        setup([[{ id: THIS_ESCROW, status: 'released' }]]);

        await release();

        expect(completedOrderPatches().length).toBeGreaterThanOrEqual(1);
        expect(completedOrderPatches()[0]).toMatchObject({
            status: 'completed',
            paymentStatus: 'paid_to_seller',
        });
    });

    it('completes the order once the sibling has also been released', async () => {
        // The concurrent case, from the perspective of whoever reads last: the
        // other admin's claim has committed by now, so the fresh read sees it.
        setup([[
            { id: THIS_ESCROW, status: 'released' },
            { id: SIBLING, status: 'released' },
        ]]);

        await release();

        expect(completedOrderPatches().length).toBeGreaterThanOrEqual(1);
    });

    it('does NOT complete the order while a sibling is still unreleased', async () => {
        // Vacuity guard, and the real rule: one seller paid is not the order
        // done. Completing here would make the order undisputable while another
        // seller has had nothing.
        setup([[
            { id: THIS_ESCROW, status: 'released' },
            { id: SIBLING, status: 'delivered' },
        ]]);

        await release();

        expect(completedOrderPatches()).toHaveLength(0);
    });

    it('ignores this escrow own status when judging the siblings', async () => {
        // The row was claimed to "released" moments ago; including it in the
        // check would be asking whether our own write landed.
        setup([[{ id: THIS_ESCROW, status: 'delivered' }]]);

        await release();

        expect(completedOrderPatches().length).toBeGreaterThanOrEqual(1);
    });

    it('does not pay out or complete when the release claim is lost', async () => {
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'released' });
        setup([[{ id: THIS_ESCROW, status: 'released' }]]);

        const r: any = await release();

        expect(r.success).toBe(false);
        expect(completedOrderPatches()).toHaveLength(0);
    });
});
