/**
 * @jest-environment node
 */

/**
 * The SMS broadcast, EXECUTED — nineteen audiences, and the send itself.
 *
 * WHY THIS ONE MATTERS MORE THAN ITS COVERAGE NUMBER
 * --------------------------------------------------
 * This module was at 6.1%, and it is the channel with the sharpest failure mode
 * in the platform. Its own source records two of them:
 *
 *   - the `buyers` audience used to query `marketplaceAccountType in
 *     ["buyer","both"]`, a field nothing writes. Zero rows matched, the loop ran
 *     zero times, and the broadcast reached nobody — reporting success, with a
 *     recipient count of zero.
 *   - `AT_USERNAME` defaults to the literal string "sandbox". A send with it
 *     unset returns "Sent 500, Failed 0" while not one message leaves the
 *     sandbox. The only signal was a logger.warn nobody clicking Send can see,
 *     so `sandboxMode` now comes back to the caller.
 *
 * Both are the same shape: a channel that reports success while delivering
 * nothing. Neither was catchable with a call-recorder harness, because both are
 * about what a QUERY RETURNS and what the numbers MEAN.
 *
 * These tests seed documents, run the real resolver, and assert on the phone
 * numbers it produces and the counts it reports.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

const sendSMS = jest.fn(async (_phone: string, _message: string) =>
    ({ success: true, error: null as string | null }));

jest.mock('@/lib/africastalking', () => ({
    sendSMS: (phone: string, message: string) => sendSMS(phone, message),
}));

// Admin, so the guard passes and the resolver is reached. The refusal path has
// its own test below.
const requireAdmin = jest.fn(async () => ({ session: { user: { id: 'admin-7' } } }) as unknown);
jest.mock('@/lib/require-admin', () => ({ requireAdmin: () => requireAdmin() }));

let store: FakeDbHandle;
const realAtUsername = process.env.AT_USERNAME;

beforeEach(() => {
    jest.clearAllMocks();
    sendSMS.mockImplementation(async () => ({ success: true, error: null }));
    requireAdmin.mockImplementation(async () => ({ session: { user: { id: 'admin-7' } } }));
    store = installFakeDb();
    // A live username, so sandboxMode is false unless a test asks for it.
    process.env.AT_USERNAME = 'easysales-live';
});

afterEach(() => {
    if (realAtUsername === undefined) delete process.env.AT_USERNAME;
    else process.env.AT_USERNAME = realAtUsername;
});

async function preview(filters: Record<string, unknown>) {
    const { previewSmsBroadcastAction } = await import('@/app/actions/sms-broadcast');
    return previewSmsBroadcastAction(filters as never);
}

async function send(filters: Record<string, unknown>, message = 'hello') {
    const { sendSmsBroadcastAction } = await import('@/app/actions/sms-broadcast');
    return sendSmsBroadcastAction(filters as never, message);
}

/** The phone numbers sendSMS was actually called with, sorted. */
function dialled(): string[] {
    return sendSMS.mock.calls.map((c) => c[0] as string).sort();
}

// ─── the phone normaliser decides who is reachable ───────────────────────────

describe('a recipient is keyed on the NORMALISED phone number', () => {
    it('so one person recorded three ways is dialled once', async () => {
        // The de-duplication that keeps a member from receiving the same message
        // three times because three collections spell their number differently.
        store.seedAll(COLLECTIONS.USERS, {
            u1: { phone: '08031234567', fullName: 'A' },
        });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'm1',
            { userId: 'u1', phone: '+2348031234567' });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'w1',
            { userId: 'u1', phone: '2348031234567' });

        const result = await preview({ audience: 'all' });
        expect(result.data?.count).toBe(1);
    });

    it('and an unusable number contributes nobody', async () => {
        store.seedAll(COLLECTIONS.USERS, {
            good: { phone: '08031234567' },
            blank: { phone: '' },
            junk: { phone: 'not a phone' },
            missing: { fullName: 'No Phone' },
        });
        const result = await preview({ audience: 'all' });
        expect(result.data?.count).toBe(1);
    });

    it('taking the number from kyc.phoneNumber when the profile has none', async () => {
        store.seed(COLLECTIONS.USERS, 'u1', { kyc: { phoneNumber: '08031234567' } });
        expect((await preview({ audience: 'all' })).data?.count).toBe(1);
    });
});

// ─── the buyers audience, which used to reach nobody ─────────────────────────

describe('the buyers audience', () => {
    it('reaches a member holding the buyer ROLE — the clause that does the work', async () => {
        // THE regression. The old query keyed on marketplaceAccountType, a field
        // nothing writes, so this audience resolved to zero recipients while
        // reporting success.
        store.seedAll(COLLECTIONS.USERS, {
            buyer: { roles: ['buyer'], phone: '08031111111', fullName: 'Buyer' },
            seller: { roles: ['seller'], phone: '08032222222' },
            plain: { roles: ['user'], phone: '08033333333' },
        });

        const result = await preview({ audience: 'buyers' });
        expect(result.data?.count).toBe(1);
        expect(result.data?.sample[0].phone).toContain('8031111111');
    });

    it('and is not empty, which is the assertion the old defect would fail', async () => {
        // Written as its own test on purpose. "count is 1" would also be satisfied
        // by a resolver that matched the wrong person; "count is not 0" is the
        // specific claim the field-that-nothing-writes defect violated.
        store.seed(COLLECTIONS.USERS, 'b', { roles: ['buyer'], phone: '08031111111' });
        expect((await preview({ audience: 'buyers' })).data?.count).toBeGreaterThan(0);
    });
});

// ─── the all audience and its supplements ────────────────────────────────────

describe('the all audience sweeps every collection that stores a phone', () => {
    it('so a number held only in a module record is still reached', async () => {
        // The legacy data gap this exists for: a phone captured during a module
        // application and never synced to the root profile.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'm1',
            { userId: 'x1', phone: '08031111111', firstName: 'Coop', lastName: 'Member' });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'w1',
            { userId: 'x2', phone: '08032222222', firstName: 'Wave', surname: 'Applicant' });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'a1',
            { userId: 'x3', personalInfo: { phone: '08033333333', fullName: 'Academy' } });
        store.seed(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS, 'b1',
            { userId: 'x4', phone: '08034444444', name: 'Registrant' });
        store.seed(COLLECTIONS.FARM_NATION_APPLICATIONS, 'f1',
            { profile: { phone: '08035555555', fullName: 'Farmer' } });
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'e1',
            { profile: { phone: '08036666666', fullName: 'Exporter' } });

        expect((await preview({ audience: 'all' })).data?.count).toBe(6);
    });

    it('taking a WAVE alternativePhone when the primary is absent', async () => {
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'w1', { alternativePhone: '08031111111' });
        expect((await preview({ audience: 'all' })).data?.count).toBe(1);
    });

    it('and all_except_approved_coop drops approved members from every collection', async () => {
        store.seed(COLLECTIONS.USERS, 'coop-user', { phone: '08031111111' });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'm1',
            { userId: 'coop-user', membershipStatus: 'approved', phone: '08031111111' });
        store.seed(COLLECTIONS.USERS, 'other', { phone: '08039999999' });

        const result = await preview({ audience: 'all_except_approved_coop' });
        expect(result.data?.count).toBe(1);
        expect(result.data?.sample[0].phone).toContain('8039999999');
    });
});

// ─── the state filter ────────────────────────────────────────────────────────

describe('the state filter', () => {
    beforeEach(() => {
        store.seedAll(COLLECTIONS.USERS, {
            lagos: { phone: '08031111111', stateOfOrigin: 'Lagos' },
            kano: { phone: '08032222222', state: 'Kano' },
            viaAddress: { phone: '08033333333', address: { state: 'Oyo' } },
            stateless: { phone: '08034444444' },
        });
    });

    it('matches case-insensitively on a substring', async () => {
        const result = await preview({ audience: 'all', state: 'lag' });
        expect(result.data?.count).toBe(1);
    });

    it('reading the state from any of the three places it is stored', async () => {
        expect((await preview({ audience: 'all', state: 'Kano' })).data?.count).toBe(1);
        expect((await preview({ audience: 'all', state: 'Oyo' })).data?.count).toBe(1);
    });

    it('and EXCLUDES a member with no recorded state', async () => {
        // isStateMatch returns false for a missing state, and that is the
        // behaviour: an admin filtering to one state has not asked for the people
        // whose state is unknown. Asserted because the opposite default would send
        // a state-targeted message nationwide.
        const all = await preview({ audience: 'all' });
        const filtered = await preview({ audience: 'all', state: 'Lagos' });
        expect(all.data?.count).toBe(4);
        expect(filtered.data?.count).toBe(1);
    });

    it('while no filter at all keeps everyone', async () => {
        expect((await preview({ audience: 'all' })).data?.count).toBe(4);
    });
});

// ─── sellers ─────────────────────────────────────────────────────────────────

describe('the seller audiences', () => {
    beforeEach(() => {
        store.seedAll(COLLECTIONS.SELLER_VERIFICATIONS, {
            s1: { userId: 'u1', status: 'approved', sellerCategory: 'wholesale' },
            s2: { userId: 'u2', status: 'approved', sellerCategory: 'retail' },
            s3: { userId: 'u3', status: 'pending', sellerCategory: 'retail' },
        });
        store.seedAll(COLLECTIONS.USERS, {
            u1: { phone: '08031111111', fullName: 'Wholesale' },
            u2: { phone: '08032222222', fullName: 'Retail' },
            u3: { phone: '08033333333', fullName: 'Pending' },
        });
    });

    it('sellers reaches all of them', async () => {
        expect((await preview({ audience: 'sellers' })).data?.count).toBe(3);
    });

    it('wholesale_sellers and retail_sellers split them by category', async () => {
        expect((await preview({ audience: 'wholesale_sellers' })).data?.count).toBe(1);
        expect((await preview({ audience: 'retail_sellers' })).data?.count).toBe(2);
    });

    it('and sellerStatus narrows within that', async () => {
        expect((await preview({ audience: 'retail_sellers', sellerStatus: 'approved' })).data?.count)
            .toBe(1);
        expect((await preview({ audience: 'sellers', sellerStatus: 'pending' })).data?.count)
            .toBe(1);
    });

    it('fully_verified_sellers additionally requires a passed KYC', async () => {
        store.seed(COLLECTIONS.USERS, 'u1',
            { phone: '08031111111', kyc: { status: 'verified' } });
        store.seed(COLLECTIONS.USERS, 'u2',
            { phone: '08032222222', kyc: { status: 'pending' } });

        const result = await preview({ audience: 'fully_verified_sellers' });
        expect(result.data?.count).toBe(1);
        expect(result.data?.sample[0].phone).toContain('8031111111');
    });
});

// ─── cooperative members: unpaid are skipped ─────────────────────────────────

describe('the cooperative_members audience skips the unpaid', () => {
    it('so a pending, unpaid application is not messaged', async () => {
        store.seedAll(COLLECTIONS.COOPERATIVE_MEMBERS, {
            approved: { userId: 'u1', membershipStatus: 'approved', phone: '08031111111' },
            paidPending: { userId: 'u2', membershipStatus: 'pending', paymentStatus: 'completed', phone: '08032222222' },
            unpaidPending: { userId: 'u3', membershipStatus: 'pending', phone: '08033333333' },
        });

        const result = await preview({ audience: 'cooperative_members' });
        expect(result.data?.count).toBe(2);
        expect(dialled()).toEqual([]);   // preview sends nothing
    });

    it('falling back to the user profile for a member record with no phone', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'm1',
            { userId: 'u1', membershipStatus: 'approved' });
        store.seed(COLLECTIONS.USERS, 'u1', { phone: '08031111111', fullName: 'From Profile' });

        const result = await preview({ audience: 'cooperative_members' });
        expect(result.data?.count).toBe(1);
        expect(result.data?.sample[0].name).toBe('From Profile');
    });

    it('and moduleStatus narrowing works on top of the paid filter', async () => {
        store.seedAll(COLLECTIONS.COOPERATIVE_MEMBERS, {
            approved: { userId: 'u1', membershipStatus: 'approved', phone: '08031111111' },
            paidPending: { userId: 'u2', membershipStatus: 'pending', paymentStatus: 'completed', phone: '08032222222' },
        });
        expect((await preview({ audience: 'cooperative_members', moduleStatus: 'approved' })).data?.count)
            .toBe(1);
        expect((await preview({ audience: 'cooperative_members', moduleStatus: 'not_approved' })).data?.count)
            .toBe(1);
    });
});

// ─── the segment audiences share one definition with the email channel ───────

describe('the segment audiences use the SAME categorizeUser as the email channel', () => {
    beforeEach(() => {
        store.seedAll(COLLECTIONS.USERS, {
            active: { phone: '08031111111', serviceRegistrations: { wave: { status: 'approved' } } },
            pending: { phone: '08032222222', serviceRegistrations: { wave: { status: 'pending' } } },
            stalled: { phone: '08033333333', bankDetails: { bankName: 'Zenith' } },
            ghost: { phone: '08034444444' },
        });
    });

    it.each(['active_users', 'pending_users', 'stalled_users', 'ghost_users'])(
        '%s resolves to exactly one of the four', async (audience) => {
            expect((await preview({ audience })).data?.count).toBe(1);
        });

    it('and the same input gives the same segment through both channels', async () => {
        // One rule, two channels. Three copies of an audience rule with two of
        // them wrong is the defect pattern this whole audit keeps finding, so the
        // agreement is asserted rather than assumed.
        const { categorizeUser } = await import('@/lib/broadcast-logic');
        expect(categorizeUser({ serviceRegistrations: { wave: { status: 'approved' } } }))
            .toBe('active_users');
        expect((await preview({ audience: 'active_users' })).data?.count).toBe(1);
    });
});

describe('active_last_30_days', () => {
    const iso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

    it('keeps recent activity and drops the stale', async () => {
        store.seedAll(COLLECTIONS.USERS, {
            recent: { phone: '08031111111', updatedAt: iso(2) },
            stale: { phone: '08032222222', updatedAt: iso(90) },
            byLogin: { phone: '08033333333', lastLoginAt: iso(7) },
            undated: { phone: '08034444444' },
        });
        expect((await preview({ audience: 'active_last_30_days' })).data?.count).toBe(2);
    });
});

// ─── the custom audience ─────────────────────────────────────────────────────

describe('the custom audience takes numbers from the caller', () => {
    it('normalising and de-duplicating them', async () => {
        const result = await preview({
            audience: 'custom',
            customRecipients: ['08031234567', '+2348031234567', '08039999999'],
        });
        expect(result.data?.count).toBe(2);
    });

    it('and a state filter still applies, resolved from the stored profile', async () => {
        // The one case where a caller-supplied number is checked against the
        // database: the admin asked for Lagos, so a number whose owner is recorded
        // elsewhere is dropped.
        store.seedAll(COLLECTIONS.USERS, {
            lagos: { phone: '08031111111', state: 'Lagos' },
            kano: { phone: '08032222222', state: 'Kano' },
        });

        const result = await preview({
            audience: 'custom',
            customRecipients: ['08031111111', '08032222222'],
            state: 'Lagos',
        });
        expect(result.data?.count).toBe(1);
    });

    it('while an empty custom list resolves to nobody', async () => {
        expect((await preview({ audience: 'custom', customRecipients: [] })).data?.count).toBe(0);
    });
});

// ─── the send ────────────────────────────────────────────────────────────────

describe('sending', () => {
    beforeEach(() => {
        store.seedAll(COLLECTIONS.USERS, {
            u1: { phone: '08031111111', fullName: 'One' },
            u2: { phone: '08032222222', fullName: 'Two' },
        });
    });

    it('dials every matched recipient exactly once', async () => {
        const result = await send({ audience: 'all' }, 'the message');
        expect(result.success).toBe(true);
        expect(result.data?.sent).toBe(2);
        expect(sendSMS).toHaveBeenCalledTimes(2);
        expect(sendSMS.mock.calls.every((c) => c[1] === 'the message')).toBe(true);
    });

    it('refuses when nothing matched, rather than reporting a send of zero', async () => {
        // "Sent 0, Failed 0" reads as success. An explicit refusal is the honest
        // answer, and it is what tells an admin their filters are wrong.
        // An audience that genuinely matches nobody. The first draft used
        // ghost_users, which matched BOTH seeded users — they have phones and no
        // registrations, which is exactly what a ghost is — so the test failed
        // against correct code and the premise was mine, not the module's.
        const result = await send({ audience: 'custom', customRecipients: [] });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/No recipients/i);
        expect(sendSMS).not.toHaveBeenCalled();
    });

    it('counts a DND rejection as SKIPPED, not failed', async () => {
        // A member who opted out is not an error, and counting them as one makes
        // every broadcast look partly broken.
        sendSMS.mockImplementation(async (phone) =>
            phone.includes('8031111111')
                ? { success: false, error: 'DoNotDisturbRejection' }
                : { success: true, error: null });

        const result = await send({ audience: 'all' });
        expect(result.data).toMatchObject({ sent: 1, skipped: 1, failed: 0 });
    });

    it('counts a real error as failed', async () => {
        sendSMS.mockImplementation(async (phone) =>
            phone.includes('8031111111')
                ? { success: false, error: 'InsufficientBalance' }
                : { success: true, error: null });

        const result = await send({ audience: 'all' });
        expect(result.data).toMatchObject({ sent: 1, failed: 1, skipped: 0 });
    });

    it('and a thrown error too, without losing the rest of the batch', async () => {
        sendSMS.mockImplementation(async (phone) => {
            if (phone.includes('8031111111')) throw new Error('socket hang up');
            return { success: true, error: null };
        });

        const result = await send({ audience: 'all' });
        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({ sent: 1, failed: 1 });
    });

    it('recording the send, with the REAL admin id rather than the string "admin"', async () => {
        requireAdmin.mockImplementation(async () => ({ session: { user: { id: 'admin-42' } } }));

        const result = await send({ audience: 'all' }, 'logged');
        const [[, log]] = store.all('sms_broadcast_logs');
        expect(log.sentBy).toBe('admin-42');
        expect(log.message).toBe('logged');
        expect(log.totalRecipients).toBe(2);
        expect(result.data?.logId).toBeTruthy();
    });

    it('with a status that distinguishes done, partial and failed', async () => {
        await send({ audience: 'all' });
        expect(store.all('sms_broadcast_logs')[0][1].status).toBe('done');

        store.clear();
        store.seedAll(COLLECTIONS.USERS, {
            u1: { phone: '08031111111' }, u2: { phone: '08032222222' },
        });
        sendSMS.mockImplementation(async (phone) =>
            phone.includes('8031111111')
                ? { success: false, error: 'boom' }
                : { success: true, error: null });
        await send({ audience: 'all' });
        expect(store.all('sms_broadcast_logs')[0][1].status).toBe('partial');

        store.clear();
        store.seed(COLLECTIONS.USERS, 'u1', { phone: '08031111111' });
        sendSMS.mockImplementation(async () => ({ success: false, error: 'boom' }));
        await send({ audience: 'all' });
        expect(store.all('sms_broadcast_logs')[0][1].status).toBe('failed');
    });
});

describe('the sandbox, which reports success while delivering nothing', () => {
    beforeEach(() => {
        store.seed(COLLECTIONS.USERS, 'u1', { phone: '08031111111' });
    });

    it('is reported BACK TO THE CALLER, not only into the log', async () => {
        // THE fix. AT_USERNAME defaults to "sandbox", so an unset environment sends
        // every message into a sandbox that accepts all of them. The counts are
        // honest about what the API accepted; sandboxMode is what makes the answer
        // honest about what was delivered.
        process.env.AT_USERNAME = 'sandbox';

        const result = await send({ audience: 'all' });
        expect(result.data?.sandboxMode).toBe(true);
        expect(result.data?.sent).toBe(1);
        expect(store.all('sms_broadcast_logs')[0][1].sandboxMode).toBe(true);
    });

    it('and the DEFAULT — an unset AT_USERNAME — is the sandbox', async () => {
        // The reason this is not a corner case. The default is the dangerous
        // value, which is why the flag has to reach the caller rather than a log.
        delete process.env.AT_USERNAME;
        const result = await send({ audience: 'all' });
        expect(result.data?.sandboxMode).toBe(true);
    });

    it('while a live username reports false', async () => {
        process.env.AT_USERNAME = 'easysales-live';
        const result = await send({ audience: 'all' });
        expect(result.data?.sandboxMode).toBe(false);
        expect(store.all('sms_broadcast_logs')[0][1].sandboxMode).toBe(false);
    });

    it('case-insensitively, so "Sandbox" is caught too', async () => {
        process.env.AT_USERNAME = 'Sandbox';
        expect((await send({ audience: 'all' })).data?.sandboxMode).toBe(true);
    });
});

describe('both actions refuse a non-admin', () => {
    beforeEach(() => {
        requireAdmin.mockImplementation(async () => ({ error: 'Unauthorized' }));
        store.seed(COLLECTIONS.USERS, 'u1', { phone: '08031111111' });
    });

    it('preview resolves nobody', async () => {
        const result = await preview({ audience: 'all' });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/admin/i);
    });

    it('and send dials nobody', async () => {
        const result = await send({ audience: 'all' });
        expect(result.success).toBe(false);
        expect(sendSMS).not.toHaveBeenCalled();
        expect(store.size('sms_broadcast_logs')).toBe(0);
    });

    it('and an admin CAN, so the refusals are not vacuous', async () => {
        requireAdmin.mockImplementation(async () => ({ session: { user: { id: 'admin-7' } } }));
        expect((await send({ audience: 'all' })).success).toBe(true);
        expect(sendSMS).toHaveBeenCalledTimes(1);
    });
});

describe('the preview sample', () => {
    it('is at most three, so a large audience does not ship a phone book to the browser', async () => {
        for (let i = 0; i < 10; i++) {
            store.seed(COLLECTIONS.USERS, `u${i}`, { phone: `0803111${String(i).padStart(4, '0')}` });
        }
        const result = await preview({ audience: 'all' });
        expect(result.data?.count).toBe(10);
        expect(result.data?.sample).toHaveLength(3);
    });

    it('and sends nothing', async () => {
        store.seed(COLLECTIONS.USERS, 'u1', { phone: '08031111111' });
        await preview({ audience: 'all' });
        expect(sendSMS).not.toHaveBeenCalled();
    });
});

// ─── the per-module audiences, and the status vocabulary they share ──────────

describe('the module audiences collapse the pending vocabulary', () => {
    // under_review, submitted and pending_review all mean "pending" to the admin
    // choosing an audience. Four collections spell it three ways, and a filter
    // that only matched the literal "pending" would miss most of them.
    const PENDING_SPELLINGS = ['pending', 'under_review', 'submitted', 'pending_review'];

    it('wave_applicants treats all four spellings as pending', async () => {
        PENDING_SPELLINGS.forEach((status, i) => {
            store.seed(COLLECTIONS.WAVE_APPLICATIONS, `w${i}`,
                { status, phone: `0803111${String(i).padStart(4, '0')}` });
        });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'approved',
            { status: 'approved', phone: '08039999999' });

        expect((await preview({ audience: 'wave_applicants', moduleStatus: 'pending' })).data?.count)
            .toBe(4);
        expect((await preview({ audience: 'wave_applicants', moduleStatus: 'approved' })).data?.count)
            .toBe(1);
    });

    it('and approved covers active, paid and completed too', async () => {
        ['approved', 'active', 'paid', 'completed'].forEach((status, i) => {
            store.seed(COLLECTIONS.WAVE_APPLICATIONS, `w${i}`,
                { status, phone: `0803111${String(i).padStart(4, '0')}` });
        });
        expect((await preview({ audience: 'wave_applicants', moduleStatus: 'approved' })).data?.count)
            .toBe(4);
        expect((await preview({ audience: 'wave_applicants', moduleStatus: 'not_approved' })).data?.count)
            .toBe(0);
    });

    it('a record with NO status counts as pending, not as unclassified', async () => {
        // The default. Treating it as unclassified would silently drop every
        // record written before the status field existed.
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'w1', { phone: '08031111111' });
        expect((await preview({ audience: 'wave_applicants', moduleStatus: 'pending' })).data?.count)
            .toBe(1);
    });

    it('export_users applies the same vocabulary', async () => {
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'e1',
            { status: 'under_review', profile: { phone: '08031111111', fullName: 'Exporter' } });
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'e2',
            { status: 'approved', profile: { phone: '08032222222' } });

        expect((await preview({ audience: 'export_users', moduleStatus: 'pending' })).data?.count).toBe(1);
        expect((await preview({ audience: 'export_users' })).data?.count).toBe(2);
    });

    it('farm_nation_users too, reading the phone out of profile', async () => {
        store.seed(COLLECTIONS.FARM_NATION_APPLICATIONS, 'f1',
            { status: 'submitted', profile: { phone: '08031111111', fullName: 'Farmer' } });
        store.seed(COLLECTIONS.FARM_NATION_APPLICATIONS, 'f2',
            { status: 'approved', profile: { phone: '08032222222' } });

        expect((await preview({ audience: 'farm_nation_users', moduleStatus: 'pending' })).data?.count).toBe(1);
        expect((await preview({ audience: 'farm_nation_users', moduleStatus: 'approved' })).data?.count).toBe(1);
    });

    it('and academy_users reads the nested personalInfo', async () => {
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'a1',
            { status: 'approved', personalInfo: { phone: '08031111111', fullName: 'Learner' } });
        const result = await preview({ audience: 'academy_users' });
        expect(result.data?.count).toBe(1);
        expect(result.data?.sample[0].name).toBe('Learner');
    });
});

describe('wave_briefing_registrants takes only the registered', () => {
    it('so a cancelled registration is not messaged', async () => {
        store.seedAll(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS, {
            r1: { status: 'registered', phone: '08031111111', name: 'Registered' },
            r2: { status: 'cancelled', phone: '08032222222', name: 'Cancelled' },
            r3: { phone: '08033333333' },
        });

        const result = await preview({ audience: 'wave_briefing_registrants' });
        expect(result.data?.count).toBe(1);
        expect(result.data?.sample[0].name).toBe('Registered');
    });
});

describe('abandoned_failed_transactions', () => {
    it('takes customerPhone, which is what the payment record carries', async () => {
        store.seed('failedPayments', 'f1',
            { customerPhone: '08031111111', customerName: 'Abandoned Buyer' });
        const result = await preview({ audience: 'abandoned_failed_transactions' });
        expect(result.data?.count).toBe(1);
        expect(result.data?.sample[0].name).toBe('Abandoned Buyer');
    });

    it('resolving through the user profile when the record has only a userId', async () => {
        store.seed('failedPayments', 'f1', { userId: 'u1' });
        store.seed(COLLECTIONS.USERS, 'u1', { phone: '08031111111', fullName: 'Via Profile' });

        const result = await preview({ audience: 'abandoned_failed_transactions' });
        expect(result.data?.count).toBe(1);
        expect(result.data?.sample[0].name).toBe('Via Profile');
    });

    it('and a record with neither reaches nobody', async () => {
        store.seed('failedPayments', 'f1', { amount: 5000 });
        expect((await preview({ audience: 'abandoned_failed_transactions' })).data?.count).toBe(0);
    });
});

describe('unpaid_applicants spans cooperative and academy', () => {
    it('taking the three unpaid spellings from both', async () => {
        store.seedAll(COLLECTIONS.COOPERATIVE_MEMBERS, {
            c1: { paymentStatus: 'pending', phone: '08031111111', firstName: 'A', lastName: 'One' },
            c2: { paymentStatus: 'unpaid', phone: '08032222222' },
            c3: { paymentStatus: 'failed', phone: '08033333333' },
            c4: { paymentStatus: 'completed', phone: '08034444444' },
        });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'a1',
            { paymentStatus: 'pending', personalInfo: { phone: '08035555555', fullName: 'Learner' } });

        expect((await preview({ audience: 'unpaid_applicants' })).data?.count).toBe(4);
    });

    it('falling back to the user profile for a member with no phone of its own', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'c1',
            { paymentStatus: 'pending', userId: 'u1' });
        store.seed(COLLECTIONS.USERS, 'u1', { phone: '08031111111', fullName: 'From Profile' });

        const result = await preview({ audience: 'unpaid_applicants' });
        expect(result.data?.count).toBe(1);
        expect(result.data?.sample[0].name).toBe('From Profile');
    });
});

describe('approved and not_approved are exact complements', () => {
    /**
     * They were not. `approved` accepted approved, active, paid and completed;
     * `not_approved` excluded only approved and active. So an applicant whose
     * status was "paid" or "completed" matched BOTH audiences — and not_approved
     * is the chase-up list, the one that says a payment is outstanding. Somebody
     * who had paid received a message asking them to pay.
     *
     * Eight copies of that pair across two channels, four each. Both arms now
     * derive from isApprovedModuleStatus in lib/broadcast-audience.ts.
     */
    const STATUSES = [
        'approved', 'active', 'paid', 'completed',
        'pending', 'under_review', 'submitted', 'pending_review', 'rejected',
    ];

    it('no applicant is in both, and none is in neither', async () => {
        STATUSES.forEach((status, i) => {
            store.seed(COLLECTIONS.WAVE_APPLICATIONS, `w${i}`,
                { status, phone: `0803111${String(i).padStart(4, '0')}` });
        });

        const approved = (await preview({ audience: 'wave_applicants', moduleStatus: 'approved' })).data!.count;
        const notApproved = (await preview({ audience: 'wave_applicants', moduleStatus: 'not_approved' })).data!.count;
        const all = (await preview({ audience: 'wave_applicants' })).data!.count;

        expect(all).toBe(STATUSES.length);
        expect(approved + notApproved).toBe(all);
        expect(approved).toBe(4);
    });

    it('specifically: "paid" is approved and NOT in the chase-up list', async () => {
        // THE case. Written as its own test because the sum above would also hold
        // if both sets were wrong in compensating ways.
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'w1', { status: 'paid', phone: '08031111111' });

        expect((await preview({ audience: 'wave_applicants', moduleStatus: 'approved' })).data?.count).toBe(1);
        expect((await preview({ audience: 'wave_applicants', moduleStatus: 'not_approved' })).data?.count).toBe(0);
    });

    it('and the same holds for export and farm-nation', async () => {
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'e1',
            { status: 'completed', profile: { phone: '08031111111' } });
        store.seed(COLLECTIONS.FARM_NATION_APPLICATIONS, 'f1',
            { status: 'paid', profile: { phone: '08032222222' } });

        expect((await preview({ audience: 'export_users', moduleStatus: 'not_approved' })).data?.count).toBe(0);
        expect((await preview({ audience: 'farm_nation_users', moduleStatus: 'not_approved' })).data?.count).toBe(0);
    });

    it('and one set is the source for both arms, in one place', async () => {
        // The structural half. Two hand-written lists that happen to agree today
        // is the state this came from.
        const { isApprovedModuleStatus, APPROVED_MODULE_STATUSES } =
            await import('@/lib/broadcast-audience');

        expect([...APPROVED_MODULE_STATUSES].sort())
            .toEqual(['active', 'approved', 'completed', 'paid']);
        for (const s of ['approved', 'active', 'paid', 'completed']) {
            expect(isApprovedModuleStatus(s)).toBe(true);
        }
        for (const s of ['pending', 'rejected', 'under_review', '', null, undefined]) {
            expect(isApprovedModuleStatus(s as string)).toBe(false);
        }
    });
});
