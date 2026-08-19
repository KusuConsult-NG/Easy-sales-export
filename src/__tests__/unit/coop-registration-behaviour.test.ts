/**
 * @jest-environment node
 */

/**
 * Cooperative registration, EXECUTED — the invite, and the application lookup.
 *
 * At 7%. The invite is the sharp end: `paymentStatus: "completed"` is set from
 * `if (inviteToken)` alone, so an invitation IS the fee waiver. Two defects here
 * are recorded and both were about who a link admits.
 *
 *   - ONE TOKEN ADMITTED TWO FEE-FREE MEMBERS. The token was read, and marked
 *     "used" much later by a blind update inside runTransaction — which takes no
 *     lock on this adapter. Two registrations submitted with the same link both
 *     read "pending" and both wrote "used". It is claimed with a CAS now, and
 *     claimed BEFORE the membership is written, because a claim made afterwards
 *     cannot refuse anything.
 *   - A FORWARDED LINK ADMITTED WHOEVER HELD IT. The check was
 *     `status !== "pending"` and nothing else: no expiry, and the invite's
 *     recorded email compared to nothing at all.
 *
 * The lookup path has its own shape worth executing: it queries by userId, falls
 * back to the document id, HEALS the missing userId, and only then falls back to
 * email — with a claim check on that last one, because an email match is not by
 * itself proof of ownership.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

let store: FakeDbHandle;

const MEMBER = 'member-1';
const MEMBER_EMAIL = 'member@example.com';

function actAs(id: string | null, email = MEMBER_EMAIL, roles: string[] = ['user']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles, email, name: id } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(MEMBER);
});

async function actions() {
    return import('@/app/actions/cooperative/_coop_registration');
}

/** An invitation issued to MEMBER_EMAIL, created now. */
function seedInvite(id: string, extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.COOPERATIVES_INVITES, id, {
        status: 'pending',
        email: MEMBER_EMAIL,
        createdAt: new Date().toISOString(),
        ...extra,
    });
}

// ─── the invitation ──────────────────────────────────────────────────────────

describe('validating a cooperative invitation', () => {
    it('accepts a pending invitation issued to the caller', async () => {
        seedInvite('tok-1');

        const { validateCooperativeInviteAction } = await actions();
        const result = await validateCooperativeInviteAction('tok-1');

        expect(result.success).toBe(true);
    });

    it('refuses an empty token without touching the database', async () => {
        const { validateCooperativeInviteAction } = await actions();
        const result = await validateCooperativeInviteAction('');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/invalid token/i);
    });

    it('refuses a token that does not exist', async () => {
        const { validateCooperativeInviteAction } = await actions();
        const result = await validateCooperativeInviteAction('never-issued');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/invalid or expired/i);
    });

    it('refuses one already used, or revoked', async () => {
        seedInvite('used', { status: 'used' });
        seedInvite('revoked', { status: 'revoked' });

        const { validateCooperativeInviteAction } = await actions();
        expect((await validateCooperativeInviteAction('used')).success).toBe(false);
        expect((await validateCooperativeInviteAction('revoked')).success).toBe(false);
    });

    it('refuses one that has expired', async () => {
        // No expiry at all was the original state, so a link issued once worked
        // for ever.
        const { INVITE_MAX_AGE_DAYS } = await import('@/lib/cooperative-invite');
        const tooOld = new Date(Date.now() - (INVITE_MAX_AGE_DAYS + 1) * 86_400_000).toISOString();
        seedInvite('stale', { createdAt: tooOld });

        const { validateCooperativeInviteAction } = await actions();
        const result = await validateCooperativeInviteAction('stale');

        expect(result.success).toBe(false);
    });

    it('and refuses a FORWARDED link — the recorded address decides', async () => {
        // THE binding. The invite waives the registration fee, so a link passed
        // to a friend used to admit that friend fee-free.
        seedInvite('tok-1', { email: 'somebody-else@example.com' });
        actAs(MEMBER, MEMBER_EMAIL);

        const { validateCooperativeInviteAction } = await actions();
        const result = await validateCooperativeInviteAction('tok-1');

        expect(result.success).toBe(false);
    });

    it('matching the address case-insensitively, because addresses are typed by hand', async () => {
        seedInvite('tok-1', { email: 'Member@Example.com' });
        actAs(MEMBER, 'member@example.com');

        const { validateCooperativeInviteAction } = await actions();
        expect((await validateCooperativeInviteAction('tok-1')).success).toBe(true);
    });

    it('and failing CLOSED when the invite records no address at all', async () => {
        // Deliberately the opposite default from the session-revocation check,
        // which fails open. An invite with no recorded address cannot be shown to
        // belong to anybody, and it is worth money.
        seedInvite('tok-1', { email: undefined });
        actAs(MEMBER, MEMBER_EMAIL);

        const { validateCooperativeInviteAction } = await actions();
        expect((await validateCooperativeInviteAction('tok-1')).success).toBe(false);
    });

    it('while a SIGNED-OUT preview checks only status and age', async () => {
        // This action is also the onboarding page's link preview. Refusing a
        // signed-out visitor would make a valid invitation look broken before they
        // had a chance to sign in — and a preview is not the fee waiver, which is
        // granted only on the redemption path.
        seedInvite('tok-1', { email: 'anyone@example.com' });
        actAs(null);

        const { validateCooperativeInviteAction } = await actions();
        expect((await validateCooperativeInviteAction('tok-1')).success).toBe(true);
    });

    it('and a signed-out preview of an EXPIRED invite is still refused', async () => {
        // The two relaxed checks are the binding only. Status and age still apply,
        // or the preview would tell a visitor a dead link is fine.
        const { INVITE_MAX_AGE_DAYS } = await import('@/lib/cooperative-invite');
        seedInvite('stale', {
            createdAt: new Date(Date.now() - (INVITE_MAX_AGE_DAYS + 5) * 86_400_000).toISOString(),
        });
        actAs(null);

        const { validateCooperativeInviteAction } = await actions();
        expect((await validateCooperativeInviteAction('stale')).success).toBe(false);
    });

    it('an explicit expiresAt overrides the age derived from createdAt', async () => {
        seedInvite('explicit', {
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() - 1000).toISOString(),
        });

        const { validateCooperativeInviteAction } = await actions();
        expect((await validateCooperativeInviteAction('explicit')).success).toBe(false);
    });

    it('and an unreadable createdAt is treated as ageless, not as 1970', async () => {
        // Parsing failure must not silently expire every legacy invitation ever
        // issued. Ageless, so status and binding still decide.
        seedInvite('odd', { createdAt: 'not a date' });

        const { validateCooperativeInviteAction } = await actions();
        expect((await validateCooperativeInviteAction('odd')).success).toBe(true);
    });
});

// ─── the application lookup ──────────────────────────────────────────────────

describe('finding the caller’s own cooperative application', () => {
    it('by userId', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-doc',
            { userId: MEMBER, firstName: 'Ada', membershipStatus: 'pending' });

        const { getCooperativeApplicationAction } = await actions();
        const result = await getCooperativeApplicationAction();

        expect(result.success).toBe(true);
        expect(JSON.stringify(result.data)).toContain('Ada');
    });

    it('by document id when the userId field was never written', async () => {
        // A bulk import keys the membership on the user id and writes no userId
        // field, so the query above finds nothing.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER,
            { firstName: 'Legacy', membershipStatus: 'pending' });

        const { getCooperativeApplicationAction } = await actions();
        const result = await getCooperativeApplicationAction();

        expect(result.success).toBe(true);
        expect(JSON.stringify(result.data)).toContain('Legacy');
    });

    it('and HEALS the missing userId, so the fast path works next time', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER,
            { firstName: 'Legacy', membershipStatus: 'pending' });

        const { getCooperativeApplicationAction } = await actions();
        await getCooperativeApplicationAction();

        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER)?.userId).toBe(MEMBER);
    });

    it('and does NOT hand over another member’s application', async () => {
        // The query test. A membership exists under a different owner, and an
        // application carries KYC, documents and bank details.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'someone-else',
            { userId: 'other-person', firstName: 'Other', email: 'other@example.com' });

        const { getCooperativeApplicationAction } = await actions();
        const result = await getCooperativeApplicationAction();

        expect(JSON.stringify(result.data ?? {})).not.toContain('Other');
    });

    it('and refuses an unauthenticated caller', async () => {
        actAs(null);
        const { getCooperativeApplicationAction } = await actions();
        expect((await getCooperativeApplicationAction()).success).toBe(false);
    });

    it('reporting no application rather than erroring when there is none', async () => {
        const { getCooperativeApplicationAction } = await actions();
        const result = await getCooperativeApplicationAction();
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/no application/i);
    });
});

// ─── the registration itself ─────────────────────────────────────────────────

describe('registering with an invitation', () => {
    /** The minimum a registration form has to carry. */
    function form(extra: Record<string, string> = {}): FormData {
        const fd = new FormData();
        // Every field cooperativeMembershipSchema requires. The first draft was
        // missing residentialAddress and nextOfKinAddress, and the schema — which
        // runs BEFORE the BVN check — refused with its own message instead. Worth
        // recording: the ordering is schema first, identifier lengths second.
        const fields: Record<string, string> = {
            firstName: 'Ada',
            lastName: 'Obi',
            email: MEMBER_EMAIL,
            phone: '08031111111',
            dateOfBirth: '1990-01-01',
            gender: 'female',
            residentialAddress: '1 Market Road, Ikeja',
            stateOfOrigin: 'Lagos',
            lga: 'Ikeja',
            occupation: 'Trader',
            nextOfKinName: 'Chidi Eze',
            nextOfKinPhone: '08032222222',
            nextOfKinAddress: '2 Market Road, Ikeja',
            membershipTier: 'Member',
            ...extra,
        };
        for (const [k, v] of Object.entries(fields)) fd.set(k, v);
        return fd;
    }

    it('refuses an unauthenticated caller before consuming the token', async () => {
        seedInvite('tok-1');
        actAs(null);

        const { registerCooperativeMemberAction } = await actions();
        const result = await registerCooperativeMemberAction(form({ inviteToken: 'tok-1' }));

        expect(result.success).toBe(false);
        // The token must survive a refusal: an invitation burned by a caller who
        // was never admitted is an invitation the real recipient cannot use.
        expect(store.get(COLLECTIONS.COOPERATIVES_INVITES, 'tok-1')?.status).toBe('pending');
    });

    it('and refuses an invitation that has already been used, leaving it used', async () => {
        seedInvite('tok-1', { status: 'used' });

        const { registerCooperativeMemberAction } = await actions();
        const result = await registerCooperativeMemberAction(form({ inviteToken: 'tok-1' }));

        expect(result.success).toBe(false);
        expect(store.size(COLLECTIONS.COOPERATIVE_MEMBERS)).toBe(0);
    });

    it('and refuses a member who has already completed onboarding', async () => {
        seedInvite('tok-1');
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER,
            { userId: MEMBER, onboardingCompleted: true });

        const { registerCooperativeMemberAction } = await actions();
        const result = await registerCooperativeMemberAction(form({ inviteToken: 'tok-1' }));

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/already completed onboarding/i);
        // And the invitation is NOT consumed by that refusal.
        expect(store.get(COLLECTIONS.COOPERATIVES_INVITES, 'tok-1')?.status).toBe('pending');
    });

    it('refusing a submission that fails the schema, naming the field', async () => {
        // The schema runs first, so this is the message an applicant sees for a
        // missing field — not the identifier check below.
        const incomplete = form();
        incomplete.delete('residentialAddress');

        const { registerCooperativeMemberAction } = await actions();
        const result = await registerCooperativeMemberAction(incomplete);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/residentialAddress/i);
        expect(store.size(COLLECTIONS.COOPERATIVE_MEMBERS)).toBe(0);
    });

    it('refusing a BVN or NIN that is not eleven digits', async () => {
        const { registerCooperativeMemberAction } = await actions();

        const badBvn = await registerCooperativeMemberAction(form({ bvn: '123' }));
        expect(badBvn.success).toBe(false);
        expect(badBvn.error).toMatch(/BVN must be exactly 11 digits/i);

        const badNin = await registerCooperativeMemberAction(form({ nin: '999' }));
        expect(badNin.success).toBe(false);
        expect(badNin.error).toMatch(/NIN must be exactly 11 digits/i);

        expect(store.size(COLLECTIONS.COOPERATIVE_MEMBERS)).toBe(0);
    });

    it('and refusing a member who is already onboarded AND paid, without an invite', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER, {
            userId: MEMBER, onboardingCompleted: true, paymentStatus: 'completed',
        });

        const { registerCooperativeMemberAction } = await actions();
        const result = await registerCooperativeMemberAction(form());

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/already completed onboarding/i);
    });
});
