/**
 * @jest-environment node
 */

/**
 * _createDisputeAction — the session was established and then used for nothing.
 *
 * WHAT WAS WRONG
 * --------------
 *     const { session } = sessionResult;      // and never referenced again
 *
 * Every identity came from the caller: `escrowId`, `initiatorId`,
 * `respondentId`. Nothing checked that the caller had any connection to the
 * escrow being disputed.
 *
 * So any authenticated user could open a dispute on ANY funded escrow, moving it
 * to "disputed", and attribute it to whoever they named. The audit row recorded
 * `userId: data.initiatorId` — the person the caller nominated, not the person
 * who acted.
 *
 * This is the vendor-ownership defect exactly: authentication standing in for
 * authorisation. `_createEscrowAction`, in the same file, has always checked
 * `session.user.id !== data.buyerId`. This function did not.
 *
 * THE SECOND DEFECT, FOUND WHILE FIXING THE FIRST
 * -----------------------------------------------
 * The dispute was written without `buyerId` / `sellerId`. Resolution reads those
 * to decide who gets paid and throws "Target beneficiary ID not found on
 * dispute" when they are missing — so every dispute raised from the escrow page
 * was UNRESOLVABLE. An admin could neither release nor refund it.
 *
 * The cause is two types sharing one name: the Dispute in src/types/index.ts
 * declares both fields, the local one in _escrow.ts did not, and the writer used
 * the shorter one.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const STRANGER = 'stranger-1';
const ESCROW_ID = 'esc-1';

/**
 * The claim primitive, HONOURING ITS FROM-SET.
 *
 * The escrow dispute creators freeze through this now (#108) rather than
 * writing inside runTransaction, so it is what refuses a dispute on an escrow
 * that is not disputeable.
 *
 * It is not a stub returning `claimed: true`. A stub that always succeeds
 * cannot tell a working guard from a missing one — which is the lesson this
 * codebase keeps relearning — so it reads the status the test seeded and
 * applies `fromAny` exactly as the SQL does.
 */
let seededEscrowStatus = 'funded';
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(async () => ({ claimed: true, status: 'x' })),
    claimStatusTransitionFromAny: jest.fn(async (p: any) => {
        const allowed: string[] = p?.fromAny ?? [];
        return allowed.includes(seededEscrowStatus)
            ? { claimed: true, status: p.to }
            : { claimed: false, status: seededEscrowStatus };
    }),
}));
jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: jest.fn(async () => ({ claimed: true, status: 'x' })),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    claimVersionedUpdate: jest.fn(), claimIdempotencyKey: jest.fn(),
    incrementWithinCeiling: jest.fn(), decrementManyOrFail: jest.fn(),
    claimSingleOpenLoanApplication: jest.fn(),
}));
jest.mock('@/lib/paystack-server', () => ({ verifyPaystackPayment: jest.fn() }));
jest.mock('@/lib/africastalking', () => ({ smsEscrowReleased: jest.fn(), smsDisputeResolved: jest.fn() }));
jest.mock('@/lib/fcm', () => ({ pushEscrowReleased: jest.fn(), pushDisputeResolved: jest.fn() }));
jest.mock('@/app/actions/notifications', () => ({ createNotificationAction: jest.fn(async () => ({})) }));

const mockAudit = jest.fn(async () => ({}));
jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p),
    createAdminAuditLog: (...a: any[]) => (mockAudit as any)(...a),
    logAdminFinancialAction: jest.fn(async () => ({})),
}));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, roles: [] } },
        error: null,
    }));
}

/** A funded escrow between BUYER and SELLER, and no existing dispute. */
function setDocs(escrowStatus = 'funded') {
    seededEscrowStatus = escrowStatus;
    const escrow = {
        buyerId: BUYER, sellerId: SELLER, amount: 5000,
        status: escrowStatus, productName: 'Yams',
    };
    (global as any).mockFirestoreGet.mockImplementation((key: string) =>
        Promise.resolve(
            key === 'disputes'
                ? { exists: true, empty: true, docs: [], data: () => ({}) }
                : { exists: true, empty: false, docs: [], data: () => escrow }
        )
    );
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [], data: () => escrow,
    }));
}

/** The dispute document written this run, if any. */
function writtenDispute(): Record<string, any> | undefined {
    const calls = [
        ...(global as any).mockFirestoreTxSet.mock.calls,
        ...(global as any).mockFirestoreAdd.mock.calls,
    ];
    return calls.map((c: any[]) => c[1]).find((d: any) => d && 'escrowId' in d);
}

/**
 * The caller always CLAIMS to be the buyer disputing the seller, whatever they
 * actually are. That is the forgery the fix has to defeat.
 */
async function dispute(callerId: string) {
    setSession(callerId);
    const { createDisputeAction } = await import('@/app/actions/marketplace/_escrow_disputes');
    return createDisputeAction({
        escrowId: ESCROW_ID,
        initiatedBy: 'buyer',
        initiatorId: BUYER,
        respondentId: SELLER,
        reason: 'Item never arrived',
    });
}

describe('_createDisputeAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setDocs();
    });

    it('refuses a caller who is neither buyer nor seller', async () => {
        // THE test. escrowId came from the caller and was never compared to
        // them, so any funded escrow on the platform could be frozen by anyone.
        const r: any = await dispute(STRANGER);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/unauthori[sz]ed/i);
        expect(writtenDispute()).toBeUndefined();
    });

    it('lets the buyer dispute their own escrow', async () => {
        // Vacuity guard: the refusal above must not be satisfied by a function
        // that now rejects everyone.
        const r: any = await dispute(BUYER);

        expect(r.success).toBe(true);
        expect(writtenDispute()).toBeDefined();
    });

    it('lets the seller dispute it too', async () => {
        const r: any = await dispute(SELLER);

        expect(r.success).toBe(true);
    });

    it('records the SELLER as initiator when the seller disputes, not the claimed buyer', async () => {
        // The caller passes initiatorId: BUYER regardless. Accepting that let a
        // seller file a dispute in the buyer's name.
        await dispute(SELLER);

        const d = writtenDispute()!;
        expect(d.initiatorId).toBe(SELLER);
        expect(d.initiatedBy).toBe('seller');
        expect(d.respondentId).toBe(BUYER);
    });

    it('attributes the audit row to the real caller', async () => {
        // It logged `userId: data.initiatorId` — the nominated person. An audit
        // trail naming whoever the actor chose is worse than none, because it
        // is believed.
        await dispute(SELLER);

        const [args] = (mockAudit as any).mock.calls[0] as [any];
        expect(args.userId).toBe(SELLER);
    });

    it('writes the parties so the dispute can actually be resolved', async () => {
        // Resolution reads sellerId/buyerId and throws without them. Every
        // dispute raised here was unresolvable.
        await dispute(BUYER);

        const d = writtenDispute()!;
        expect(d.buyerId).toBe(BUYER);
        expect(d.sellerId).toBe(SELLER);
    });

    it('takes the parties from the escrow, not from the request', async () => {
        // Same reason the initiator is derived: a request-supplied sellerId
        // would let the caller nominate who gets paid on resolution.
        await dispute(BUYER);

        const d = writtenDispute()!;
        expect(d.sellerId).toBe(SELLER);
        expect(d.buyerId).not.toBe(STRANGER);
    });

    it('still refuses to dispute an escrow that is not funded', async () => {
        setDocs('pending');

        const r: any = await dispute(BUYER);

        expect(r.success).toBe(false);
    });
});
