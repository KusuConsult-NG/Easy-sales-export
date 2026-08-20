/**
 * @jest-environment node
 */

/**
 * #108 — three dispute creators, and only one of them claimed.
 *
 * actions/disputes.ts freezes the escrow with claimStatusTransitionFromAny, and
 * its comment records why: a check-then-write let two disputes on one record
 * both be created, leaving the escrow pointing at whichever wrote its disputeId
 * last and an orphan dispute no resolution path can reach.
 *
 * The two marketplace creators kept the old shape:
 *
 *   marketplace/_escrow_disputes.ts   /escrow/[id]/dispute
 *   marketplace/_escrow_actions.ts    createEscrowDispute
 *
 * Both read the status inside runTransaction — which takes NO lock in this
 * adapter — and then wrote. _createEscrowDispute did not check for an existing
 * open dispute at all.
 *
 * SECOND HALF: _escrow_disputes required `status === "funded"` exactly, while
 * ESCROW_DISPUTEABLE_STATUSES is funded/in_transit/delivered and its own
 * comment says a dispute must be raisable from anything a release can be
 * claimed from, "or the freeze is decorative". Both release paths release from
 * "delivered". So a buyer whose goods had shipped, or arrived damaged, was told
 * the escrow "must be in 'funded' state" — the surviving copy of #48.
 *
 * The claim primitive is stateful here, applying `fromAny` against the seeded
 * row exactly as the SQL does. A stub returning `claimed: true` could not tell
 * a working guard from a missing one.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { ESCROW_DISPUTEABLE_STATUSES } from '@/lib/escrow-status';

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

jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: jest.fn(async () => ({})),
}));
jest.mock('@/lib/africastalking', () => ({
    smsEscrowReleased: jest.fn(), smsDisputeResolved: jest.fn(),
}));
jest.mock('@/lib/fcm', () => ({
    pushEscrowReleased: jest.fn(), pushDisputeResolved: jest.fn(),
}));

let store: FakeDbHandle;

/** Reads the row and applies fromAny, exactly as claim_status_transition does. */
const claimFromAny = jest.fn(async (p: any) => {
    const current = store.get(p.collection, p.id);
    if (!current) return { claimed: false, status: null };
    const status = String(current.status ?? '');
    if (!p.fromAny.includes(status)) return { claimed: false, status };
    store.seed(p.collection, p.id, { ...current, ...(p.patch ?? {}), status: p.to });
    return { claimed: true, status: p.to };
});
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(async () => ({ claimed: true, status: 'x' })),
    claimStatusTransitionFromAny: (p: unknown) => claimFromAny(p),
}));

jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: jest.fn(async () => ({ claimed: true })),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    incrementWithinCeiling: jest.fn(), decrementManyOrFail: jest.fn(),
    markFulfilmentFailed: jest.fn(),
}));

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const ESCROW = 'esc-1';

const ESCROWS = COLLECTIONS.ESCROW_TRANSACTIONS;
const DISPUTES = COLLECTIONS.DISPUTES;

function actAs(id: string | null): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles: ['general_user'], email: `${id}@e.com` } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(BUYER);
});

const seedEscrow = (status = 'funded') =>
    store.seed(ESCROWS, ESCROW, {
        buyerId: BUYER, sellerId: SELLER, amount: 5000,
        status, productName: 'Yams', orderId: 'ORD-1',
    });

const escrow = () => store.get(ESCROWS, ESCROW) as Record<string, any>;

// ─────────────────────────────────────────────────────────────────────────────
describe('_escrow_disputes.createDisputeAction', () => {
    const raise = async (over: Record<string, unknown> = {}) =>
        (await (await import('@/app/actions/marketplace/_escrow_disputes')).createDisputeAction({
            escrowId: ESCROW,
            // Deliberately forged: the action must derive all of these.
            initiatedBy: 'buyer', initiatorId: BUYER, respondentId: SELLER,
            reason: 'The goods arrived damaged and unusable.',
            ...over,
        } as never)) as any;

    beforeEach(() => { seedEscrow(); });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await raise()).toMatchObject({ success: false });
        expect(store.size(DISPUTES)).toBe(0);
    });

    it('refuses a stranger, whatever they claim to be', async () => {
        actAs('stranger-1');
        expect(await raise()).toMatchObject({ success: false, error: 'Unauthorized' });
        expect(store.size(DISPUTES)).toBe(0);
        expect(escrow().status).toBe('funded');
    });

    it('derives the parties from the escrow, never from the request', async () => {
        actAs(SELLER);
        expect(await raise({ initiatorId: BUYER, respondentId: 'somebody' })).toMatchObject({ success: true });

        const [, dispute] = store.all(DISPUTES)[0];
        expect(dispute).toMatchObject({
            initiatedBy: 'seller', initiatorId: SELLER, respondentId: BUYER,
            buyerId: BUYER, sellerId: SELLER, status: 'open',
        });
    });

    it.each([...ESCROW_DISPUTEABLE_STATUSES])(
        'RAISES A DISPUTE from %s, not from "funded" alone', async (status) => {
            // The surviving copy of #48. Both release paths release from
            // "delivered", so refusing a dispute there made the freeze
            // decorative on exactly the states where it matters.
            seedEscrow(status);

            expect(await raise()).toMatchObject({ success: true });
            expect(escrow().status).toBe('disputed');
        });

    it.each(['pending', 'released', 'refunded', 'cancelled'])(
        'refuses from %s, naming the state', async (status) => {
            seedEscrow(status);

            const res = await raise();
            expect(res.success).toBe(false);
            expect(res.error).toContain(status);
            expect(store.size(DISPUTES)).toBe(0);
        });

    it('CANNOT create two disputes on one escrow', async () => {
        // The claim is the check now. Under the old check-then-write both
        // callers read "funded" and both wrote, leaving the escrow pointing at
        // the second disputeId and the first dispute orphaned.
        expect((await raise()).success).toBe(true);
        expect((await raise()).success).toBe(false);

        expect(store.size(DISPUTES)).toBe(1);
    });

    it('links the escrow to the dispute it actually created', async () => {
        await raise();

        const [disputeId] = store.all(DISPUTES)[0];
        expect(escrow().disputeId).toBe(disputeId);
    });

    it('refuses an escrow that does not exist', async () => {
        store.clear();
        expect(await raise()).toMatchObject({ success: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('_escrow_actions.createEscrowDispute', () => {
    const raise = async (reason = 'The goods arrived damaged and unusable.') =>
        (await (await import('@/app/actions/marketplace/_escrow_actions'))
            .createEscrowDispute(ESCROW, reason)) as any;

    beforeEach(() => { seedEscrow(); });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await raise()).toMatchObject({ success: false });
    });

    it('refuses a reason that is too short or too long', async () => {
        expect((await raise('short')).success).toBe(false);
        expect((await raise('x'.repeat(1001))).success).toBe(false);
        expect(store.size(DISPUTES)).toBe(0);
    });

    it('refuses a stranger', async () => {
        actAs('stranger-1');
        expect(await raise()).toMatchObject({
            success: false, error: 'Not authorized to dispute this transaction',
        });
        expect(escrow().status).toBe('funded');
    });

    it('refuses an escrow that does not exist', async () => {
        store.clear();
        expect(await raise()).toMatchObject({ success: false, error: 'Transaction not found' });
    });

    it.each([...ESCROW_DISPUTEABLE_STATUSES])('raises from %s', async (status) => {
        seedEscrow(status);

        expect(await raise()).toMatchObject({ success: true });
        expect(escrow()).toMatchObject({ status: 'disputed' });

        const [, dispute] = store.all(DISPUTES)[0];
        expect(dispute).toMatchObject({
            escrowId: ESCROW, buyerId: BUYER, sellerId: SELLER,
            raisedBy: BUYER, status: 'open',
        });
    });

    it.each(['released', 'refunded'])('refuses a settled %s escrow', async (status) => {
        seedEscrow(status);
        expect((await raise()).success).toBe(false);
        expect(store.size(DISPUTES)).toBe(0);
    });

    it('REFUSES A SECOND DISPUTE — this creator checked for none at all', async () => {
        // The sibling in _escrow_disputes checks; this one simply created
        // another row.
        expect((await raise()).success).toBe(true);

        seedEscrow('funded');   // as if the escrow had been reopened
        const second = await raise();
        expect(second.success).toBe(false);
        expect(second.error).toContain('active dispute already exists');
        expect(store.size(DISPUTES)).toBe(1);
    });

    it('lets the seller dispute as well as the buyer', async () => {
        actAs(SELLER);
        expect(await raise()).toMatchObject({ success: true });
        expect(store.all(DISPUTES)[0][1].raisedBy).toBe(SELLER);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('all three creators now agree', () => {
    it('every one of them claims the escrow transition', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const { stripComments } = await import('@/lib/testing/strip-comments');

        const files = [
            'src/app/actions/disputes.ts',
            'src/app/actions/marketplace/_escrow_disputes.ts',
            'src/app/actions/marketplace/_escrow_actions.ts',
        ];

        for (const rel of files) {
            const src = stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });
            expect(src).toContain('claimStatusTransitionFromAny');
            // The shape that was wrong: writing the freeze straight onto the row.
            expect(src).not.toMatch(/update\(\s*\{\s*status:\s*"disputed"/);
        }
    });
});
