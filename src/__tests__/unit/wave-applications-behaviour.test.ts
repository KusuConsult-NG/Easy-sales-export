/**
 * @jest-environment node
 */

/**
 * The WAVE applicant's own path, EXECUTED — enrol, check status, load for
 * editing, and resubmit after a revision request.
 *
 * At 11.1%, and it is the file carrying five of this audit's WAVE findings:
 * #31 (status readable for any user id), #32 (resubmission skipped the
 * duplicate gate), #35 (eligibility read the bypassable derived copy), #38 (four
 * copies of the eligibility rule) and the set-once identity rule behind #155
 * and #156. Every one of those is a decision made from a document, so a
 * call-recorder harness could assert the SHAPE of the code and nothing about
 * what it decides. These run it.
 *
 * WHAT IS MOCKED AND WHY
 * ----------------------
 * The status claim is a Postgres CAS function, which the fake deliberately does
 * not implement (see KNOWN_DIVERGENCES). It is mocked so the ACTION's decisions
 * are testable — which statuses it will move from, what it puts in the patch,
 * and what it does with a refusal. Whether the CAS actually serialises is proven
 * against a real database in src/__tests__/pg/.
 *
 * THE ONE THING TO KNOW BEFORE READING
 * ------------------------------------
 * Resubmission gates on the APPLICATION's status through the claim, not on the
 * user record's `serviceRegistrations.wave.status` — but it reads the user
 * record FIRST to find the application id and to reject an obviously wrong
 * state. Both guards are live and they fail with different messages, so the
 * tests below distinguish them.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createHash } from 'crypto';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('resend', () => ({
    Resend: class { emails = { send: async () => ({ error: null }) }; },
}));

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

const notifyAdmins = jest.fn(async (_p: unknown) => undefined);
jest.mock('@/lib/admin-notifications', () => ({
    notifyAdmins: (p: unknown) => notifyAdmins(p),
}));

const claimStatusTransitionFromAny = jest.fn(async (_args: unknown) =>
    ({ claimed: true, status: 'pending', exists: true } as {
        claimed: boolean; status: string | null; exists?: boolean;
    }));
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransitionFromAny: (args: unknown) => claimStatusTransitionFromAny(args),
    claimStatusTransition: (args: unknown) => claimStatusTransitionFromAny(args),
}));

let store: FakeDbHandle;

const APPLICANT = 'applicant-1';
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

function actAs(id: string | null, roles: string[] = ['user'], email = 'ada@example.com'): void {
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
    claimStatusTransitionFromAny.mockImplementation(async () =>
        ({ claimed: true, status: 'pending', exists: true }));
    store = installFakeDb();
    actAs(APPLICANT);
});

async function actions() {
    return import('@/app/actions/wave/_wv_applications');
}

// ─── the form ────────────────────────────────────────────────────────────────

/**
 * A submission that passes the schema and the age cross-check.
 *
 * The date of birth is fixed and the declared age is derived from it at call
 * time, so the age gate stays satisfied as the calendar moves — a hard-coded
 * age would start failing in a year and read as a defect in the action.
 */
const DOB = '1994-05-10';

function ageFrom(dobString: string): number {
    const dob = new Date(dobString);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
    return age;
}

function form(extra: Record<string, unknown> = {}): any {
    return {
        surname: 'Obi',
        firstName: 'Ada',
        otherNames: '',
        dateOfBirth: DOB,
        age: ageFrom(DOB),
        phone: '+2348012345678',
        alternativePhone: '',
        email: 'ada@example.com',
        residentialAddress: '12 Market Road, Jos',
        stateOfOrigin: 'Plateau',
        lgaOfOrigin: 'Jos North',
        stateOfResidence: 'Plateau',
        lgaOfResidence: 'Jos North',
        maritalStatus: 'single',
        nextOfKinName: 'Ngozi Obi',
        nextOfKinPhone: '08087654321',
        nextOfKinRelationship: 'Sister',
        nin: '12345678901',
        votersCardNumber: '',
        highestEducation: 'tertiary',
        currentOccupation: 'Trader',
        averageMonthlyIncome: '50k_100k',
        involvedInAgriculture: true,
        agricultureTypes: ['farming'],
        valueChainAreas: ['crop_production'],
        preferredCommodities: ['rice'],
        hasAccessToFarmland: true,
        farmlandHectares: 2,
        hasBankAccount: true,
        bankName: 'Access Bank',
        accountNumber: '0123456789',
        bvn: '22233344455',
        isMemberOfCooperative: false,
        willingToJoinCooperative: true,
        supportNeeded: ['training'],
        willingToUndergoTraining: true,
        willingToComplyWithStandards: true,
        willingToParticipateInME: true,
        declarationAccepted: true,
        consentGiven: true,
        ...extra,
    };
}

function seedUser(extra: Record<string, unknown> = {}, id = APPLICANT): void {
    store.seed(COLLECTIONS.USERS, id, {
        email: 'ada@example.com',
        fullName: 'Ada Obi',
        roles: ['user'],
        gender: 'Female',
        createdAt: '2024-01-01T00:00:00.000Z',
        ...extra,
    });
}

const readUser = (id = APPLICANT) => store.get(COLLECTIONS.USERS, id) as Record<string, any> | undefined;
const applications = () => store.all(COLLECTIONS.WAVE_APPLICATIONS);
const onlyApplication = () => applications()[0][1] as Record<string, any>;

// ─────────────────────────────────────────────────────────────────────────────
describe('submitMultiStepWaveApplicationAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { submitMultiStepWaveApplicationAction } = await actions();
        expect(await submitMultiStepWaveApplicationAction(form())).toMatchObject({
            success: false,
            error: 'Authentication required',
        });
        expect(applications()).toHaveLength(0);
    });

    it('refuses a form that fails the schema, with the first issue\'s message', async () => {
        seedUser();
        const { submitMultiStepWaveApplicationAction } = await actions();
        const res: any = await submitMultiStepWaveApplicationAction(form({ bankName: 'A' }));

        expect(res.success).toBe(false);
        expect(res.error).toContain('Bank name');
        expect(applications()).toHaveLength(0);
    });

    it('refuses an applicant under 18 by the DATE, not by the declared age', async () => {
        // The declared age is a lie the schema would accept; the DOB is not.
        seedUser();
        const child = new Date();
        child.setFullYear(child.getFullYear() - 15);

        const { submitMultiStepWaveApplicationAction } = await actions();
        const res: any = await submitMultiStepWaveApplicationAction(
            form({ dateOfBirth: child.toISOString().split('T')[0], age: 25 }));

        expect(res.success).toBe(false);
        expect(res.error).toContain('at least 18 years old');
        expect(applications()).toHaveLength(0);
    });

    it('refuses a declared age that does not match the date of birth', async () => {
        seedUser();
        const { submitMultiStepWaveApplicationAction } = await actions();
        const res: any = await submitMultiStepWaveApplicationAction(
            form({ age: ageFrom(DOB) + 10 }));

        expect(res.success).toBe(false);
        expect(res.error).toContain('does not match the declared age');
    });

    it('tolerates a one-year discrepancy, so a birthday near the submission is not a rejection', async () => {
        seedUser();
        const { submitMultiStepWaveApplicationAction } = await actions();
        expect(await submitMultiStepWaveApplicationAction(form({ age: ageFrom(DOB) + 1 })))
            .toMatchObject({ success: true });
    });

    it('records the CALCULATED age on the application, not the declared one', async () => {
        seedUser();
        const { submitMultiStepWaveApplicationAction } = await actions();
        await submitMultiStepWaveApplicationAction(form({ age: ageFrom(DOB) + 1 }));

        expect(onlyApplication().age).toBe(ageFrom(DOB));
    });

    it('refuses a male account with no pre-existing WAVE access', async () => {
        seedUser({ gender: 'Male', createdAt: '2024-01-01T00:00:00.000Z' });

        const { submitMultiStepWaveApplicationAction } = await actions();
        const res: any = await submitMultiStepWaveApplicationAction(form());

        expect(res.success).toBe(false);
        expect(res.error).toContain('exclusively for women');
        expect(applications()).toHaveLength(0);
    });

    it('a wave_participant role does NOT rescue a male account created after the cutoff', async () => {
        // #35 and #38 together. This path was the loosest of four copies of the
        // rule: it applied no date cutoff, so an account holding the role or a
        // registration was admitted whenever it was made — while both gates in
        // front of it, the /wave/application page and /api/wave/check-eligibility,
        // reported the same account ineligible. The cutoff is 2026-06-17; an
        // account created after it cannot have a pre-existing anything.
        seedUser({
            gender: 'Male',
            createdAt: '2026-07-01T00:00:00.000Z',
            roles: ['user', 'wave_participant'],
            serviceRegistrations: { wave: { status: 'rejected' } },
        });

        const { submitMultiStepWaveApplicationAction } = await actions();
        const res: any = await submitMultiStepWaveApplicationAction(form());

        expect(res.success).toBe(false);
        expect(res.error).toContain('exclusively for women');
        expect(applications()).toHaveLength(0);
    });

    it('but a male participant from BEFORE the cutoff keeps their access', async () => {
        // The positive control for the two refusals above: removing access from
        // existing participants is not the eligibility rule's call.
        seedUser({
            gender: 'Male',
            createdAt: '2026-01-01T00:00:00.000Z',
            roles: ['user', 'wave_participant'],
        });

        const { submitMultiStepWaveApplicationAction } = await actions();
        expect(await submitMultiStepWaveApplicationAction(form())).toMatchObject({ success: true });
    });

    it('admits a female applicant — the eligibility refusals are not vacuous', async () => {
        seedUser({ gender: 'Female' });
        const { submitMultiStepWaveApplicationAction } = await actions();
        expect(await submitMultiStepWaveApplicationAction(form())).toMatchObject({ success: true });
    });

    it('admits an account whose gender was never recorded', async () => {
        seedUser({ gender: undefined });
        const { submitMultiStepWaveApplicationAction } = await actions();
        expect(await submitMultiStepWaveApplicationAction(form())).toMatchObject({ success: true });
    });

    it('refuses a second application while one is still pending', async () => {
        seedUser({ serviceRegistrations: { wave: { status: 'pending' } } });
        const { submitMultiStepWaveApplicationAction } = await actions();
        expect(await submitMultiStepWaveApplicationAction(form())).toMatchObject({
            success: false,
            error: 'Your previous application is still being processed.',
        });
    });

    it('refuses an applicant who is already enrolled', async () => {
        seedUser({ serviceRegistrations: { wave: { status: 'approved' } } });
        const { submitMultiStepWaveApplicationAction } = await actions();
        expect(await submitMultiStepWaveApplicationAction(form())).toMatchObject({
            success: false,
            error: 'You are already enrolled in the WAVE program.',
        });
    });

    it('lets a rejected applicant apply again', async () => {
        seedUser({ serviceRegistrations: { wave: { status: 'rejected' } } });
        const { submitMultiStepWaveApplicationAction } = await actions();
        expect(await submitMultiStepWaveApplicationAction(form())).toMatchObject({ success: true });
    });

    it('writes the application and links it from the user record in one go', async () => {
        seedUser();
        const { submitMultiStepWaveApplicationAction } = await actions();
        const res: any = await submitMultiStepWaveApplicationAction(form());

        const app = onlyApplication();
        expect(app).toMatchObject({ userId: APPLICANT, status: 'pending', surname: 'Obi' });

        const user = readUser()!;
        expect(user.serviceRegistrations.wave).toMatchObject({
            status: 'pending',
            applicationId: res.data.applicationId,
        });
        expect(app.id).toBe(res.data.applicationId);
    });

    it('hashes the BVN and NIN rather than storing them', async () => {
        seedUser();
        const { submitMultiStepWaveApplicationAction } = await actions();
        await submitMultiStepWaveApplicationAction(form());

        const app = onlyApplication();
        expect(app.nin).toBe(sha256('12345678901'));
        expect(app.bvn).toBe(sha256('22233344455'));
        expect(JSON.stringify(app)).not.toContain('12345678901');
        expect(JSON.stringify(app)).not.toContain('22233344455');

        const user = readUser()!;
        expect(user.nin).toBe(sha256('12345678901'));
        expect(user.kyc.nin).toBe(sha256('12345678901'));
    });

    it('stores null rather than a hash of the empty string when no NIN is given', async () => {
        seedUser();
        const { submitMultiStepWaveApplicationAction } = await actions();
        await submitMultiStepWaveApplicationAction(form({ nin: '', bvn: '' }));

        expect(onlyApplication().nin).toBeNull();
        expect(onlyApplication().bvn).toBeNull();
    });

    it('never marks the identity verified from the applicant\'s own typing', async () => {
        // These two fields decide the account's overall KYC state. They were
        // written as `applicantBvn ? true : false`, which is self-assertion in
        // both directions.
        seedUser({ kyc: { bvnVerified: true, ninVerified: true } });
        const { submitMultiStepWaveApplicationAction } = await actions();
        await submitMultiStepWaveApplicationAction(form());

        const kyc = readUser()!.kyc;
        expect(kyc.bvnVerified).toBe(true);   // untouched, not downgraded
        expect(kyc.ninVerified).toBe(true);
    });

    it('and does not raise them either, for an applicant who had none', async () => {
        seedUser();
        const { submitMultiStepWaveApplicationAction } = await actions();
        await submitMultiStepWaveApplicationAction(form());

        expect(readUser()!.kyc.bvnVerified).toBeUndefined();
        expect(readUser()!.kyc.ninVerified).toBeUndefined();
    });

    it('records the date of birth on the user when none is stored', async () => {
        // #156: the age sweep reads the USER record, and nothing had ever put a
        // date there.
        seedUser();
        const { submitMultiStepWaveApplicationAction } = await actions();
        await submitMultiStepWaveApplicationAction(form());

        expect(readUser()!.dateOfBirth).toBe(DOB);
    });

    it('does NOT overwrite a stored date of birth that disagrees', async () => {
        seedUser({ dateOfBirth: '1990-01-01' });
        const { submitMultiStepWaveApplicationAction } = await actions();
        await submitMultiStepWaveApplicationAction(form());

        expect(readUser()!.dateOfBirth).toBe('1990-01-01');
        // Both values survive: the declared one on the application row.
        expect(onlyApplication().dateOfBirth).toBe(DOB);
    });

    it('does NOT rewrite a stored gender to Female', async () => {
        // #155. Reaching the write does not prove the applicant is female — the
        // eligibility rule exempts admins and Academy Elite members — and after
        // #155 he could not correct the record himself.
        seedUser({ gender: 'Male', roles: ['user', 'super_admin'], createdAt: '2026-06-01T00:00:00.000Z' });

        const { submitMultiStepWaveApplicationAction } = await actions();
        expect(await submitMultiStepWaveApplicationAction(form())).toMatchObject({ success: true });
        expect(readUser()!.gender).toBe('Male');
    });

    it('sets gender only when the record has none', async () => {
        seedUser({ gender: '' });
        const { submitMultiStepWaveApplicationAction } = await actions();
        await submitMultiStepWaveApplicationAction(form());

        expect(readUser()!.gender).toBe('Female');
    });

    it('composes the full name from first, other and surname', async () => {
        seedUser();
        const { submitMultiStepWaveApplicationAction } = await actions();
        await submitMultiStepWaveApplicationAction(form({ otherNames: 'Chidinma' }));

        const user = readUser()!;
        expect(user.fullName).toBe('Ada Chidinma Obi');
        expect(user.bankAccountName).toBe('Ada Chidinma Obi');
        expect(user.bankDetails.accountName).toBe('Ada Chidinma Obi');
    });

    it('reuses the application id already on the user record', async () => {
        seedUser({ serviceRegistrations: { wave: { status: 'rejected', applicationId: 'WAVE-EXISTING' } } });
        const { submitMultiStepWaveApplicationAction } = await actions();
        const res: any = await submitMultiStepWaveApplicationAction(form());

        expect(res.data.applicationId).toBe('WAVE-EXISTING');
        expect(applications()).toHaveLength(1);
    });

    it('tells the admins a new application arrived', async () => {
        seedUser();
        const { submitMultiStepWaveApplicationAction } = await actions();
        await submitMultiStepWaveApplicationAction(form());

        expect(notifyAdmins).toHaveBeenCalledTimes(1);
        expect((notifyAdmins.mock.calls[0] as any[])[0]).toMatchObject({
            type: 'wave', link: '/admin/wave',
        });
    });

    it('still succeeds when the notification fails — it is not the applicant\'s problem', async () => {
        seedUser();
        notifyAdmins.mockImplementation(async () => { throw new Error('smtp down'); });

        const { submitMultiStepWaveApplicationAction } = await actions();
        expect(await submitMultiStepWaveApplicationAction(form())).toMatchObject({ success: true });
        expect(applications()).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the duplicate-identity gate', () => {
    function seedForeignApplication(fields: Record<string, unknown>): void {
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'foreign-app', {
            userId: 'someone-else',
            status: 'pending',
            ...fields,
        });
    }

    it('refuses a phone number already on another account\'s application', async () => {
        seedUser();
        seedForeignApplication({ phone: '+2348012345678' });

        const { submitMultiStepWaveApplicationAction } = await actions();
        const res: any = await submitMultiStepWaveApplicationAction(form());

        expect(res.success).toBe(false);
        expect(res.error).toContain('phone number');
        expect(res.error).toContain('different account');
    });

    it('refuses a NIN already on another account\'s application, matched on the HASH', async () => {
        seedUser();
        seedForeignApplication({ nin: sha256('12345678901') });

        const { submitMultiStepWaveApplicationAction } = await actions();
        const res: any = await submitMultiStepWaveApplicationAction(form());

        expect(res.success).toBe(false);
        expect(res.error).toContain('NIN');
    });

    it('refuses an email already on another account\'s application', async () => {
        seedUser();
        seedForeignApplication({ userEmail: 'ada@example.com' });

        const { submitMultiStepWaveApplicationAction } = await actions();
        const res: any = await submitMultiStepWaveApplicationAction(form());

        expect(res.success).toBe(false);
        expect(res.error).toContain('email address');
    });

    it('finds the foreign owner even when the caller\'s own row is also in the set', async () => {
        // The old query was .limit(1) while the loop scanned snap.docs, so
        // whether the duplicate was caught depended on which row came back
        // first. A foreign owner now wins whatever the order.
        seedUser();
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'own-old-app', {
            userId: APPLICANT, phone: '+2348012345678', status: 'rejected',
        });
        seedForeignApplication({ phone: '+2348012345678' });

        const { submitMultiStepWaveApplicationAction } = await actions();
        const res: any = await submitMultiStepWaveApplicationAction(form());

        expect(res.success).toBe(false);
        expect(res.error).toContain('different account');
    });

    it('lets the applicant\'s OWN rejected application through', async () => {
        seedUser({ serviceRegistrations: { wave: { status: 'rejected' } } });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'own-old-app', {
            userId: APPLICANT, phone: '+2348012345678', status: 'rejected',
        });

        const { submitMultiStepWaveApplicationAction } = await actions();
        expect(await submitMultiStepWaveApplicationAction(form())).toMatchObject({ success: true });
    });

    it('refuses when the applicant\'s own row is in a live status', async () => {
        seedUser();
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'own-live-app', {
            userId: APPLICANT, phone: '+2348012345678', status: 'under_review',
        });

        const { submitMultiStepWaveApplicationAction } = await actions();
        const res: any = await submitMultiStepWaveApplicationAction(form());

        expect(res.success).toBe(false);
        expect(res.error).toContain('currently under_review');
    });

    it('skips the NIN check entirely when the applicant declares none', async () => {
        seedUser();
        // A foreign row holding the hash of the empty string must not match.
        seedForeignApplication({ nin: sha256('') });

        const { submitMultiStepWaveApplicationAction } = await actions();
        expect(await submitMultiStepWaveApplicationAction(form({ nin: '' })))
            .toMatchObject({ success: true });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getWaveApplicationStatusAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { getWaveApplicationStatusAction } = await actions();
        expect(await getWaveApplicationStatusAction()).toMatchObject({ success: false });
    });

    it('refuses one applicant asking about another (finding #31)', async () => {
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'other-app', {
            userId: 'other-user', status: 'approved', createdAt: '2026-01-01T00:00:00.000Z',
        });

        const { getWaveApplicationStatusAction } = await actions();
        const res: any = await getWaveApplicationStatusAction('other-user');

        expect(res).toMatchObject({ success: false, error: 'Unauthorized' });
        expect(JSON.stringify(res)).not.toContain('approved');
    });

    it('lets an ADMIN look one up — the refusal is a permission, not a wall', async () => {
        actAs('admin-1', ['super_admin']);
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'other-app', {
            userId: 'other-user', status: 'approved', createdAt: '2026-01-01T00:00:00.000Z',
        });

        const { getWaveApplicationStatusAction } = await actions();
        expect(((await getWaveApplicationStatusAction('other-user')) as any).data)
            .toMatchObject({ status: 'approved' });
    });

    it('answers for the session user when no id is passed', async () => {
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'mine', {
            userId: APPLICANT, status: 'under_review', createdAt: '2026-01-01T00:00:00.000Z',
        });

        const { getWaveApplicationStatusAction } = await actions();
        expect(((await getWaveApplicationStatusAction()) as any).data)
            .toMatchObject({ status: 'under_review' });
    });

    it('accepts the caller naming their own id', async () => {
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'mine', {
            userId: APPLICANT, status: 'pending', createdAt: '2026-01-01T00:00:00.000Z',
        });

        const { getWaveApplicationStatusAction } = await actions();
        expect(((await getWaveApplicationStatusAction(APPLICANT)) as any).data)
            .toMatchObject({ status: 'pending' });
    });

    it('reports the MOST RECENT application when there are several', async () => {
        store.seedAll(COLLECTIONS.WAVE_APPLICATIONS, {
            old: { userId: APPLICANT, status: 'rejected', createdAt: '2025-01-01T00:00:00.000Z' },
            recent: { userId: APPLICANT, status: 'pending', createdAt: '2026-06-01T00:00:00.000Z' },
        });

        const { getWaveApplicationStatusAction } = await actions();
        expect(((await getWaveApplicationStatusAction()) as any).data)
            .toMatchObject({ status: 'pending' });
    });

    it('falls back to the registration when no application row can be found', async () => {
        // The branch that read `reg` into a variable and returned null anyway.
        seedUser({ serviceRegistrations: { wave: { status: 'pending', submittedAt: '2026-02-02T00:00:00.000Z' } } });

        const { getWaveApplicationStatusAction } = await actions();
        const res: any = await getWaveApplicationStatusAction();

        expect(res.data).toMatchObject({ status: 'pending' });
        expect(res.data.submittedAt).toBe('2026-02-02T00:00:00.000Z');
    });

    it('returns null when neither an application nor a registration exists', async () => {
        seedUser();
        const { getWaveApplicationStatusAction } = await actions();
        expect(await getWaveApplicationStatusAction()).toEqual({
            success: true, error: null, data: null,
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getWaveApplicationAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { getWaveApplicationAction } = await actions();
        expect(await getWaveApplicationAction()).toMatchObject({ success: false });
    });

    it('loads the application the user record points at', async () => {
        seedUser({ serviceRegistrations: { wave: { applicationId: 'app-1' } } });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'app-1', {
            userId: APPLICANT, surname: 'Obi', status: 'revision_required',
            revisionNote: 'Please re-upload your ID.',
        });

        const { getWaveApplicationAction } = await actions();
        const res: any = await getWaveApplicationAction();

        expect(res.success).toBe(true);
        expect(res.data).toMatchObject({ surname: 'Obi' });
        expect(res.meta).toEqual({ revisionNote: 'Please re-upload your ID.' });
    });

    it('finds it by query when the link is missing, and REPAIRS the link', async () => {
        seedUser();
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'orphan-app', {
            userId: APPLICANT, surname: 'Obi', createdAt: '2026-01-01T00:00:00.000Z',
        });

        const { getWaveApplicationAction } = await actions();
        expect((await getWaveApplicationAction() as any).success).toBe(true);

        expect(readUser()!.serviceRegistrations.wave.applicationId).toBe('orphan-app');
    });

    it('repairs a missing userId on the application it just read', async () => {
        seedUser({ serviceRegistrations: { wave: { applicationId: 'app-1' } } });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'app-1', { surname: 'Obi' });

        const { getWaveApplicationAction } = await actions();
        await getWaveApplicationAction();

        expect(store.get(COLLECTIONS.WAVE_APPLICATIONS, 'app-1')!.userId).toBe(APPLICANT);
    });

    it('takes the newest when the query finds several', async () => {
        seedUser();
        store.seedAll(COLLECTIONS.WAVE_APPLICATIONS, {
            old: { userId: APPLICANT, surname: 'Old', createdAt: '2025-01-01T00:00:00.000Z' },
            recent: { userId: APPLICANT, surname: 'Recent', createdAt: '2026-06-01T00:00:00.000Z' },
        });

        const { getWaveApplicationAction } = await actions();
        expect(((await getWaveApplicationAction()) as any).data.surname).toBe('Recent');
    });

    it('says so when there is nothing to load', async () => {
        seedUser();
        const { getWaveApplicationAction } = await actions();
        expect(await getWaveApplicationAction()).toMatchObject({
            success: false, error: 'No application found',
        });
    });

    it('falls back to the query when the linked id points at nothing', async () => {
        seedUser({ serviceRegistrations: { wave: { applicationId: 'deleted-app' } } });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'real-app', {
            userId: APPLICANT, surname: 'Obi', createdAt: '2026-01-01T00:00:00.000Z',
        });

        const { getWaveApplicationAction } = await actions();
        expect(((await getWaveApplicationAction()) as any).data.surname).toBe('Obi');
        expect(readUser()!.serviceRegistrations.wave.applicationId).toBe('real-app');
    });

    it('reads only the caller\'s own application', async () => {
        seedUser();
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'somebody-elses', {
            userId: 'other-user', surname: 'Nwosu', createdAt: '2026-01-01T00:00:00.000Z',
        });

        const { getWaveApplicationAction } = await actions();
        expect(await getWaveApplicationAction()).toMatchObject({
            success: false, error: 'No application found',
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('requestWaveRevisionAction', () => {
    beforeEach(() => {
        actAs('admin-1', ['admin']);
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'app-1', {
            userId: APPLICANT, status: 'pending',
        });
        seedUser({ serviceRegistrations: { wave: { status: 'pending', applicationId: 'app-1' } } });
    });

    it('refuses a non-admin', async () => {
        actAs(APPLICANT, ['user']);
        const { requestWaveRevisionAction } = await actions();
        expect(await requestWaveRevisionAction('app-1', 'Please redo')).toMatchObject({ success: false });
        expect(claimStatusTransitionFromAny).not.toHaveBeenCalled();
    });

    it('ADMITS THE WAVE ADMIN, WHO HOLDS wave:approve_applications', async () => {
        // #265 A hand-written `admin || super_admin` pair refused the role the
        // module exists for, while the rest of the WAVE admin surface admits it.
        actAs('wave-admin-1', ['wave_admin']);
        const { requestWaveRevisionAction } = await actions();

        expect(await requestWaveRevisionAction('app-1', 'Please redo')).toMatchObject({ success: true });
    });

    it('and still refuses an admin of a different module', async () => {
        actAs('academy-admin-1', ['academy_admin']);
        const { requestWaveRevisionAction } = await actions();

        expect(await requestWaveRevisionAction('app-1', 'Please redo')).toMatchObject({ success: false });
        expect(claimStatusTransitionFromAny).not.toHaveBeenCalled();
    });

    it('refuses an application that does not exist', async () => {
        const { requestWaveRevisionAction } = await actions();
        expect(await requestWaveRevisionAction('nope', 'Please redo')).toMatchObject({
            success: false, error: 'Application not found',
        });
    });

    it('claims the transition only from an undecided status', async () => {
        // The guard #-- added: this was an existence check and an unconditional
        // write, so it could overwrite an approval or a rejection.
        const { requestWaveRevisionAction } = await actions();
        await requestWaveRevisionAction('app-1', 'Please redo');

        const args = (claimStatusTransitionFromAny.mock.calls[0] as any[])[0];
        expect(args.fromAny).toEqual(['pending', 'under_review', 'revision_required']);
        expect(args.to).toBe('revision_required');
        expect(args.collection).toBe(COLLECTIONS.WAVE_APPLICATIONS);
        expect(args.patch.revisionNote).toBe('Please redo');
        expect(args.patch.revisionRequestedBy).toBe('admin-1');
        expect(args.recordPreviousAs).toBe('statusBeforeRevisionRequest');
    });

    it('mirrors the status onto the user record when the claim succeeds', async () => {
        const { requestWaveRevisionAction } = await actions();
        expect(await requestWaveRevisionAction('app-1', 'Please redo')).toMatchObject({ success: true });

        expect(readUser()!.serviceRegistrations.wave.status).toBe('revision_required');
    });

    it('reports the current status and writes nothing when the claim is refused', async () => {
        claimStatusTransitionFromAny.mockImplementation(async () =>
            ({ claimed: false, status: 'approved', exists: true }));

        const { requestWaveRevisionAction } = await actions();
        const res: any = await requestWaveRevisionAction('app-1', 'Please redo');

        expect(res.success).toBe(false);
        expect(res.error).toContain("'approved'");
        // The user record is untouched, so a live member is not half-revoked.
        expect(readUser()!.serviceRegistrations.wave.status).toBe('pending');
    });

    it('distinguishes a missing status from a missing document', async () => {
        claimStatusTransitionFromAny.mockImplementation(async () =>
            ({ claimed: false, status: null, exists: true }));

        const { requestWaveRevisionAction } = await actions();
        expect(((await requestWaveRevisionAction('app-1', 'Please redo')) as any).error)
            .toContain('no status recorded');

        claimStatusTransitionFromAny.mockImplementation(async () =>
            ({ claimed: false, status: null, exists: false }));
        expect(((await requestWaveRevisionAction('app-1', 'Please redo')) as any).error)
            .toBe('Application not found');
    });

    it('does not fall over when the application carries no userId', async () => {
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'orphan', { status: 'pending' });
        const { requestWaveRevisionAction } = await actions();
        expect(await requestWaveRevisionAction('orphan', 'Please redo')).toMatchObject({ success: true });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('resubmitWaveApplicationAction', () => {
    function seedResubmittable(status = 'revision_required'): void {
        seedUser({ serviceRegistrations: { wave: { status, applicationId: 'app-1' } } });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'app-1', {
            userId: APPLICANT, status, revisionNote: 'Please redo',
        });
    }

    it('refuses a caller with no session', async () => {
        actAs(null);
        const { resubmitWaveApplicationAction } = await actions();
        expect(await resubmitWaveApplicationAction(form())).toMatchObject({ success: false });
    });

    it('refuses a form that fails the schema', async () => {
        seedResubmittable();
        const { resubmitWaveApplicationAction } = await actions();
        expect(((await resubmitWaveApplicationAction(form({ accountNumber: '1' }))) as any).success)
            .toBe(false);
    });

    it('refuses when the user record names no application', async () => {
        seedUser();
        const { resubmitWaveApplicationAction } = await actions();
        expect(await resubmitWaveApplicationAction(form())).toMatchObject({
            success: false, error: 'No existing application found to resubmit',
        });
    });

    it('refuses from a status that is neither pending nor revision_required', async () => {
        seedResubmittable('approved');
        const { resubmitWaveApplicationAction } = await actions();
        expect(await resubmitWaveApplicationAction(form())).toMatchObject({
            success: false,
            error: 'Only applications in pending or revision_required status can be resubmitted',
        });
        expect(claimStatusTransitionFromAny).not.toHaveBeenCalled();
    });

    it('runs the SAME duplicate gate as enrolment (finding #32)', async () => {
        // This path had no duplicate check at all, so an applicant asked for
        // revisions could return with somebody else's phone number.
        seedResubmittable();
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'foreign-app', {
            userId: 'someone-else', phone: '+2348012345678', status: 'pending',
        });

        const { resubmitWaveApplicationAction } = await actions();
        const res: any = await resubmitWaveApplicationAction(form());

        expect(res.success).toBe(false);
        expect(res.error).toContain('different account');
        expect(claimStatusTransitionFromAny).not.toHaveBeenCalled();
    });

    it('excludes the applicant\'s OWN pending row from the status half of that gate', async () => {
        // Without ignoreApplicationId the shared check would refuse every
        // resubmission with "your application is currently pending".
        seedResubmittable('pending');
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'app-1', {
            userId: APPLICANT, phone: '+2348012345678', status: 'pending',
        });

        const { resubmitWaveApplicationAction } = await actions();
        expect(await resubmitWaveApplicationAction(form())).toMatchObject({ success: true });
    });

    it('still refuses a FOREIGN owner sharing the identity, exclusion or not', async () => {
        seedResubmittable('pending');
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'app-1', {
            userId: APPLICANT, phone: '+2348012345678', status: 'pending',
        });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'foreign-app', {
            userId: 'someone-else', phone: '+2348012345678', status: 'rejected',
        });

        const { resubmitWaveApplicationAction } = await actions();
        expect(((await resubmitWaveApplicationAction(form())) as any).error)
            .toContain('different account');
    });

    it('claims the APPLICATION\'s status, not the user record\'s copy', async () => {
        seedResubmittable();
        const { resubmitWaveApplicationAction } = await actions();
        await resubmitWaveApplicationAction(form());

        const args = (claimStatusTransitionFromAny.mock.calls[0] as any[])[0];
        expect(args.collection).toBe(COLLECTIONS.WAVE_APPLICATIONS);
        expect(args.id).toBe('app-1');
        expect(args.fromAny).toEqual(['revision_required', 'pending']);
        expect(args.to).toBe('pending');
        expect(args.allowSameStatus).toBe(true);
    });

    it('refuses when the application has since been decided, whatever the user record says', async () => {
        // The user record still reads revision_required; the application is
        // approved. Letting the stale copy win undid an admin decision from the
        // applicant's side.
        seedResubmittable();
        claimStatusTransitionFromAny.mockImplementation(async () =>
            ({ claimed: false, status: 'approved', exists: true }));

        const { resubmitWaveApplicationAction } = await actions();
        const res: any = await resubmitWaveApplicationAction(form());

        expect(res.success).toBe(false);
        expect(res.error).toContain("'approved'");
        expect(store.get(COLLECTIONS.WAVE_APPLICATIONS, 'app-1')!.status).toBe('revision_required');
    });

    it('updates the application and clears the revision note', async () => {
        seedResubmittable();
        const { resubmitWaveApplicationAction } = await actions();
        expect(await resubmitWaveApplicationAction(form({ currentOccupation: 'Exporter' })))
            .toMatchObject({ success: true });

        const app = store.get(COLLECTIONS.WAVE_APPLICATIONS, 'app-1')!;
        expect(app).toMatchObject({ status: 'pending', currentOccupation: 'Exporter' });
        expect(app.revisionNote).toBeNull();
        expect(typeof app.resubmittedAt).toBe('string');
    });

    it('puts the user record back to pending', async () => {
        seedResubmittable();
        const { resubmitWaveApplicationAction } = await actions();
        await resubmitWaveApplicationAction(form());

        expect(readUser()!.serviceRegistrations.wave.status).toBe('pending');
    });

    it('hashes the identity numbers here too', async () => {
        seedResubmittable();
        const { resubmitWaveApplicationAction } = await actions();
        await resubmitWaveApplicationAction(form());

        expect(store.get(COLLECTIONS.WAVE_APPLICATIONS, 'app-1')!.nin).toBe(sha256('12345678901'));
        expect(readUser()!.kyc.bvn).toBe(sha256('22233344455'));
    });

    it('does not rewrite a stored gender on resubmission either', async () => {
        // This path runs NO eligibility check, so without the set-once rule a
        // male applicant could rewrite his gender on every resubmission.
        seedUser({
            gender: 'Male',
            serviceRegistrations: { wave: { status: 'revision_required', applicationId: 'app-1' } },
        });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'app-1', { userId: APPLICANT, status: 'revision_required' });

        const { resubmitWaveApplicationAction } = await actions();
        expect(await resubmitWaveApplicationAction(form())).toMatchObject({ success: true });
        expect(readUser()!.gender).toBe('Male');
    });

    it('does not overwrite a stored date of birth on resubmission either', async () => {
        seedUser({
            dateOfBirth: '1990-01-01',
            serviceRegistrations: { wave: { status: 'pending', applicationId: 'app-1' } },
        });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'app-1', { userId: APPLICANT, status: 'pending' });

        const { resubmitWaveApplicationAction } = await actions();
        await resubmitWaveApplicationAction(form());

        expect(readUser()!.dateOfBirth).toBe('1990-01-01');
    });

    it('leaves an existing KYC verification alone when resubmitting without a BVN', async () => {
        // The old code wrote `applicantBvn ? true : false`, so filling in LESS
        // of the form downgraded the applicant.
        seedUser({
            kyc: { bvnVerified: true, ninVerified: true },
            serviceRegistrations: { wave: { status: 'pending', applicationId: 'app-1' } },
        });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'app-1', { userId: APPLICANT, status: 'pending' });

        const { resubmitWaveApplicationAction } = await actions();
        await resubmitWaveApplicationAction(form({ bvn: '', nin: '' }));

        expect(readUser()!.kyc.bvnVerified).toBe(true);
        expect(readUser()!.kyc.ninVerified).toBe(true);
    });
});
