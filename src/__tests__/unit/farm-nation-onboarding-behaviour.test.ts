/**
 * @jest-environment node
 */

/**
 * Farm Nation onboarding, EXECUTED — submit, check status, load for editing,
 * resubmit, and the access check.
 *
 * At 5.3%. checkFarmNationStatusAction is the interesting one: it reconciles a
 * status held in THREE places — the user's `serviceRegistrations.farmNation`,
 * the application row, and a V1 `userData.farmNation` blob — and it writes back
 * to the user record when they disagree. Every branch of that is a decision made
 * from stored documents, so with a call-recorder harness none of it could be
 * checked; the reconciliation could have been reading the wrong field in every
 * branch and the tests would have been just as green.
 *
 * WHAT RUNNING IT FOUND
 * ---------------------
 * Finding #83. checkWaveStatus used to claim a legacy application by email with
 * two defects: it fell back to a `profile.email` nobody had authenticated as,
 * and its `!appData.userId` test guarded only the backfill WRITE, so an
 * application belonging to somebody else was still read and its `approved`
 * status promoted onto the caller. That was fixed as #36 — on WAVE only. The
 * same code, defects included, was still in Farm Nation and in Export.
 *
 * It matters because the promotion is not cosmetic: the action writes
 * `serviceRegistrations.farmNation.status = "approved"` onto the caller's user
 * record, and module-access-check Layer 2 admits on exactly that.
 *
 * The regression tests are below, and
 * src/__tests__/unit/email-claim-is-narrowed-everywhere.test.ts is the gate that
 * stops a fourth copy appearing.
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

const APPLICANT = 'farmer-1';
const APPS = COLLECTIONS.FARM_NATION_APPLICATIONS;

function actAs(id: string | null, roles: string[] = ['user'], email: string | undefined = 'ada@example.com'): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles, email, name: 'Ada Obi' } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(APPLICANT);
});

async function actions() {
    return import('@/app/actions/farm-nation/_fn_onboarding');
}

function form(extra: Record<string, unknown> = {}): any {
    return {
        role: 'seller',
        profile: {
            firstName: 'Ada',
            lastName: 'Obi',
            otherName: '',
            phone: '08012345678',
            businessName: 'Obi Farms',
            state: 'Plateau',
            lga: 'Jos North',
            address: '12 Market Road, Jos',
        },
        interests: { listingTypes: ['farmland'], totalAcreage: '5', readyToList: true },
        terms: { termsAccepted: true, privacyAccepted: true, feeDisclosureAccepted: true },
        ...extra,
    };
}

function seedUser(extra: Record<string, unknown> = {}, id = APPLICANT): void {
    store.seed(COLLECTIONS.USERS, id, {
        email: 'ada@example.com',
        fullName: 'Ada Obi',
        roles: ['user'],
        ...extra,
    });
}

const readUser = (id = APPLICANT) => store.get(COLLECTIONS.USERS, id) as Record<string, any> | undefined;
const onlyApp = () => store.all(APPS)[0][1] as Record<string, any>;
const reg = (id = APPLICANT) => readUser(id)!.serviceRegistrations?.farmNation ?? {};

// ─────────────────────────────────────────────────────────────────────────────
describe('submitFarmNationOnboardingAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { submitFarmNationOnboardingAction } = await actions();
        expect(await submitFarmNationOnboardingAction(form())).toMatchObject({
            success: false, error: 'Authentication required',
        });
        expect(store.size(APPS)).toBe(0);
    });

    it('refuses a form that fails the schema', async () => {
        seedUser();
        const { submitFarmNationOnboardingAction } = await actions();
        const res: any = await submitFarmNationOnboardingAction(
            form({ profile: { ...form().profile, address: 'x' } }));

        expect(res.success).toBe(false);
        expect(res.error).toContain('Address');
        expect(store.size(APPS)).toBe(0);
    });

    it('refuses while a previous application is still being processed', async () => {
        seedUser({ serviceRegistrations: { farmNation: { status: 'under_review' } } });
        const { submitFarmNationOnboardingAction } = await actions();
        expect(await submitFarmNationOnboardingAction(form())).toMatchObject({
            success: false, error: 'Your previous application is still being processed.',
        });
    });

    it('refuses somebody already registered', async () => {
        seedUser({ serviceRegistrations: { farmNation: { status: 'approved' } } });
        const { submitFarmNationOnboardingAction } = await actions();
        expect(await submitFarmNationOnboardingAction(form())).toMatchObject({
            success: false, error: 'You are already registered for Farm Nation.',
        });
    });

    it('lets a rejected applicant apply again', async () => {
        seedUser({ serviceRegistrations: { farmNation: { status: 'rejected' } } });
        const { submitFarmNationOnboardingAction } = await actions();
        expect(await submitFarmNationOnboardingAction(form())).toMatchObject({ success: true });
    });

    it('checks the existing status BEFORE the schema, so a half-filled retry is told the real reason', async () => {
        seedUser({ serviceRegistrations: { farmNation: { status: 'approved' } } });
        const { submitFarmNationOnboardingAction } = await actions();
        const res: any = await submitFarmNationOnboardingAction({} as any);

        expect(res.error).toBe('You are already registered for Farm Nation.');
    });

    it('writes the application and links it from the user record', async () => {
        seedUser();
        const { submitFarmNationOnboardingAction } = await actions();
        expect(await submitFarmNationOnboardingAction(form())).toMatchObject({ success: true });

        const app = onlyApp();
        expect(app).toMatchObject({
            userId: APPLICANT, status: 'pending', role: 'seller', userEmail: 'ada@example.com',
        });
        expect(app.applicationId).toBe(app.id);
        expect(reg()).toMatchObject({
            status: 'pending', applicationId: app.id, paymentStatus: 'completed', role: 'seller',
        });
    });

    it('grants "farmer" for a seller', async () => {
        seedUser();
        const { submitFarmNationOnboardingAction } = await actions();
        await submitFarmNationOnboardingAction(form({ role: 'seller' }));

        expect(readUser()!.roles).toContain('farmer');
        expect(readUser()!.roles).not.toContain('investor');
    });

    it('grants "investor" for a buyer', async () => {
        seedUser();
        const { submitFarmNationOnboardingAction } = await actions();
        await submitFarmNationOnboardingAction(form({ role: 'buyer' }));

        expect(readUser()!.roles).toContain('investor');
        expect(readUser()!.roles).not.toContain('farmer');
    });

    it('grants both for "both", and does not duplicate a role already held', async () => {
        seedUser({ roles: ['user', 'farmer'] });
        const { submitFarmNationOnboardingAction } = await actions();
        await submitFarmNationOnboardingAction(form({ role: 'both' }));

        const roles = readUser()!.roles;
        expect(roles).toEqual(expect.arrayContaining(['user', 'farmer', 'investor']));
        expect(roles.filter((r: string) => r === 'farmer')).toHaveLength(1);
    });

    it('mirrors the registration under BOTH key spellings', async () => {
        // normalizeUserUpdate exists because the codebase reads
        // serviceRegistrations.farmNation in some places and farm_nation in
        // others. A write that lands in only one is invisible to half the app.
        seedUser();
        const { submitFarmNationOnboardingAction } = await actions();
        await submitFarmNationOnboardingAction(form());

        const registrations = readUser()!.serviceRegistrations;
        expect(registrations.farmNation.status).toBe('pending');
        expect(registrations.farm_nation.status).toBe('pending');
        expect(registrations.farm_nation.applicationId).toBe(registrations.farmNation.applicationId);
    });

    it('mirrors phone to phoneNumber', async () => {
        seedUser();
        const { submitFarmNationOnboardingAction } = await actions();
        await submitFarmNationOnboardingAction(form());

        expect(readUser()!.phone).toBe('08012345678');
        expect(readUser()!.phoneNumber).toBe('08012345678');
    });

    it('composes the full name and syncs the profile onto the user record', async () => {
        seedUser();
        const { submitFarmNationOnboardingAction } = await actions();
        await submitFarmNationOnboardingAction(
            form({ profile: { ...form().profile, otherName: 'Chidinma' } }));

        const user = readUser()!;
        expect(user.fullName).toBe('Ada Chidinma Obi');
        expect(user.farmNation.profile.fullName).toBe('Ada Chidinma Obi');
        expect(user.stateOfOrigin).toBe('Plateau');
        expect(user.lga).toBe('Jos North');
        expect(user.residentialAddress).toBe('12 Market Road, Jos');
    });

    it('succeeds even when the cache invalidation fails', async () => {
        seedUser();
        jest.resetModules();
        jest.doMock('@/lib/cache-invalidation', () => ({
            invalidateUserCache: async () => { throw new Error('redis down'); },
            invalidateAdminGlobalStats: async () => undefined,
        }));

        const { submitFarmNationOnboardingAction } = await actions();
        expect(await submitFarmNationOnboardingAction(form())).toMatchObject({ success: true });
        expect(store.size(APPS)).toBe(1);

        jest.dontMock('@/lib/cache-invalidation');
        jest.resetModules();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('checkFarmNationStatusAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { checkFarmNationStatusAction } = await actions();
        expect(await checkFarmNationStatusAction()).toMatchObject({ success: false });
    });

    it('returns null for somebody who has never applied', async () => {
        seedUser();
        const { checkFarmNationStatusAction } = await actions();
        expect(await checkFarmNationStatusAction()).toMatchObject({ success: true, data: null });
    });

    it('trusts an already-approved registration without reading an application', async () => {
        seedUser({ serviceRegistrations: { farmNation: { status: 'approved' } } });
        store.seed(APPS, 'app-1', { userId: APPLICANT, status: 'rejected' });

        const { checkFarmNationStatusAction } = await actions();
        expect(((await checkFarmNationStatusAction()) as any).data).toBe('approved');
    });

    it('lets the APPLICATION correct a stale registration', async () => {
        seedUser({ serviceRegistrations: { farmNation: { status: 'pending' } } });
        store.seed(APPS, 'app-1', { userId: APPLICANT, status: 'rejected' });

        const { checkFarmNationStatusAction } = await actions();
        expect(((await checkFarmNationStatusAction()) as any).data).toBe('rejected');
    });

    it('backfills the user record when the application says approved', async () => {
        seedUser({ serviceRegistrations: { farmNation: { status: 'pending' } } });
        store.seed(APPS, 'app-1', { userId: APPLICANT, status: 'approved' });

        const { checkFarmNationStatusAction } = await actions();
        expect(((await checkFarmNationStatusAction()) as any).data).toBe('approved');
        expect(reg()).toMatchObject({ status: 'approved', paymentStatus: 'completed' });
    });

    it('treats approved_admin as approved', async () => {
        seedUser();
        store.seed(APPS, 'app-1', { userId: APPLICANT, status: 'approved_admin' });

        const { checkFarmNationStatusAction } = await actions();
        expect(((await checkFarmNationStatusAction()) as any).data).toBe('approved');
    });

    it('takes the most recently submitted application when there are several', async () => {
        seedUser();
        store.seedAll(APPS, {
            old: { userId: APPLICANT, status: 'rejected', submittedAt: '2025-01-01T00:00:00.000Z' },
            recent: { userId: APPLICANT, status: 'pending', submittedAt: '2026-06-01T00:00:00.000Z' },
        });

        const { checkFarmNationStatusAction } = await actions();
        expect(((await checkFarmNationStatusAction()) as any).data).toBe('pending');
    });

    it('finds the application by the id on the user record when the query misses it', async () => {
        seedUser({ serviceRegistrations: { farmNation: { applicationId: 'app-1' } } });
        store.seed(APPS, 'app-1', { status: 'under_review' });   // no userId

        const { checkFarmNationStatusAction } = await actions();
        expect(((await checkFarmNationStatusAction()) as any).data).toBe('under_review');
        // and repairs the missing link
        expect(store.get(APPS, 'app-1')!.userId).toBe(APPLICANT);
    });

    it('migrates a V1 farmNation blob to a pending registration', async () => {
        seedUser({ farmNation: { role: 'seller', onboardingCompletedAt: '2025-05-05T00:00:00.000Z' } });

        const { checkFarmNationStatusAction } = await actions();
        expect(((await checkFarmNationStatusAction()) as any).data).toBe('pending');
        expect(reg()).toMatchObject({ status: 'pending', role: 'seller', syncedFromLegacy: true });
    });

    it('does not invent a status from an empty V1 blob', async () => {
        seedUser({ farmNation: { profile: { firstName: 'Ada' } } });

        const { checkFarmNationStatusAction } = await actions();
        expect(((await checkFarmNationStatusAction()) as any).data).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('claiming an application by email (finding #83)', () => {
    it('claims an UNCLAIMED application matching the authenticated address', async () => {
        seedUser();
        store.seed(APPS, 'legacy-app', { userEmail: 'ada@example.com', status: 'approved' });

        const { checkFarmNationStatusAction } = await actions();
        expect(((await checkFarmNationStatusAction()) as any).data).toBe('approved');
        expect(store.get(APPS, 'legacy-app')!.userId).toBe(APPLICANT);
    });

    it('refuses to adopt an application that already belongs to somebody else', async () => {
        // DEFECT 2. The `!appData.userId` test guarded only the backfill write,
        // so this row was still read and its approval promoted onto the caller —
        // and written to their user record, which module-access-check reads.
        seedUser();
        store.seed(APPS, 'somebody-elses', {
            userId: 'other-user', userEmail: 'ada@example.com', status: 'approved',
        });

        const { checkFarmNationStatusAction } = await actions();
        expect(((await checkFarmNationStatusAction()) as any).data).toBeNull();
        expect(reg().status).toBeUndefined();
        expect(store.get(APPS, 'somebody-elses')!.userId).toBe('other-user');
    });

    it('claims the unclaimed one even when an owned row matches the same address', async () => {
        seedUser();
        store.seedAll(APPS, {
            'owned-by-other': { userId: 'other-user', userEmail: 'ada@example.com', status: 'approved' },
            'unclaimed': { userEmail: 'ada@example.com', status: 'pending' },
        });

        const { checkFarmNationStatusAction } = await actions();
        expect(((await checkFarmNationStatusAction()) as any).data).toBe('pending');
        expect(store.get(APPS, 'unclaimed')!.userId).toBe(APPLICANT);
        expect(store.get(APPS, 'owned-by-other')!.userId).toBe('other-user');
    });

    it('does not match on profile.email, which nobody authenticated as', async () => {
        // DEFECT 1. userEmail is written from session.user.email at submission;
        // profile.email arrives from an import or an admin edit.
        seedUser();
        store.seed(APPS, 'imported', {
            profile: { email: 'ada@example.com' }, status: 'approved',
        });

        const { checkFarmNationStatusAction } = await actions();
        expect(((await checkFarmNationStatusAction()) as any).data).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getFarmNationApplicationAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { getFarmNationApplicationAction } = await actions();
        expect(await getFarmNationApplicationAction()).toMatchObject({ success: false });
    });

    it('loads the application the user record points at', async () => {
        seedUser({ serviceRegistrations: { farmNation: { applicationId: 'app-1', status: 'revision_required' } } });
        store.seed(APPS, 'app-1', { userId: APPLICANT, role: 'seller', status: 'revision_required' });

        const { getFarmNationApplicationAction } = await actions();
        const res: any = await getFarmNationApplicationAction();

        expect(res.success).toBe(true);
        expect(res.data.application).toMatchObject({ role: 'seller' });
        expect(res.data.registration).toMatchObject({ status: 'revision_required' });
    });

    it('finds it by query when the link is missing, and REPAIRS the link', async () => {
        seedUser();
        store.seed(APPS, 'orphan-app', { userId: APPLICANT, role: 'buyer' });

        const { getFarmNationApplicationAction } = await actions();
        expect(((await getFarmNationApplicationAction()) as any).data.application.role).toBe('buyer');
        expect(reg().applicationId).toBe('orphan-app');
    });

    it('repairs a missing userId on the application it just read', async () => {
        seedUser({ serviceRegistrations: { farmNation: { applicationId: 'app-1' } } });
        store.seed(APPS, 'app-1', { role: 'seller' });

        const { getFarmNationApplicationAction } = await actions();
        await getFarmNationApplicationAction();

        expect(store.get(APPS, 'app-1')!.userId).toBe(APPLICANT);
    });

    it('surfaces the rejection reason from the registration', async () => {
        seedUser({
            serviceRegistrations: { farmNation: { applicationId: 'app-1', rejectionReason: 'Documents unreadable' } },
        });
        store.seed(APPS, 'app-1', { userId: APPLICANT });

        const { getFarmNationApplicationAction } = await actions();
        expect(((await getFarmNationApplicationAction()) as any).data.rejectionReason)
            .toBe('Documents unreadable');
    });

    it('falls back to the reason on the application when the registration has none', async () => {
        seedUser({ serviceRegistrations: { farmNation: { applicationId: 'app-1' } } });
        store.seed(APPS, 'app-1', { userId: APPLICANT, rejectionReason: 'Farm size unverified' });

        const { getFarmNationApplicationAction } = await actions();
        expect(((await getFarmNationApplicationAction()) as any).data.rejectionReason)
            .toBe('Farm size unverified');
    });

    it('falls back to the V1 blob when there is no application row', async () => {
        seedUser({ farmNation: { role: 'seller', profile: { firstName: 'Ada' } } });

        const { getFarmNationApplicationAction } = await actions();
        const res: any = await getFarmNationApplicationAction();

        expect(res.success).toBe(true);
        expect(res.data.application).toMatchObject({ role: 'seller' });
    });

    it('says so when there is nothing at all', async () => {
        seedUser();
        const { getFarmNationApplicationAction } = await actions();
        expect(await getFarmNationApplicationAction()).toMatchObject({
            success: false, error: 'No application found',
        });
    });

    it('reads only the caller\'s own application', async () => {
        seedUser();
        store.seed(APPS, 'somebody-elses', { userId: 'other-user', role: 'seller' });

        const { getFarmNationApplicationAction } = await actions();
        expect(await getFarmNationApplicationAction()).toMatchObject({
            success: false, error: 'No application found',
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('resubmitFarmNationApplicationAction', () => {
    function seedResubmittable(status = 'rejected'): void {
        seedUser({ serviceRegistrations: { farmNation: { status, applicationId: 'app-1' } } });
        store.seed(APPS, 'app-1', {
            userId: APPLICANT, status, role: 'buyer', rejectionReason: 'Try again',
        });
    }

    it('refuses a caller with no session', async () => {
        actAs(null);
        const { resubmitFarmNationApplicationAction } = await actions();
        expect(await resubmitFarmNationApplicationAction(form())).toMatchObject({ success: false });
    });

    it('refuses a form that fails the schema', async () => {
        seedResubmittable();
        const { resubmitFarmNationApplicationAction } = await actions();
        expect(((await resubmitFarmNationApplicationAction(
            form({ profile: { ...form().profile, state: '' } }))) as any).success).toBe(false);
    });

    it('refuses from a status that is not resubmittable', async () => {
        seedResubmittable('approved');
        const { resubmitFarmNationApplicationAction } = await actions();
        expect(await resubmitFarmNationApplicationAction(form())).toMatchObject({
            success: false, error: 'Your application cannot be resubmitted at this time.',
        });
        expect(store.get(APPS, 'app-1')!.status).toBe('approved');
    });

    it('refuses somebody who has never applied', async () => {
        seedUser();
        const { resubmitFarmNationApplicationAction } = await actions();
        expect(await resubmitFarmNationApplicationAction(form())).toMatchObject({
            success: false, error: 'Your application cannot be resubmitted at this time.',
        });
    });

    it.each(['pending', 'rejected', 'revision_required'])('allows resubmission from %s', async (status) => {
        seedResubmittable(status);
        const { resubmitFarmNationApplicationAction } = await actions();
        expect(await resubmitFarmNationApplicationAction(form())).toMatchObject({ success: true });
    });

    it('updates the application in place and clears the rejection reason', async () => {
        seedResubmittable();
        const { resubmitFarmNationApplicationAction } = await actions();
        await resubmitFarmNationApplicationAction(form({ role: 'both' }));

        const app = store.get(APPS, 'app-1')!;
        expect(app).toMatchObject({ status: 'pending', role: 'both' });
        expect(app.rejectionReason).toBeNull();
        expect(typeof app.resubmittedAt).toBe('string');
        expect(store.size(APPS)).toBe(1);
    });

    it('puts the registration back to pending and clears its reason too', async () => {
        seedUser({
            serviceRegistrations: {
                farmNation: { status: 'rejected', applicationId: 'app-1', rejectionReason: 'Try again' },
            },
        });
        store.seed(APPS, 'app-1', { userId: APPLICANT, status: 'rejected' });

        const { resubmitFarmNationApplicationAction } = await actions();
        await resubmitFarmNationApplicationAction(form());

        expect(reg()).toMatchObject({ status: 'pending', paymentStatus: 'completed' });
        expect(reg().rejectionReason).toBeNull();
        expect(readUser()!.serviceRegistrations.farm_nation.status).toBe('pending');
    });

    it('finds the application by query when the link is stale', async () => {
        seedUser({ serviceRegistrations: { farmNation: { status: 'rejected', applicationId: 'deleted-app' } } });
        store.seed(APPS, 'real-app', { userId: APPLICANT, status: 'rejected' });

        const { resubmitFarmNationApplicationAction } = await actions();
        expect(await resubmitFarmNationApplicationAction(form())).toMatchObject({ success: true });

        expect(store.get(APPS, 'real-app')!.status).toBe('pending');
        expect(reg().applicationId).toBe('real-app');
        expect(store.size(APPS)).toBe(1);
    });

    it('CREATES a row for a legacy applicant who has a registration but no application', async () => {
        seedUser({ serviceRegistrations: { farmNation: { status: 'rejected' } } });

        const { resubmitFarmNationApplicationAction } = await actions();
        expect(await resubmitFarmNationApplicationAction(form())).toMatchObject({ success: true });

        expect(store.size(APPS)).toBe(1);
        const app = onlyApp();
        expect(app).toMatchObject({ userId: APPLICANT, status: 'pending', userEmail: 'ada@example.com' });
        expect(reg().applicationId).toBe(app.id);
    });

    it('syncs the corrected profile onto the user record', async () => {
        seedResubmittable();
        const { resubmitFarmNationApplicationAction } = await actions();
        await resubmitFarmNationApplicationAction(
            form({ profile: { ...form().profile, lastName: 'Nwosu', phone: '08099998888' } }));

        const user = readUser()!;
        expect(user.fullName).toBe('Ada Nwosu');
        expect(user.phone).toBe('08099998888');
        expect(user.phoneNumber).toBe('08099998888');
    });

    it('does not touch another applicant\'s row', async () => {
        seedResubmittable();
        store.seed(APPS, 'other-app', { userId: 'other-user', status: 'rejected' });

        const { resubmitFarmNationApplicationAction } = await actions();
        await resubmitFarmNationApplicationAction(form());

        expect(store.get(APPS, 'other-app')!.status).toBe('rejected');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('checkFarmNationAccessAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { checkFarmNationAccessAction } = await actions();
        expect(await checkFarmNationAccessAction()).toMatchObject({
            success: false, error: 'Session expired',
        });
    });

    it('is false for somebody who has not been approved', async () => {
        seedUser({ serviceRegistrations: { farmNation: { status: 'pending' } } });
        const { checkFarmNationAccessAction } = await actions();
        expect(await checkFarmNationAccessAction()).toMatchObject({ success: true, data: false });
    });

    it('is true once the registration is approved', async () => {
        seedUser({ serviceRegistrations: { farmNation: { status: 'approved' } } });
        const { checkFarmNationAccessAction } = await actions();
        expect(await checkFarmNationAccessAction()).toMatchObject({ success: true, data: true });
    });

    it('is true for an admin', async () => {
        actAs(APPLICANT, ['super_admin']);
        seedUser({ roles: ['super_admin'] });
        const { checkFarmNationAccessAction } = await actions();
        expect(await checkFarmNationAccessAction()).toMatchObject({ success: true, data: true });
    });
});
