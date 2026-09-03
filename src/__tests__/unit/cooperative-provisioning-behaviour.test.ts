/**
 * @jest-environment node
 */

/**
 * lib/cooperative-provisioning.ts was at 10.9%.
 *
 * Both functions in it GRANT A PAID COOPERATIVE MEMBERSHIP — membershipStatus
 * approved/active and paymentStatus "completed" — so what they refuse matters
 * as much as what they write. The file's own header explains why they live
 * outside a "use server" module: exporting them there would publish "provision
 * a paid membership for an arbitrary user id" as an RPC.
 *
 * That reasoning is sound and the guards hold. This suite executes them anyway,
 * because reading a guard is not the same as running it — every defect this
 * audit has found in a low-coverage file was found by running the code.
 *
 * The one real defect it turned up is #257, below: re-provisioning an existing
 * member wrote `createdAt: undefined` over a row that had no createdAt.
 */

import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

jest.mock('next/cache', () => ({
    unstable_cache: (fn: unknown) => fn,
    revalidateTag: jest.fn(), updateTag: jest.fn(), revalidatePath: jest.fn(),
}));

/**
 * A TEST address, supplied through PAYMENT_BYPASS_EMAILS.
 *
 * The production bypass address is deliberately NOT written here — it lives in
 * lib/payment-bypass.ts alone, and payment-bypass.test.ts fails if it appears
 * anywhere else.
 */
const TEST_BYPASS = 'bypass.fixture@example.test';
const realBypassEnv = process.env.PAYMENT_BYPASS_EMAILS;

let store: FakeDbHandle;
const MEMBERS = COLLECTIONS.COOPERATIVE_MEMBERS;
const USERS = COLLECTIONS.USERS;

const provisioning = async () => await import('@/lib/cooperative-provisioning');

beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    process.env.PAYMENT_BYPASS_EMAILS = TEST_BYPASS;
    store = installFakeDb();
});

afterAll(() => {
    if (realBypassEnv === undefined) delete process.env.PAYMENT_BYPASS_EMAILS;
    else process.env.PAYMENT_BYPASS_EMAILS = realBypassEnv;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('autoProvisionZereCooperative — who it refuses', () => {
    it('GRANTS NOTHING TO AN ORDINARY EMAIL', async () => {
        // The whole guard. A paid membership for anyone who is not the
        // configured bypass account would be the platform giving itself away.
        const { autoProvisionZereCooperative } = await provisioning();
        await autoProvisionZereCooperative('u-1', 'ordinary@example.test');

        expect(store.get(MEMBERS, 'u-1')).toBeUndefined();
        expect(store.size(MEMBERS)).toBe(0);
    });

    it.each(['', '   ', 'BYPASS.FIXTURE@EXAMPLE.TEST.evil.test', 'x' + TEST_BYPASS])(
        'grants nothing to %p', async (email) => {
            const { autoProvisionZereCooperative } = await provisioning();
            await autoProvisionZereCooperative('u-1', email);
            expect(store.size(MEMBERS)).toBe(0);
        });

    it('provisions the configured bypass account, paid and approved', async () => {
        // Vacuity guard for every refusal above: they must not be satisfied by
        // a function that provisions nobody at all.
        const { autoProvisionZereCooperative } = await provisioning();
        await autoProvisionZereCooperative('u-1', TEST_BYPASS);

        const row = store.get(MEMBERS, 'u-1')!;
        expect(row.membershipStatus).toBe('approved');
        expect(row.paymentStatus).toBe('completed');
        expect(row.onboardingCompleted).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('autoProvisionZereCooperative — the user document', () => {
    it('DOES NOT WIPE THE MEMBER\'S OTHER MODULE REGISTRATIONS', async () => {
        // set(merge) over a nested object is the write that erased sibling
        // modules before the adapter learned to flatten it into dotted paths.
        // A cooperative grant must not cost somebody their WAVE approval.
        store.seed(USERS, 'u-1', {
            id: 'u-1', roles: ['general_user'],
            serviceRegistrations: {
                wave: { status: 'approved', paymentStatus: 'completed' },
                academy: { status: 'pending' },
            },
        });

        const { autoProvisionZereCooperative } = await provisioning();
        await autoProvisionZereCooperative('u-1', TEST_BYPASS);

        const user = store.get(USERS, 'u-1')!;
        expect(user.serviceRegistrations.wave.status).toBe('approved');
        expect(user.serviceRegistrations.academy.status).toBe('pending');
        expect(user.serviceRegistrations.cooperatives.status).toBe('approved');
    });

    it('adds the cooperative_member role without dropping existing roles', async () => {
        store.seed(USERS, 'u-1', { id: 'u-1', roles: ['general_user', 'seller'] });

        const { autoProvisionZereCooperative } = await provisioning();
        await autoProvisionZereCooperative('u-1', TEST_BYPASS);

        const roles = store.get(USERS, 'u-1')!.roles as string[];
        expect(roles).toEqual(expect.arrayContaining(['general_user', 'seller', 'cooperative_member']));
    });

    it('does not duplicate the role on a second run', async () => {
        store.seed(USERS, 'u-1', { id: 'u-1', roles: ['cooperative_member'] });

        const { autoProvisionZereCooperative } = await provisioning();
        await autoProvisionZereCooperative('u-1', TEST_BYPASS);
        await autoProvisionZereCooperative('u-1', TEST_BYPASS);

        const roles = store.get(USERS, 'u-1')!.roles as string[];
        expect(roles.filter(r => r === 'cooperative_member')).toHaveLength(1);
    });

    it('writes no user document when there is no user to update', async () => {
        // The membership row is still created; the user half is guarded on
        // exists, and inventing a user document from a provisioning helper
        // would be worse than skipping it.
        const { autoProvisionZereCooperative } = await provisioning();
        await autoProvisionZereCooperative('ghost', TEST_BYPASS);

        expect(store.get(MEMBERS, 'ghost')).toBeTruthy();
        expect(store.get(USERS, 'ghost')).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('autoProvisionLegacyCooperative — who it refuses', () => {
    it('GRANTS NOTHING TO A USER WHO WAS NOT LEGACY-ONBOARDED', async () => {
        // Without this the helper would provision a paid membership for every
        // ordinary user who loads the cooperative page.
        const { autoProvisionLegacyCooperative } = await provisioning();
        await autoProvisionLegacyCooperative('u-1', { email: 'a@e.test' });

        expect(store.size(MEMBERS)).toBe(0);
    });

    it.each([undefined, null, {}, { legacyOnboardedBy: '' }])(
        'grants nothing for userData %p', async (userData) => {
            const { autoProvisionLegacyCooperative } = await provisioning();
            await autoProvisionLegacyCooperative('u-1', userData);
            expect(store.size(MEMBERS)).toBe(0);
        });

    it('provisions a genuine legacy member', async () => {
        const { autoProvisionLegacyCooperative } = await provisioning();
        await autoProvisionLegacyCooperative('u-1', {
            legacyOnboardedBy: 'admin-9', email: 'legacy@e.test', name: 'Ada Grace Lovelace',
        });

        const row = store.get(MEMBERS, 'u-1')!;
        expect(row.membershipStatus).toBe('active');
        expect(row.paymentStatus).toBe('completed');
        // Onboarding is NOT complete — that is the member's own step.
        expect(row.onboardingCompleted).toBe(false);
        expect(row.firstName).toBe('Ada');
        expect(row.lastName).toBe('Lovelace');
    });

    it('DOES NOT OVERWRITE A MEMBER WHO HAS FINISHED ONBOARDING', async () => {
        // The member did the work; re-running this would reset their own
        // details to placeholders.
        store.seed(MEMBERS, 'u-1', {
            id: 'u-1', userId: 'u-1', onboardingCompleted: true,
            firstName: 'Chosen', lastName: 'Name', phone: '08011112222',
        });

        const { autoProvisionLegacyCooperative } = await provisioning();
        await autoProvisionLegacyCooperative('u-1', {
            legacyOnboardedBy: 'admin-9', email: 'legacy@e.test', name: 'Placeholder Person',
        });

        const row = store.get(MEMBERS, 'u-1')!;
        expect(row.firstName).toBe('Chosen');
        expect(row.phone).toBe('08011112222');
    });

    it('falls back to a usable name when the legacy row has none', async () => {
        const { autoProvisionLegacyCooperative } = await provisioning();
        await autoProvisionLegacyCooperative('u-1', { legacyOnboardedBy: 'admin-9' });

        const row = store.get(MEMBERS, 'u-1')!;
        expect(row.firstName).toBe('Cooperative');
        expect(row.lastName).toBe('Member');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#257 — re-provisioning must not erase createdAt', () => {
    /**
     *   #257 RE-PROVISIONING WROTE `createdAt: undefined` OVER AN EXISTING ROW.
     *
     *        Both functions carry:
     *
     *            createdAt: memberDoc.exists
     *                ? memberDoc.data()?.createdAt
     *                : FieldValue.serverTimestamp()
     *
     *        The ternary is there to PRESERVE the original creation date on a
     *        re-run, which is right. But `?.createdAt` is `undefined` for a row
     *        that exists without one — and legacy rows are exactly that: the
     *        import script and the older provisioning paths did not all write
     *        it. So the re-run sends `createdAt: undefined`, and the membership
     *        ends up with no creation date at all rather than acquiring one.
     *
     *        It matters because `createdAt` is a sort key. This audit has
     *        already found 34 "most recent" sorts whose key is 0 for the shape
     *        the app writes (#49); a member row with no createdAt sorts to the
     *        bottom of the admin member list forever, which is where a member
     *        nobody can find lives.
     *
     *        Fixed by falling back to a fresh timestamp when the existing row
     *        has none: preserve what is there, supply what is missing.
     */
    it('KEEPS AN EXISTING createdAt ON A RE-RUN', async () => {
        const original = '2020-01-01T00:00:00.000Z';
        store.seed(MEMBERS, 'u-1', { id: 'u-1', userId: 'u-1', createdAt: original });

        const { autoProvisionLegacyCooperative } = await provisioning();
        await autoProvisionLegacyCooperative('u-1', { legacyOnboardedBy: 'admin-9' });

        expect(store.get(MEMBERS, 'u-1')!.createdAt).toBe(original);
    });

    it('AND SUPPLIES ONE WHEN THE EXISTING ROW HAS NONE', async () => {
        // Was: createdAt: undefined — a member with no creation date at all.
        store.seed(MEMBERS, 'u-1', { id: 'u-1', userId: 'u-1' });

        const { autoProvisionLegacyCooperative } = await provisioning();
        await autoProvisionLegacyCooperative('u-1', { legacyOnboardedBy: 'admin-9' });

        expect(store.get(MEMBERS, 'u-1')!.createdAt).toBeTruthy();
    });

    it('the bypass path has the same rule', async () => {
        // Both functions carried the identical ternary, so both needed it.
        store.seed(MEMBERS, 'u-1', { id: 'u-1', userId: 'u-1', paymentStatus: 'pending' });

        const { autoProvisionZereCooperative } = await provisioning();
        await autoProvisionZereCooperative('u-1', TEST_BYPASS);

        expect(store.get(MEMBERS, 'u-1')!.createdAt).toBeTruthy();
    });

    it('and a brand-new row still gets one', async () => {
        const { autoProvisionLegacyCooperative } = await provisioning();
        await autoProvisionLegacyCooperative('fresh', { legacyOnboardedBy: 'admin-9' });

        expect(store.get(MEMBERS, 'fresh')!.createdAt).toBeTruthy();
    });
});
