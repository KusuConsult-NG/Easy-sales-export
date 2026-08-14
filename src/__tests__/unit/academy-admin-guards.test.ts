/**
 * @jest-environment node
 */

/**
 * academy/_admin.ts — 1,194 lines, 12 admin endpoints, no tests.
 *
 * THE DEFECT
 * ----------
 * Eleven of the twelve check `isAdmin` or `hasAdminPermission`. The twelfth was
 * `logAcademyExportAction`, which took a `details` object from the caller and
 * wrote it into `createAdminAuditLog` as
 *
 *     action:   "data_export"
 *     targetId: "academy_applications"
 *     details:  `Exported ${details.count} academy applications. Filters: ...`
 *     metadata: details
 *
 * behind a session check alone. The exports themselves —
 * `getStandardAcademyApplicationsAction`, `getPendingAcademyApplicationsAction`
 * — are properly gated. Only the RECORD of an export was writable by anyone
 * signed in, with a count and filters of their choosing.
 *
 * That log is what an incident gets reconstructed from, and this platform has an
 * open data-exposure incident. A record anybody can write to is not evidence.
 * It is also the quieter half of the risk: entries can be manufactured to sit
 * alongside a real export and make it unremarkable.
 *
 * WHY THIS FILE, AND WHAT ELSE WAS CHECKED
 * ----------------------------------------
 * Every other endpoint here was read and found correct, and the properties are
 * asserted below rather than left in a commit message:
 *
 *   approve / reject / updatePayment    users:update or academy_admin
 *   upsertCourse, getEnrollments,
 *   getStats, getApplicationStats,
 *   getInstructors, getCourses,
 *   getPending, getStandard            isAdmin
 *
 * `updateAcademyApplicationPaymentAction` takes `paymentStatus` and
 * `paymentAmount` as parameters, which reads like the caller-supplied-amount
 * defect found in wallet checkout and farm-nation property payment. It is not
 * the same thing: it is an admin recording a payment taken offline, it is
 * permission-gated and audited, and — asserted below — it writes no ledger row.
 * Nothing it does reaches `platform_revenue_totals()`, which only counts
 * transactions with status "completed".
 *
 * NOTED AND NOT CHANGED
 * ---------------------
 * `approveAcademyApplicationAction` does not claim the status transition, so
 * approving an already-approved application runs the whole body again and sends
 * a second "Application Approved!" email. Every write it makes is idempotent —
 * a status set, an `arrayUnion` of a role, no counter and no money — so the only
 * effect is a duplicate email. An admin re-approving deliberately to trigger a
 * resend is a plausible use, and suppressing it is a product call rather than a
 * defect with a victim. Recorded here instead of decided unilaterally.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const ADMIN = 'admin-1';
const LEARNER = 'learner-1';
const APP = 'app-1';

const mockAdminAuditLog = jest.fn(async () => ({})) as jest.Mock<any>;

jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: (...a: any[]) => mockAdminAuditLog(...a),
    logAuditAction: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
    logAdminFinancialAction: jest.fn(async () => ({})),
}));
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: jest.fn(async () => ({})),
    createBulkNotificationsAction: jest.fn(async () => ({})),
}));
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: jest.fn(async () => ({})),
    invalidateServiceCache: jest.fn(async () => ({})),
    invalidateAdminGlobalStats: jest.fn(async () => ({})),
    invalidateAllCaches: jest.fn(async () => ({})),
}));

/**
 * isAdmin and hasAdminPermission are NOT mocked — the real ones run against the
 * roles set here. That is deliberate: mocking them would mean these tests assert
 * that a mock returned false, which is the shape that made an earlier suite pass
 * with its guards deleted.
 */
function setSession(id: string, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles } },
        error: null,
    }));
}

/**
 * Both read stubs, and the second one is easy to miss.
 *
 * These actions re-read inside `db.runTransaction`, and the harness routes
 * `transaction.get` to mockFirestoreTxGet — a different stub from the plain
 * `docRef.get`. Leaving it unset returns undefined, the action throws on
 * `appSnap.exists`, its catch turns that into a generic "Failed to update
 * payment status", and every assertion about what it wrote becomes unfalsifiable
 * while the refusal tests around it stay green.
 *
 * That is precisely how a harness gap hides a coverage gap. It was caught here
 * only because the admin cases assert SUCCESS.
 */
function setDoc(data: Record<string, any>) {
    const snap = {
        exists: true, empty: false,
        docs: [{ id: APP, ref: { id: APP }, data: () => data }],
        ref: { id: APP },
        data: () => data,
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

function allWrites(): Record<string, any>[] {
    const g = global as any;
    return [
        ...g.mockFirestoreUpdate.mock.calls,
        ...g.mockFirestoreSet.mock.calls,
        ...g.mockFirestoreTxUpdate.mock.calls,
        ...g.mockFirestoreTxSet.mock.calls,
    ].map((c: any[]) => c[c.length - 1]).filter(Boolean);
}

describe('logAcademyExportAction — the audit log is not a public inbox', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setDoc({ userId: LEARNER, status: 'pending' });
    });

    async function log(details: any) {
        const { logAcademyExportAction } = await import('@/app/actions/academy/_ac_admin_applications');
        return logAcademyExportAction(details);
    }

    it('refuses a signed-in non-admin, and writes nothing', async () => {
        // THE test. Asserts the write did not happen, not merely that the call
        // reported failure — the action returns success:false for other reasons
        // too, and the weaker assertion would pass with the guard removed.
        setSession(LEARNER);

        const r: any = await log({ count: 41106, filters: { all: true } });

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/unauthori[sz]ed/i);
        expect(mockAdminAuditLog).not.toHaveBeenCalled();
    });

    it('refuses an academy learner even though the data is academy data', async () => {
        // academy_participant is the role an approved applicant gets. It is not
        // an admin role, and the export log is not theirs to write.
        setSession(LEARNER, ['academy_participant']);

        const r: any = await log({ count: 1, filters: {} });

        expect(r.success).toBe(false);
        expect(mockAdminAuditLog).not.toHaveBeenCalled();
    });

    it('still records a genuine admin export', async () => {
        // Vacuity guard. Both refusals above are satisfied by an endpoint that
        // logs nothing for anyone, which would silently stop recording who read
        // the applicant data — the opposite of the intent.
        setSession(ADMIN, ['admin']);

        const r: any = await log({ count: 12, filters: { status: 'pending' } });

        expect(r.success).toBe(true);
        expect(mockAdminAuditLog).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'data_export', userId: ADMIN })
        );
    });
});

describe('every other endpoint refuses a non-admin', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(LEARNER, ['academy_participant']);
        setDoc({ userId: LEARNER, status: 'pending', personalInfo: { email: 'l@e.com' } });
    });

    const cases: Array<[string, any[]]> = [
        ['approveAcademyApplicationAction', [APP]],
        ['rejectAcademyApplicationAction', [APP, 'not eligible']],
        ['updateAcademyApplicationPaymentAction', [APP, 'completed', 250_000, 'elite']],
        ['upsertAcademyCourseAction', ['new', { title: 'A Course' }]],
        ['getAcademyEnrollmentsAction', []],
        ['getAcademyStatsAction', []],
        ['getAcademyApplicationStatsAction', []],
        ['getPendingAcademyApplicationsAction', []],
        ['getStandardAcademyApplicationsAction', []],
        ['getAcademyInstructorsAction', []],
        ['getAcademyCoursesAction', []],
    ];

    for (const [name, args] of cases) {
        it(`${name} refuses`, async () => {
            const mod: any = await import('@/app/actions/academy');

            const r = await mod[name](...args).catch((e: any) => ({ success: false, error: String(e) }));

            expect(r.success).toBe(false);
            expect(String(r.error)).toMatch(/unauthori[sz]ed|permission|admin/i);
        });
    }
});

describe('an admin gets through, so the refusals above are not vacuous', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(ADMIN, ['admin']);
        setDoc({ userId: LEARNER, status: 'pending', personalInfo: { email: 'l@e.com' } });
    });

    it('approves an application', async () => {
        const { approveAcademyApplicationAction } = await import('@/app/actions/academy');

        const r: any = await approveAcademyApplicationAction(APP);

        expect(r.success).toBe(true);
        const statuses = allWrites().map((p) => p.status ?? p['serviceRegistrations.academy.status']);
        expect(statuses).toContain('approved');
    });

    it('records an offline payment without writing a ledger row', async () => {
        // paymentAmount is a parameter, which is the shape of the defects found
        // in wallet checkout and farm-nation property payment. Here it is an
        // admin recording money taken offline, so the amount is theirs to state
        // — but it must not become money-in. platform_revenue_totals() counts
        // transactions with status "completed", so a ledger row written here
        // would inflate reported revenue by whatever the admin typed.
        const { updateAcademyApplicationPaymentAction } = await import('@/app/actions/academy');

        const r: any = await updateAcademyApplicationPaymentAction(APP, 'completed', 250_000, 'elite');

        expect(r.success).toBe(true);

        const ledgerRows = allWrites().filter(
            (p) => p && 'amount' in p && (p.status === 'completed' || p.type === 'credit')
        );
        expect(ledgerRows).toEqual([]);
    });

    it('records the payment against the application and the learner', async () => {
        // The positive half of the assertion above: "writes no ledger row" is
        // also satisfied by writing nothing at all.
        const { updateAcademyApplicationPaymentAction } = await import('@/app/actions/academy');

        await updateAcademyApplicationPaymentAction(APP, 'completed', 250_000, 'elite');

        const appPatch = allWrites().find((p) => p && 'paymentAmount' in p);
        expect(appPatch?.paymentAmount).toBe(250_000);
        expect(appPatch?.paymentVerifiedBy).toBe(ADMIN);

        const userPatch = allWrites().find((p) => p && 'serviceRegistrations.academy.paymentStatus' in p);
        expect(userPatch?.['serviceRegistrations.academy.paymentStatus']).toBe('completed');
    });
});
