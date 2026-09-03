/**
 * @jest-environment node
 */

/**
 * Cooperative registration, EXECUTED — the onboarding submit, the invite
 * redemption, the revision resubmission and the application read-back.
 *
 * At 35%. This file holds the invite claim that stops one link admitting two
 * fee-free members, the compensating release that hands the token back when the
 * registration then fails, and the optimistic-locking version guard — none of
 * which had ever run.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
}));

jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: async () => undefined,
    invalidateServiceCache: async () => undefined,
}));

/**
 * claimStatusTransition is a Postgres CAS — it calls supabaseAdmin.rpc directly
 * rather than going through the adapter, so the in-memory store cannot see it.
 * Backed by the same store here, with the same compare-and-set semantics the
 * SQL function has, so the claim and the compensating release below are really
 * exercised rather than stubbed to a fixed answer.
 */
const mockClaim = jest.fn(async (args: any) => {
    const { collection, id, from, to, patch } = args;
    const doc = store.get(collection, id);
    if (!doc) return { claimed: false, exists: false, status: null };
    if (doc.status !== from) return { claimed: false, exists: true, status: doc.status };
    store.seed(collection, id, { ...doc, ...(patch ?? {}), status: to });
    return { claimed: true, exists: true, status: to };
});
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: (args: any) => mockClaim(args),
}));

let store: FakeDbHandle;

const MEMBER = 'member-1';

function actAs(id: string | null, email = `${id}@example.com`): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() =>
        Promise.resolve(
            id === null
                ? { session: null, error: { error: 'Authentication required' } }
                : { session: { user: { id, email, roles: [], name: id } }, error: null },
        ),
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(MEMBER);
});

async function actions() {
    return import('@/app/actions/cooperative/_coop_registration');
}

// ─── seeds ───────────────────────────────────────────────────────────────────

/** Every field cooperativeMembershipSchema requires, plus the two document urls. */
function form(overrides: Record<string, string> = {}): FormData {
    const fd = new FormData();
    const fields: Record<string, string> = {
        firstName: 'Amaka',
        lastName: 'Okonkwo',
        dateOfBirth: '1990-04-12',
        gender: 'female',
        email: `${MEMBER}@example.com`,
        phone: '08012345678',
        stateOfOrigin: 'Enugu',
        lga: 'Nsukka',
        ward: 'Ward 3',
        residentialAddress: '12 Market Road, Nsukka',
        occupation: 'Trader',
        nextOfKinName: 'Chidi Okonkwo',
        nextOfKinPhone: '08087654321',
        nextOfKinAddress: '12 Market Road, Nsukka',
        validIdUrl: 'https://cdn/id.png',
        validIdName: 'National ID',
        passportPhotoUrl: 'https://cdn/photo.png',
        passportPhotoName: 'Passport',
        ...overrides,
    };
    for (const [k, v] of Object.entries(fields)) if (v !== '') fd.set(k, v);
    return fd;
}

function seedUser(extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.USERS, MEMBER, {
        email: `${MEMBER}@example.com`,
        name: 'Amaka',
        roles: [],
        ...extra,
    });
}

const readMember = (id = MEMBER) => store.get(COLLECTIONS.COOPERATIVE_MEMBERS, id) as Record<string, any> | undefined;
const readUser = (id = MEMBER) => store.get(COLLECTIONS.USERS, id) as Record<string, any> | undefined;

// ─── registerCooperativeMemberAction ─────────────────────────────────────────

describe('registerCooperativeMemberAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { registerCooperativeMemberAction } = await actions();

        expect(await registerCooperativeMemberAction(form())).toMatchObject({ success: false });
        expect(store.size(COLLECTIONS.COOPERATIVE_MEMBERS)).toBe(0);
    });

    it('records the profile and leaves an unpaid member pending', async () => {
        seedUser();
        const { registerCooperativeMemberAction } = await actions();

        expect(await registerCooperativeMemberAction(form())).toMatchObject({ success: true });

        expect(readMember()).toMatchObject({
            userId: MEMBER,
            fullName: 'Amaka Okonkwo',
            membershipStatus: 'pending',
            paymentStatus: 'pending',
            onboardingCompleted: true,
        });
        expect(readUser()?.roles ?? []).not.toContain('cooperative_member');
    });

    it('and activates one whose payment is already recorded', async () => {
        seedUser({ serviceRegistrations: { cooperatives: { paymentStatus: 'completed' } } });
        const { registerCooperativeMemberAction } = await actions();

        await registerCooperativeMemberAction(form());

        expect(readMember()).toMatchObject({ membershipStatus: 'active', paymentStatus: 'completed' });
        expect(readUser()?.roles).toContain('cooperative_member');
        expect(readUser()?.isVerified).toBe(true);
    });

    it('refuses a submission missing its ID upload', async () => {
        seedUser();
        const { registerCooperativeMemberAction } = await actions();

        const fd = form();
        fd.delete('validIdUrl');
        expect(await registerCooperativeMemberAction(fd)).toMatchObject({
            success: false, error: 'A valid ID document upload is required',
        });
        expect(store.size(COLLECTIONS.COOPERATIVE_MEMBERS)).toBe(0);
    });

    it('refuses a BVN that is not eleven digits', async () => {
        seedUser();
        const { registerCooperativeMemberAction } = await actions();

        expect(await registerCooperativeMemberAction(form({ bvn: '123' }))).toMatchObject({
            success: false, error: 'BVN must be exactly 11 digits',
        });
    });

    it('refuses a member who has already completed onboarding and paid', async () => {
        seedUser();
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER, {
            userId: MEMBER, onboardingCompleted: true, paymentStatus: 'completed',
        });
        const { registerCooperativeMemberAction } = await actions();

        expect(await registerCooperativeMemberAction(form())).toMatchObject({
            success: false,
            error: 'You have already completed onboarding. Profile updates require admin approval.',
        });
    });

    describe('the optimistic-locking guard', () => {
        it('refuses a submission carrying a stale version', async () => {
            seedUser();
            store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER, { userId: MEMBER, _version: 4 });
            const { registerCooperativeMemberAction } = await actions();

            const result = await registerCooperativeMemberAction(form({ _version: '2' }));
            expect(result.success).toBe(false);
            expect(result.error).toContain('STALE_DATA');
        });

        it('and accepts the current one, returning the next', async () => {
            seedUser();
            store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER, { userId: MEMBER, _version: 4 });
            const { registerCooperativeMemberAction } = await actions();

            const result: any = await registerCooperativeMemberAction(form({ _version: '4' }));
            expect(result.success).toBe(true);
            expect(result.data.version).toBe(5);
            expect(readMember()?._version).toBe(5);
        });
    });

    describe('the cross-account duplicate guard', () => {
        it('refuses a phone number another member already holds', async () => {
            seedUser();
            store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'someone-else', {
                userId: 'someone-else', phone: '08012345678', email: 'other@example.com',
            });
            const { registerCooperativeMemberAction } = await actions();

            expect(await registerCooperativeMemberAction(form())).toMatchObject({
                success: false,
                error: 'A cooperative member with this phone number already exists.',
            });
        });

        it('but not the caller editing their own record', async () => {
            seedUser();
            store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER, {
                userId: MEMBER, phone: '08012345678', email: `${MEMBER}@example.com`,
            });
            const { registerCooperativeMemberAction } = await actions();

            expect(await registerCooperativeMemberAction(form())).toMatchObject({ success: true });
        });

        /**
         * `.limit(1)` DECIDED THE ANSWER, AND ONE PHONE FORM MISSED THE OTHER.
         *
         * The guard read a single row per field with no ordering and refused if
         * that row belonged to somebody else. With the caller's OWN row beside
         * another account's, which one came back decided whether the caller
         * could edit their own registration — and Postgres does not promise an
         * order for a query that does not ask for one.
         *
         * Both halves are the academy application defect verbatim, diagnosed and
         * fixed there (DUPLICATE_SCAN_LIMIT and `.where("personalInfo.phone",
         * "in", phoneForms)`) and left standing here. Two member rows CAN share
         * a phone: legacy imports and joinCooperativeAction both write into this
         * collection without passing this guard.
         */
        it('sees a conflict that does not happen to be the first row back', async () => {
            // THE test for the `.limit(1)`. The caller's own record is keyed by
            // their user id and sorts before 'z-other', so the single row the
            // guard read was their own — `phoneDoc.id === userId`, no refusal —
            // and the genuine cross-account duplicate one row further down was
            // never looked at. The guard failed OPEN, silently, decided by
            // nothing more than how two ids happen to sort.
            seedUser();
            store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER, {
                userId: MEMBER, phone: '08012345678', email: `${MEMBER}@example.com`,
            });
            store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'z-other', {
                userId: 'z-other', phone: '08012345678', email: 'other@example.com',
            });
            const { registerCooperativeMemberAction } = await actions();

            const result = await registerCooperativeMemberAction(form());
            expect(result.success).toBe(false);
            expect(result.error).toContain('phone number');
        });

        it('and the same for the email, whichever row comes back first', async () => {
            seedUser();
            store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER, {
                userId: MEMBER, phone: '08000000000', email: `${MEMBER}@example.com`,
            });
            store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'z-other', {
                userId: 'z-other', phone: '08099999999', email: `${MEMBER}@example.com`,
            });
            const { registerCooperativeMemberAction } = await actions();

            const result = await registerCooperativeMemberAction(form());
            expect(result.success).toBe(false);
            expect(result.error).toContain('email address');
        });

        it('and finds a conflict recorded in the other phone form', async () => {
            // 08012345678 and +2348012345678 are the same person. Rows already
            // exist in each form, so querying one alone misses the other.
            seedUser();
            store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'someone-else', {
                userId: 'someone-else', phone: '+2348012345678', email: 'other@example.com',
            });
            const { registerCooperativeMemberAction } = await actions();

            expect(await registerCooperativeMemberAction(form({ phone: '08012345678' })))
                .toMatchObject({ success: false });
        });

        it('and the caller\'s own row in the other form is still their own', async () => {
            // The mirror of the case above: normalising must not turn the
            // caller's own record into somebody else's conflict.
            seedUser();
            store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER, {
                userId: MEMBER, phone: '+2348012345678', email: `${MEMBER}@example.com`,
            });
            const { registerCooperativeMemberAction } = await actions();

            expect(await registerCooperativeMemberAction(form({ phone: '08012345678' })))
                .toMatchObject({ success: true });
        });
    });

    describe('the invite', () => {
        function seedInvite(id: string, extra: Record<string, unknown> = {}): void {
            store.seed(COLLECTIONS.COOPERATIVES_INVITES, id, {
                status: 'pending',
                email: `${MEMBER}@example.com`,
                createdAt: new Date().toISOString(),
                ...extra,
            });
        }

        it('waives the fee and activates the member', async () => {
            seedUser();
            seedInvite('tok-1');
            const { registerCooperativeMemberAction } = await actions();

            expect(await registerCooperativeMemberAction(form({ inviteToken: 'tok-1' })))
                .toMatchObject({ success: true });

            expect(readMember()).toMatchObject({
                paymentStatus: 'completed',
                membershipStatus: 'active',
                _importSource: 'email_invite',
            });
        });

        it('is consumed, so one link cannot admit two fee-free members', async () => {
            // THE reason the claim moved ahead of the transaction: it was marked
            // used by a blind update inside runTransaction, which takes no lock
            // on this adapter.
            seedUser();
            seedInvite('tok-1');
            const { registerCooperativeMemberAction } = await actions();

            await registerCooperativeMemberAction(form({ inviteToken: 'tok-1' }));
            expect(store.get(COLLECTIONS.COOPERATIVES_INVITES, 'tok-1')).toMatchObject({
                status: 'used', usedBy: MEMBER,
            });

            // A second account presenting the same link.
            actAs('member-2', 'member-2@example.com');
            store.seed(COLLECTIONS.USERS, 'member-2', { email: 'member-2@example.com', roles: [] });
            const second = await registerCooperativeMemberAction(form({
                inviteToken: 'tok-1',
                email: 'member-2@example.com',
                phone: '08099999999',
            }));

            expect(second).toMatchObject({
                success: false, error: 'This invitation has already been used or revoked.',
            });
            expect(readMember('member-2')).toBeUndefined();
        });

        it('is handed back when the registration then fails', async () => {
            // The claim happens before the writes, which is the only order that
            // can refuse a second use — so a later failure must not leave the
            // member holding a link that reports "already used".
            seedUser();
            seedInvite('tok-1');
            store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER, { userId: MEMBER, _version: 9 });
            const { registerCooperativeMemberAction } = await actions();

            const result = await registerCooperativeMemberAction(form({
                inviteToken: 'tok-1', _version: '1',
            }));

            expect(result.success).toBe(false);
            expect(store.get(COLLECTIONS.COOPERATIVES_INVITES, 'tok-1')).toMatchObject({
                status: 'pending', usedBy: null,
            });
        });

        it('is refused when it was issued to a different address', async () => {
            seedUser();
            seedInvite('tok-1', { email: 'somebody-else@example.com' });
            const { registerCooperativeMemberAction } = await actions();

            const result = await registerCooperativeMemberAction(form({ inviteToken: 'tok-1' }));
            expect(result.success).toBe(false);
            // And it is not consumed by the attempt.
            expect(store.get(COLLECTIONS.COOPERATIVES_INVITES, 'tok-1')?.status).toBe('pending');
        });
    });
});

// ─── the identity numbers ────────────────────────────────────────────────────

describe('the identity numbers the applicant typed', () => {
    it('are not recorded as verified', async () => {
        // THE test. `bvnVerified: bvn ? true : false` asserted a check nothing
        // performs, and admin/users renders it as a green "Verified" badge for
        // the reviewer deciding whether to approve this very application.
        seedUser();
        const { registerCooperativeMemberAction } = await actions();

        await registerCooperativeMemberAction(form({ bvn: '12345678901', nin: '10987654321' }));

        expect(readMember()?.bvnVerified).toBeUndefined();
        expect(readMember()?.ninVerified).toBeUndefined();
        expect(readUser()?.bvnVerified).toBeUndefined();
        expect(readUser()?.ninVerified).toBeUndefined();
    });

    it('and do not reach the users table in the clear', async () => {
        // kyc.ts, marketplace/_mp_seller_verification.ts, the WAVE application
        // and export onboarding all hash before storing. This path wrote the
        // raw number onto the user document.
        seedUser();
        const { registerCooperativeMemberAction } = await actions();

        await registerCooperativeMemberAction(form({ bvn: '12345678901', nin: '10987654321' }));

        expect(readUser()?.bvn).not.toBe('12345678901');
        expect(readUser()?.nin).not.toBe('10987654321');
        expect(String(readUser()?.bvn)).toMatch(/^[a-f0-9]{64}$/);
    });

    it('while the application record an admin reviews keeps the readable copy', async () => {
        // The member document IS the application. _coop_admin_members searches
        // it by bvn, and the precedent fixes left the reviewable copy alone.
        seedUser();
        const { registerCooperativeMemberAction } = await actions();

        await registerCooperativeMemberAction(form({ bvn: '12345678901' }));

        expect(readMember()?.bvn).toBe('12345678901');
    });

    it('and an admin\'s manual verification is not overwritten', async () => {
        // admin/_users.ts toggles bvnVerified by hand after a real check.
        // Writing `false` from here would undo it on any resubmission, which is
        // why the field is not written at all.
        seedUser({ bvnVerified: true, kyc: { bvnVerified: true } });
        const { registerCooperativeMemberAction } = await actions();

        await registerCooperativeMemberAction(form({ bvn: '12345678901' }));

        expect(readUser()?.bvnVerified).toBe(true);
    });
});

// ─── resubmitCooperativeApplicationAction ────────────────────────────────────

describe('resubmitCooperativeApplicationAction', () => {
    it('refuses an application that is not open for resubmission', async () => {
        seedUser({ serviceRegistrations: { cooperatives: { status: 'active' } } });
        const { resubmitCooperativeApplicationAction } = await actions();

        expect(await resubmitCooperativeApplicationAction(form())).toMatchObject({
            success: false, error: 'Your application cannot be resubmitted at this time.',
        });
    });

    it('updates the existing record and returns it to pending', async () => {
        seedUser({ serviceRegistrations: { cooperatives: { status: 'revision_required' } } });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER, {
            userId: MEMBER, membershipStatus: 'revision_required', revisionNote: 'Photo unclear',
        });
        const { resubmitCooperativeApplicationAction } = await actions();

        expect(await resubmitCooperativeApplicationAction(form())).toMatchObject({ success: true });

        expect(readMember()).toMatchObject({
            membershipStatus: 'pending', revisionNote: null, firstName: 'Amaka',
        });
        expect(readUser()?.serviceRegistrations?.cooperatives?.status).toBe('pending');
    });

    it('creates the record when the member document has gone missing', async () => {
        // THE test. The fallback says "auto-heal by allowing a new registration
        // creation" and then called batch.update on a document that does not
        // exist. update() does not create — the adapter no-ops it with a warning
        // whose own comment reads "this is how 'the save button did nothing'
        // bugs reach production". So the resubmitted application was discarded,
        // the user's status was still flipped to pending, and the action
        // returned success.
        seedUser({ serviceRegistrations: { cooperatives: { status: 'pending_repair' } } });
        const { resubmitCooperativeApplicationAction } = await actions();

        expect(await resubmitCooperativeApplicationAction(form())).toMatchObject({ success: true });

        expect(readMember()).toMatchObject({
            userId: MEMBER, firstName: 'Amaka', lastName: 'Okonkwo', membershipStatus: 'pending',
        });
    });

    it('and does not leave a pending status with no application behind it', async () => {
        seedUser({ serviceRegistrations: { cooperatives: { status: 'pending_repair' } } });
        const { resubmitCooperativeApplicationAction } = await actions();

        await resubmitCooperativeApplicationAction(form());

        const statusSaysPending = readUser()?.serviceRegistrations?.cooperatives?.status === 'pending';
        expect(statusSaysPending).toBe(true);
        expect(readMember()).toBeDefined();
    });

    it('keeps the documents already on file when none are re-uploaded', async () => {
        seedUser({ serviceRegistrations: { cooperatives: { status: 'revision_required' } } });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER, {
            userId: MEMBER,
            documents: {
                validId: { url: 'https://cdn/old-id.png', name: 'Old ID' },
                passportPhoto: { url: 'https://cdn/old-photo.png', name: 'Old Photo' },
            },
        });
        const { resubmitCooperativeApplicationAction } = await actions();

        const fd = form();
        fd.delete('validIdUrl');
        fd.delete('passportPhotoUrl');

        expect(await resubmitCooperativeApplicationAction(fd)).toMatchObject({ success: true });
        expect(readMember()?.documents?.validId?.url).toBe('https://cdn/old-id.png');
    });
});

// ─── joinCooperativeAction ───────────────────────────────────────────────────

describe('joinCooperativeAction', () => {
    beforeEach(() => {
        store.seed(COLLECTIONS.COOPERATIVES, 'coop-1', { name: 'Nsukka Traders', memberCount: 0, totalSavings: 0 });
    });

    it('refuses a cooperative that does not exist', async () => {
        const { joinCooperativeAction } = await actions();

        expect(await joinCooperativeAction('nope')).toMatchObject({
            success: false, error: 'Cooperative not found',
        });
    });

    it('adds the member as PENDING and counts them', async () => {
        /**
         * `pending`, not `active` — the other audit's finding, and it is the
         * stronger one. This branch wrote the member straight to active with
         * `savingsBalance: initialContribution`, and NO PAYMENT IS TAKEN
         * anywhere in this function. This branch validated the number's sign;
         * theirs observed that no sign makes an uncollected contribution real.
         *
         * So a member joins pending, and the money arrives through the payment
         * path that actually charges for it.
         */
        const { joinCooperativeAction } = await actions();

        expect(await joinCooperativeAction('coop-1')).toMatchObject({ success: true });

        const [, member] = store.all(COLLECTIONS.COOPERATIVE_MEMBERS)[0];
        expect(member).toMatchObject({ userId: MEMBER, cooperativeId: 'coop-1', status: 'pending', savingsBalance: 0 });
        expect(store.get(COLLECTIONS.COOPERATIVES, 'coop-1')?.memberCount).toBe(1);
    });

    it('and writes NO ledger row for a contribution nobody paid', async () => {
        // Was: two COMPLETED contribution rows and an incremented totalSavings
        // for a sum the caller merely named. The ledger is the record of money
        // that moved; nothing moved here.
        const { joinCooperativeAction } = await actions();

        await joinCooperativeAction('coop-1', 25000);

        expect(store.size(COLLECTIONS.COOPERATIVE_TRANSACTIONS)).toBe(0);
        expect(store.size(COLLECTIONS.TRANSACTIONS)).toBe(0);
        // And the cooperative's own total is untouched for the same reason: it
        // is the sum of money held, not of money named.
        expect(store.get(COLLECTIONS.COOPERATIVES, 'coop-1')?.totalSavings ?? 0).toBe(0);
    });

    it('refuses a second join of the same cooperative', async () => {
        const { joinCooperativeAction } = await actions();

        await joinCooperativeAction('coop-1');
        expect(await joinCooperativeAction('coop-1')).toMatchObject({
            success: false, error: 'You are already a member of this cooperative',
        });
        expect(store.size(COLLECTIONS.COOPERATIVE_MEMBERS)).toBe(1);
    });

    /**
     * THE OPENING BALANCE WAS WHATEVER THE CALLER SENT.
     *
     * `initialContribution` arrives as a parameter and was written straight to
     * `savingsBalance` with no validation at all. The only thing standing near
     * it is `if (initialContribution > 0)`, which guards the two LEDGER rows and
     * the cooperative's `totalSavings` — not the balance itself.
     *
     * So `joinCooperativeAction(coopId, -50000)` opened a savings account at
     * minus fifty thousand naira, with no transaction behind it and the
     * cooperative's own total untouched: a member balance that no ledger
     * explains and no reconciliation can find. This file is "use server", so the
     * parameter is reachable directly.
     *
     * A non-finite value was the same shape: `NaN > 0` is false, so `NaN` was
     * written as the balance and every later sum involving it became NaN.
     */
    it('refuses a negative opening contribution', async () => {
        const { joinCooperativeAction } = await actions();

        const result = await joinCooperativeAction('coop-1', -50000);
        expect(result.success).toBe(false);
        expect(store.size(COLLECTIONS.COOPERATIVE_MEMBERS)).toBe(0);
    });

    it('and one that is not a number at all', async () => {
        const { joinCooperativeAction } = await actions();

        expect(await joinCooperativeAction('coop-1', Number.NaN)).toMatchObject({ success: false });
        expect(await joinCooperativeAction('coop-1', Number.POSITIVE_INFINITY)).toMatchObject({ success: false });
        expect(store.size(COLLECTIONS.COOPERATIVE_MEMBERS)).toBe(0);
    });

    it('while zero is a normal opening balance', async () => {
        // Vacuity guard: joining without contributing is the default.
        const { joinCooperativeAction } = await actions();

        expect(await joinCooperativeAction('coop-1', 0)).toMatchObject({ success: true });
        expect(store.size(COLLECTIONS.COOPERATIVE_TRANSACTIONS)).toBe(0);
    });
});

// ─── getCooperativeApplicationAction ─────────────────────────────────────────

describe('getCooperativeApplicationAction', () => {
    it('returns the application found by userId', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'row-1', {
            userId: MEMBER, firstName: 'Amaka', revisionNote: 'Photo unclear',
            createdAt: new Date('2026-01-01').toISOString(),
        });
        const { getCooperativeApplicationAction } = await actions();

        const result: any = await getCooperativeApplicationAction();
        expect(result.success).toBe(true);
        expect(result.data.application.firstName).toBe('Amaka');
        expect(result.data.revisionNote).toBe('Photo unclear');
    });

    it('heals a record keyed by user id that never carried the field', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER, {
            firstName: 'Amaka', createdAt: new Date('2026-01-01').toISOString(),
        });
        const { getCooperativeApplicationAction } = await actions();

        expect((await getCooperativeApplicationAction() as any).data.application.firstName).toBe('Amaka');
        expect(readMember()?.userId).toBe(MEMBER);
    });

    it('and says so when there is nothing to return', async () => {
        const { getCooperativeApplicationAction } = await actions();

        expect(await getCooperativeApplicationAction()).toMatchObject({
            success: false, error: 'No application found',
        });
    });

    it('takes the most recent when a learner has several rows', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'old', {
            userId: MEMBER, firstName: 'Old', createdAt: new Date('2026-01-01').toISOString(),
        });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'new', {
            userId: MEMBER, firstName: 'New', createdAt: new Date('2026-06-01').toISOString(),
        });
        const { getCooperativeApplicationAction } = await actions();

        expect((await getCooperativeApplicationAction() as any).data.application.firstName).toBe('New');
    });
});

// ─── validateCooperativeInviteAction ─────────────────────────────────────────

describe('validateCooperativeInviteAction', () => {
    it('refuses an empty token', async () => {
        const { validateCooperativeInviteAction } = await actions();
        expect(await validateCooperativeInviteAction('')).toMatchObject({ success: false });
    });

    it('refuses a token that does not exist', async () => {
        const { validateCooperativeInviteAction } = await actions();
        expect(await validateCooperativeInviteAction('nope')).toMatchObject({
            success: false, error: 'Invalid or expired invitation link.',
        });
    });

    it('accepts a pending invitation issued to the caller', async () => {
        store.seed(COLLECTIONS.COOPERATIVES_INVITES, 'tok-1', {
            status: 'pending', email: `${MEMBER}@example.com`, createdAt: new Date().toISOString(),
        });
        const { validateCooperativeInviteAction } = await actions();

        expect(await validateCooperativeInviteAction('tok-1')).toMatchObject({ success: true });
    });

    it('refuses one issued to somebody else', async () => {
        store.seed(COLLECTIONS.COOPERATIVES_INVITES, 'tok-1', {
            status: 'pending', email: 'other@example.com', createdAt: new Date().toISOString(),
        });
        const { validateCooperativeInviteAction } = await actions();

        expect(await validateCooperativeInviteAction('tok-1')).toMatchObject({ success: false });
    });

    it('refuses one already used', async () => {
        store.seed(COLLECTIONS.COOPERATIVES_INVITES, 'tok-1', {
            status: 'used', email: `${MEMBER}@example.com`, createdAt: new Date().toISOString(),
        });
        const { validateCooperativeInviteAction } = await actions();

        expect(await validateCooperativeInviteAction('tok-1')).toMatchObject({ success: false });
    });
});
