/**
 * @jest-environment node
 */

/**
 * The cooperative member ID card and the two editors beside it, EXECUTED.
 *
 * At 6.6%, and it is one of the densest decision surfaces in the codebase:
 * getCooperativeMemberIdCardAction walks FOUR fallbacks to find a membership
 * (query by userId, document id, email, then a completed payment), heals what
 * it finds, resolves a display name through six candidate sources with a
 * placeholder filter, and only then applies two gates — payment verified, admin
 * approved — each with its own authoritative fallback and self-heal.
 *
 * Every step of that is a decision made from stored documents. With a
 * call-recorder harness none of it could be checked, and the two most dangerous
 * paths — the email claim and the payment-based synthesis — both CREATE or
 * REASSIGN a membership record.
 *
 * WHY THE DATES ARE THE INTERESTING PART
 * --------------------------------------
 * The card's issue and expiry dates come out of
 * `d.approvedAt?.toDate ? ... : d.approvedAt instanceof Date ? ... : applicationDate`.
 * The adapter stores dates as ISO strings in JSONB and revives them into
 * Timestamps on read, so the FIRST arm is the one production takes. The fake
 * used to hand back the raw string, which meant that arm was unreachable in
 * tests and every assertion here would have been about the fallback. That gap
 * was closed first — see the hydration block in harness-covers-adapter.test.ts
 * — which is why "the card is dated from approvedAt, not from today" is a
 * meaningful assertion below rather than a tautology.
 *
 * TWO REFUSALS PINNED THAT USED TO BE PROVISIONING
 * ------------------------------------------------
 * updatePassportPhotoAction and updateMemberProfileDetailsAction each used to
 * MINT a cooperative membership — `paymentStatus: "completed"` on a payment that
 * never happened — for any caller holding an academy plan. Both are pinned as
 * refusals here, with a control proving the same caller succeeds once a real
 * membership exists.
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

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
    revalidateTag: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

let store: FakeDbHandle;

const MEMBER = 'member-1';
const MEMBERS = COLLECTIONS.COOPERATIVE_MEMBERS;
const PAYMENTS = COLLECTIONS.PROCESSED_PAYMENTS;

function actAs(id: string | null, extra: Record<string, unknown> = {}): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Not authenticated' } }
            : {
                  session: {
                      user: { id, roles: ['user'], email: 'ada@example.com', name: 'Ada Obi', ...extra },
                  },
                  error: null,
              },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(MEMBER);
});

async function actions() {
    return import('@/app/actions/cooperative/_coop_identity');
}

function seedUser(extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.USERS, MEMBER, {
        email: 'ada@example.com',
        fullName: 'Ada Obi',
        firstName: 'Ada',
        lastName: 'Obi',
        roles: ['user', 'cooperative_member'],
        ...extra,
    });
}

function seedMembership(extra: Record<string, unknown> = {}, id = 'coop-1'): void {
    store.seed(MEMBERS, id, {
        userId: MEMBER,
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Obi',
        gender: 'female',
        stateOfOrigin: 'Plateau',
        membershipStatus: 'active',
        paymentStatus: 'completed',
        createdAt: '2025-03-04T00:00:00.000Z',
        ...extra,
    });
}

const card = async () => (await (await actions()).getCooperativeMemberIdCardAction()) as any;

// ─────────────────────────────────────────────────────────────────────────────
describe('getCooperativeMemberIdCardAction — finding the membership', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await card()).toMatchObject({ success: false, reason: 'not_member' });
    });

    it('says so when there is no membership and no subscription', async () => {
        seedUser();
        expect(await card()).toMatchObject({
            success: false, error: 'No cooperative membership found.', reason: 'not_member',
        });
    });

    it('finds the membership by userId', async () => {
        seedUser();
        seedMembership();

        const res = await card();
        expect(res.success).toBe(true);
        expect(res.data).toMatchObject({ fullName: 'Ada Obi', stateOfOrigin: 'Plateau' });
    });

    it('takes the most recent when the member has several', async () => {
        seedUser();
        seedMembership({ createdAt: '2024-01-01T00:00:00.000Z', stateOfOrigin: 'Kano' }, 'old');
        seedMembership({ createdAt: '2026-01-01T00:00:00.000Z', stateOfOrigin: 'Plateau' }, 'recent');

        expect((await card()).data.stateOfOrigin).toBe('Plateau');
    });

    it('FALLBACK 2: finds a membership filed under the user\'s own id, and repairs the link', async () => {
        seedUser();
        // Note the document id IS the user id, but the row carries no userId, so
        // the query above it finds nothing.
        store.seed(MEMBERS, MEMBER, {
            firstName: 'Ada', lastName: 'Obi', membershipStatus: 'active',
            paymentStatus: 'completed', createdAt: '2025-03-04T00:00:00.000Z',
        });

        expect((await card()).success).toBe(true);
        expect(store.get(MEMBERS, MEMBER)!.userId).toBe(MEMBER);
    });

    it('FALLBACK 3: claims an ORPHANED membership when a payment ties it to the caller', async () => {
        seedUser();
        store.seed(MEMBERS, 'orphan', {
            email: 'ada@example.com', paymentReference: 'PSK-1',
            membershipStatus: 'active', paymentStatus: 'completed',
            createdAt: '2025-03-04T00:00:00.000Z',
        });
        store.seed(PAYMENTS, 'pay-1', { reference: 'PSK-1', userId: MEMBER, status: 'completed' });

        expect((await card()).success).toBe(true);
        expect(store.get(MEMBERS, 'orphan')!.userId).toBe(MEMBER);
    });

    it('and refuses the same claim when no payment ties it to the caller', async () => {
        // A matching email is not proof of ownership — the caller's address
        // comes from their own profile and they can change it. This is the
        // savings-and-loans handover that lib/cooperative-membership-claim.ts
        // exists to prevent.
        seedUser();
        store.seed(MEMBERS, 'orphan', {
            email: 'ada@example.com', paymentReference: 'PSK-1',
            membershipStatus: 'active', paymentStatus: 'completed',
        });
        store.seed(PAYMENTS, 'pay-1', { reference: 'PSK-1', userId: 'someone-else', status: 'completed' });

        expect(await card()).toMatchObject({ success: false, reason: 'not_member' });
        expect(store.get(MEMBERS, 'orphan')!.userId).toBeUndefined();
    });

    it('and never claims a membership that already belongs to somebody else', async () => {
        seedUser();
        store.seed(MEMBERS, 'theirs', {
            userId: 'someone-else', email: 'ada@example.com',
            membershipStatus: 'active', paymentStatus: 'completed',
        });

        expect(await card()).toMatchObject({ success: false, reason: 'not_member' });
        expect(store.get(MEMBERS, 'theirs')!.userId).toBe('someone-else');
    });

    it('and refuses an orphan with no payment reference at all', async () => {
        seedUser();
        store.seed(MEMBERS, 'orphan', {
            email: 'ada@example.com', membershipStatus: 'active', paymentStatus: 'completed',
        });

        expect(await card()).toMatchObject({ success: false, reason: 'not_member' });
    });

    it('FALLBACK 4: heals an orphaned membership found through a completed payment', async () => {
        seedUser();
        store.seed(PAYMENTS, 'pay-1', {
            userId: MEMBER, type: 'cooperative_membership_registration',
            status: 'completed', reference: 'PSK-9',
        });
        store.seed(MEMBERS, 'by-ref', {
            paymentReference: 'PSK-9', firstName: 'Ada', lastName: 'Obi',
            membershipStatus: 'active', paymentStatus: 'completed',
        });

        expect((await card()).success).toBe(true);
        expect(store.get(MEMBERS, 'by-ref')!.userId).toBe(MEMBER);
    });

    it('FALLBACK 4: SYNTHESISES a pending membership when the payment has no record', async () => {
        seedUser();
        store.seed(PAYMENTS, 'pay-1', {
            userId: MEMBER, type: 'cooperative_membership_registration',
            status: 'completed', reference: 'PSK-9', tier: 'Silver',
        });

        // Synthesised at "pending", so Gate 2 still refuses — paying is not
        // being approved.
        expect(await card()).toMatchObject({ success: false, reason: 'pending_approval' });

        const created = store.get(MEMBERS, MEMBER)!;
        expect(created).toMatchObject({
            userId: MEMBER,
            paymentStatus: 'completed',
            paymentReference: 'PSK-9',
            membershipStatus: 'pending',
            _healedFromPayment: true,
        });
    });

    it('ignores a payment of the wrong type', async () => {
        seedUser();
        store.seed(PAYMENTS, 'pay-1', {
            userId: MEMBER, type: 'academy_registration', status: 'completed', reference: 'PSK-9',
        });

        expect(await card()).toMatchObject({ success: false, reason: 'not_member' });
        expect(store.size(MEMBERS)).toBe(0);
    });

    it('ignores an incomplete payment', async () => {
        seedUser();
        store.seed(PAYMENTS, 'pay-1', {
            userId: MEMBER, type: 'cooperative_membership_registration',
            status: 'pending', reference: 'PSK-9',
        });

        expect(await card()).toMatchObject({ success: false, reason: 'not_member' });
        expect(store.size(MEMBERS)).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getCooperativeMemberIdCardAction — the two gates', () => {
    it('refuses when the fee is unverified', async () => {
        seedUser();
        seedMembership({ paymentStatus: 'pending', membershipStatus: 'pending' });

        expect(await card()).toMatchObject({ success: false, reason: 'payment_required' });
    });

    it('refuses when payment is in but the admin has not approved', async () => {
        seedUser();
        seedMembership({ paymentStatus: 'completed', membershipStatus: 'pending' });

        expect(await card()).toMatchObject({ success: false, reason: 'pending_approval' });
    });

    it('accepts "approved" as well as "active"', async () => {
        seedUser();
        seedMembership({ membershipStatus: 'approved' });

        expect((await card()).success).toBe(true);
    });

    it('honours a completed payment recorded in processed_payments when the row is stale, and heals it', async () => {
        // A webhook that half-landed leaves the member row saying pending while
        // processed_payments — the source of truth for Paystack — says paid.
        seedUser();
        seedMembership({ paymentStatus: 'pending', membershipStatus: 'pending' });
        store.seed(PAYMENTS, 'pay-1', {
            userId: MEMBER, type: 'cooperative_membership_registration', status: 'completed',
        });

        // Gate 1 now passes; Gate 2 still refuses, which is the point.
        expect(await card()).toMatchObject({ success: false, reason: 'pending_approval' });
        expect(store.get(MEMBERS, 'coop-1')!.paymentStatus).toBe('completed');
        expect(store.get(COLLECTIONS.USERS, MEMBER)!.serviceRegistrations.cooperatives.paymentStatus)
            .toBe('completed');
    });

    it('lets a legacy member past the payment gate', async () => {
        seedUser();
        seedMembership({ paymentStatus: 'pending', isLegacy: true });

        expect((await card()).success).toBe(true);
    });

    it('auto-activates a member the CENTRAL record already calls active, and heals both', async () => {
        seedUser({ serviceRegistrations: { cooperatives: { status: 'active' } } });
        seedMembership({ membershipStatus: 'pending', paymentStatus: 'completed' });

        expect((await card()).success).toBe(true);
        expect(store.get(MEMBERS, 'coop-1')!.membershipStatus).toBe('active');
        expect(store.get(COLLECTIONS.USERS, MEMBER)!.serviceRegistrations.cooperatives.status)
            .toBe('active');
    });

    it('auto-activates a member who paid and completed onboarding', async () => {
        seedUser();
        seedMembership({
            membershipStatus: 'pending', paymentStatus: 'completed', onboardingCompleted: true,
        });

        expect((await card()).success).toBe(true);
        expect(store.get(MEMBERS, 'coop-1')!.membershipStatus).toBe('active');
    });

    it('does NOT auto-activate somebody who merely paid', async () => {
        seedUser();
        seedMembership({ membershipStatus: 'pending', paymentStatus: 'completed' });

        expect(await card()).toMatchObject({ success: false, reason: 'pending_approval' });
        expect(store.get(MEMBERS, 'coop-1')!.membershipStatus).toBe('pending');
    });

    it('an academy subscriber gets a card with no membership at all', async () => {
        // Pinned, not endorsed: the premium bypass short-circuits both gates and
        // synthesises the card body. It is what the id-card page relies on.
        seedUser({ serviceRegistrations: { academy: { plan: 'elite' } } });

        const res = await card();
        expect(res.success).toBe(true);
        expect(res.data).toMatchObject({ membershipStatus: 'active', paymentStatus: 'completed' });
    });

    it('and a free academy plan does not', async () => {
        seedUser({ serviceRegistrations: { academy: { plan: 'free' } } });
        expect(await card()).toMatchObject({ success: false, reason: 'not_member' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getCooperativeMemberIdCardAction — what goes on the card', () => {
    it('is dated from approvedAt, and expires a year later', async () => {
        // The arm production takes: the adapter revives the stored ISO string
        // into a Timestamp, so `d.approvedAt?.toDate` is a function.
        seedUser();
        seedMembership({
            createdAt: '2025-03-04T00:00:00.000Z',
            approvedAt: '2026-02-01T09:30:00.000Z',
        });

        const { data } = await card();
        expect(data.joinedAt).toBe('2026-02-01T09:30:00.000Z');
        expect(data.validUntil).toBe('2027-02-01T09:30:00.000Z');
    });

    it('falls back to the APPLICATION date when the membership was never stamped approved', async () => {
        seedUser();
        seedMembership({ createdAt: '2025-03-04T05:06:07.000Z', approvedAt: undefined });

        const { data } = await card();
        expect(data.joinedAt).toBe('2025-03-04T05:06:07.000Z');
        expect(data.validUntil).toBe('2026-03-04T05:06:07.000Z');
    });

    it('keeps a stored member number rather than minting one', async () => {
        seedUser();
        seedMembership({ memberNumber: 'ESE-COOP-0042' });

        expect((await card()).data.memberNumber).toBe('ESE-COOP-0042');
    });

    it('accepts memberId as the same thing', async () => {
        seedUser();
        seedMembership({ memberId: 'ESE-COOP-0099' });

        expect((await card()).data.memberNumber).toBe('ESE-COOP-0099');
    });

    it('derives one from the document id when there is none', async () => {
        seedUser();
        seedMembership({}, 'abcdef1234');

        expect((await card()).data.memberNumber).toBe('ESE-COOP-1234');
    });

    it('always reports the tier as "Member"', async () => {
        // Hard-coded in the action. Pinned so a future tiered card is a
        // decision rather than a surprise.
        seedUser();
        seedMembership({ membershipTier: 'Platinum' });

        expect((await card()).data.membershipTier).toBe('Member');
    });

    it('prefers the central profile name', async () => {
        seedUser({ name: 'Adaeze Obiageli' });
        seedMembership({ firstName: 'Wrong', lastName: 'Name' });

        expect((await card()).data.fullName).toBe('Adaeze Obiageli');
    });

    it('skips a placeholder central name and uses the membership record', async () => {
        seedUser({ name: 'general_user', fullName: 'general_user' });
        seedMembership({ firstName: 'Ada', lastName: 'Obi' });

        expect((await card()).data.fullName).toBe('Ada Obi');
    });

    it.each(['general_user', 'General User', 'null', 'undefined', 'kusuconsult admin'])(
        'treats %p as a placeholder', async (placeholder) => {
            seedUser({ name: placeholder, fullName: placeholder, email: 'ada.obi@example.com' });
            seedMembership({ firstName: '', lastName: '' });

            expect((await card()).data.fullName).not.toBe(placeholder);
        });

    it('builds a name from the email when every source is a placeholder', async () => {
        seedUser({ name: 'general_user', fullName: 'general_user', email: 'ada.obi@example.com' });
        actAs(MEMBER, { name: 'general_user' });
        seedMembership({ firstName: '', lastName: '' });

        expect((await card()).data.fullName).toBe('Ada Obi');
    });

    it('resolves the passport photo through the membership document first', async () => {
        seedUser({ passportPhotoUrl: 'https://cdn/user.jpg' });
        seedMembership({ documents: { passportPhoto: { url: 'https://cdn/member.jpg' } } });

        expect((await card()).data.passportPhotoUrl).toBe('https://cdn/member.jpg');
    });

    it('accepts a passport photo stored as a bare string', async () => {
        seedUser();
        seedMembership({ documents: { passportPhoto: 'https://cdn/bare.jpg' } });

        expect((await card()).data.passportPhotoUrl).toBe('https://cdn/bare.jpg');
    });

    it('falls through to the central profile photo', async () => {
        seedUser({ photoUrl: 'https://cdn/central.jpg' });
        seedMembership();

        expect((await card()).data.passportPhotoUrl).toBe('https://cdn/central.jpg');
    });

    it('reports null rather than an empty string when there is no photo', async () => {
        seedUser();
        seedMembership();

        expect((await card()).data.passportPhotoUrl).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('updatePassportPhotoAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { updatePassportPhotoAction } = await actions();
        expect(await updatePassportPhotoAction('https://cdn/x.jpg', 'x.jpg'))
            .toMatchObject({ success: false, error: 'Not authenticated' });
    });

    it('refuses an academy subscriber with no membership, rather than minting one', async () => {
        // It used to CREATE a membership at membershipStatus "active" and
        // paymentStatus "completed" — a registration fee that was never paid,
        // reachable as an RPC from a photo-upload endpoint, and
        // _checkCooperativeStatusAction then grants cooperative_member from it.
        seedUser({ serviceRegistrations: { academy: { plan: 'elite' } } });

        const { updatePassportPhotoAction } = await actions();
        expect(await updatePassportPhotoAction('https://cdn/x.jpg', 'x.jpg')).toMatchObject({
            success: false, error: 'No cooperative membership found. Please register first.',
        });
        expect(store.size(MEMBERS)).toBe(0);
    });

    it('refuses everybody else with no membership too', async () => {
        seedUser();
        const { updatePassportPhotoAction } = await actions();
        expect(((await updatePassportPhotoAction('https://cdn/x.jpg', 'x.jpg')) as any).success)
            .toBe(false);
        expect(store.size(MEMBERS)).toBe(0);
    });

    it('updates the membership and the central profile when one exists', async () => {
        // The control: the refusals above are about the missing membership, not
        // about the action being broken.
        seedUser({ serviceRegistrations: { academy: { plan: 'elite' } } });
        seedMembership();

        const { updatePassportPhotoAction } = await actions();
        expect(await updatePassportPhotoAction('https://cdn/new.jpg', 'passport.jpg'))
            .toMatchObject({ success: true });

        const member = store.get(MEMBERS, 'coop-1')!;
        expect(member.passportPhotoUrl).toBe('https://cdn/new.jpg');
        expect(member.documents.passportPhoto).toEqual({
            name: 'passport.jpg', url: 'https://cdn/new.jpg',
        });

        const user = store.get(COLLECTIONS.USERS, MEMBER)!;
        expect(user.passportPhotoUrl).toBe('https://cdn/new.jpg');
        expect(user.documents.passportPhoto.name).toBe('passport.jpg');
    });

    it('works for a member still pending approval', async () => {
        seedUser();
        seedMembership({ membershipStatus: 'pending', paymentStatus: 'pending' });

        const { updatePassportPhotoAction } = await actions();
        expect(await updatePassportPhotoAction('https://cdn/new.jpg', 'p.jpg'))
            .toMatchObject({ success: true });
    });

    it('does not touch another member\'s record', async () => {
        seedUser();
        seedMembership();
        store.seed(MEMBERS, 'other', { userId: 'someone-else', passportPhotoUrl: 'https://cdn/theirs.jpg' });

        const { updatePassportPhotoAction } = await actions();
        await updatePassportPhotoAction('https://cdn/new.jpg', 'p.jpg');

        expect(store.get(MEMBERS, 'other')!.passportPhotoUrl).toBe('https://cdn/theirs.jpg');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('updateMemberProfileDetailsAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { updateMemberProfileDetailsAction } = await actions();
        expect(await updateMemberProfileDetailsAction('Female', 'Plateau'))
            .toMatchObject({ success: false, error: 'Not authenticated' });
    });

    it('refuses a gender that is neither male nor female', async () => {
        seedUser();
        seedMembership();
        const { updateMemberProfileDetailsAction } = await actions();
        expect(((await updateMemberProfileDetailsAction('other', 'Plateau')) as any).error)
            .toContain('Invalid gender');
    });

    it('normalises the gender to lower case', async () => {
        seedUser();
        seedMembership({ gender: '' });

        const { updateMemberProfileDetailsAction } = await actions();
        expect(await updateMemberProfileDetailsAction('  FEMALE ', 'Plateau'))
            .toMatchObject({ success: true });

        expect(store.get(MEMBERS, 'coop-1')!.gender).toBe('female');
        expect(store.get(COLLECTIONS.USERS, MEMBER)!.gender).toBe('female');
    });

    it('refuses a state that is not a Nigerian state', async () => {
        seedUser();
        seedMembership();
        const { updateMemberProfileDetailsAction } = await actions();
        expect(((await updateMemberProfileDetailsAction('Female', 'Atlantis')) as any).error)
            .toContain('Invalid state of origin');
    });

    it('writes the state to every key the app reads it under', async () => {
        seedUser();
        seedMembership();

        const { updateMemberProfileDetailsAction } = await actions();
        await updateMemberProfileDetailsAction('Female', 'Plateau');

        const user = store.get(COLLECTIONS.USERS, MEMBER)!;
        expect(user.stateOfOrigin).toBe('Plateau');
        expect(user.state).toBe('Plateau');
        expect(store.get(MEMBERS, 'coop-1')!.stateOfOrigin).toBe('Plateau');
    });

    it('refuses an academy subscriber with no membership, rather than minting one', async () => {
        // The second copy of the same fee bypass, reached from the gender and
        // state editor instead of the photo upload.
        seedUser({ serviceRegistrations: { academy: { plan: 'standard' } } });

        const { updateMemberProfileDetailsAction } = await actions();
        expect(await updateMemberProfileDetailsAction('Female', 'Plateau')).toMatchObject({
            success: false, error: 'No cooperative membership found. Please register first.',
        });
        expect(store.size(MEMBERS)).toBe(0);
    });

    it('still updates the CENTRAL profile even when it then refuses', async () => {
        // The user write happens before the membership lookup. Pinned because
        // the refusal above would otherwise read as "nothing happened".
        seedUser({ serviceRegistrations: { academy: { plan: 'standard' } } });

        const { updateMemberProfileDetailsAction } = await actions();
        await updateMemberProfileDetailsAction('Female', 'Plateau');

        expect(store.get(COLLECTIONS.USERS, MEMBER)!.gender).toBe('female');
    });

    it('updates the most recent membership when there are several', async () => {
        seedUser();
        seedMembership({ createdAt: '2024-01-01T00:00:00.000Z', gender: '' }, 'old');
        seedMembership({ createdAt: '2026-01-01T00:00:00.000Z', gender: '' }, 'recent');

        const { updateMemberProfileDetailsAction } = await actions();
        await updateMemberProfileDetailsAction('Female', 'Plateau');

        expect(store.get(MEMBERS, 'recent')!.gender).toBe('female');
        expect(store.get(MEMBERS, 'old')!.gender).toBe('');
    });
});
