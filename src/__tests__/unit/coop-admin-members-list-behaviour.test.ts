/**
 * @jest-environment node
 */

/**
 * The cooperative admin MEMBER LISTS, EXECUTED — getAllMembersAction,
 * getStandardCooperativeMembersAction and the revision request.
 *
 * coop-admin-members-behaviour.test.ts already covers the status changes; this
 * is the reading half, which is most of the file and was the uncovered part.
 * Both list actions hydrate every row from the users collection, merge two
 * records field by field, filter, paginate, and compute the cohort statistics
 * printed beside the table. All of that is decisions taken from documents, and
 * a call recorder answered every query with whatever the test stubbed.
 *
 * TWO PAGINATION MODES, WHICH IS THE THING TO KNOW
 * ------------------------------------------------
 * getStandardCooperativeMembersAction runs one of two entirely different
 * pipelines:
 *
 *   CURSOR MODE (no search, no date range, no state/LGA/registry, no gender
 *   sort) — the status and payment filters go into the QUERY, the page is
 *   `limit` rows, and the cursor is the last document id.
 *
 *   MEMORY MODE (any of those present) — the query fetches up to 5,001 rows
 *   unfiltered by status, everything is filtered in JavaScript, the cursor is a
 *   PAGE NUMBER, and a `stats` block is computed over the cohort BEFORE the
 *   status and payment filters are applied.
 *
 * They return different cursor types and only one of them returns stats, so a
 * caller that cannot tell which mode it is in will misread the response. Both
 * are exercised below.
 *
 * AND WHAT USED TO BE REPORTED AS COMPLETE
 * ----------------------------------------
 * The memory cohort caps at 5,000 and used to compute `hasMore` purely from the
 * length of what it had — so on a cooperative larger than the cap an admin
 * paged to the end of the first 5,000, was told there was no more, and never
 * saw the rest, with the cohort stats beside the list counting only those
 * 5,000 while presenting as the whole. `truncated` and `rowCap` are in the
 * payload for that reason and are asserted here.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('resend', () => ({
    Resend: class { emails = { send: async () => ({ data: { id: 'e1' }, error: null }) }; },
}));

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

let store: FakeDbHandle;

const MEMBERS = COLLECTIONS.COOPERATIVE_MEMBERS;

function actAs(id: string | null, roles: string[] = ['super_admin']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles, email: `${id}@example.com`, name: id } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs('admin-1');
    store.seed(COLLECTIONS.USERS, 'admin-1', { roles: ['super_admin'], email: 'admin-1@example.com' });
});

async function actions() {
    return import('@/app/actions/cooperative/_coop_admin_members');
}

function seedMember(id: string, extra: Record<string, unknown> = {}): void {
    store.seed(MEMBERS, id, {
        userId: `user-${id}`,
        firstName: 'Ada',
        lastName: 'Obi',
        email: `${id}@example.com`,
        phone: '08012345678',
        membershipStatus: 'pending',
        paymentStatus: 'pending',
        cooperativeId: 'coop-a',
        stateOfOrigin: 'Plateau',
        lga: 'Jos North',
        createdAt: '2026-01-01T00:00:00.000Z',
        ...extra,
    });
}

function seedMemberUser(id: string, extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.USERS, `user-${id}`, {
        firstName: 'Ada',
        lastName: 'Obi',
        email: `${id}@example.com`,
        phone: '08012345678',
        ...extra,
    });
}

const ids = (res: any) => (res.data as any[]).map((m) => m.id);

// ─────────────────────────────────────────────────────────────────────────────
describe('getAllMembersAction', () => {
    const all = async (options?: any) =>
        (await (await actions()).getAllMembersAction(options)) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await all()).toMatchObject({ success: false });
    });

    it('refuses an ordinary user', async () => {
        actAs('user-1', ['user']);
        store.seed(COLLECTIONS.USERS, 'user-1', { roles: ['user'] });
        expect(await all()).toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('re-reads the roles from the database when the session is stale', async () => {
        actAs('user-1', ['user']);
        store.seed(COLLECTIONS.USERS, 'user-1', { roles: ['admin'] });
        expect((await all()).success).toBe(true);
    });

    it('returns every member, INCLUDING the ones still pending', async () => {
        // A filter here used to hide members whose status was still "pending"
        // after submitting the form — making them invisible to the admins who
        // were supposed to approve them.
        seedMember('m1', { membershipStatus: 'pending' });
        seedMember('m2', { membershipStatus: 'active', createdAt: '2026-02-01T00:00:00.000Z' });

        const res = await all();
        expect(((res.data.members) as any[]).map((m) => m.id).sort()).toEqual(['m1', 'm2']);
    });

    it('hydrates each row from the user record', async () => {
        seedMember('m1', { firstName: undefined, lastName: undefined, email: undefined });
        seedMemberUser('m1', {
            firstName: 'Ngozi', lastName: 'Eze', email: 'ngozi@example.com', phone: '08099998888',
        });

        const [member] = (await all()).data.members;
        expect(member.user).toMatchObject({
            id: 'user-m1', name: 'Ngozi Eze', email: 'ngozi@example.com', phone: '08099998888',
        });
    });

    it('falls back to the membership record when there is no user document', async () => {
        seedMember('m1', { firstName: 'Ada', lastName: 'Obi', email: 'ada@example.com' });

        const [member] = (await all()).data.members;
        expect(member.user.email).toBe('ada@example.com');
    });

    it('filters by status, treating approved and active as one', async () => {
        seedMember('pending', { membershipStatus: 'pending' });
        seedMember('approved', { membershipStatus: 'approved' });
        seedMember('active', { membershipStatus: 'active' });
        seedMember('suspended', { membershipStatus: 'suspended' });

        expect(((await all({ status: 'active' })).data.members as any[]).map((m) => m.id).sort())
            .toEqual(['active', 'approved']);
        expect(((await all({ status: 'suspended' })).data.members as any[]).map((m) => m.id))
            .toEqual(['suspended']);
        expect((await all({ status: 'all' })).data.members).toHaveLength(4);
    });

    it('searches across the membership AND the hydrated user fields', async () => {
        seedMember('m1', { firstName: 'Ada', lastName: 'Obi' });
        seedMember('m2', { firstName: 'Ngozi', lastName: 'Eze', email: 'ngozi@example.com' });
        seedMemberUser('m2', { firstName: 'Ngozi', lastName: 'Eze', email: 'ngozi@example.com' });

        expect(((await all({ search: 'ngozi' })).data.members as any[]).map((m) => m.id))
            .toEqual(['m2']);
    });

    it('applies the caller\'s limit, and reports hasMore honestly', async () => {
        for (const n of [1, 2, 3]) {
            seedMember(`m${n}`, { createdAt: `2026-0${n}-01T00:00:00.000Z` });
        }

        const res = await all({ limit: 2 });
        expect(res.data.members).toHaveLength(2);
        expect(res.meta.hasMore).toBe(true);
    });

    it('reports hasMore false, and truncated false, when it returned everything', async () => {
        // `hasMore` was hardcoded false over a query that caps at fetchLimit and
        // then slices — so this reader always told its caller it had returned
        // every member, whatever it had actually returned.
        seedMember('m1');

        const res = await all();
        expect(res.meta).toMatchObject({ hasMore: false, truncated: false, rowCap: 500 });
    });

    it('a scoped admin sees only their own cooperative', async () => {
        actAs('coop-admin', ['cooperative_admin']);
        store.seed(COLLECTIONS.USERS, 'coop-admin', {
            roles: ['cooperative_admin', 'admin'], cooperativeId: 'coop-a',
        });
        seedMember('mine', { cooperativeId: 'coop-a' });
        seedMember('theirs', { cooperativeId: 'coop-b' });

        expect(((await all()).data.members as any[]).map((m) => m.id)).toEqual(['mine']);
    });

    it('and a global admin sees both', async () => {
        seedMember('mine', { cooperativeId: 'coop-a' });
        seedMember('theirs', { cooperativeId: 'coop-b', createdAt: '2026-02-01T00:00:00.000Z' });

        expect((await all()).data.members).toHaveLength(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getStandardCooperativeMembersAction — cursor mode', () => {
    const list = async (options?: any) =>
        (await (await actions()).getStandardCooperativeMembersAction(options)) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await list()).toMatchObject({ success: false, error: 'Not authenticated' });
    });

    it('refuses on the LIVE roles, not the session\'s', async () => {
        // This action reads the user document and never trusts the JWT, which is
        // the stricter of the two patterns in this file.
        actAs('user-1', ['super_admin']);
        store.seed(COLLECTIONS.USERS, 'user-1', { roles: ['user'] });

        expect(await list()).toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('lists members newest first', async () => {
        seedMember('older', { createdAt: '2026-01-01T00:00:00.000Z' });
        seedMember('newer', { createdAt: '2026-06-01T00:00:00.000Z' });

        expect(ids(await list())).toEqual(['newer', 'older']);
    });

    it('honours an ascending sort', async () => {
        seedMember('older', { createdAt: '2026-01-01T00:00:00.000Z' });
        seedMember('newer', { createdAt: '2026-06-01T00:00:00.000Z' });

        expect(ids(await list({ sortOrder: 'asc' }))).toEqual(['older', 'newer']);
    });

    it('filters by status in the QUERY, treating approved and active as one', async () => {
        seedMember('pending', { membershipStatus: 'pending' });
        seedMember('approved', { membershipStatus: 'approved', createdAt: '2026-02-01T00:00:00.000Z' });
        seedMember('active', { membershipStatus: 'active', createdAt: '2026-03-01T00:00:00.000Z' });

        expect(ids(await list({ status: 'approved' })).sort()).toEqual(['active', 'approved']);
        expect(ids(await list({ status: 'pending' }))).toEqual(['pending']);
    });

    it('filters by payment, folding unpaid, pending and failed together', async () => {
        seedMember('paid', { paymentStatus: 'completed' });
        seedMember('unpaid', { paymentStatus: 'unpaid', createdAt: '2026-02-01T00:00:00.000Z' });
        seedMember('failed', { paymentStatus: 'failed', createdAt: '2026-03-01T00:00:00.000Z' });
        seedMember('pending', { paymentStatus: 'pending', createdAt: '2026-04-01T00:00:00.000Z' });

        expect(ids(await list({ paymentStatus: 'completed' }))).toEqual(['paid']);
        expect(ids(await list({ paymentStatus: 'unpaid' })).sort())
            .toEqual(['failed', 'pending', 'unpaid']);
    });

    it('pages by DOCUMENT ID, and reports hasMore', async () => {
        seedMember('a', { createdAt: '2026-01-03T00:00:00.000Z' });
        seedMember('b', { createdAt: '2026-01-02T00:00:00.000Z' });
        seedMember('c', { createdAt: '2026-01-01T00:00:00.000Z' });

        const page1 = await list({ limit: 2 });
        expect(ids(page1)).toEqual(['a', 'b']);
        expect(page1.hasMore).toBe(true);
        expect(page1.lastDocId).toBe('b');

        const page2 = await list({ limit: 2, cursorId: page1.lastDocId });
        expect(ids(page2)).toEqual(['c']);
        expect(page2.hasMore).toBe(false);
    });

    it('returns NO cohort stats in this mode', async () => {
        seedMember('a');
        const res = await list();
        expect(res.meta.stats).toBeUndefined();
        expect(res.meta).toMatchObject({ truncated: false });
    });

    it('a scoped admin sees only their own cooperative', async () => {
        // The roles on the RECORD decide the scope here, because this action
        // never trusts the session's copy — so a cooperative_admin who is not
        // also a platform admin is scoped to their cooperativeId.
        actAs('coop-admin', ['cooperative_admin']);
        store.seed(COLLECTIONS.USERS, 'coop-admin', {
            roles: ['cooperative_admin'], cooperativeId: 'coop-a',
        });
        seedMember('mine', { cooperativeId: 'coop-a' });
        seedMember('theirs', { cooperativeId: 'coop-b' });

        expect(ids(await list())).toEqual(['mine']);
    });

    it('and a cooperative_admin who is ALSO a platform admin is global', async () => {
        // Worth pinning: adding "admin" to a scoped administrator's roles
        // silently widens them to every cooperative, because getAdminScope
        // short-circuits on it before it ever reads cooperativeId.
        actAs('coop-admin', ['cooperative_admin']);
        store.seed(COLLECTIONS.USERS, 'coop-admin', {
            roles: ['cooperative_admin', 'admin'], cooperativeId: 'coop-a',
        });
        seedMember('mine', { cooperativeId: 'coop-a' });
        seedMember('theirs', { cooperativeId: 'coop-b', createdAt: '2026-02-01T00:00:00.000Z' });

        expect(ids(await list())).toHaveLength(2);
    });

    it('merges the membership over the user record, field by field', async () => {
        seedMember('m1', {
            firstName: 'Ada', lastName: undefined, gender: undefined,
            stateOfOrigin: undefined, lga: undefined,
        });
        seedMemberUser('m1', {
            firstName: 'Ignored', lastName: 'Eze', gender: 'female',
            address: { state: 'Lagos', lga: 'Ikeja', street: '1 Broad Street' },
            bankDetails: { bankName: 'Zenith', accountNumber: '0123456789', accountName: 'Ada Eze' },
        });

        const [member] = (await list()).data;
        // The membership record wins where it has a value...
        expect(member.data.firstName).toBe('Ada');
        // ...and the user record fills the gaps, including from the nested address.
        expect(member.user).toMatchObject({
            name: 'Ignored Eze', gender: 'female', state: 'Lagos', lga: 'Ikeja',
            address: '1 Broad Street',
        });
        expect(member.user.bankDetails).toMatchObject({ bankName: 'Zenith' });
    });

    it('synthesises bank details from the loose fields when there is no bankDetails object', async () => {
        seedMember('m1', { bankName: 'Access', accountNumber: '9876543210', accountName: 'Ada Obi' });

        const [member] = (await list()).data;
        expect(member.user.bankDetails).toMatchObject({
            bankName: 'Access', accountNumber: '9876543210', accountName: 'Ada Obi',
        });
    });

    it('defaults a member with no membershipStatus to pending', async () => {
        seedMember('m1', { membershipStatus: undefined });
        expect(((await list()).data as any[])[0].status).toBe('pending');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getStandardCooperativeMembersAction — memory mode', () => {
    const list = async (options?: any) =>
        (await (await actions()).getStandardCooperativeMembersAction(options)) as any;

    it('filters by state, ignoring a trailing "State" and the casing', async () => {
        seedMember('jos', { stateOfOrigin: 'Plateau State' });
        seedMember('lagos', { stateOfOrigin: 'Lagos', createdAt: '2026-02-01T00:00:00.000Z' });

        expect(ids(await list({ state: 'plateau' }))).toEqual(['jos']);
    });

    it('filters by LGA', async () => {
        seedMember('north', { lga: 'Jos North' });
        seedMember('south', { lga: 'Jos South', createdAt: '2026-02-01T00:00:00.000Z' });

        expect(ids(await list({ lga: 'jos south' }))).toEqual(['south']);
    });

    it('separates the legacy registry from the regular one', async () => {
        seedMember('legacy', { isLegacy: true });
        seedMember('regular', { createdAt: '2026-02-01T00:00:00.000Z' });

        expect(ids(await list({ registry: 'legacy' }))).toEqual(['legacy']);
        expect(ids(await list({ registry: 'regular' }))).toEqual(['regular']);
        expect(ids(await list({ registry: 'all' }))).toHaveLength(2);
    });

    it('filters by a date range, comparing against the stored ISO form', async () => {
        seedMember('early', { createdAt: '2026-01-15T00:00:00.000Z' });
        seedMember('mid', { createdAt: '2026-03-15T00:00:00.000Z' });
        seedMember('late', { createdAt: '2026-06-15T00:00:00.000Z' });

        expect(ids(await list({ dateFrom: '2026-02-01', dateTo: '2026-04-30' }))).toEqual(['mid']);
    });

    it('searches the id, the short id and the name fields', async () => {
        seedMember('abcd1234', { firstName: 'Ada', lastName: 'Obi' });
        seedMember('efgh5678', { firstName: 'Ngozi', lastName: 'Eze', createdAt: '2026-02-01T00:00:00.000Z' });

        expect(ids(await list({ search: 'ngozi' }))).toEqual(['efgh5678']);
        expect(ids(await list({ search: 'ese-coop-1234' }))).toEqual(['abcd1234']);
        expect(ids(await list({ search: 'abcd' }))).toEqual(['abcd1234']);
    });

    it('reports the cohort STATS, counted before the status filter narrows it', async () => {
        // The stats describe the cohort the filters selected — the state, the
        // date range — not the tab the admin happens to be on. That is why they
        // are computed before the status and payment filters run.
        seedMember('a', { stateOfOrigin: 'Plateau', membershipStatus: 'pending', paymentStatus: 'pending' });
        seedMember('b', { stateOfOrigin: 'Plateau', membershipStatus: 'approved', paymentStatus: 'completed', createdAt: '2026-02-01T00:00:00.000Z' });
        seedMember('c', { stateOfOrigin: 'Plateau', membershipStatus: 'active', paymentStatus: 'completed', createdAt: '2026-03-01T00:00:00.000Z' });
        seedMember('d', { stateOfOrigin: 'Lagos', membershipStatus: 'pending', paymentStatus: 'pending', createdAt: '2026-04-01T00:00:00.000Z' });

        const res = await list({ state: 'Plateau', status: 'pending' });

        expect(ids(res)).toEqual(['a']);
        expect(res.meta.stats).toEqual({
            pendingMembers: 1, activeMembers: 2, paidMembers: 2, unpaidMembers: 1, totalMembers: 3,
        });
    });

    it('pages by PAGE NUMBER in this mode, not by document id', async () => {
        for (const n of [1, 2, 3]) {
            seedMember(`m${n}`, {
                stateOfOrigin: 'Plateau', createdAt: `2026-0${n}-01T00:00:00.000Z`,
            });
        }

        const page1 = await list({ state: 'Plateau', limit: 2 });
        expect(page1.data).toHaveLength(2);
        expect(page1.hasMore).toBe(true);
        expect(page1.lastDocId).toBe('1');

        const page2 = await list({ state: 'Plateau', limit: 2, cursorId: '1' });
        expect(page2.data).toHaveLength(1);
        expect(page2.hasMore).toBe(false);
    });

    it('accepts an explicit page option too', async () => {
        for (const n of [1, 2, 3]) {
            seedMember(`m${n}`, {
                stateOfOrigin: 'Plateau', createdAt: `2026-0${n}-01T00:00:00.000Z`,
            });
        }

        const page2 = await list({ state: 'Plateau', limit: 2, page: 1 });
        expect(page2.data).toHaveLength(1);
    });

    it('sorts by gender, falling back to newest within a gender', async () => {
        seedMember('f-old', { gender: 'female', createdAt: '2026-01-01T00:00:00.000Z' });
        seedMember('f-new', { gender: 'female', createdAt: '2026-06-01T00:00:00.000Z' });
        seedMember('m1', { gender: 'male', createdAt: '2026-03-01T00:00:00.000Z' });

        expect(ids(await list({ sortBy: 'gender', sortOrder: 'desc' })))
            .toEqual(['m1', 'f-new', 'f-old']);
        expect(ids(await list({ sortBy: 'gender', sortOrder: 'asc' })))
            .toEqual(['f-new', 'f-old', 'm1']);
    });

    it('reports truncated:false and the row cap it used', async () => {
        seedMember('a', { stateOfOrigin: 'Plateau' });

        const res = await list({ state: 'Plateau' });
        expect(res.meta).toMatchObject({ truncated: false, rowCap: 5000 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('requestCooperativeRevisionAction', () => {
    const request = async (id: string, reason: string) =>
        (await (await actions()).requestCooperativeRevisionAction(id, reason)) as any;

    beforeEach(() => {
        seedMember('m1', { userId: 'user-m1', membershipStatus: 'pending' });
        store.seed(COLLECTIONS.USERS, 'user-m1', {
            email: 'ada@example.com',
            serviceRegistrations: { cooperatives: { status: 'pending' } },
        });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await request('m1', 'Please redo')).toMatchObject({ success: false });
    });

    it('refuses an admin without cooperatives:approve_members', async () => {
        // The stale-session retry used to ask isAdmin() — a fallback WIDER than
        // the gate it falls back from, so a caller the gate refused could be
        // admitted by it. Both halves ask the same question now.
        actAs('content-admin', ['academy_admin']);
        store.seed(COLLECTIONS.USERS, 'content-admin', { roles: ['academy_admin'] });

        expect(await request('m1', 'Please redo')).toMatchObject({
            success: false, error: 'Admin access required',
        });
        expect(store.get(MEMBERS, 'm1')!.membershipStatus).toBe('pending');
    });

    it('admits a permitted admin whose SESSION is stale', async () => {
        actAs('coop-admin', ['user']);
        store.seed(COLLECTIONS.USERS, 'coop-admin', { roles: ['super_admin'] });

        expect(await request('m1', 'Please redo')).toMatchObject({ success: true });
    });

    it('says so when the member does not exist', async () => {
        expect(await request('nope', 'Please redo')).toMatchObject({
            success: false, error: 'Member not found',
        });
    });

    it('records the note, the requester and the time', async () => {
        expect(await request('m1', 'Upload a clearer ID')).toMatchObject({ success: true });

        const member = store.get(MEMBERS, 'm1')!;
        expect(member).toMatchObject({
            membershipStatus: 'revision_required',
            revisionNote: 'Upload a clearer ID',
            revisionRequestedBy: 'admin-1',
        });
        expect(typeof member.revisionRequestedAt).toBe('string');
    });

    it('mirrors the status onto the user record, under both key spellings', async () => {
        await request('m1', 'Please redo');

        const registrations = store.get(COLLECTIONS.USERS, 'user-m1')!.serviceRegistrations;
        expect(registrations.cooperatives.status).toBe('revision_required');
        expect(registrations.cooperative.status).toBe('revision_required');
    });

    it('does not fall over when the membership names no user', async () => {
        seedMember('orphan', { userId: undefined });
        expect(await request('orphan', 'Please redo')).toMatchObject({ success: true });
        expect(store.get(MEMBERS, 'orphan')!.membershipStatus).toBe('revision_required');
    });

    it('still succeeds when the member has no email to notify', async () => {
        seedMember('m2', { userId: 'user-m2', email: undefined });
        expect(await request('m2', 'Please redo')).toMatchObject({ success: true });
    });

    it('does not touch another member', async () => {
        seedMember('m2', { membershipStatus: 'active' });
        await request('m1', 'Please redo');

        expect(store.get(MEMBERS, 'm2')!.membershipStatus).toBe('active');
    });
});
