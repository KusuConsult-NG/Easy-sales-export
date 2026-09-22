/**
 * @jest-environment node
 */

/**
 * The Academy learner application, EXECUTED — submit, load for editing, the
 * admin revision request, the legacy approval endpoint, and resubmission.
 *
 * At 9.1%, and it carries three of this audit's academy findings: the dedup
 * guard that told a rejected applicant to reapply and then refused them, the
 * plan written as the literal "registration" for every learner including those
 * who paid the elite fee, and the second approval endpoint that recorded the
 * reviewer under a different pair of field names from the canonical one.
 *
 * TWO HARNESS GAPS HAD TO CLOSE FIRST
 * -----------------------------------
 * This file is why the fake grew two adapter behaviours it was missing:
 *
 *   - `t.get` takes a QUERY, not only a document reference —
 *     SupabaseTransaction.get is literally `refOrQuery.get()`. The dedup guard
 *     reads a filtered query inside the transaction, and with a ref-only stub
 *     it came back as a non-existent document: `snap.empty` undefined, then
 *     `snap.docs.sort` threw into the action's catch, which reads exactly like
 *     a defect in the code under test.
 *   - Transaction writes are DEFERRED to `_commit()`. Applying them eagerly
 *     left the store holding writes a thrown callback would never have made —
 *     so "the refusal wrote nothing" failed against correct code.
 *
 * Both are now gated in harness-covers-adapter.test.ts. Without them every
 * assertion below about the dedup guard would have been about a crash.
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

jest.mock('@/lib/auth', () => ({
    auth: async () => null,
    signIn: async () => undefined,
    signOut: async () => undefined,
    handlers: {},
}));

let store: FakeDbHandle;

const LEARNER = 'learner-1';
const APPS = COLLECTIONS.ACADEMY_APPLICATIONS;

function actAs(id: string | null, roles: string[] = ['user']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : { session: { user: { id, roles, email: 'ada@example.com', name: 'Ada Obi' } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(LEARNER);
});

async function actions() {
    return import('@/app/actions/academy/_ac_applications');
}

function form(overrides: Record<string, unknown> = {}): any {
    const { personalInfo, ...rest } = overrides as any;
    return {
        personalInfo: {
            firstName: 'Ada',
            lastName: 'Obi',
            otherName: '',
            fullName: 'Ada Obi',
            email: 'ada@example.com',
            phone: '08012345678',
            dateOfBirth: '1994-05-10',
            gender: 'female',
            state: 'Plateau',
            lga: 'Jos North',
            occupation: 'Trader',
            ...(personalInfo ?? {}),
        },
        education: {
            educationLevel: 'tertiary',
            fieldOfStudy: 'Agriculture',
            yearsExperience: 3,
            currentRole: 'Trader',
        },
        interests: {
            learningPaths: ['export'],
            topics: 'Grains',
            goals: 'Export rice',
        },
        ...rest,
    };
}

/**
 * A learner who may submit.
 *
 *   PAID BY DEFAULT, because payment is now the PRECONDITION for submitting at
 *   all — the owner's "before users can submit application on academy they
 *   should make payment". A test that is not about payment should start from a
 *   learner who can get through the door; the ones that ARE about it pass their
 *   own `serviceRegistrations`, which replaces this wholesale.
 */
function seedUser(extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.USERS, LEARNER, {
        email: 'ada@example.com',
        fullName: 'Ada Obi',
        roles: ['user'],
        serviceRegistrations: { academy: { paymentStatus: 'completed' } },
        ...extra,
    });
}

const readUser = () => store.get(COLLECTIONS.USERS, LEARNER) as Record<string, any>;
const reg = () => readUser().serviceRegistrations?.academy ?? {};
const onlyApp = () => store.all(APPS)[0][1] as Record<string, any>;

// ─────────────────────────────────────────────────────────────────────────────
describe('submitAcademyApplicationAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { submitAcademyApplicationAction } = await actions();
        expect(await submitAcademyApplicationAction(form()))
            .toMatchObject({ success: false, error: 'Unauthorized' });
        expect(store.size(APPS)).toBe(0);
    });

    it('writes the application and links it from the user record', async () => {
        seedUser();
        const { submitAcademyApplicationAction } = await actions();
        expect(await submitAcademyApplicationAction(form())).toMatchObject({ success: true });

        const app = onlyApp();
        expect(app).toMatchObject({ userId: LEARNER, status: 'pending', paymentStatus: 'completed' });
        expect(reg()).toMatchObject({ status: 'pending', applicationId: app.applicationId });
        expect(app.id).toBe(app.applicationId);
    });

    it('syncs the learner\'s profile onto the user record', async () => {
        seedUser();
        const { submitAcademyApplicationAction } = await actions();
        await submitAcademyApplicationAction(
            form({ personalInfo: { otherName: 'Chidinma' } }));

        expect(readUser()).toMatchObject({
            firstName: 'Ada', lastName: 'Obi', otherName: 'Chidinma', fullName: 'Ada Chidinma Obi',
            gender: 'female', stateOfOrigin: 'Plateau', lga: 'Jos North',
        });
    });

    it('LOWERCASES the stored email', async () => {
        // Three separate lookups — checkAcademyStatus, checkAcademyPaymentStatus
        // and module-access-check Layer 2.7, which GRANTS academy access — query
        // `personalInfo.email == userData.email.toLowerCase()`. An applicant who
        // typed a capital was invisible to all three.
        seedUser();
        const { submitAcademyApplicationAction } = await actions();
        await submitAcademyApplicationAction(
            form({ personalInfo: { email: '  Ada@Example.COM ' } }));

        expect(onlyApp().personalInfo.email).toBe('ada@example.com');
    });

    it('refuses while a previous application is still being processed', async () => {
        seedUser({ serviceRegistrations: { academy: { status: 'pending', applicationId: 'ACADEMY-1' } } });
        const { submitAcademyApplicationAction } = await actions();
        expect(await submitAcademyApplicationAction(form())).toMatchObject({
            success: false, error: 'Your previous application is still being processed.',
        });
        expect(store.size(APPS)).toBe(0);
    });

    it('but "pending" with NO application id is the payment step, not an application', async () => {
        // The payment verification step also sets status "pending". Treating
        // that as a submitted application locked the learner out of applying.
        seedUser({ serviceRegistrations: { academy: { status: 'pending', paymentStatus: 'completed' } } });
        const { submitAcademyApplicationAction } = await actions();
        expect(await submitAcademyApplicationAction(form())).toMatchObject({ success: true });
    });

    it('refuses somebody already enrolled', async () => {
        seedUser({ serviceRegistrations: { academy: { status: 'approved' } } });
        const { submitAcademyApplicationAction } = await actions();
        expect(await submitAcademyApplicationAction(form())).toMatchObject({
            success: false, error: 'You are already enrolled in the Academy program.',
        });
    });

    /*
     *   THE OWNER: "yes decouple payment from auto-approval", after asking that
     *   courses be "accessible to users after they paid AND approved by admin".
     *
     *   Paying used to BE approval: the application was written `status:
     *   "approved"`, `reviewedBy: "system_auto_approval"`, with
     *   `academy_participant` granted in the same request. Two gates now —
     *   payment buys the right to APPLY, an administrator grants the right to
     *   LEARN — and these tests are the old ones inverted.
     */
    it('A PAID LEARNER IS ACCEPTED AND LEFT FOR AN ADMIN — no longer auto-approved', async () => {
        seedUser({
            roles: ['user'],
            serviceRegistrations: {
                academy: { paymentStatus: 'completed', paymentAmount: 270000, plan: 'elite' },
            },
        });

        const { submitAcademyApplicationAction } = await actions();
        expect(await submitAcademyApplicationAction(form())).toMatchObject({ success: true });

        //   The payment is RECORDED. It just no longer decides.
        expect(onlyApp()).toMatchObject({
            status: 'pending', reviewedBy: null, reviewedAt: null, paymentAmount: 270000,
        });
        expect(reg().status).toBe('pending');

        //   The entitlement is the admin's to grant — _ac_admin_review does it.
        expect(readUser().roles).not.toContain('academy_participant');
    });

    it.each(['completed', 'paid', 'successful'])('%p LETS THEM THROUGH THE DOOR', async (paymentStatus) => {
        seedUser({ serviceRegistrations: { academy: { paymentStatus } } });
        const { submitAcademyApplicationAction } = await actions();
        expect(await submitAcademyApplicationAction(form())).toMatchObject({ success: true });

        //   Accepted, and waiting on a person.
        expect(onlyApp().status).toBe('pending');
    });

    it('A WAIVED PLACE LETS THEM THROUGH TOO — a grant is a decision, not a shortfall', async () => {
        //   academyGrantFields writes paymentStatus: "waived" when an admin opens
        //   a place without a payment. Refusing it would punish the learner for
        //   the platform's own generosity.
        seedUser({ serviceRegistrations: { academy: { paymentStatus: 'waived' } } });
        const { submitAcademyApplicationAction } = await actions();
        expect(await submitAcademyApplicationAction(form())).toMatchObject({ success: true });
        expect(onlyApp().status).toBe('pending');
    });

    it('AN UNPAID APPLICANT IS REFUSED, and no row is written', async () => {
        //   THE OWNER: "before users can submit application on academy they
        //   should make payment before application can be submit."
        //
        //   The form already refused — Submit is disabled until paid. This is a
        //   "use server" export, so it is a public endpoint and the button was
        //   the only thing saying no.
        seedUser({ serviceRegistrations: { academy: { paymentStatus: 'pending' } } });
        const { submitAcademyApplicationAction } = await actions();

        expect(await submitAcademyApplicationAction(form())).toMatchObject({
            success: false, error: expect.stringMatching(/payment/i),
        });
        expect(store.size(APPS)).toBe(0);
        expect(readUser().roles).not.toContain('academy_participant');
    });

    it('A LEARNER WHOSE MONEY IS RECORDED BUT WHOSE FLAG IS NOT, GETS IN', async () => {
        /*
         *   THE REGRESSION THIS PINS, AND IT WAS MINE.
         *
         *   THE OWNER: "new users are gated and also they submit the
         *   application without payment".
         *
         *   The first version of this gate asked ONE question —
         *   isAcademyEntitled(serviceRegistrations.academy.paymentStatus) —
         *   while the Submit button asks checkAcademyPaymentStatusAction, which
         *   consults FIVE sources. A learner whose payment is recorded in
         *   processed_payments but whose registration flag was never written
         *   (the fulfilment gap this audit keeps finding) therefore saw the
         *   button go green and was refused by the server.
         *
         *   Gated, after paying. The gate asks the same oracle now.
         */
        store.seed(COLLECTIONS.USERS, LEARNER, {
            email: 'ada@example.com',
            fullName: 'Ada Obi',
            roles: ['user'],
            //   No serviceRegistrations.academy at all — the flag never landed.
        });
        store.seed(COLLECTIONS.PROCESSED_PAYMENTS, 'pay-1', {
            userId: LEARNER,
            type: 'academy_registration',
            status: 'completed',
            amount: 15000,
        });

        const { submitAcademyApplicationAction } = await actions();
        expect(await submitAcademyApplicationAction(form())).toMatchObject({ success: true });
        expect(onlyApp().status).toBe('pending');
    });

    it('AND AN ALREADY-ENROLLED LEARNER IS TOLD SO, not told to pay', async () => {
        //   Ordering. The payment verdict is read before the transaction opens,
        //   because it issues its own reads — but applying it there would answer
        //   "pay first" to somebody who is already in.
        seedUser({ serviceRegistrations: { academy: { status: 'approved' } } });
        const { submitAcademyApplicationAction } = await actions();

        expect(await submitAcademyApplicationAction(form())).toMatchObject({
            success: false, error: expect.stringMatching(/already enrolled/i),
        });
    });

    it('AND SO IS AN APPLICANT WITH NO ACADEMY REGISTRATION AT ALL', async () => {
        seedUser({ serviceRegistrations: {} });
        const { submitAcademyApplicationAction } = await actions();

        expect(await submitAcademyApplicationAction(form())).toMatchObject({ success: false });
        expect(store.size(APPS)).toBe(0);
    });

    it('records the TIER the learner bought, not the literal "registration"', async () => {
        // The plan was written as "registration" unconditionally, so the admin
        // screen, its badge and its CSV said Registration for everybody —
        // including everyone who had paid the ₦270,000 elite fee, with the
        // amount column right beside it disagreeing.
        seedUser({
            serviceRegistrations: { academy: { plan: 'elite', paymentStatus: 'completed' } },
        });

        const { submitAcademyApplicationAction } = await actions();
        await submitAcademyApplicationAction(form());

        expect(onlyApp().plan).toBe('elite');
    });

    it('records null, not a placeholder, when no tier was bought', async () => {
        // Registration itself is free, so "applied without buying a tier" is a
        // real state and deserves an honest absence.
        seedUser();
        const { submitAcademyApplicationAction } = await actions();
        await submitAcademyApplicationAction(form());

        expect(onlyApp().plan).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the academy dedup guard', () => {
    function seedForeign(fields: Record<string, unknown>, status = 'pending'): void {
        store.seed(APPS, 'foreign', {
            userId: 'someone-else', status,
            personalInfo: { firstName: 'Other', ...fields },
        });
    }

    it('refuses a phone number on another account\'s application', async () => {
        seedUser();
        seedForeign({ phone: '08012345678' });

        const { submitAcademyApplicationAction } = await actions();
        const res: any = await submitAcademyApplicationAction(form());

        expect(res.success).toBe(false);
        expect(res.error).toContain('phone number');
        expect(res.error).toContain('different account');
        expect(store.size(APPS)).toBe(1);
    });

    it('refuses another account\'s application even when it is REJECTED', async () => {
        seedUser();
        seedForeign({ phone: '08012345678' }, 'rejected');

        const { submitAcademyApplicationAction } = await actions();
        expect(((await submitAcademyApplicationAction(form())) as any).error)
            .toContain('different account');
    });

    it('refuses an email on another account\'s application', async () => {
        seedUser();
        seedForeign({ email: 'ada@example.com' });

        const { submitAcademyApplicationAction } = await actions();
        expect(((await submitAcademyApplicationAction(form())) as any).error)
            .toContain('email address');
    });

    it('LETS A REJECTED APPLICANT REAPPLY', async () => {
        // The platform emails a rejected applicant a list headed "What You Can
        // Do" whose last item is "Re-apply after making necessary
        // improvements". The guard then matched their OWN rejected row on phone
        // and told them the number was already taken — permanently, in a
        // message that reads as though somebody else had it.
        //   They paid once; the fee is not charged again to reapply.
        seedUser({ serviceRegistrations: { academy: { status: 'rejected', paymentStatus: 'completed' } } });
        store.seed(APPS, 'my-old-one', {
            userId: LEARNER, status: 'rejected',
            personalInfo: { phone: '08012345678', email: 'ada@example.com' },
        });

        const { submitAcademyApplicationAction } = await actions();
        expect(await submitAcademyApplicationAction(form())).toMatchObject({ success: true });
        expect(store.size(APPS)).toBe(2);
    });

    it('and one asked for revisions', async () => {
        seedUser();
        store.seed(APPS, 'my-old-one', {
            userId: LEARNER, status: 'revision_required',
            personalInfo: { phone: '08012345678', email: 'ada@example.com' },
        });

        const { submitAcademyApplicationAction } = await actions();
        expect(await submitAcademyApplicationAction(form())).toMatchObject({ success: true });
    });

    it('but still refuses when the learner\'s own row is LIVE', async () => {
        seedUser();
        store.seed(APPS, 'my-live-one', {
            userId: LEARNER, status: 'under_review',
            personalInfo: { phone: '08012345678' },
        });

        const { submitAcademyApplicationAction } = await actions();
        const res: any = await submitAcademyApplicationAction(form());
        expect(res.success).toBe(false);
        expect(res.error).toContain('currently under_review');
    });

    it('finds the foreign owner even when the caller\'s own rejected row is also in the set', async () => {
        seedUser();
        store.seed(APPS, 'mine', {
            userId: LEARNER, status: 'rejected', personalInfo: { phone: '08012345678' },
        });
        seedForeign({ phone: '08012345678' });

        const { submitAcademyApplicationAction } = await actions();
        expect(((await submitAcademyApplicationAction(form())) as any).error)
            .toContain('different account');
    });

    it('matches a phone stored in the E.164 form as well as the typed one', async () => {
        seedUser();
        seedForeign({ phone: '+2348012345678' });

        const { submitAcademyApplicationAction } = await actions();
        expect(((await submitAcademyApplicationAction(form())) as any).error)
            .toContain('phone number');
    });

    it('matches an email case-insensitively, because the stored form is lowercased', async () => {
        seedUser();
        seedForeign({ email: 'ada@example.com' });

        const { submitAcademyApplicationAction } = await actions();
        expect(((await submitAcademyApplicationAction(
            form({ personalInfo: { phone: '08099998888', email: 'ADA@Example.com' } }))) as any).error)
            .toContain('email address');
    });

    it('writes NOTHING when it refuses', async () => {
        // The transaction throws, and SupabaseTransaction only commits after the
        // callback returns — so the user record must be untouched too.
        seedUser();
        seedForeign({ phone: '08012345678' });

        const { submitAcademyApplicationAction } = await actions();
        await submitAcademyApplicationAction(form());

        expect(store.size(APPS)).toBe(1);
        expect(reg().applicationId).toBeUndefined();
        expect(readUser().firstName).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getAcademyApplicationAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { getAcademyApplicationAction } = await actions();
        expect(await getAcademyApplicationAction()).toMatchObject({ success: false });
    });

    it('loads the application the user record points at', async () => {
        seedUser({ serviceRegistrations: { academy: { applicationId: 'app-1' } } });
        store.seed(APPS, 'app-1', { userId: LEARNER, status: 'revision_required', notes: 'x' });

        const { getAcademyApplicationAction } = await actions();
        expect(((await getAcademyApplicationAction()) as any).data)
            .toMatchObject({ status: 'revision_required' });
    });

    it('finds it by query when the link is missing, and REPAIRS the link', async () => {
        seedUser();
        store.seed(APPS, 'orphan', {
            userId: LEARNER, status: 'pending', submittedAt: '2026-01-01T00:00:00.000Z',
        });

        const { getAcademyApplicationAction } = await actions();
        expect(((await getAcademyApplicationAction()) as any).success).toBe(true);
        expect(reg().applicationId).toBe('orphan');
    });

    it('repairs a missing userId on the application it just read', async () => {
        seedUser({ serviceRegistrations: { academy: { applicationId: 'app-1' } } });
        store.seed(APPS, 'app-1', { status: 'pending' });

        const { getAcademyApplicationAction } = await actions();
        await getAcademyApplicationAction();

        expect(store.get(APPS, 'app-1')!.userId).toBe(LEARNER);
    });

    it('takes the most recently submitted when there are several', async () => {
        seedUser();
        store.seedAll(APPS, {
            old: { userId: LEARNER, status: 'rejected', submittedAt: '2025-01-01T00:00:00.000Z' },
            recent: { userId: LEARNER, status: 'pending', submittedAt: '2026-06-01T00:00:00.000Z' },
        });

        const { getAcademyApplicationAction } = await actions();
        expect(((await getAcademyApplicationAction()) as any).data.status).toBe('pending');
    });

    it('says so when there is nothing to load', async () => {
        seedUser();
        const { getAcademyApplicationAction } = await actions();
        expect(await getAcademyApplicationAction()).toMatchObject({
            success: false, error: 'No application found',
        });
    });

    it('reads only the caller\'s own application', async () => {
        seedUser();
        store.seed(APPS, 'theirs', { userId: 'someone-else', status: 'approved' });

        const { getAcademyApplicationAction } = await actions();
        expect(await getAcademyApplicationAction()).toMatchObject({
            success: false, error: 'No application found',
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('requestAcademyRevisionAction', () => {
    beforeEach(() => {
        actAs('admin-1', ['admin']);
        seedUser({ serviceRegistrations: { academy: { status: 'pending', applicationId: 'app-1' } } });
        store.seed(APPS, 'app-1', {
            userId: LEARNER, status: 'pending',
            personalInfo: { firstName: 'Ada', lastName: 'Obi', email: 'ada@example.com' },
        });
    });

    it('refuses a non-admin', async () => {
        actAs(LEARNER, ['user']);
        const { requestAcademyRevisionAction } = await actions();
        expect(await requestAcademyRevisionAction('app-1', 'Please redo')).toMatchObject({ success: false });
        expect(store.get(APPS, 'app-1')!.status).toBe('pending');
    });

    it('ADMITS THE ACADEMY ADMIN, WHO COULD ALREADY SEE THIS QUEUE', async () => {
        //   #265 _ac_admin_applications.ts admits academy_admin to READ the
        //        pending queue in this very collection; this write refused the
        //        same role. The academy admin opened the screen, saw the
        //        applications, and every button said "Admin access required".
        actAs('academy-admin-1', ['academy_admin']);
        const { requestAcademyRevisionAction } = await actions();

        expect(await requestAcademyRevisionAction('app-1', 'Please redo')).toMatchObject({ success: true });
    });

    it('and still refuses an admin of a different module', async () => {
        // The fix is the named permission, not isAdmin().
        actAs('wave-admin-1', ['wave_admin']);
        const { requestAcademyRevisionAction } = await actions();

        expect(await requestAcademyRevisionAction('app-1', 'Please redo')).toMatchObject({ success: false });
    });

    it('refuses an application that does not exist', async () => {
        const { requestAcademyRevisionAction } = await actions();
        expect(await requestAcademyRevisionAction('nope', 'Please redo')).toMatchObject({
            success: false, error: 'Application not found',
        });
    });

    it('records the note, the requester and the time', async () => {
        const { requestAcademyRevisionAction } = await actions();
        expect(await requestAcademyRevisionAction('app-1', 'Upload a clearer ID'))
            .toMatchObject({ success: true });

        const app = store.get(APPS, 'app-1')!;
        expect(app).toMatchObject({
            status: 'revision_required',
            revisionNote: 'Upload a clearer ID',
            revisionRequestedBy: 'admin-1',
        });
        expect(typeof app.revisionRequestedAt).toBe('string');
    });

    it('mirrors the status onto the applicant\'s user record', async () => {
        const { requestAcademyRevisionAction } = await actions();
        await requestAcademyRevisionAction('app-1', 'Please redo');

        expect(reg().status).toBe('revision_required');
    });

    it('does not fall over when the application carries no userId', async () => {
        store.seed(APPS, 'orphan', { status: 'pending' });
        const { requestAcademyRevisionAction } = await actions();
        expect(await requestAcademyRevisionAction('orphan', 'Please redo'))
            .toMatchObject({ success: true });
    });

    it('a super_admin may do it too', async () => {
        actAs('admin-2', ['super_admin']);
        const { requestAcademyRevisionAction } = await actions();
        expect(await requestAcademyRevisionAction('app-1', 'Please redo'))
            .toMatchObject({ success: true });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('approveAcademyApplicationAction (the legacy endpoint)', () => {
    it('refuses an anonymous caller before delegating', async () => {
        actAs(null);
        const { approveAcademyApplicationAction } = await actions();
        expect(await approveAcademyApplicationAction('app-1'))
            .toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('DELEGATES to the canonical implementation rather than approving here', async () => {
        // There were two live approval endpoints that disagreed: different role
        // guards, and this one wrote approvedAt/approvedBy where the canonical
        // one writes reviewedAt/reviewedBy — so who approved an application, and
        // when, depended on which endpoint the caller happened to hit.
        // Excluding it from the barrel changed nothing: this file is
        // "use server", so every export is reachable.
        jest.resetModules();
        const canonical = jest.fn(async (_id: string) => ({ success: true, error: null, data: null }));
        jest.doMock('@/app/actions/academy/_ac_admin_review', () => ({
            approveAcademyApplicationAction: (id: string) => canonical(id),
        }));

        actAs('admin-1', ['super_admin']);
        const { approveAcademyApplicationAction } = await actions();
        expect(await approveAcademyApplicationAction('app-1')).toMatchObject({ success: true });

        expect(canonical).toHaveBeenCalledWith('app-1');

        jest.dontMock('@/app/actions/academy/_ac_admin_review');
        jest.resetModules();
    });

    it('and does NOT decide the authorisation itself', async () => {
        // A strictly weaker precondition than the canonical guard, not a second
        // rule that could disagree with it: an ordinary user reaches the
        // delegation and the canonical implementation refuses them.
        jest.resetModules();
        const canonical = jest.fn(async (_id: string) =>
            ({ success: false, error: 'Admin access required', data: null }));
        jest.doMock('@/app/actions/academy/_ac_admin_review', () => ({
            approveAcademyApplicationAction: (id: string) => canonical(id),
        }));

        actAs(LEARNER, ['user']);
        const { approveAcademyApplicationAction } = await actions();
        expect(await approveAcademyApplicationAction('app-1'))
            .toMatchObject({ success: false, error: 'Admin access required' });
        expect(canonical).toHaveBeenCalledTimes(1);

        jest.dontMock('@/app/actions/academy/_ac_admin_review');
        jest.resetModules();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('resubmitAcademyApplicationAction', () => {
    function seedResubmittable(status = 'revision_required'): void {
        seedUser({ serviceRegistrations: { academy: { status, applicationId: 'app-1' } } });
        store.seed(APPS, 'app-1', {
            userId: LEARNER, status, revisionNote: 'Please redo',
            createdAt: '2026-01-01T00:00:00.000Z',
            personalInfo: { firstName: 'Ada', lastName: 'Obi' },
        });
    }

    it('refuses a form that fails the schema, BEFORE checking the session', async () => {
        // Validation is the first statement in the function. Pinned so the
        // ordering is a decision — an anonymous caller gets a validation error
        // rather than "Unauthorized" for a malformed body.
        actAs(null);
        const { resubmitAcademyApplicationAction } = await actions();
        const res: any = await resubmitAcademyApplicationAction(
            form({ personalInfo: { email: 'not-an-email' } }));

        expect(res.success).toBe(false);
        expect(res.error).not.toBe('Unauthorized');
    });

    it('refuses a caller with no session once the form is valid', async () => {
        actAs(null);
        const { resubmitAcademyApplicationAction } = await actions();
        expect(await resubmitAcademyApplicationAction(form()))
            .toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('refuses from a status that is not resubmittable', async () => {
        seedResubmittable('approved');
        const { resubmitAcademyApplicationAction } = await actions();
        expect(await resubmitAcademyApplicationAction(form())).toMatchObject({
            success: false, error: 'Your application cannot be resubmitted at this time.',
        });
        expect(store.get(APPS, 'app-1')!.status).toBe('approved');
    });

    it('refuses somebody who has never applied', async () => {
        seedUser();
        const { resubmitAcademyApplicationAction } = await actions();
        expect(await resubmitAcademyApplicationAction(form())).toMatchObject({
            success: false, error: 'Your application cannot be resubmitted at this time.',
        });
    });

    it.each(['pending', 'revision_required'])('allows resubmission from %s', async (status) => {
        seedResubmittable(status);
        const { resubmitAcademyApplicationAction } = await actions();
        expect(await resubmitAcademyApplicationAction(form())).toMatchObject({ success: true });
    });

    it('updates the application in place and clears the revision note', async () => {
        seedResubmittable();
        const { resubmitAcademyApplicationAction } = await actions();
        await resubmitAcademyApplicationAction(
            form({ personalInfo: { occupation: 'Exporter' } }));

        const app = store.get(APPS, 'app-1')!;
        expect(app.status).toBe('pending');
        expect(app.revisionNote).toBeNull();
        expect(app.personalInfo.occupation).toBe('Exporter');
        expect(typeof app.resubmittedAt).toBe('string');
        expect(store.size(APPS)).toBe(1);
    });

    it('puts the registration back to pending and re-syncs the profile', async () => {
        seedResubmittable();
        const { resubmitAcademyApplicationAction } = await actions();
        await resubmitAcademyApplicationAction(
            form({ personalInfo: { lastName: 'Nwosu', phone: '08099998888' } }));

        expect(reg().status).toBe('pending');
        expect(readUser()).toMatchObject({
            lastName: 'Nwosu', fullName: 'Ada Nwosu', phone: '08099998888',
        });
    });

    it('updates the most recent application when there are several', async () => {
        seedUser({ serviceRegistrations: { academy: { status: 'revision_required' } } });
        store.seedAll(APPS, {
            old: { userId: LEARNER, status: 'rejected', createdAt: '2025-01-01T00:00:00.000Z' },
            recent: { userId: LEARNER, status: 'revision_required', createdAt: '2026-06-01T00:00:00.000Z' },
        });

        const { resubmitAcademyApplicationAction } = await actions();
        await resubmitAcademyApplicationAction(form());

        expect(store.get(APPS, 'recent')!.status).toBe('pending');
        expect(store.get(APPS, 'old')!.status).toBe('rejected');
    });

    it('reports a failure and writes nothing when the learner has a status but no row', async () => {
        seedUser({ serviceRegistrations: { academy: { status: 'revision_required' } } });

        const { resubmitAcademyApplicationAction } = await actions();
        expect(await resubmitAcademyApplicationAction(form())).toMatchObject({
            success: false, error: 'Failed to resubmit application',
        });
        expect(reg().status).toBe('revision_required');
    });

    it('does not touch another learner\'s application', async () => {
        seedResubmittable();
        store.seed(APPS, 'theirs', {
            userId: 'someone-else', status: 'revision_required',
            createdAt: '2026-06-01T00:00:00.000Z',
        });

        const { resubmitAcademyApplicationAction } = await actions();
        await resubmitAcademyApplicationAction(form());

        expect(store.get(APPS, 'theirs')!.status).toBe('revision_required');
        expect(store.get(APPS, 'app-1')!.status).toBe('pending');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 *   #232 REAPPLYING AFTER A REJECTION WENT STRAIGHT PAST THE ADMIN.
 *
 *        `isPaid` is the auto-approval switch: a paid applicant's application is
 *        written `status: "approved"`, `reviewedBy: "system_auto_approval"`,
 *        with `academy_participant` granted and `isVerified` set. That is
 *        deliberate for a FIRST application — paying the registration fee is
 *        what admits a learner.
 *
 *        But the fee is paid once, and the dedup guard above deliberately lets a
 *        rejected applicant reapply, because the rejection email invites exactly
 *        that ("Re-apply after making necessary improvements"). So the applicant
 *        an admin had just rejected submitted a new form and was auto-approved
 *        by their OLD payment, in the same request, with the role back. The
 *        admin who rejected them had no way to make it stick.
 *
 *        A reapplication that follows a decision goes to the admin instead.
 *        Nothing is lost — the payment still counts, and the admin can approve,
 *        which is the outcome auto-approval would have produced. It just cannot
 *        happen without them.
 *
 *        Fifth instance of the shape fixed in #207, #225, #227 and #229.
 */
describe('#232 — a reapplication after a decision needs an admin', () => {
    const submit = async (f = form()) =>
        (await (await actions()).submitAcademyApplicationAction(f)) as any;

    const PAID = { paymentStatus: 'completed', paymentAmount: 45_000, plan: 'foundation' };

    it.each(['rejected', 'declined', 'revoked', 'suspended', 'cancelled'])(
        'DOES NOT AUTO-APPROVE AFTER %s', async (status) => {
            seedUser({ serviceRegistrations: { academy: { ...PAID, status } } });

            expect(await submit()).toMatchObject({ success: true });

            // Was: "approved", reviewedBy "system_auto_approval".
            expect(onlyApp().status).toBe('pending');
            expect(onlyApp().reviewedBy).toBeNull();
            expect(reg().status).toBe('pending');
        });

    it('AND DOES NOT HAND BACK THE ROLE THE REJECTION REVOKED', async () => {
        seedUser({ serviceRegistrations: { academy: { ...PAID, status: 'rejected' } } });

        await submit();

        expect(readUser().roles).not.toContain('academy_participant');
        expect(readUser().isVerified).not.toBe(true);
    });

    it('and the payment is still carried onto the new application', async () => {
        // The applicant is not asked to pay twice. The fee they already paid is
        // recorded on the new row; it simply no longer approves it by itself.
        seedUser({ serviceRegistrations: { academy: { ...PAID, status: 'rejected' } } });

        await submit();

        expect(onlyApp().paymentStatus).toBe('completed');
        expect(onlyApp().paymentAmount).toBe(45_000);
        expect(onlyApp().plan).toBe('foundation');
    });

    it('and reapplying is still ALLOWED — this refuses the shortcut, not the applicant', async () => {
        seedUser({ serviceRegistrations: { academy: { ...PAID, status: 'rejected' } } });
        store.seed(APPS, 'old-rejected', {
            userId: LEARNER, status: 'rejected',
            personalInfo: { email: 'ada@example.com', phone: '08012345678' },
            submittedAt: '2026-01-01T00:00:00.000Z',
        });

        expect(await submit()).toMatchObject({ success: true });
    });

    /*
     *   ── AND NOBODY IS ADMITTED WITHOUT AN ADMIN ANY MORE ────────────────
     *
     *   These three read "still auto-approves ..." until the owner said "yes
     *   decouple payment from auto-approval". The cases they cover still matter
     *   — a first-time payer, an unpaid applicant, a revision request — but the
     *   answer to all three is now the same: accepted if paid, and pending.
     *
     *   #207's line of fixes is SUBSUMED rather than lost. It existed to stop an
     *   old payment auto-approving a REAPPLICATION after a rejection. Nothing
     *   auto-approves now, so the case it guarded cannot arise.
     */

    it('A FIRST-TIME PAYER IS ACCEPTED AND PENDING, not admitted', async () => {
        seedUser({ serviceRegistrations: { academy: PAID } });

        expect(await submit()).toMatchObject({ success: true });
        expect(onlyApp().status).toBe('pending');
        expect(reg().status).toBe('pending');
        expect(readUser().roles).not.toContain('academy_participant');
    });

    it('AN UNPAID APPLICANT IS REFUSED — no longer merely left pending', async () => {
        seedUser({ serviceRegistrations: { academy: { paymentStatus: 'pending' } } });

        expect(await submit()).toMatchObject({ success: false });
        expect(store.size(APPS)).toBe(0);
        expect(readUser().roles).not.toContain('academy_participant');
    });

    it('A REVISION REQUEST IS NOT A DECISION AGAINST — they may resubmit, and wait', async () => {
        // revision_required means "come back with more", not "no".
        seedUser({ serviceRegistrations: { academy: { ...PAID, status: 'revision_required' } } });

        expect(await submit()).toMatchObject({ success: true });
        expect(onlyApp().status).toBe('pending');
    });
});
