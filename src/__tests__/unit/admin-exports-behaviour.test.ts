/**
 * @jest-environment node
 */

/**
 * The export application review desk, EXECUTED.
 *
 * Six actions decide whether somebody may trade on the export module: approve,
 * reject, request a revision, the stats tile, and two list views. Approval grants
 * the `export_participant` role and writes the serviceRegistrations entry
 * checkModuleAccess reads — so this is an authorisation boundary, not a form.
 *
 * It was at 6.6%. Every action is guard → query → write, and with a call-recorder
 * harness the query returned whatever the test stubbed, so "the approval reached
 * the right application" and "the rejection did NOT grant the role" were both
 * unaskable.
 *
 * TWO SHAPES WORTH KNOWING ABOUT BEFORE READING THE TESTS
 * -------------------------------------------------------
 * 1. An application is addressable BY TWO IDENTIFIERS. The actions try the
 *    document id first and fall back to a query on the `applicationId` FIELD.
 *    Both are used by real callers, and the fallback is the one a recorder could
 *    never exercise.
 * 2. Every write path first re-reads the USER document and refuses if it is
 *    missing — "Database desync". That check is the only thing standing between
 *    an approval and a role granted to a user record that does not exist.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('resend', () => ({
    Resend: class { emails = { send: async () => ({ error: null }) }; },
}));

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
}));

let store: FakeDbHandle;

function actAs(id: string, roles: string[]): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles, email: `${id}@example.com`, name: id } },
        error: null,
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs('admin-1', ['super_admin']);
});

async function actions() {
    return import('@/app/actions/admin/_exports');
}

const APP = 'app-1';
const USER = 'user-1';

function seedApplication(extra: Record<string, unknown> = {}, id = APP): void {
    store.seed(COLLECTIONS.EXPORT_APPLICATIONS, id, {
        userId: USER,
        userEmail: 'exporter@example.com',
        status: 'pending_review',
        profile: { fullName: 'Ex Porter', phone: '08031111111', state: 'Lagos' },
        createdAt: '2026-06-01T10:00:00.000Z',
        ...extra,
    });
}

function seedUser(id = USER, extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.USERS, id, {
        email: 'exporter@example.com',
        fullName: 'Ex Porter',
        roles: ['user'],
        ...extra,
    });
}

// ─── approval ────────────────────────────────────────────────────────────────

describe('approving an export application', () => {
    beforeEach(() => {
        seedApplication();
        seedUser();
    });

    it('marks the application approved and records who did it', async () => {
        const { approveExportOnboardingAction } = await actions();
        const result = await approveExportOnboardingAction(APP);

        expect(result.success).toBe(true);
        const app = store.get(COLLECTIONS.EXPORT_APPLICATIONS, APP)!;
        expect(app.status).toBe('approved');
        expect(app.reviewedBy).toBe('admin-1');
        expect(app.reviewedAt).toBeTruthy();
    });

    it('and grants the role, the verification and the registration together', async () => {
        // The authorisation half. checkModuleAccess reads the role at Layer 1 and
        // serviceRegistrations.export at Layer 2, so writing one without the other
        // leaves access depending on which layer answers.
        const { approveExportOnboardingAction } = await actions();
        await approveExportOnboardingAction(APP);

        const user = store.get(COLLECTIONS.USERS, USER)!;
        expect(user.roles).toContain('export_participant');
        expect(user.isVerified).toBe(true);
        expect(user.serviceRegistrations.export.status).toBe('approved');
        expect(user.serviceRegistrations.export.paymentStatus).toBe('completed');
        expect(user.verifiedBy).toBe('admin-1');
    });

    it('keeping the roles the applicant already had', async () => {
        store.seed(COLLECTIONS.USERS, USER, {
            email: 'exporter@example.com', roles: ['user', 'seller'],
        });
        const { approveExportOnboardingAction } = await actions();
        await approveExportOnboardingAction(APP);

        expect(store.get(COLLECTIONS.USERS, USER)!.roles)
            .toEqual(expect.arrayContaining(['user', 'seller', 'export_participant']));
    });

    it('found by the applicationId FIELD when the document id does not match', async () => {
        // The second identifier. Real callers pass both, and the fallback query is
        // the branch a recorder harness could never reach.
        store.clear();
        seedUser();
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'internal-doc-id', {
            applicationId: 'EXP-2026-0042',
            userId: USER,
            userEmail: 'exporter@example.com',
            status: 'pending_review',
        });

        const { approveExportOnboardingAction } = await actions();
        const result = await approveExportOnboardingAction('EXP-2026-0042');

        expect(result.success).toBe(true);
        expect(store.get(COLLECTIONS.EXPORT_APPLICATIONS, 'internal-doc-id')!.status)
            .toBe('approved');
    });

    it('refusing an application that does not exist under either identifier', async () => {
        const { approveExportOnboardingAction } = await actions();
        const result = await approveExportOnboardingAction('no-such-application');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not found/i);
        expect(store.get(COLLECTIONS.USERS, USER)!.roles).not.toContain('export_participant');
    });

    it('refusing an application with no userId rather than granting a role to nobody', async () => {
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'orphan', { status: 'pending_review' });

        const { approveExportOnboardingAction } = await actions();
        const result = await approveExportOnboardingAction('orphan');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Missing User ID/i);
        expect(store.get(COLLECTIONS.EXPORT_APPLICATIONS, 'orphan')!.status).toBe('pending_review');
    });

    it('and refusing when the user document is gone — the desync check', async () => {
        // THE guard. Without it the approval writes a role onto a user record that
        // does not exist, and the application is marked approved for somebody the
        // platform cannot identify.
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'ghost-app',
            { userId: 'vanished-user', status: 'pending_review' });

        const { approveExportOnboardingAction } = await actions();
        const result = await approveExportOnboardingAction('ghost-app');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/desync/i);
        // And crucially: the application status is unchanged, so it stays in the
        // queue rather than disappearing into an approved state nobody can use.
        expect(store.get(COLLECTIONS.EXPORT_APPLICATIONS, 'ghost-app')!.status)
            .toBe('pending_review');
    });
});

// ─── rejection ───────────────────────────────────────────────────────────────

describe('rejecting an export application', () => {
    beforeEach(() => {
        seedApplication();
        seedUser();
    });

    it('records the reason and marks the registration rejected', async () => {
        const { rejectExportApplicationAction } = await actions();
        const result = await rejectExportApplicationAction(APP, 'Company registration document is unreadable');

        expect(result.success).toBe(true);
        const app = store.get(COLLECTIONS.EXPORT_APPLICATIONS, APP)!;
        expect(app.status).toBe('rejected');
        expect(app.rejectionReason).toBe('Company registration document is unreadable');
        expect(app.reviewedBy).toBe('admin-1');

        const user = store.get(COLLECTIONS.USERS, USER)!;
        expect(user.serviceRegistrations.export.status).toBe('rejected');
    });

    it('and grants NOTHING — no role, no verification', async () => {
        // The property that matters. A rejection path that shared code with
        // approval and forgot one branch would grant access on a refusal.
        const { rejectExportApplicationAction } = await actions();
        await rejectExportApplicationAction(APP, 'A sufficiently long rejection reason');

        const user = store.get(COLLECTIONS.USERS, USER)!;
        expect(user.roles).not.toContain('export_participant');
        expect(user.isVerified).toBeUndefined();
    });

    it('refusing an empty reason, so the applicant is told something', async () => {
        const { rejectExportApplicationAction } = await actions();
        const result = await rejectExportApplicationAction(APP, '');

        expect(result.success).toBe(false);
        expect(store.get(COLLECTIONS.EXPORT_APPLICATIONS, APP)!.status).toBe('pending_review');
    });

    it('and honouring the same desync guard', async () => {
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'ghost-app',
            { userId: 'vanished-user', status: 'pending_review' });

        const { rejectExportApplicationAction } = await actions();
        const result = await rejectExportApplicationAction('ghost-app', 'A sufficiently long reason');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/desync/i);
    });
});

// ─── revision ────────────────────────────────────────────────────────────────

describe('requesting a revision', () => {
    beforeEach(() => {
        seedApplication();
        seedUser();
    });

    it('sets revision_required rather than rejecting', async () => {
        // A third state, and the distinction matters to the applicant: rejected is
        // final, revision_required is "fix this and resubmit".
        const { requestExportApplicationRevisionAction } = await actions();
        const result = await requestExportApplicationRevisionAction(APP, 'Please upload a clearer CAC certificate');

        expect(result.success).toBe(true);
        expect(store.get(COLLECTIONS.EXPORT_APPLICATIONS, APP)!.status).toBe('revision_required');
    });

    it('refusing an empty note, because the applicant would learn nothing', async () => {
        const { requestExportApplicationRevisionAction } = await actions();
        const result = await requestExportApplicationRevisionAction(APP, '   ');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/note is required/i);
        expect(store.get(COLLECTIONS.EXPORT_APPLICATIONS, APP)!.status).toBe('pending_review');
    });

    it('and granting no role either', async () => {
        const { requestExportApplicationRevisionAction } = await actions();
        await requestExportApplicationRevisionAction(APP, 'Please re-upload the certificate');

        expect(store.get(COLLECTIONS.USERS, USER)!.roles).not.toContain('export_participant');
    });
});

// ─── the three decisions are mutually exclusive ──────────────────────────────

describe('the three decisions', () => {
    it('leave the application in exactly one state', async () => {
        // Run all three against separate applications and check the results do not
        // overlap. Sharing a helper between approve and reject is how a rejection
        // ends up granting a role.
        seedUser();
        seedApplication({}, 'a-approve');
        seedApplication({}, 'a-reject');
        seedApplication({}, 'a-revise');

        const a = await actions();
        await a.approveExportOnboardingAction('a-approve');
        await a.rejectExportApplicationAction('a-reject', 'A sufficiently long reason');
        await a.requestExportApplicationRevisionAction('a-revise', 'A sufficiently long note');

        expect(store.get(COLLECTIONS.EXPORT_APPLICATIONS, 'a-approve')!.status).toBe('approved');
        expect(store.get(COLLECTIONS.EXPORT_APPLICATIONS, 'a-reject')!.status).toBe('rejected');
        expect(store.get(COLLECTIONS.EXPORT_APPLICATIONS, 'a-revise')!.status).toBe('revision_required');
    });
});

// ─── the guards ──────────────────────────────────────────────────────────────

describe('every write refuses a caller without the permission', () => {
    beforeEach(() => {
        seedApplication();
        seedUser();
        actAs('nobody', ['user']);
        store.seed(COLLECTIONS.USERS, 'nobody', { roles: ['user'] });
    });

    it('approve', async () => {
        const { approveExportOnboardingAction } = await actions();
        const result = await approveExportOnboardingAction(APP);
        expect(result.success).toBe(false);
        expect(store.get(COLLECTIONS.EXPORT_APPLICATIONS, APP)!.status).toBe('pending_review');
        expect(store.get(COLLECTIONS.USERS, USER)!.roles).not.toContain('export_participant');
    });

    it('reject', async () => {
        const { rejectExportApplicationAction } = await actions();
        const result = await rejectExportApplicationAction(APP, 'A sufficiently long reason');
        expect(result.success).toBe(false);
        expect(store.get(COLLECTIONS.EXPORT_APPLICATIONS, APP)!.status).toBe('pending_review');
    });

    it('revision', async () => {
        const { requestExportApplicationRevisionAction } = await actions();
        const result = await requestExportApplicationRevisionAction(APP, 'A sufficiently long note');
        expect(result.success).toBe(false);
        expect(store.get(COLLECTIONS.EXPORT_APPLICATIONS, APP)!.status).toBe('pending_review');
    });

    it('and the reads too', async () => {
        const a = await actions();
        expect((await a.getExportApplicationsStatsAction()).success).toBe(false);
        expect((await a.getStandardExportApplicationsAction({})).success).toBe(false);
    });

    it('while an unauthenticated caller gets nowhere at all', async () => {
        (globalThis as { mockRequireSession: { mockImplementation: (f: () => unknown) => void } })
            .mockRequireSession.mockImplementation(() => Promise.resolve({
                session: null, error: { error: 'Authentication required' },
            }));

        const a = await actions();
        expect((await a.approveExportOnboardingAction(APP)).success).toBe(false);
        expect((await a.getExportApplicationsStatsAction()).success).toBe(false);
        expect(store.get(COLLECTIONS.EXPORT_APPLICATIONS, APP)!.status).toBe('pending_review');
    });
});

describe('the export admin role', () => {
    it('may approve without holding users:update', async () => {
        // export:approve_applications is the module-specific permission, and an
        // export admin holding only that must be able to work. Requiring
        // users:update alone would leave the export desk unable to approve
        // anything.
        const { hasAdminPermission } = await import('@/lib/admin-permissions');
        expect(hasAdminPermission(['export_admin'], 'export:approve_applications')).toBe(true);

        seedApplication();
        seedUser();
        actAs('export-admin', ['export_admin']);

        const { approveExportOnboardingAction } = await actions();
        expect((await approveExportOnboardingAction(APP)).success).toBe(true);
    });
});

// ─── the stats tile ──────────────────────────────────────────────────────────

describe('the stats tile', () => {
    it('counts each status, folding pending_review into pending', async () => {
        // Two spellings of one state, and an admin reading "pending: 3" is being
        // told about both. Counting only one leaves applications invisible.
        store.seedAll(COLLECTIONS.EXPORT_APPLICATIONS, {
            a: { status: 'pending' },
            b: { status: 'pending_review' },
            c: { status: 'pending_review' },
            d: { status: 'approved' },
            e: { status: 'rejected' },
            f: { status: 'revision_required' },
        });

        const { getExportApplicationsStatsAction } = await actions();
        const result = await getExportApplicationsStatsAction();

        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({ pending: 3, approved: 1, rejected: 1 });
    });

    it('and reports zeros on an empty platform rather than failing', async () => {
        const { getExportApplicationsStatsAction } = await actions();
        const result = await getExportApplicationsStatsAction();

        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({ pending: 0, approved: 0, rejected: 0 });
    });
});

// ─── the list ────────────────────────────────────────────────────────────────

describe('the application list', () => {
    beforeEach(() => {
        store.seedAll(COLLECTIONS.EXPORT_APPLICATIONS, {
            p1: { status: 'pending', userId: 'u1', createdAt: '2026-01-01T00:00:00.000Z' },
            p2: { status: 'pending_review', userId: 'u2', createdAt: '2026-02-01T00:00:00.000Z' },
            ap: { status: 'approved', userId: 'u3', createdAt: '2026-03-01T00:00:00.000Z' },
            rj: { status: 'rejected', userId: 'u4', createdAt: '2026-04-01T00:00:00.000Z' },
        });
    });

    it('returns everything with no filter', async () => {
        const { getStandardExportApplicationsAction } = await actions();
        const result = await getStandardExportApplicationsAction({});

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(4);
    });

    it('and "pending" covers BOTH spellings, so nothing hides in the queue', async () => {
        const { getStandardExportApplicationsAction } = await actions();
        const result = await getStandardExportApplicationsAction({ status: 'pending' });

        expect(result.data!.map((a: { id: string }) => a.id).sort()).toEqual(['p1', 'p2']);
    });

    it('while a specific status is exact', async () => {
        const { getStandardExportApplicationsAction } = await actions();
        expect((await getStandardExportApplicationsAction({ status: 'approved' })).data)
            .toHaveLength(1);
        expect((await getStandardExportApplicationsAction({ status: 'rejected' })).data)
            .toHaveLength(1);
    });

    it('ordered newest first', async () => {
        const { getStandardExportApplicationsAction } = await actions();
        const result = await getStandardExportApplicationsAction({});
        expect(result.data!.map((a: { id: string }) => a.id)).toEqual(['rj', 'ap', 'p2', 'p1']);
    });

    it('and honouring a limit', async () => {
        const { getStandardExportApplicationsAction } = await actions();
        const result = await getStandardExportApplicationsAction({ limit: 2 });
        expect(result.data).toHaveLength(2);
    });
});
