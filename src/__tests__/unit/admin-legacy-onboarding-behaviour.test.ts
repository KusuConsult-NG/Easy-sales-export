/**
 * @jest-environment node
 */

/**
 * Legacy member onboarding, EXECUTED — the admin screen that pre-registers
 * somebody who already exists in the business but not on the platform.
 *
 * At 9.1%, and it is the single most consequential write in the admin surface:
 * one call creates an authentication identity, a user document marked verified
 * with `isVerifiedBadge: true`, and APPROVED registrations with
 * `paymentStatus: "completed"` across up to six modules — plus the module
 * documents behind them. It grants, in one action, everything the paid
 * enrolment flows exist to gate.
 *
 * Which is why the identity resolution matters. Before writing anything it has
 * to decide WHICH account this is, across an auth record and any number of
 * Firestore documents sharing the email, and then migrate the child documents
 * of whichever it discards. Getting that wrong either creates a duplicate
 * account or deletes a real one. None of it had ever run in a test.
 *
 * WHAT IS MOCKED
 * --------------
 * `adminAuth` (jest.setup.js's Firebase surface, reprogrammed per test) and
 * `requireAdmin`, which calls `auth()` directly rather than through the session
 * guard. The permission decision itself is NOT mocked — it runs against the
 * real PERMISSION_MATRIX, because "which roles may do this" is the thing worth
 * checking.
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

const sendLegacyMemberWelcomeEmail = jest.fn(
    async (_to: string, _name: string, _pin: string) => ({ success: true, error: null as string | null }));
jest.mock('@/lib/email-notifications', () => ({
    sendLegacyMemberWelcomeEmail: (to: string, name: string, pin: string) =>
        sendLegacyMemberWelcomeEmail(to, name, pin),
    sendEmail: jest.fn(async () => undefined),
}));

const requireAdmin = jest.fn(async () => ({ userId: 'admin-1' } as { userId: string } | { error: string }));
jest.mock('@/lib/require-admin', () => ({
    requireAdmin: () => requireAdmin(),
}));

jest.mock('@/lib/auth', () => ({
    auth: async () => ({ user: { id: 'admin-1', roles: ['super_admin'] } }),
    signIn: async () => undefined,
    signOut: async () => undefined,
    handlers: {},
}));

let store: FakeDbHandle;

const ADMIN = 'admin-1';
const NEW_UID = 'auth-uid-1';

type Globals = {
    mockAdminAuthGetUserByEmail: { mockImplementation: (f: (email: string) => unknown) => void };
    mockAdminAuthCreateUser: {
        mockImplementation: (f: (props: Record<string, unknown>) => unknown) => void;
        mock: { calls: unknown[][] };
    };
    mockRequireSession: { mockImplementation: (f: () => unknown) => void };
};
const g = () => globalThis as unknown as Globals;

function actAs(id: string | null, roles: string[] = ['super_admin']): void {
    g().mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : { session: { user: { id, roles, email: `${id}@example.com`, name: id } }, error: null },
    ));
}

/** No Firebase Auth record exists for this email yet. */
function noAuthRecord(): void {
    g().mockAdminAuthGetUserByEmail.mockImplementation(() =>
        Promise.reject(new Error('auth/user-not-found')));
    g().mockAdminAuthCreateUser.mockImplementation((props: Record<string, unknown>) =>
        Promise.resolve({ uid: (props.uid as string) || NEW_UID, ...props }));
}

/** An auth record already exists, under `uid`. */
function existingAuthRecord(uid: string): void {
    g().mockAdminAuthGetUserByEmail.mockImplementation((email: string) =>
        Promise.resolve({ uid, email, disabled: false }));
}

beforeEach(() => {
    jest.clearAllMocks();
    sendLegacyMemberWelcomeEmail.mockImplementation(async () => ({ success: true, error: null }));
    requireAdmin.mockImplementation(async () => ({ userId: ADMIN }));
    store = installFakeDb();
    actAs(ADMIN);
    noAuthRecord();
});

async function actions() {
    return import('@/app/actions/admin/_legacy');
}

function form(overrides: Record<string, unknown> = {}): any {
    return {
        fullName: 'Ada Chidinma Obi',
        email: 'Ada@Example.com',
        phone: '08012345678',
        gender: 'Female',
        dateOfBirth: '1994-05-10',
        occupation: 'Trader',
        roles: ['cooperative_member'],
        state: 'Plateau',
        lga: 'Jos North',
        city: 'Jos',
        address: '12 Market Road, Jos',
        accountNumber: '0123456789',
        bankName: 'Zenith',
        accountName: 'Ada Obi',
        bankCode: '057',
        nin: '12345678901',
        ...overrides,
    };
}

const onboard = async (data?: any) =>
    (await (await actions()).onboardLegacyMemberAction(data ?? form())) as any;

const user = (uid = NEW_UID) => store.get(COLLECTIONS.USERS, uid) as Record<string, any>;

// ─────────────────────────────────────────────────────────────────────────────
describe('inviteLegacyMemberAction', () => {
    it('is DEPRECATED and refuses, whoever asks', async () => {
        // The whole body is commented out. Pinned because the cooperative invite
        // issuer is a real capability the platform lost, and a test saying so is
        // how the loss stays visible rather than being rediscovered from a
        // support ticket.
        const { inviteLegacyMemberAction } = await actions();
        expect(await inviteLegacyMemberAction({ email: 'ada@example.com' }))
            .toMatchObject({ success: false, error: 'Method deprecated' });
        expect(store.collections()).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('onboardLegacyMemberAction — who may do it', () => {
    it('refuses when requireAdmin refuses', async () => {
        requireAdmin.mockImplementation(async () => ({ error: 'Unauthenticated' }));
        expect(await onboard()).toMatchObject({ success: false, error: 'Unauthenticated' });
        expect(store.collections()).toEqual([]);
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await onboard()).toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('refuses a role without users:create', async () => {
        actAs('mod-1', ['moderator']);
        store.seed(COLLECTIONS.USERS, 'mod-1', { roles: ['moderator'] });

        expect(await onboard()).toMatchObject({
            success: false, error: 'Unauthorized: Permission users:create required',
        });
    });

    it('admits an ADMIN, who holds users:create', async () => {
        // #62. The permission was absent from the `admin` role, and that absence
        // was an oversight rather than a policy: the role's own comment
        // enumerates what it is denied — deletion, impersonation, config
        // rollback — and creation is not among them. This screen is its only
        // caller, and an admin opening it was refused a task the role owns while
        // keeping users:update and users:assign_roles, which are wider.
        actAs('admin-2', ['admin']);
        expect((await onboard()).success).toBe(true);
    });

    it('REFUSES a plain admin onboarding somebody with admin roles (finding #87)', async () => {
        // The third role-writer, and the one with no escalation guard.
        // admin-permissions.ts's includesPrivilegedRole exists because both
        // role-writing endpoints accepted whatever list they were handed, and
        // its header names them: bulkAssignRolesAction and
        // updateUserRolesAction. This is a third — `data.roles` is written
        // wholesale onto the user document, LegacyOnboardingSchema accepts
        // "admin" and "super_admin" as values, and the only gate is
        // `users:create`, which PERMISSION_MATRIX gives to plain `admin`.
        //
        // So an admin could open this screen, type any email address, tick
        // super_admin, and mint an account holding exactly the permissions the
        // matrix withholds from them — on a new identity rather than their own,
        // which is if anything harder to notice.
        actAs('admin-2', ['admin']);

        expect(await onboard(form({ roles: ['cooperative_member', 'super_admin'] })))
            .toMatchObject({
                success: false,
                error: 'Only a super admin can onboard a member with admin roles',
            });
        expect(store.get(COLLECTIONS.USERS, NEW_UID)).toBeUndefined();
    });

    it('and refuses plain "admin" too', async () => {
        actAs('admin-2', ['admin']);
        expect(((await onboard(form({ roles: ['admin'] }))) as any).success).toBe(false);
    });

    it('a SUPER ADMIN may — the refusal is a permission, not a wall', async () => {
        expect((await onboard(form({ roles: ['cooperative_member', 'admin'] }))).success).toBe(true);
        expect(user().roles).toEqual(['cooperative_member', 'admin']);
    });

    it('and a plain admin may still onboard an ordinary member', async () => {
        actAs('admin-2', ['admin']);
        expect((await onboard(form({ roles: ['cooperative_member'] }))).success).toBe(true);
    });

    it('re-reads the roles from the database when the session is stale', async () => {
        actAs('promoted-1', ['user']);
        store.seed(COLLECTIONS.USERS, 'promoted-1', { roles: ['super_admin'] });

        expect((await onboard()).success).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('onboardLegacyMemberAction — validation', () => {
    it('requires at least one role', async () => {
        expect(((await onboard(form({ roles: [] }))) as any).error)
            .toBe('At least one role is required');
        expect(store.collections()).toEqual([]);
    });

    it('refuses an account number that is not ten digits', async () => {
        expect(((await onboard(form({ accountNumber: '123' }))) as any).error)
            .toContain('10 digits');
    });

    it('refuses an invalid email', async () => {
        expect(((await onboard(form({ email: 'not-an-email' }))) as any).success).toBe(false);
    });

    it('LOWERCASES the email before doing anything with it', async () => {
        // Every reader in this codebase queries the lowercased form, and user
        // emails are lowercased at registration. A capital here would create an
        // account no lookup could find.
        await onboard(form({ email: 'Ada@Example.COM' }));
        expect(user().email).toBe('ada@example.com');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('onboardLegacyMemberAction — resolving the identity', () => {
    it('creates a new auth user when there is none, and links the document to it', async () => {
        expect((await onboard()).success).toBe(true);

        expect(user().uid).toBe(NEW_UID);
        expect(user().requiresPasswordChange).toBe(true);
    });

    it('adopts the UID of an existing Firestore document when there is no auth record', async () => {
        store.seed(COLLECTIONS.USERS, 'legacy-uid', { email: 'ada@example.com', fullName: 'Old' });

        await onboard();

        // The auth user is created WITH that uid, so the two stay aligned.
        const [props] = g().mockAdminAuthCreateUser.mock.calls[0] as [Record<string, unknown>];
        expect(props.uid).toBe('legacy-uid');
    });

    it('deletes duplicate stubs sharing the email, keeping the aligned one', async () => {
        existingAuthRecord('real-uid');
        store.seed(COLLECTIONS.USERS, 'real-uid', { email: 'ada@example.com', fullName: 'Real' });
        store.seed(COLLECTIONS.USERS, 'stub-a', { email: 'ada@example.com' });
        store.seed(COLLECTIONS.USERS, 'stub-b', { email: 'ada@example.com' });

        expect((await onboard()).success).toBe(true);

        expect(store.get(COLLECTIONS.USERS, 'real-uid')).toBeDefined();
        expect(store.get(COLLECTIONS.USERS, 'stub-a')).toBeUndefined();
        expect(store.get(COLLECTIONS.USERS, 'stub-b')).toBeUndefined();
    });

    it('MIGRATES an unaligned document onto the auth UID, then deletes it', async () => {
        // The auth record exists but no Firestore document carries its uid. The
        // legacy document's data is moved rather than dropped — losing it would
        // lose the member's history.
        existingAuthRecord('real-uid');
        store.seed(COLLECTIONS.USERS, 'old-uid', {
            email: 'ada@example.com', savingsHistoryNote: 'kept', fullName: 'Old',
        });

        expect((await onboard()).success).toBe(true);

        expect(store.get(COLLECTIONS.USERS, 'real-uid')!.savingsHistoryNote).toBe('kept');
        expect(store.get(COLLECTIONS.USERS, 'old-uid')).toBeUndefined();
    });

    it('and migrates the module documents that hung off the old UID', async () => {
        existingAuthRecord('real-uid');
        store.seed(COLLECTIONS.USERS, 'old-uid', { email: 'ada@example.com' });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'old-uid', {
            userId: 'old-uid', savingsBalance: 125000,
        });
        store.seed(COLLECTIONS.WAVE_MEMBERS, 'old-uid', { userId: 'old-uid', points: 40 });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'legacy_old-uid', {
            userId: 'old-uid', status: 'approved',
        });

        await onboard(form({ roles: ['cooperative_member'] }));

        const migrated = store.get(COLLECTIONS.COOPERATIVE_MEMBERS, 'real-uid')!;
        expect(migrated.userId).toBe('real-uid');
        // The savings balance survives the move — the whole point of migrating
        // rather than recreating.
        expect(migrated.savingsBalance).toBe(125000);

        expect(store.get(COLLECTIONS.WAVE_MEMBERS, 'real-uid')!.points).toBe(40);
        expect(store.get(COLLECTIONS.WAVE_MEMBERS, 'old-uid')).toBeUndefined();

        expect(store.get(COLLECTIONS.ACADEMY_APPLICATIONS, 'legacy_real-uid')!.userId)
            .toBe('real-uid');
        expect(store.get(COLLECTIONS.ACADEMY_APPLICATIONS, 'legacy_old-uid')).toBeUndefined();
    });

    it('adopts a UID matched by PHONE when the email found nothing', async () => {
        store.seed(COLLECTIONS.USERS, 'phone-uid', {
            email: 'ada@example.com', phone: '08012345678',
        });

        await onboard(form({ email: 'ada@example.com' }));

        const [props] = g().mockAdminAuthCreateUser.mock.calls[0] as [Record<string, unknown>];
        expect(props.uid).toBe('phone-uid');
    });

    it('but does NOT adopt one whose phone matches under a DIFFERENT email', async () => {
        // Two people sharing a phone number is a data-quality problem, not a
        // reason to merge their accounts.
        store.seed(COLLECTIONS.USERS, 'somebody-else', {
            email: 'ngozi@example.com', phone: '08012345678',
        });

        await onboard();

        const [props] = g().mockAdminAuthCreateUser.mock.calls[0] as [Record<string, unknown>];
        expect(props.uid).toBeUndefined();
        expect(store.get(COLLECTIONS.USERS, 'somebody-else')!.email).toBe('ngozi@example.com');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('onboardLegacyMemberAction — what it provisions', () => {
    it('writes a verified user document carrying the structured name', async () => {
        await onboard();

        expect(user()).toMatchObject({
            fullName: 'Ada Chidinma Obi',
            firstName: 'Ada',
            otherName: 'Chidinma',
            lastName: 'Obi',
            email: 'ada@example.com',
            phone: '08012345678',
            isVerified: true,
            verified: true,
            isVerifiedBadge: true,
            onboardingCompleted: true,
            legacyOnboardedBy: ADMIN,
        });
    });

    it('handles a single-word name without inventing a surname', async () => {
        await onboard(form({ fullName: 'Ada' }));

        expect(user()).toMatchObject({ firstName: 'Ada', lastName: '' });
        expect(user().otherName).toBeUndefined();
    });

    it('records the address under every key the app reads it from', async () => {
        await onboard();

        expect(user()).toMatchObject({
            stateOfOrigin: 'Plateau', lga: 'Jos North', residentialAddress: '12 Market Road, Jos',
        });
        expect(user().address).toMatchObject({
            street: '12 Market Road, Jos', city: 'Jos', state: 'Plateau',
            lga: 'Jos North', country: 'Nigeria',
        });
    });

    it('marks the KYC verified only for the numbers actually supplied', async () => {
        await onboard(form({ nin: '12345678901', bvn: '' }));

        expect(user()).toMatchObject({ ninVerified: true, bvnVerified: false });
    });

    it('omits next of kin and bank details entirely when none were given', async () => {
        await onboard(form({ accountNumber: undefined, accountName: undefined }));

        expect(user().nextOfKin).toBeUndefined();
        expect(user().bankDetails).toBeUndefined();
    });

    it('grants a cooperative membership under BOTH key spellings, with a real member record', async () => {
        await onboard(form({ roles: ['cooperative_member'] }));

        const registrations = user().serviceRegistrations;
        expect(registrations.cooperative).toMatchObject({ status: 'approved', paymentStatus: 'completed' });
        expect(registrations.cooperatives).toMatchObject({ status: 'approved' });

        const member = store.get(COLLECTIONS.COOPERATIVE_MEMBERS, NEW_UID)!;
        expect(member).toMatchObject({
            userId: NEW_UID, membershipStatus: 'active', paymentStatus: 'completed',
            isLegacy: true, onboardingCompleted: true,
        });
        // A brand-new member starts at zero on all three, not at whatever a
        // previous document said.
        expect(member.savingsBalance).toBe(0);
        expect(member.loanBalance).toBe(0);
        expect(member.totalContributions).toBe(0);
    });

    it('grants Farm Nation under BOTH key spellings, because the readers disagree', async () => {
        await onboard(form({ roles: ['farmer'] }));

        const registrations = user().serviceRegistrations;
        expect(registrations.farmNation).toMatchObject({ status: 'approved' });
        expect(registrations.farm_nation).toMatchObject({ status: 'approved' });
        expect(store.get(COLLECTIONS.FARM_NATION_APPLICATIONS, `legacy_${NEW_UID}`))
            .toMatchObject({ userId: NEW_UID, status: 'approved' });
    });

    it('provisions the marketplace seller records for a seller', async () => {
        await onboard(form({ roles: ['seller'] }));

        expect(user().serviceRegistrations.marketplace)
            .toMatchObject({ status: 'approved', accountType: 'seller' });
        expect(store.get(COLLECTIONS.SELLER_VERIFICATIONS, `legacy_${NEW_UID}`))
            .toMatchObject({ userId: NEW_UID, status: 'approved', _isLegacy: true });
        expect(store.get(COLLECTIONS.VENDOR_SETTINGS, NEW_UID)!.userId).toBe(NEW_UID);
    });

    it('is "both" when the member is a seller AND a buyer', async () => {
        await onboard(form({ roles: ['seller', 'marketplace_buyer'] }));
        expect(user().serviceRegistrations.marketplace.accountType).toBe('both');
    });

    it('is "buyer" for a buyer alone, and the verification stays pending', async () => {
        await onboard(form({ roles: ['marketplace_buyer'] }));
        expect(user().serviceRegistrations.marketplace.accountType).toBe('buyer');
        expect(store.get(COLLECTIONS.SELLER_VERIFICATIONS, `legacy_${NEW_UID}`)).toBeUndefined();
    });

    it('provisions the academy enrolment AND the application, on the chosen plan', async () => {
        await onboard(form({ roles: ['academy_participant'], academyPlan: 'elite' }));

        expect(user().serviceRegistrations.academy).toMatchObject({
            status: 'approved', plan: 'elite', paymentStatus: 'completed',
        });
        expect(store.get(COLLECTIONS.ACADEMY_ENROLLMENTS, NEW_UID)).toMatchObject({
            plan: 'elite', status: 'active', paymentAmount: 0, _isLegacy: true,
        });
        expect(store.get(COLLECTIONS.ACADEMY_APPLICATIONS, `legacy_${NEW_UID}`)).toMatchObject({
            status: 'approved', plan: 'elite', reviewedBy: ADMIN,
        });
    });

    it('defaults the academy plan to foundation', async () => {
        await onboard(form({ roles: ['academy_participant'] }));
        expect(user().serviceRegistrations.academy.plan).toBe('foundation');
    });

    it('provisions the export application, filling the company details it was not given', async () => {
        await onboard(form({ roles: ['export_participant'] }));

        const app = store.get(COLLECTIONS.EXPORT_APPLICATIONS, `legacy_${NEW_UID}`)!;
        expect(app).toMatchObject({ userId: NEW_UID, status: 'approved', approvedBy: ADMIN });
        expect(app.companyInfo).toMatchObject({
            companyName: "Ada's Export Co.", rcNumber: 'LEGACY-N/A',
        });
    });

    it('provisions the WAVE application and the member profile', async () => {
        await onboard(form({ roles: ['wave_participant'] }));

        expect(store.get(COLLECTIONS.WAVE_APPLICATIONS, `legacy_${NEW_UID}`)).toMatchObject({
            userId: NEW_UID, status: 'approved', userEmail: 'ada@example.com',
        });
        expect(store.get(COLLECTIONS.WAVE_MEMBERS, NEW_UID)).toMatchObject({
            userId: NEW_UID, status: 'active', tier: 'standard', points: 0,
        });
    });

    it('provisions NOTHING for a module the member was not given', async () => {
        // The boundary. One call grants approved, paid registrations across
        // every module named — so the modules NOT named must stay empty.
        await onboard(form({ roles: ['cooperative_member'] }));

        const registrations = user().serviceRegistrations;
        expect(registrations.academy).toBeUndefined();
        expect(registrations.wave).toBeUndefined();
        expect(registrations.export).toBeUndefined();
        expect(registrations.marketplace).toBeUndefined();
        expect(store.size(COLLECTIONS.WAVE_MEMBERS)).toBe(0);
        expect(store.size(COLLECTIONS.ACADEMY_ENROLLMENTS)).toBe(0);
        expect(store.size(COLLECTIONS.EXPORT_APPLICATIONS)).toBe(0);
        expect(store.size(COLLECTIONS.SELLER_VERIFICATIONS)).toBe(0);
    });

    it('grants a module through the SERVICES flag as well as through a role', async () => {
        await onboard(form({ roles: ['cooperative_member'], services: { wave: true } }));

        expect(user().serviceRegistrations.wave).toMatchObject({ status: 'approved' });
        expect(store.get(COLLECTIONS.WAVE_MEMBERS, NEW_UID)).toBeDefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('onboardLegacyMemberAction — the welcome email', () => {
    it('sends the temporary PIN to a NEW member', async () => {
        const res = await onboard();

        expect(res.success).toBe(true);
        expect(sendLegacyMemberWelcomeEmail).toHaveBeenCalledTimes(1);

        const [to, name, pin] = sendLegacyMemberWelcomeEmail.mock.calls[0] as [string, string, string];
        expect(to).toBe('ada@example.com');
        expect(name).toBe('Ada Chidinma Obi');
        expect(pin).toMatch(/^\d{6}$/);
        expect(res.message).toContain('Default PIN sent');
    });

    it('does NOT send one to somebody who already had an account', async () => {
        existingAuthRecord('real-uid');
        store.seed(COLLECTIONS.USERS, 'real-uid', { email: 'ada@example.com' });

        const res = await onboard();
        expect(sendLegacyMemberWelcomeEmail).not.toHaveBeenCalled();
        expect(res.message).toContain('successfully updated');
        expect(store.get(COLLECTIONS.USERS, 'real-uid')!.requiresPasswordChange).toBeUndefined();
    });

    it('still succeeds when the email fails, and hands the admin the PIN to pass on', async () => {
        sendLegacyMemberWelcomeEmail.mockImplementation(async () =>
            ({ success: false, error: 'smtp down' }));

        const res = await onboard();
        expect(res.success).toBe(true);
        expect(res.message).toContain('welcome email failed to send');
        expect(res.message).toMatch(/\d{6}/);
        // ...and the member exists, which is what makes handing over the PIN
        // useful rather than misleading.
        expect(user().email).toBe('ada@example.com');
    });

    it('and when it throws outright', async () => {
        sendLegacyMemberWelcomeEmail.mockImplementation(async () => { throw new Error('boom'); });

        const res = await onboard();
        expect(res.success).toBe(true);
        expect(res.message).toContain('welcome email failed to send');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Finding #84 — a re-run zeroed the money.
 *
 * Every provisioning block is a `set(..., { merge: true })`, and `merge`
 * protects the fields a payload OMITS, not the fields it NAMES. The payloads
 * named `savingsBalance: 0`, `loanBalance: 0`, `totalContributions: 0`,
 * `points: 0`, `paymentAmount: 0` and a fresh `createdAt`, unconditionally.
 *
 * So running this screen a second time on somebody who is already a
 * cooperative member — to add a module, correct a phone number, attach a
 * document — set their savings balance, loan balance and lifetime
 * contributions to ZERO and reported "successfully updated". It is also
 * reachable through the migration path: an unaligned document is moved to the
 * auth UID with its balances intact, and then this zeroed them.
 *
 * The zeroes are correct for a member who does not exist yet, which is why the
 * controls below matter as much as the refusals.
 */
describe('re-onboarding an existing member (finding #84)', () => {
    beforeEach(() => {
        existingAuthRecord('existing-uid');
        store.seed(COLLECTIONS.USERS, 'existing-uid', {
            email: 'ada@example.com', phone: '08012345678',
        });
    });

    it('does NOT zero a cooperative member\'s savings, loans or contributions', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'existing-uid', {
            userId: 'existing-uid',
            savingsBalance: 125_000,
            loanBalance: 40_000,
            totalContributions: 300_000,
            createdAt: '2024-03-04T00:00:00.000Z',
        });

        expect((await onboard(form({ roles: ['cooperative_member'] }))).success).toBe(true);

        const member = store.get(COLLECTIONS.COOPERATIVE_MEMBERS, 'existing-uid')!;
        expect(member.savingsBalance).toBe(125_000);
        expect(member.loanBalance).toBe(40_000);
        expect(member.totalContributions).toBe(300_000);
        // ...and their join date is not reset either.
        expect(member.createdAt).toBe('2024-03-04T00:00:00.000Z');
    });

    it('but DOES start a brand-new member at zero — the guard is not a blanket skip', async () => {
        expect((await onboard(form({ roles: ['cooperative_member'] }))).success).toBe(true);

        const member = store.get(COLLECTIONS.COOPERATIVE_MEMBERS, 'existing-uid')!;
        expect(member.savingsBalance).toBe(0);
        expect(member.loanBalance).toBe(0);
        expect(member.totalContributions).toBe(0);
        expect(typeof member.createdAt).toBe('string');
    });

    it('still updates everything a re-run is FOR', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'existing-uid', {
            userId: 'existing-uid', savingsBalance: 125_000,
            phone: '08000000000', membershipStatus: 'pending',
        });

        await onboard(form({ roles: ['cooperative_member'], phone: '08099998888' }));

        const member = store.get(COLLECTIONS.COOPERATIVE_MEMBERS, 'existing-uid')!;
        expect(member.phone).toBe('08099998888');
        expect(member.membershipStatus).toBe('active');
        expect(member.savingsBalance).toBe(125_000);
    });

    it('does not reset a WAVE member\'s points or join date', async () => {
        store.seed(COLLECTIONS.WAVE_MEMBERS, 'existing-uid', {
            userId: 'existing-uid', points: 340, tier: 'gold',
            joinDate: '2024-03-04T00:00:00.000Z',
        });

        await onboard(form({ roles: ['wave_participant'] }));

        const member = store.get(COLLECTIONS.WAVE_MEMBERS, 'existing-uid')!;
        expect(member.points).toBe(340);
        expect(member.tier).toBe('gold');
        expect(member.joinDate).toBe('2024-03-04T00:00:00.000Z');
    });

    it('and starts a new WAVE member at zero points on the standard tier', async () => {
        await onboard(form({ roles: ['wave_participant'] }));

        expect(store.get(COLLECTIONS.WAVE_MEMBERS, 'existing-uid'))
            .toMatchObject({ points: 0, tier: 'standard' });
    });

    it('does not reset what an academy learner actually paid', async () => {
        store.seed(COLLECTIONS.ACADEMY_ENROLLMENTS, 'existing-uid', {
            userId: 'existing-uid', paymentAmount: 270_000,
            enrolledAt: '2024-03-04T00:00:00.000Z',
        });

        await onboard(form({ roles: ['academy_participant'], academyPlan: 'elite' }));

        const enrolment = store.get(COLLECTIONS.ACADEMY_ENROLLMENTS, 'existing-uid')!;
        expect(enrolment.paymentAmount).toBe(270_000);
        expect(enrolment.enrolledAt).toBe('2024-03-04T00:00:00.000Z');
        // ...while the plan the admin selected still takes effect.
        expect(enrolment.plan).toBe('elite');
    });

    it('and starts a new enrolment at zero', async () => {
        await onboard(form({ roles: ['academy_participant'] }));
        expect(store.get(COLLECTIONS.ACADEMY_ENROLLMENTS, 'existing-uid')!.paymentAmount).toBe(0);
    });

    it('preserves the balances a MIGRATION just moved onto the new UID', async () => {
        // The two paths compose: the migration carries the member's history to
        // the auth UID, and the provisioning below it used to wipe what had
        // just arrived.
        //
        // The migration only runs when NO document already carries the auth
        // UID — otherwise the stubs are simply deleted — so this starts from an
        // empty store rather than the shared seed above.
        store.clear();
        store.seed(COLLECTIONS.USERS, 'old-uid', { email: 'ada@example.com' });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'old-uid', {
            userId: 'old-uid', savingsBalance: 125_000, totalContributions: 300_000,
        });

        expect((await onboard(form({ roles: ['cooperative_member'] }))).success).toBe(true);

        const member = store.get(COLLECTIONS.COOPERATIVE_MEMBERS, 'existing-uid')!;
        expect(member.userId).toBe('existing-uid');
        expect(member.savingsBalance).toBe(125_000);
        expect(member.totalContributions).toBe(300_000);
        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, 'old-uid')).toBeUndefined();
    });
});
