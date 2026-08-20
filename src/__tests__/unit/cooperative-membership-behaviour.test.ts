/**
 * @jest-environment node
 */

/**
 * Cooperative membership reads, EXECUTED — the member's own record, their tier,
 * the status reconciliation that decides whether they are in, and the member
 * directory.
 *
 * At 11.5%. checkCooperativeStatusAction is the piece that matters: it
 * reconciles a status held under TWO key spellings on the user record against
 * the membership document, scores which of them is further along, heals the
 * loser from the winner, and grants `cooperative_member` — the role
 * module-access-check admits on — as part of that healing. It is a
 * self-modifying read, and with a call recorder none of its branches could be
 * distinguished from any other.
 *
 * THE HEALING IS THE RISK, NOT THE READING
 * ----------------------------------------
 * Two paths here write the role:
 *
 *   - the progress-score sync, when the membership document is further along
 *     than the user record;
 *   - the race repair, when onboarding is complete and the payment is confirmed
 *     but the status is still pending.
 *
 * Both are asserted, and so is the boundary: a membership that has NOT been
 * paid for must not be healed to active, and a membership found by email must
 * be claimable before any of it happens — the email match feeds this same
 * healing path, so adopting a stranger's membership granted module access as
 * well as visibility.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

const autoProvisionZereCooperative = jest.fn(async (_id: string, _email?: string | null) => undefined);
const autoProvisionLegacyCooperative = jest.fn(async (_id: string, _data: unknown) => undefined);
jest.mock('@/lib/cooperative-provisioning', () => ({
    autoProvisionZereCooperative: (id: string, email?: string | null) =>
        autoProvisionZereCooperative(id, email),
    autoProvisionLegacyCooperative: (id: string, data: unknown) =>
        autoProvisionLegacyCooperative(id, data),
}));

let store: FakeDbHandle;

const MEMBER = 'member-1';
const MEMBERS = COLLECTIONS.COOPERATIVE_MEMBERS;
const PAYMENTS = COLLECTIONS.PROCESSED_PAYMENTS;

function actAs(id: string | null, roles: string[] = ['user'], email = 'ada@example.com'): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles, email, name: 'Ada Obi' } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    autoProvisionZereCooperative.mockImplementation(async () => undefined);
    autoProvisionLegacyCooperative.mockImplementation(async () => undefined);
    store = installFakeDb();
    actAs(MEMBER);
});

async function actions() {
    return import('@/app/actions/cooperative/_coop_membership');
}

function seedUser(extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.USERS, MEMBER, {
        email: 'ada@example.com',
        fullName: 'Ada Obi',
        roles: ['user'],
        ...extra,
    });
}

function seedMembership(extra: Record<string, unknown> = {}, id = 'coop-1'): void {
    store.seed(MEMBERS, id, {
        userId: MEMBER,
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Obi',
        membershipStatus: 'active',
        paymentStatus: 'completed',
        onboardingCompleted: true,
        occupation: 'Trader',
        lga: 'Jos North',
        stateOfOrigin: 'Plateau',
        phone: '08012345678',
        createdAt: '2026-01-01T00:00:00.000Z',
        ...extra,
    });
}

const readUser = () => store.get(COLLECTIONS.USERS, MEMBER) as Record<string, any>;
const status = async () => (await (await actions()).checkCooperativeStatusAction()) as any;

// ─────────────────────────────────────────────────────────────────────────────
describe('getMembershipAction', () => {
    const membership = async () => (await (await actions()).getMembershipAction()) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await membership()).toMatchObject({ success: false });
    });

    it('returns the membership found by userId', async () => {
        seedUser();
        seedMembership();

        const res = await membership();
        expect(res.success).toBe(true);
        expect(res.data.membership).toMatchObject({ id: 'coop-1', firstName: 'Ada' });
    });

    it('FALLBACK 1: finds one filed under the user\'s own id, and repairs the link', async () => {
        seedUser();
        store.seed(MEMBERS, MEMBER, { firstName: 'Ada', lastName: 'Obi', membershipStatus: 'active' });

        expect((await membership()).success).toBe(true);
        expect(store.get(MEMBERS, MEMBER)!.userId).toBe(MEMBER);
    });

    it('FALLBACK 2: claims an ORPHANED membership when a payment ties it to the caller', async () => {
        seedUser();
        store.seed(MEMBERS, 'orphan', {
            email: 'ada@example.com', firstName: 'Ada', lastName: 'Obi',
            paymentReference: 'PSK-1', membershipStatus: 'active',
        });
        store.seed(PAYMENTS, 'p1', { reference: 'PSK-1', userId: MEMBER, status: 'completed' });

        expect((await membership()).success).toBe(true);
        expect(store.get(MEMBERS, 'orphan')!.userId).toBe(MEMBER);
    });

    it('and refuses when no payment ties it to the caller', async () => {
        seedUser();
        store.seed(MEMBERS, 'orphan', {
            email: 'ada@example.com', paymentReference: 'PSK-1', membershipStatus: 'active',
        });
        store.seed(PAYMENTS, 'p1', { reference: 'PSK-1', userId: 'someone-else', status: 'completed' });

        expect(await membership()).toMatchObject({ success: false, error: 'No membership found' });
        expect(store.get(MEMBERS, 'orphan')!.userId).toBeUndefined();
    });

    it('and never claims one that already belongs to somebody else', async () => {
        seedUser();
        store.seed(MEMBERS, 'theirs', {
            userId: 'someone-else', email: 'ada@example.com', membershipStatus: 'active',
        });

        expect(await membership()).toMatchObject({ success: false, error: 'No membership found' });
        expect(store.get(MEMBERS, 'theirs')!.userId).toBe('someone-else');
    });

    it('says so when there is nothing at all', async () => {
        seedUser();
        expect(await membership()).toMatchObject({ success: false, error: 'No membership found' });
    });

    it('auto-provisions the bypass account before looking', async () => {
        actAs(MEMBER, ['user'], 'zeredogo@example.test');
        seedUser();

        // The email is not the production bypass address, so the branch is
        // asserted through the LEGACY provisioner, which every other account
        // reaches. The bypass list itself is covered in payment-bypass.test.ts.
        await membership();
        expect(autoProvisionLegacyCooperative).toHaveBeenCalledWith(MEMBER, expect.any(Object));
    });

    it('does not provision when there is no user record to read', async () => {
        await membership();
        expect(autoProvisionLegacyCooperative).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getUserTierAction', () => {
    const tier = async () => (await (await actions()).getUserTierAction()) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await tier()).toMatchObject({ success: false });
    });

    it('is null with nothing contributed for a non-member', async () => {
        expect((await tier()).data).toEqual({ tier: null, totalContributions: 0 });
    });

    it('reads the membership filed under the user\'s own id', async () => {
        seedMembership({ totalContributions: 250000 }, MEMBER);

        expect((await tier()).data).toEqual({ tier: 'Member', totalContributions: 250000 });
    });

    it('is "Member" at every contribution level — the tiers are not graded today', async () => {
        // calculateUserTier returns "Member" unconditionally. Pinned so that
        // reintroducing graded tiers is a decision with a test behind it, rather
        // than a screen quietly showing one word for everybody.
        for (const total of [0, 1, 999, 1_000_000]) {
            store.clear();
            seedMembership({ totalContributions: total }, MEMBER);
            expect((await tier()).data.tier).toBe('Member');
        }
    });

    it('treats a missing total as zero', async () => {
        seedMembership({ totalContributions: undefined }, MEMBER);
        expect((await tier()).data.totalContributions).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('checkCooperativeStatusAction — the fast path', () => {
    it('is null for a caller with no session', async () => {
        actAs(null);
        expect(await status()).toBeNull();
    });

    it.each(['active', 'approved'])(
        'answers "approved" straight from a %s registration', async (regStatus) => {
            seedUser({ serviceRegistrations: { cooperatives: { status: regStatus } } });
            expect(await status()).toBe('approved');
        });

    it('reads the SINGULAR key spelling too', async () => {
        seedUser({ serviceRegistrations: { cooperative: { status: 'active' } } });
        expect(await status()).toBe('approved');
    });

    it('prefers whichever spelling is further along', async () => {
        // The two are written by different eras of the code and drift. The one
        // that has progressed further wins, in either direction.
        seedUser({
            serviceRegistrations: {
                cooperatives: { status: 'not_started' },
                cooperative: { status: 'active' },
            },
        });
        expect(await status()).toBe('approved');
    });

    it('and does not let a stale singular key drag an active plural one back', async () => {
        seedUser({
            serviceRegistrations: {
                cooperatives: { status: 'active' },
                cooperative: { status: 'not_started' },
            },
        });
        expect(await status()).toBe('approved');
    });

    it('is null for somebody with no registration and no membership', async () => {
        seedUser();
        expect(await status()).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('checkCooperativeStatusAction — reconciling with the membership', () => {
    it('reports the membership\'s status when the user record has none', async () => {
        seedUser();
        seedMembership({ membershipStatus: 'suspended' });

        expect(await status()).toBe('suspended');
    });

    it('heals the user record from a membership that is further along, and grants the role', async () => {
        seedUser({ serviceRegistrations: { cooperatives: { status: 'not_started' } } });
        seedMembership({ membershipStatus: 'active' });

        expect(await status()).toBe('active');

        const user = readUser();
        expect(user.serviceRegistrations.cooperatives.status).toBe('active');
        expect(user.serviceRegistrations.cooperatives.syncedFromLegacy).toBe(true);
        expect(user.roles).toContain('cooperative_member');
    });

    it('grants the role to an active member who somehow lacks it', async () => {
        seedUser({
            roles: ['user'],
            serviceRegistrations: { cooperatives: { status: 'pending' } },
        });
        seedMembership({ membershipStatus: 'approved' });

        await status();
        expect(readUser().roles).toContain('cooperative_member');
    });

    it('does NOT grant the role for a status that is not approved or active', async () => {
        seedUser();
        seedMembership({ membershipStatus: 'suspended', paymentStatus: 'completed' });

        await status();
        expect(readUser().roles ?? []).not.toContain('cooperative_member');
    });

    it('repairs the membership\'s missing userId', async () => {
        seedUser();
        store.seed(MEMBERS, MEMBER, {
            membershipStatus: 'active', paymentStatus: 'completed', onboardingCompleted: true,
        });

        await status();
        expect(store.get(MEMBERS, MEMBER)!.userId).toBe(MEMBER);
    });

    it('reads the membership through the userId query when it is not filed under the id', async () => {
        seedUser();
        seedMembership({ membershipStatus: 'suspended' }, 'coop-xyz');

        expect(await status()).toBe('suspended');
    });

    it('claims one found by EMAIL only when a payment ties it to the caller', async () => {
        // This branch feeds the healing path above, which writes the
        // cooperative_member ROLE — so adopting a stranger's membership here
        // granted module access as well as visibility.
        seedUser();
        store.seed(MEMBERS, 'orphan', {
            email: 'ada@example.com', membershipStatus: 'active',
            paymentStatus: 'completed', onboardingCompleted: true, paymentReference: 'PSK-1',
        });
        store.seed(PAYMENTS, 'p1', { reference: 'PSK-1', userId: MEMBER, status: 'completed' });

        expect(await status()).toBe('active');
        expect(readUser().roles).toContain('cooperative_member');
    });

    it('and refuses to adopt one that no payment ties to the caller', async () => {
        seedUser();
        store.seed(MEMBERS, 'orphan', {
            email: 'ada@example.com', membershipStatus: 'active',
            paymentStatus: 'completed', onboardingCompleted: true, paymentReference: 'PSK-1',
        });
        store.seed(PAYMENTS, 'p1', { reference: 'PSK-1', userId: 'someone-else', status: 'completed' });

        expect(await status()).toBeNull();
        expect(readUser().roles ?? []).not.toContain('cooperative_member');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('checkCooperativeStatusAction — the intermediate states', () => {
    it('a paid legacy import that has not onboarded is legacy_pending_onboarding', async () => {
        seedUser();
        seedMembership({ paymentStatus: 'completed', onboardingCompleted: false });

        expect(await status()).toBe('legacy_pending_onboarding');
    });

    it('a submitted form with no payment is payment_required', async () => {
        seedUser();
        seedMembership({
            membershipStatus: 'pending', paymentStatus: 'pending', onboardingCompleted: true,
        });

        expect(await status()).toBe('payment_required');
    });

    it('a legacy member is not asked to pay', async () => {
        seedUser();
        seedMembership({
            membershipStatus: 'pending', paymentStatus: 'pending',
            onboardingCompleted: true, isLegacy: true,
        });

        expect(await status()).toBe('pending_review');
    });

    it('nor is somebody the admin already approved', async () => {
        seedUser();
        seedMembership({
            membershipStatus: 'approved', paymentStatus: 'pending', onboardingCompleted: true,
        });

        expect(await status()).toBe('approved');
    });

    it('REPAIRS the webhook race: onboarded and paid but still pending becomes active', async () => {
        seedUser({ roles: ['user'] });
        seedMembership({
            membershipStatus: 'pending', paymentStatus: 'completed', onboardingCompleted: true,
        });

        expect(await status()).toBe('active');

        expect(store.get(MEMBERS, 'coop-1')!.membershipStatus).toBe('active');
        const user = readUser();
        expect(user.serviceRegistrations.cooperatives.status).toBe('active');
        expect(user.roles).toContain('cooperative_member');
        expect(user.isVerified).toBe(true);
    });

    it('and does NOT repair one that was never paid for', async () => {
        // The boundary. Without the payment check this repair would activate
        // anybody who filled the form.
        seedUser();
        seedMembership({
            membershipStatus: 'pending', paymentStatus: 'failed',
            onboardingCompleted: true, isLegacy: true,
        });

        expect(await status()).toBe('pending_review');
        expect(store.get(MEMBERS, 'coop-1')!.membershipStatus).toBe('pending');
    });

    it('FINAL CHECK: a completed Paystack record with no member document at all', async () => {
        seedUser();
        store.seed(PAYMENTS, 'p1', {
            userId: MEMBER, type: 'cooperative_membership_registration', status: 'completed',
        });

        expect(await status()).toBe('legacy_pending_onboarding');
    });

    it('and ignores a payment of the wrong type or an incomplete one', async () => {
        seedUser();
        store.seedAll(PAYMENTS, {
            wrongType: { userId: MEMBER, type: 'academy_registration', status: 'completed' },
            incomplete: { userId: MEMBER, type: 'cooperative_membership_registration', status: 'pending' },
        });

        expect(await status()).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getDirectoryMembersAction', () => {
    const directory = async () => (await (await actions()).getDirectoryMembersAction()) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await directory()).toMatchObject({ success: false });
    });

    it('REFUSES a signed-in account that is not a cooperative member', async () => {
        // The guard was `if (!session?.user)` under a comment that asked the
        // question and did not answer it. Every row carries a member's phone
        // number, passport photograph URL, occupation, LGA and state — the
        // personal data of every member, to any registered stranger.
        seedUser();
        // Somebody ELSE's membership — the caller has none, which is the point.
        seedMembership({ userId: 'other-member', email: 'ngozi@example.com' });

        const res = await directory();
        expect(res.success).toBe(false);
        expect(res.error).toContain('Cooperative membership is required');
        expect(JSON.stringify(res)).not.toContain('08012345678');
    });

    it('admits a cooperative member', async () => {
        seedUser({ serviceRegistrations: { cooperatives: { status: 'active' } } });
        seedMembership();

        const res = await directory();
        expect(res.success).toBe(true);
        expect(res.data).toHaveLength(1);
    });

    it('admits an admin', async () => {
        actAs('admin-1', ['super_admin']);
        store.seed(COLLECTIONS.USERS, 'admin-1', { roles: ['super_admin'] });
        seedMembership();

        expect((await directory()).success).toBe(true);
    });

    it('lists approved and active members, and nobody else', async () => {
        seedUser({ serviceRegistrations: { cooperatives: { status: 'active' } } });
        seedMembership({ membershipStatus: 'active', firstName: 'Ada' }, 'a');
        seedMembership({ membershipStatus: 'approved', firstName: 'Ngozi' }, 'b');
        seedMembership({ membershipStatus: 'pending', firstName: 'Chidi' }, 'c');
        seedMembership({ membershipStatus: 'suspended', firstName: 'Emeka' }, 'd');

        const names = ((await directory()).data as any[]).map((m) => m.name).sort();
        expect(names).toEqual(['Ada Obi', 'Ngozi Obi']);
    });

    it('drops a corrupted row rather than showing "undefined undefined"', async () => {
        seedUser({ serviceRegistrations: { cooperatives: { status: 'active' } } });
        seedMembership({ firstName: 'Ada' }, 'good');
        seedMembership({ firstName: undefined }, 'missing');
        seedMembership({ firstName: 'undefined', lastName: 'undefined' }, 'literal');

        const res = await directory();
        expect(res.data).toHaveLength(1);
        expect(res.data[0].name).toBe('Ada Obi');
    });

    it('builds each row from the membership record', async () => {
        seedUser({ serviceRegistrations: { cooperatives: { status: 'active' } } });
        seedMembership({
            documents: { passportPhoto: { url: 'https://cdn/ada.jpg' } },
        });

        const [row] = (await directory()).data;
        expect(row).toMatchObject({
            id: 'coop-1',
            name: 'Ada Obi',
            role: 'Member',
            location: 'Jos North, Plateau',
            occupation: 'Trader',
            image: 'https://cdn/ada.jpg',
            phone: '08012345678',
        });
        // createdAt is revived into a Timestamp by the adapter, so the joined
        // label is a real month rather than the "Recent" fallback.
        expect(row.joined).not.toBe('Recent');
    });

    it('falls back to "Recent" when a member has no join date', async () => {
        seedUser({ serviceRegistrations: { cooperatives: { status: 'active' } } });
        seedMembership({ createdAt: undefined });

        expect((await directory()).data[0].joined).toBe('Recent');
    });

    it('reports the row cap and whether it was hit', async () => {
        seedUser({ serviceRegistrations: { cooperatives: { status: 'active' } } });
        seedMembership();

        const res = await directory();
        expect(res).toMatchObject({ truncated: false, rowCap: 2000 });
    });
});
