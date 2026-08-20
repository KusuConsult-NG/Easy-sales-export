/**
 * @jest-environment node
 */

/**
 * The Academy admin applications screen, EXECUTED — the pending queue, the
 * status counters, the filtered list behind the table, and the export log.
 *
 * At 20.2%. Every one of these is a query plus a merge: the applicant's record
 * hydrated from the user document field by field, the cohort counted, the list
 * paged. With a call recorder the queries returned whatever the test stubbed,
 * so a filter reading the wrong field looked exactly like a correct one.
 *
 * TWO PAGINATION MODES AGAIN, AND THEY DISAGREE ABOUT hasMore
 * ------------------------------------------------------------
 * Like the cooperative member list, this action runs either a cursor pipeline
 * (status filter in the QUERY, cursor is a document id) or a memory pipeline
 * (search, date range, payment status, registry, or a gender sort — everything
 * filtered in JavaScript, cursor is a PAGE NUMBER, and a `stats` block computed
 * over the cohort BEFORE the status filter narrows it). Both are exercised, and
 * so is the fact that only one of them returns stats.
 *
 * THE EXPORT LOG IS THE INTERESTING REFUSAL
 * -----------------------------------------
 * logAcademyExportAction writes into the admin audit log — the record of WHO
 * read applicant data — and it was gated on a session alone while every export
 * beside it was gated on isAdmin. So any signed-in user could write entries
 * into the log that reconstructs an incident, with a count and filters they
 * chose. A record anybody can write to is not evidence.
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

let store: FakeDbHandle;

const APPS = COLLECTIONS.ACADEMY_APPLICATIONS;

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
});

async function actions() {
    return import('@/app/actions/academy/_ac_admin_applications');
}

function seedApplication(id: string, extra: Record<string, unknown> = {}): void {
    const { personalInfo, ...rest } = extra as any;
    store.seed(APPS, id, {
        userId: `user-${id}`,
        status: 'pending',
        paymentStatus: 'pending',
        submittedAt: '2026-01-01T00:00:00.000Z',
        personalInfo: {
            firstName: 'Ada',
            lastName: 'Obi',
            fullName: 'Ada Obi',
            email: `${id}@example.com`,
            phone: '08012345678',
            gender: 'female',
            state: 'Plateau',
            lga: 'Jos North',
            ...(personalInfo ?? {}),
        },
        ...rest,
    });
}

function seedApplicantUser(id: string, extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.USERS, `user-${id}`, {
        firstName: 'Ada',
        lastName: 'Obi',
        email: `${id}@example.com`,
        phone: '08012345678',
        ...extra,
    });
}

const ids = (res: any) => (res.data as any[]).map((a) => a.id);

// ─────────────────────────────────────────────────────────────────────────────
describe('getPendingAcademyApplicationsAction', () => {
    const pending = async () =>
        (await (await actions()).getPendingAcademyApplicationsAction()) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await pending()).toMatchObject({ success: false });
    });

    it('refuses an ordinary user', async () => {
        actAs('user-1', ['user']);
        expect(((await pending()) as any).error).toContain('users:update');
    });

    it('admits an academy_admin, who has no users:update', async () => {
        // The asymmetry this action carries deliberately: reviewing academy
        // applications is an academy responsibility, not a user-management one.
        actAs('academy-1', ['academy_admin']);
        expect((await pending()).success).toBe(true);
    });

    it('returns only pending applications', async () => {
        seedApplication('p1', { status: 'pending' });
        seedApplication('a1', { status: 'approved' });
        seedApplication('r1', { status: 'rejected' });

        expect(ids(await pending())).toEqual(['p1']);
    });

    it('lists the most recently submitted first', async () => {
        seedApplication('older', { submittedAt: '2026-01-01T00:00:00.000Z' });
        seedApplication('newer', { submittedAt: '2026-06-01T00:00:00.000Z' });

        expect(ids(await pending())).toEqual(['newer', 'older']);
    });

    it('hydrates the applicant profile from the user record', async () => {
        seedApplication('p1');
        seedApplicantUser('p1', {
            firstName: 'Ngozi', lastName: 'Eze', email: 'ngozi@example.com', phone: '08099998888',
        });

        const [app] = (await pending()).data;
        expect(app.userProfile).toEqual({
            name: 'Ngozi Eze', email: 'ngozi@example.com', phone: '08099998888',
        });
    });

    it('falls back to the application\'s own personalInfo when there is no user record', async () => {
        seedApplication('p1', {
            personalInfo: { fullName: 'Ada Obi', email: 'ada@example.com', phone: '08011112222' },
        });

        const [app] = (await pending()).data;
        expect(app.userProfile).toEqual({
            name: 'Ada Obi', email: 'ada@example.com', phone: '08011112222',
        });
    });

    it('reports "Unknown" and "N/A" rather than undefined when nothing is known', async () => {
        store.seed(APPS, 'bare', { status: 'pending', submittedAt: '2026-01-01T00:00:00.000Z' });

        const [app] = (await pending()).data;
        expect(app.userProfile).toEqual({ name: 'Unknown', email: 'N/A', phone: 'N/A' });
    });

    it('prefers a stored bankDetails object over the loose fields', async () => {
        seedApplication('p1');
        seedApplicantUser('p1', {
            bankDetails: { bankName: 'Zenith', accountNumber: '0123456789', accountName: 'Ada Obi' },
            bankName: 'Ignored',
        });

        expect((await pending()).data[0].bankDetails).toMatchObject({ bankName: 'Zenith' });
    });

    it('and synthesises one from the loose fields when there is none', async () => {
        seedApplication('p1');
        seedApplicantUser('p1', {
            bankName: 'Access', bankAccountNumber: '9876543210', bankAccountName: 'Ada Obi',
        });

        expect((await pending()).data[0].bankDetails).toMatchObject({
            bankName: 'Access', accountNumber: '9876543210', accountName: 'Ada Obi', bankCode: 'N/A',
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getAcademyApplicationStatsAction', () => {
    const stats = async () =>
        (await (await actions()).getAcademyApplicationStatsAction()) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await stats()).toMatchObject({ success: false });
    });

    it('refuses an ordinary user', async () => {
        actAs('user-1', ['user']);
        expect(await stats()).toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('is all zeroes when there are no applications', async () => {
        expect((await stats()).data.stats).toEqual({
            totalApplications: 0, pending: 0, under_review: 0, approved: 0, rejected: 0,
        });
    });

    it('counts each status, and totals only the four it counts', async () => {
        seedApplication('p1', { status: 'pending' });
        seedApplication('p2', { status: 'pending' });
        seedApplication('u1', { status: 'under_review' });
        seedApplication('a1', { status: 'approved' });
        seedApplication('r1', { status: 'rejected' });
        // A status outside the four is counted nowhere — including in the total.
        seedApplication('x1', { status: 'revision_required' });

        expect((await stats()).data.stats).toEqual({
            totalApplications: 5, pending: 2, under_review: 1, approved: 1, rejected: 1,
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getStandardAcademyApplicationsAction — cursor mode', () => {
    const list = async (options?: any) =>
        (await (await actions()).getStandardAcademyApplicationsAction(options)) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await list()).toMatchObject({ success: false });
    });

    it('refuses an ordinary user', async () => {
        actAs('user-1', ['user']);
        expect(await list()).toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('lists the most recently submitted first', async () => {
        seedApplication('older', { submittedAt: '2026-01-01T00:00:00.000Z' });
        seedApplication('newer', { submittedAt: '2026-06-01T00:00:00.000Z' });

        expect(ids(await list())).toEqual(['newer', 'older']);
    });

    it('honours an ascending sort', async () => {
        seedApplication('older', { submittedAt: '2026-01-01T00:00:00.000Z' });
        seedApplication('newer', { submittedAt: '2026-06-01T00:00:00.000Z' });

        expect(ids(await list({ sortOrder: 'asc' }))).toEqual(['older', 'newer']);
    });

    it('filters by status in the QUERY', async () => {
        seedApplication('p1', { status: 'pending' });
        seedApplication('a1', { status: 'approved', submittedAt: '2026-02-01T00:00:00.000Z' });

        expect(ids(await list({ status: 'approved' }))).toEqual(['a1']);
        expect(ids(await list({ status: 'all' }))).toHaveLength(2);
    });

    it('pages by DOCUMENT ID and reports hasMore', async () => {
        seedApplication('a', { submittedAt: '2026-01-03T00:00:00.000Z' });
        seedApplication('b', { submittedAt: '2026-01-02T00:00:00.000Z' });
        seedApplication('c', { submittedAt: '2026-01-01T00:00:00.000Z' });

        const page1 = await list({ limit: 2 });
        expect(ids(page1)).toEqual(['a', 'b']);
        expect(page1.meta).toMatchObject({ hasMore: true, lastDocId: 'b' });

        const page2 = await list({ limit: 2, lastDocId: 'b' });
        expect(ids(page2)).toEqual(['c']);
        expect(page2.meta).toMatchObject({ hasMore: false, lastDocId: null });
    });

    it('returns NO cohort stats in this mode', async () => {
        seedApplication('a');
        expect((await list()).meta.stats).toBeNull();
    });

    it('hydrates the applicant, the APPLICATION\'s own answers winning', async () => {
        seedApplication('a1', {
            personalInfo: { firstName: 'Ada', lga: 'Jos North', gender: undefined },
        });
        seedApplicantUser('a1', {
            firstName: 'Ignored', lastName: 'Eze', gender: 'female',
            address: { state: 'Lagos', lga: 'Ikeja', street: '1 Broad Street' },
        });

        const [app] = (await list()).data;
        // The name comes from the user record; everything the applicant TYPED
        // on the form wins over it, and the user record only fills the gaps.
        expect(app.user).toMatchObject({ name: 'Ignored Eze', lga: 'Jos North', gender: 'female' });
        expect(app.status).toBe('pending');
    });

    it('and falls back to the user record\'s nested address for what the form left blank', async () => {
        seedApplication('a1', { personalInfo: { firstName: 'Ada', lga: undefined } });
        seedApplicantUser('a1', {
            address: { state: 'Lagos', lga: 'Ikeja', street: '1 Broad Street' },
        });

        const [app] = (await list()).data;
        expect(app.user).toMatchObject({ lga: 'Ikeja', address: '1 Broad Street' });
    });

    it('REPAIRS the plan on read, from the user record when the row says nothing useful', async () => {
        // Every application row was written with the literal "registration", so
        // the badge and the CSV said Registration for every learner — including
        // everyone who paid the elite fee, with the correct amount displayed
        // beside it. The user document holds the plan the fulfilment paths
        // verified the payment against.
        seedApplication('a1', { plan: 'registration' });
        seedApplicantUser('a1', { serviceRegistrations: { academy: { plan: 'elite' } } });

        expect((await list()).data[0].data.plan).toBe('elite');
    });

    it('and keeps a real plan already on the application', async () => {
        seedApplication('a1', { plan: 'standard' });
        seedApplicantUser('a1', { serviceRegistrations: { academy: { plan: 'elite' } } });

        expect((await list()).data[0].data.plan).toBe('standard');
    });

    it('reports null rather than a placeholder when no tier was bought at all', async () => {
        seedApplication('a1', { plan: 'registration' });
        seedApplicantUser('a1');

        expect((await list()).data[0].data.plan).toBeNull();
    });

    it('marks a legacy applicant from either the application or the user record', async () => {
        seedApplication('legacy-app', { _isLegacy: true });
        seedApplication('legacy-user', { submittedAt: '2026-02-01T00:00:00.000Z' });
        seedApplicantUser('legacy-user', { legacyOnboardedBy: 'admin-9' });
        seedApplication('regular', { submittedAt: '2026-03-01T00:00:00.000Z' });

        const byId = Object.fromEntries(
            ((await list()).data as any[]).map((a) => [a.id, a.isLegacy]));
        expect(byId['legacy-app']).toBe(true);
        expect(byId['legacy-user']).toBe(true);
        expect(byId['regular']).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getStandardAcademyApplicationsAction — memory mode', () => {
    const list = async (options?: any) =>
        (await (await actions()).getStandardAcademyApplicationsAction(options)) as any;

    it('filters by payment status, folding "paid" in with "completed"', async () => {
        seedApplication('paid', { paymentStatus: 'completed' });
        seedApplication('also-paid', { paymentStatus: 'paid', submittedAt: '2026-02-01T00:00:00.000Z' });
        seedApplication('unpaid', { paymentStatus: 'pending', submittedAt: '2026-03-01T00:00:00.000Z' });

        expect(ids(await list({ paymentStatus: 'completed' })).sort())
            .toEqual(['also-paid', 'paid']);
        expect(ids(await list({ paymentStatus: 'pending' }))).toEqual(['unpaid']);
    });

    it('separates the legacy registry from the regular one', async () => {
        seedApplication('legacy', { isLegacy: true });
        seedApplication('regular', { submittedAt: '2026-02-01T00:00:00.000Z' });

        expect(ids(await list({ registry: 'legacy' }))).toEqual(['legacy']);
        expect(ids(await list({ registry: 'regular' }))).toEqual(['regular']);
    });

    it('filters by a date range', async () => {
        seedApplication('early', { submittedAt: '2026-01-15T00:00:00.000Z' });
        seedApplication('mid', { submittedAt: '2026-03-15T00:00:00.000Z' });
        seedApplication('late', { submittedAt: '2026-06-15T00:00:00.000Z' });

        expect(ids(await list({ dateFrom: '2026-02-01', dateTo: '2026-04-30' }))).toEqual(['mid']);
    });

    it('reports the cohort STATS, counted before the status filter narrows the list', async () => {
        seedApplication('a', { paymentStatus: 'completed', status: 'pending' });
        seedApplication('b', { paymentStatus: 'completed', status: 'approved', submittedAt: '2026-02-01T00:00:00.000Z' });
        seedApplication('c', { paymentStatus: 'completed', status: 'rejected', submittedAt: '2026-03-01T00:00:00.000Z' });
        seedApplication('d', { paymentStatus: 'pending', status: 'pending', submittedAt: '2026-04-01T00:00:00.000Z' });

        const res = await list({ paymentStatus: 'completed', status: 'pending' });

        expect(ids(res)).toEqual(['a']);
        expect(res.meta.stats).toEqual({
            totalApplications: 3, pending: 1, under_review: 0, approved: 1, rejected: 1,
        });
    });

    it('pages by PAGE NUMBER in this mode', async () => {
        for (const n of [1, 2, 3]) {
            seedApplication(`a${n}`, {
                paymentStatus: 'completed', submittedAt: `2026-0${n}-01T00:00:00.000Z`,
            });
        }

        const page1 = await list({ paymentStatus: 'completed', limit: 2 });
        expect(page1.data).toHaveLength(2);
        expect(page1.meta).toMatchObject({ hasMore: true, lastDocId: '1' });

        const page2 = await list({ paymentStatus: 'completed', limit: 2, lastDocId: '1' });
        expect(page2.data).toHaveLength(1);
        expect(page2.meta.hasMore).toBe(false);
    });

    it('sorts by gender', async () => {
        seedApplication('f1', { paymentStatus: 'completed', personalInfo: { gender: 'female' } });
        seedApplication('m1', {
            paymentStatus: 'completed', personalInfo: { gender: 'male' },
            submittedAt: '2026-02-01T00:00:00.000Z',
        });

        expect(ids(await list({ sortBy: 'gender', sortOrder: 'desc' }))).toEqual(['m1', 'f1']);
        expect(ids(await list({ sortBy: 'gender', sortOrder: 'asc' }))).toEqual(['f1', 'm1']);
    });

    it('an empty search returns an empty cohort with zeroed stats, not everything', async () => {
        // The early return when no user matches. Returning the whole list there
        // would be the opposite of what the admin asked for.
        seedApplication('a1');

        const res = await list({ search: 'nobody-by-that-name' });
        expect(res.data).toEqual([]);
        expect(res.meta.stats).toEqual({
            totalApplications: 0, pending: 0, under_review: 0, approved: 0, rejected: 0,
        });
    });

    it('finds an applicant by their user record\'s email', async () => {
        seedApplication('a1');
        seedApplicantUser('a1', { email: 'ngozi@example.com' });

        expect(ids(await list({ search: 'ngozi@example.com' }))).toEqual(['a1']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('logAcademyExportAction', () => {
    const log = async (details: any) =>
        (await (await actions()).logAcademyExportAction(details)) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await log({ count: 1, filters: {} })).toMatchObject({ success: false });
    });

    it('REFUSES an ordinary signed-in user', async () => {
        // It was gated on a session alone, while every export beside it was
        // gated on isAdmin. So any signed-in user could write entries into the
        // log that records who read applicant data — with a count and filters
        // they chose. That log is what an incident is reconstructed from.
        actAs('user-1', ['user']);
        expect(await log({ count: 9999, filters: { status: 'all' } }))
            .toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('lets an admin record an export — the refusal is a permission, not a wall', async () => {
        expect(await log({ count: 42, filters: { status: 'approved' } }))
            .toMatchObject({ success: true });
    });
});
