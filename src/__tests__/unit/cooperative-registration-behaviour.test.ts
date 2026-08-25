/**
 * @jest-environment node
 */

/**
 * _coop_registration.ts, EXECUTED. It was the lowest-covered file left at
 * 36.3%, and it is the front door to the module that holds members' savings.
 *
 *   #233 joinCooperativeAction WAS A FREE MEMBERSHIP WITH FREE SAVINGS.
 *
 *        Nothing in the UI calls it. That does not make it unreachable: this
 *        file is "use server", so every export is a public endpoint, and the
 *        action is re-exported from the cooperative barrel.
 *
 *        `initialContribution` is a caller-supplied number. It was written
 *        straight through as `savingsBalance`, as a COMPLETED `contribution`
 *        row in the cooperative ledger AND in the universal ledger, and
 *        incremented into the cooperative's `totalSavings`. No payment is taken
 *        anywhere in the function. The cooperative loan limit is a multiple of
 *        savings balance (lib/cooperative-utils.ts), so it was borrowing power
 *        as well as a number on a dashboard.
 *
 *        And the membership it created was `status: "active"` — with no
 *        registration fee, no onboarding and no admin. checkModuleAccess Layer
 *        2.6 reads `membershipStatus || status`, so that granted the whole
 *        cooperative module; canTransactAsMember reads the same pair, so the
 *        new member could contribute, borrow and withdraw immediately. Every
 *        other way in — registerCooperativeMember, the Paystack webhook, the
 *        admin approval — makes a member pending until the fee clears. This one
 *        door bypassed all three.
 *
 *   #234 THE RESUBMIT "AUTO-HEAL" SAVED NOTHING.
 *
 *        resubmitCooperativeApplicationAction has a fallback for a member whose
 *        record was lost: it logs "falling back to new registration creation"
 *        and then commits `batch.update(memberRef, ...)`. update() on a missing
 *        document is a documented NO-OP in this adapter — it warns "no rows will
 *        be affected. Use set(data, { merge: true }) if the document may not
 *        exist yet" and returns.
 *
 *        So the member filled in the whole KYC form, pressed Resubmit, and was
 *        told it succeeded. No member record existed afterwards. The USER
 *        document WAS updated to "pending", so the screen then showed them
 *        waiting for review of an application that was never written —
 *        repeatable for ever. The adapter's own warning names this exact
 *        failure: "this is how 'the save button did nothing' bugs reach
 *        production."
 *
 *   #235 AND THE RESUBMIT PATH HAD NO DUPLICATE-IDENTITY GUARD.
 *
 *        The submit path checks the roster for a matching phone and email
 *        before writing. The resubmit path — same fields, same collection —
 *        checked neither, so a member in revision_required could resubmit
 *        carrying somebody else's phone number or email address.
 *
 *        That is #32 again: WAVE's resubmission bypassed its own duplicate
 *        guards for the same reason. A resubmit is written as a separate
 *        function from a submit, and only one of them gets the rule. Both ask
 *        lib/cooperative-identity-conflict.ts now.
 *
 *        The original comparison had two faults of its own, recorded there: it
 *        compared the DOCUMENT id rather than the row's `userId`, and it read
 *        one row rather than the matching set.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

jest.mock('next/cache', () => ({
    revalidatePath: () => undefined,
    revalidateTag: () => undefined,
}));

jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: async () => undefined,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

let store: FakeDbHandle;

const MEMBER = 'member-1';
const STRANGER = 'stranger-9';
const USERS = COLLECTIONS.USERS;
const MEMBERS = COLLECTIONS.COOPERATIVE_MEMBERS;
const COOPS = COLLECTIONS.COOPERATIVES;
const COOP_TX = COLLECTIONS.COOPERATIVE_TRANSACTIONS;

const actions = async () => await import('@/app/actions/cooperative/_coop_registration');

const actAs = (id: string | null, email = 'ada@example.com') =>
    mockRequireSession.mockResolvedValue(
        id === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : { session: { user: { id, email, roles: ['general_user'] } }, error: null });

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(MEMBER);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#233 — joining does not move money and does not admit anybody', () => {
    const join = async (amount = 0, coop = 'default') =>
        (await (await actions())).joinCooperativeAction(coop, amount) as any;

    beforeEach(() => {
        store.seed(COOPS, 'default', { name: 'Default', memberCount: 3, totalSavings: 100 });
    });

    it.each([1, 5_000, 5_000_000, -1_000, 0.5])(
        'REFUSES AN INITIAL CONTRIBUTION OF %s', async (amount) => {
            const res = await join(amount);

            expect(res.success).toBe(false);
            expect(res.error).toMatch(/contributions are made/i);
        });

    it('AND WRITES NO MEMBERSHIP, NO LEDGER ROW AND NO SAVINGS', async () => {
        await join(5_000_000);

        expect(store.size(MEMBERS)).toBe(0);
        expect(store.size(COOP_TX)).toBe(0);
        expect(store.size(COLLECTIONS.TRANSACTIONS)).toBe(0);
        expect(store.get(COOPS, 'default')?.totalSavings).toBe(100);
        expect(store.get(COOPS, 'default')?.memberCount).toBe(3);
    });

    it('AND A LEGITIMATE JOIN CREATES A PENDING MEMBERSHIP, NOT AN ACTIVE ONE', async () => {
        // Was: status "active" — which checkModuleAccess Layer 2.6 and
        // canTransactAsMember both honour, with no fee and no admin.
        expect(await join(0)).toMatchObject({ success: true });

        const [, row] = store.all(MEMBERS)[0];
        expect(row.membershipStatus).toBe('pending');
        expect(row.status).toBe('pending');
        expect(row.paymentStatus).toBe('pending');
        expect(row.onboardingCompleted).toBe(false);
        expect(row.savingsBalance).toBe(0);
    });

    it('and it does not grant the cooperative module', async () => {
        store.seed(USERS, MEMBER, { email: 'ada@example.com', roles: ['general_user'] });

        await join(0);

        const { checkModuleAccess } = await import('@/lib/module-access-check');
        expect(await checkModuleAccess(MEMBER, ['general_user'] as never, 'cooperatives' as never))
            .toBe(false);
    });

    it('and the new member cannot transact', async () => {
        await join(0);

        const { canTransactAsMember } = await import('@/lib/cooperative-membership-status');
        const [, row] = store.all(MEMBERS)[0];
        expect(canTransactAsMember(row as any)).toBe(false);
    });

    // ── and the parts that were always right stay right ──────────────────────

    it('still counts the member on the cooperative', async () => {
        await join(0);
        expect(store.get(COOPS, 'default')?.memberCount).toBe(4);
    });

    it('refuses a cooperative that does not exist', async () => {
        expect(await join(0, 'nope')).toMatchObject({ success: false });
        expect(store.size(MEMBERS)).toBe(0);
    });

    it('refuses a second join of the same cooperative', async () => {
        expect(await join(0)).toMatchObject({ success: true });
        expect(await join(0)).toMatchObject({ success: false });
        expect(store.size(MEMBERS)).toBe(1);
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await join(0)).toMatchObject({ success: false });
        expect(store.size(MEMBERS)).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#234 — resubmitting when the member row is gone actually saves', () => {
    const resubmit = async (over: Record<string, string> = {}) => {
        const fd = new FormData();
        const fields: Record<string, string> = {
            firstName: 'Ada', lastName: 'Obi',
            dateOfBirth: '1994-05-10', gender: 'female',
            email: 'ada@example.com', phone: '08012345678',
            occupation: 'Trader', stateOfOrigin: 'Plateau',
            lga: 'Jos North', ward: 'Ward A',
            residentialAddress: '1 Market Road',
            nextOfKinName: 'Ngozi Obi', nextOfKinPhone: '08087654321',
            nextOfKinAddress: '2 Market Road',
            validIdUrl: 'https://cdn.test/id.png', validIdName: 'NIN slip',
            passportPhotoUrl: 'https://cdn.test/photo.png', passportPhotoName: 'Passport',
            ...over,
        };
        for (const [k, v] of Object.entries(fields)) if (v !== '') fd.set(k, v);
        return (await (await actions())).resubmitCooperativeApplicationAction(fd) as any;
    };

    /** In revision_required, and the member row was lost. */
    const seedOrphaned = () => store.seed(USERS, MEMBER, {
        email: 'ada@example.com',
        roles: ['general_user'],
        serviceRegistrations: { cooperatives: { status: 'revision_required' } },
    });

    it('CREATES THE MEMBER ROW INSTEAD OF SILENTLY WRITING NOTHING', async () => {
        seedOrphaned();

        expect(await resubmit()).toMatchObject({ success: true });

        // Was: reported success and left the collection empty, for ever.
        const row = store.get(MEMBERS, MEMBER);
        expect(row).toBeDefined();
        expect(row!.firstName).toBe('Ada');
        expect(row!.userId).toBe(MEMBER);
        expect(row!.membershipStatus).toBe('pending');
        expect(row!.onboardingCompleted).toBe(true);
    });

    it('AND CARRIES THE UPLOADED DOCUMENTS ONTO THE NEW ROW', async () => {
        // The dotted paths in the payload have to survive the create, not just
        // the update — they are written as `documents.validId.url`.
        seedOrphaned();

        await resubmit();

        expect(store.get(MEMBERS, MEMBER)?.documents?.validId?.url)
            .toBe('https://cdn.test/id.png');
        expect(store.get(MEMBERS, MEMBER)?.documents?.passportPhoto?.url)
            .toBe('https://cdn.test/photo.png');
    });

    it('AND THE USER DOCUMENT AND THE MEMBER ROW NOW AGREE', async () => {
        // The user doc write always landed; only the member row was lost. The
        // screen therefore showed a review pending on nothing.
        seedOrphaned();

        await resubmit();

        expect(store.get(USERS, MEMBER)?.serviceRegistrations.cooperatives.status).toBe('pending');
        expect(store.get(MEMBERS, MEMBER)?.membershipStatus).toBe('pending');
    });

    // ── the path that always worked, unchanged ───────────────────────────────

    it('still updates an existing member row without recreating it', async () => {
        store.seed(USERS, MEMBER, {
            email: 'ada@example.com', roles: ['general_user'],
            serviceRegistrations: { cooperatives: { status: 'revision_required' } },
        });
        store.seed(MEMBERS, MEMBER, {
            userId: MEMBER, firstName: 'Old', lastName: 'Name',
            email: 'ada@example.com', phone: '08012345678',
            membershipStatus: 'revision_required', paymentStatus: 'completed',
            revisionNote: 'Photo unreadable',
            createdAt: '2026-01-01T00:00:00.000Z',
        });

        expect(await resubmit()).toMatchObject({ success: true });

        const row = store.get(MEMBERS, MEMBER)!;
        expect(row.firstName).toBe('Ada');
        expect(row.membershipStatus).toBe('pending');
        expect(row.revisionNote).toBeNull();
        // Untouched fields survive: the write is a patch, not a replacement.
        expect(row.paymentStatus).toBe('completed');
        expect(store.size(MEMBERS)).toBe(1);
    });

    it.each(['active', 'approved', 'rejected', 'suspended'])(
        'still refuses to resubmit from %s', async (status) => {
            store.seed(USERS, MEMBER, {
                email: 'ada@example.com', roles: ['general_user'],
                serviceRegistrations: { cooperatives: { status } },
            });

            const res = await resubmit();
            expect(res.success).toBe(false);
            expect(res.error).toMatch(/cannot be resubmitted/i);
        });

    it('still refuses a caller with no session', async () => {
        actAs(null);
        expect(await resubmit()).toMatchObject({ success: false });
    });

    it('still refuses a malformed BVN', async () => {
        seedOrphaned();
        expect(await resubmit({ bvn: '123' })).toMatchObject({ success: false });
        expect(store.size(MEMBERS)).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#235 — the resubmit path asks the same identity question', () => {
    const resubmit = async (over: Record<string, string> = {}) => {
        const fd = new FormData();
        const fields: Record<string, string> = {
            firstName: 'Ada', lastName: 'Obi',
            dateOfBirth: '1994-05-10', gender: 'female',
            email: 'ada@example.com', phone: '08012345678',
            occupation: 'Trader', stateOfOrigin: 'Plateau',
            lga: 'Jos North', ward: 'Ward A',
            residentialAddress: '1 Market Road',
            nextOfKinName: 'Ngozi Obi', nextOfKinPhone: '08087654321',
            nextOfKinAddress: '2 Market Road',
            validIdUrl: 'https://cdn.test/id.png',
            passportPhotoUrl: 'https://cdn.test/photo.png',
            ...over,
        };
        for (const [k, v] of Object.entries(fields)) if (v !== '') fd.set(k, v);
        return (await (await actions())).resubmitCooperativeApplicationAction(fd) as any;
    };

    const inRevision = () => store.seed(USERS, MEMBER, {
        email: 'ada@example.com',
        roles: ['general_user'],
        serviceRegistrations: { cooperatives: { status: 'revision_required' } },
    });

    it("REFUSES SOMEBODY ELSE'S PHONE NUMBER", async () => {
        inRevision();
        store.seed(MEMBERS, 'row-of-stranger', {
            userId: STRANGER, email: 'other@example.com', phone: '08012345678',
        });

        const res = await resubmit();

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/phone number already exists/i);
        expect(store.get(MEMBERS, MEMBER)).toBeUndefined();
    });

    it("REFUSES SOMEBODY ELSE'S EMAIL ADDRESS", async () => {
        inRevision();
        store.seed(MEMBERS, 'row-of-stranger', {
            userId: STRANGER, email: 'ada@example.com', phone: '09099999999',
        });

        const res = await resubmit();

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/email address already exists/i);
    });

    it('and does NOT refuse the caller over their own row', async () => {
        // The original comparison used the DOCUMENT id, so a row with an
        // auto-generated id — which joinCooperativeAction creates — read as a
        // stranger's and locked the owner out of their own resubmission.
        inRevision();
        store.seed(MEMBERS, 'auto-generated-id', {
            userId: MEMBER, email: 'ada@example.com', phone: '08012345678',
            membershipStatus: 'revision_required',
            createdAt: '2026-01-01T00:00:00.000Z',
        });

        expect(await resubmit()).toMatchObject({ success: true });
    });

    it('scans the whole matching set, not one row', async () => {
        // With the caller's own row beside a stranger's, which one answered
        // used to depend on row order.
        inRevision();
        store.seed(MEMBERS, 'a-own-row', {
            userId: MEMBER, email: 'ada@example.com', phone: '08012345678',
            membershipStatus: 'revision_required',
            createdAt: '2026-01-01T00:00:00.000Z',
        });
        store.seed(MEMBERS, 'b-stranger-row', {
            userId: STRANGER, email: 'ada@example.com', phone: '08012345678',
        });

        expect(await resubmit()).toMatchObject({ success: false });
    });

    it('matches a phone stored in the imported E.164 form', async () => {
        // #80: the roster holds both the typed and the normalised spelling.
        inRevision();
        store.seed(MEMBERS, 'imported', {
            userId: STRANGER, email: 'other@example.com', phone: '+2348012345678',
        });

        expect(await resubmit()).toMatchObject({ success: false });
    });

    it('matches however the CALLER capitalises the address', async () => {
        // The Zod schema lowercases the email before the guard sees it, so a
        // conflict cannot be dodged by typing a capital letter. (A stored row
        // that itself carries capitals — a legacy import — is a different,
        // narrower blind spot: equality queries cannot close it, and the
        // helper's comment records that honestly rather than pretending.)
        inRevision();
        store.seed(MEMBERS, 'stored-lower', {
            userId: STRANGER, email: 'ada@example.com', phone: '09099999999',
        });

        expect(await resubmit({ email: 'ADA@Example.com' })).toMatchObject({ success: false });
    });

    it('lets a clean resubmission through', async () => {
        inRevision();
        store.seed(MEMBERS, 'unrelated', {
            userId: STRANGER, email: 'other@example.com', phone: '09099999999',
        });

        expect(await resubmit()).toMatchObject({ success: true });
    });
});
