/**
 * @jest-environment node
 */

/**
 *   #240 PAYING THE REGISTRATION FEE AGAIN UNDID A SUSPENSION — AND THE GUARD
 *        THAT SHOULD HAVE STOPPED THE PAYMENT READ A FIELD NOTHING WRITES.
 *
 *        Two halves, one loop:
 *
 *        THE DOOR — /api/cooperatives/register checked
 *        `userDoc.cooperativeMembershipId` before charging. That field appears
 *        in two type declarations, one validation schema and one reader — and
 *        in NO writer, so the check could never fire. Any existing member
 *        could be charged the ₦10,000 registration fee again.
 *
 *        THE FULFILMENT — processCooperativeRegistration (the Paystack
 *        webhook) then asked only `onboardingCompleted === true` before
 *        writing `membershipStatus: "active"` and arrayUnion("cooperative_member").
 *        A suspended member satisfies that exactly — they paid to join and
 *        finished the form — so the admin's Suspend was reversible for the
 *        price of the fee. The academy webhook had the identical fault (#231);
 *        this is its cooperative twin, and the sixth instance of the
 *        decision-survives-repair shape (#207, #225, #227, #229, #231).
 *
 *        The door now asks the collection that actually holds memberships,
 *        with the same rule as the action-path initiator: active or paid does
 *        not buy another, decided-against does not buy its way back. The
 *        fulfilment records the money — claimed, ledgered, on the member row —
 *        but does not re-activate over a decision.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

const claimPaymentOnce = jest.fn(async (_p: unknown) => ({ claimed: true } as { claimed: boolean }));
jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (p: unknown) => claimPaymentOnce(p),
    incrementWithinCeiling: jest.fn(async () => ({ ok: true })),
    markFulfilmentFailed: jest.fn(async () => undefined),
    CLAIM_TYPE: {},
}));

jest.mock('@/lib/whatsapp-invites', () => ({
    generateAndSendWhatsAppInvite: jest.fn(async () => undefined),
}));

jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: async () => undefined,
}));

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

let store: FakeDbHandle;

const MEMBER = 'member-1';
const USERS = COLLECTIONS.USERS;
const MEMBERS = COLLECTIONS.COOPERATIVE_MEMBERS;
const FEE = 10_000;

const service = async () => await import('@/infrastructure/payments/service');

const fulfil = async (ref = 'PSK-COOP-1') =>
    (await service()).processCooperativeRegistration(ref, FEE, MEMBER, 'Member');

const readUser = () => store.get(USERS, MEMBER) as Record<string, any>;
const readMember = () => store.get(MEMBERS, MEMBER) as Record<string, any>;

beforeEach(() => {
    jest.clearAllMocks();
    claimPaymentOnce.mockImplementation(async () => ({ claimed: true }));
    store = installFakeDb();
    mockRequireSession.mockResolvedValue({
        session: { user: { id: MEMBER, email: 'ada@example.com', roles: ['general_user'] } },
        error: null,
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#240 — the webhook does not re-activate a decided-against membership', () => {
    const seedSuspended = () => {
        store.seed(USERS, MEMBER, {
            email: 'ada@example.com', roles: ['general_user'],
            serviceRegistrations: { cooperatives: { status: 'suspended' } },
        });
        store.seed(MEMBERS, MEMBER, {
            userId: MEMBER, membershipStatus: 'suspended',
            paymentStatus: 'completed', onboardingCompleted: true,
            createdAt: '2026-01-01T00:00:00.000Z',
        });
    };

    it.each(['suspended', 'rejected', 'revoked', 'terminated', 'banned'])(
        'LEAVES A %s MEMBERSHIP AS IT IS', async (status) => {
            store.seed(USERS, MEMBER, {
                email: 'ada@example.com', roles: ['general_user'],
                serviceRegistrations: { cooperatives: { status } },
            });
            store.seed(MEMBERS, MEMBER, {
                userId: MEMBER, membershipStatus: status,
                paymentStatus: 'completed', onboardingCompleted: true,
                createdAt: '2026-01-01T00:00:00.000Z',
            });

            await fulfil();

            // Was: "active", role re-granted, from a webhook.
            expect(readMember().membershipStatus).toBe(status);
            expect(readUser().serviceRegistrations.cooperatives.status).toBe(status);
            expect(readUser().roles).not.toContain('cooperative_member');
        });

    it('AND DOES NOT HAND BACK THE ROLE OR isVerified', async () => {
        seedSuspended();

        await fulfil();

        expect(readUser().roles).not.toContain('cooperative_member');
        expect(readUser().isVerified).not.toBe(true);
    });

    it('BUT THE MONEY IS STILL RECORDED, SO IT CAN BE REFUNDED', async () => {
        seedSuspended();

        await fulfil();

        expect(claimPaymentOnce).toHaveBeenCalled();
        expect(store.get(COLLECTIONS.TRANSACTIONS, 'PSK-COOP-1')?.amount).toBe(FEE);
        expect(readMember().paymentReference).toBe('PSK-COOP-1');
        expect(readUser().serviceRegistrations.cooperatives.paymentStatus).toBe('completed');
    });

    // ── and the ordinary registration still works ────────────────────────────

    it('still activates an onboarded member whose fee just cleared', async () => {
        store.seed(USERS, MEMBER, { email: 'ada@example.com', roles: ['general_user'] });
        store.seed(MEMBERS, MEMBER, {
            userId: MEMBER, membershipStatus: 'pending',
            paymentStatus: 'pending', onboardingCompleted: true,
            createdAt: '2026-01-01T00:00:00.000Z',
        });

        await fulfil();

        expect(readMember().membershipStatus).toBe('active');
        expect(readUser().roles).toContain('cooperative_member');
        expect(readUser().serviceRegistrations.cooperatives.status).toBe('active');
    });

    it('still records a legacy payment with no onboarding as pending', async () => {
        store.seed(USERS, MEMBER, { email: 'ada@example.com', roles: ['general_user'] });

        await fulfil();

        expect(readUser().roles).not.toContain('cooperative_member');
        expect(readUser().serviceRegistrations.cooperatives.status).toBe('legacy_pending_onboarding');
    });

    it('still refuses an underpayment by throwing', async () => {
        store.seed(USERS, MEMBER, { email: 'ada@example.com', roles: ['general_user'] });

        await expect(
            (await service()).processCooperativeRegistration('PSK-COOP-2', 500, MEMBER, 'Member'),
        ).rejects.toThrow(/Insufficient/i);
        expect(claimPaymentOnce).not.toHaveBeenCalled();
    });

    it('does nothing twice — the claim decides', async () => {
        store.seed(USERS, MEMBER, { email: 'ada@example.com', roles: ['general_user'] });
        store.seed(MEMBERS, MEMBER, {
            userId: MEMBER, membershipStatus: 'pending',
            paymentStatus: 'pending', onboardingCompleted: true,
        });
        claimPaymentOnce.mockImplementation(async () => ({ claimed: false }));

        await fulfil();

        expect(readMember().membershipStatus).toBe('pending');
        expect(readUser().roles ?? []).not.toContain('cooperative_member');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#240 — the register API route refuses before any money moves', () => {
    const post = async () => {
        const { POST } = await import('@/app/api/cooperatives/register/route');
        const req = new Request('http://localhost/api/cooperatives/register', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                firstName: 'Ada', lastName: 'Obi', dateOfBirth: '1994-05-10',
                gender: 'female', email: 'ada@example.com', phone: '08012345678',
                stateOfOrigin: 'Plateau', lga: 'Jos North',
                residentialAddress: '1 Market Road', occupation: 'Trader',
                nextOfKin: { name: 'N', phone: '080', address: 'A' },
                tier: 'Member',
            }),
        });
        const res = await POST(req as never);
        return { status: res.status, body: await res.json() as any };
    };

    it('REFUSES AN ACTIVE MEMBER — the old guard never could', async () => {
        // The old check read `cooperativeMembershipId`, which nothing writes.
        store.seed(USERS, MEMBER, { email: 'ada@example.com', roles: ['cooperative_member'] });
        store.seed(MEMBERS, MEMBER, {
            userId: MEMBER, membershipStatus: 'active', paymentStatus: 'completed',
        });

        const { status, body } = await post();

        expect(status).toBe(400);
        expect(body.error).toMatch(/already have a cooperative membership/i);
    });

    it('REFUSES A SUSPENDED MEMBER — paying is not an appeal', async () => {
        store.seed(USERS, MEMBER, { email: 'ada@example.com', roles: ['general_user'] });
        store.seed(MEMBERS, MEMBER, {
            userId: MEMBER, membershipStatus: 'suspended', paymentStatus: 'completed',
            onboardingCompleted: true,
        });

        const { status, body } = await post();

        expect(status).toBe(403);
        expect(body.error).toMatch(/not currently active/i);
    });

    it('and finds a membership stored under an auto-generated id too', async () => {
        // joinCooperativeAction creates rows with an auto-generated document id;
        // only `userId` links them to the caller.
        store.seed(USERS, MEMBER, { email: 'ada@example.com', roles: ['general_user'] });
        store.seed(MEMBERS, 'auto-id-1', {
            userId: MEMBER, membershipStatus: 'active', paymentStatus: 'completed',
        });

        const { status } = await post();

        expect(status).toBe(400);
    });

    it('still refuses an unauthenticated caller', async () => {
        mockRequireSession.mockResolvedValue({ session: null, error: { error: 'Unauthorized' } });
        const { status } = await post();
        expect(status).toBe(401);
    });

    it('still lets somebody with no membership through to Paystack', async () => {
        // Paystack is a network call; in this harness fetch fails, which is
        // fine — reaching it at all is what the old guard also allowed, and
        // what a NEW registrant must still do.
        store.seed(USERS, MEMBER, { email: 'ada@example.com', roles: ['general_user'] });

        const { status, body } = await post();

        // Not refused by the membership guard: any failure past it is the
        // Paystack call, not a 400/403 refusal.
        expect([400, 403]).not.toContain(status);
        expect(String(body.error ?? '')).not.toMatch(/already have|not currently active/i);
    });
});
