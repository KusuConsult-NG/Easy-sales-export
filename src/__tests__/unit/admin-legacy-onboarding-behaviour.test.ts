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
        nin: '22107458391',
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

    it('AND KEEPS THEM WHEN THERE IS NO AUTH RECORD EITHER — the branch that copied nothing', async () => {
        /*
         *   #681 THE MOST DESTRUCTIVE OF THE THREE SITES, AND THE ONE NOTHING
         *   COVERED. A mutant that restored the delete here SURVIVED the first
         *   run.
         *
         *   With no auth record there is no identity to match, so the old code
         *   took `emailCheck.docs[0]` as the person and deleted every other row
         *   OUTRIGHT — no merge, no copy, unlike the branch above it. Whichever
         *   row the database listed first became the member; the rest were
         *   gone, with whatever they held.
         *
         *   The existing coverage for this branch seeded exactly ONE document,
         *   so the deletion never had anything to delete.
         */
        store.seed(COLLECTIONS.USERS, 'aaa-first', { email: 'ada@example.com' });
        store.seed(COLLECTIONS.USERS, 'bbb-history', {
            email: 'ada@example.com',
            savingsHistoryNote: 'REAL MONEY',
        });

        expect((await onboard()).success).toBe(true);

        const first = store.get(COLLECTIONS.USERS, 'aaa-first');
        const history = store.get(COLLECTIONS.USERS, 'bbb-history');

        expect(first).toBeDefined();
        expect(history).toBeDefined();
        //   Nothing was destroyed, and the row that did not win says which one did.
        expect(history!.savingsHistoryNote).toBe('REAL MONEY');
        const winner = store.get(COLLECTIONS.USERS, 'aaa-first')!._migratedTo
            ? 'bbb-history' : 'aaa-first';
        const loser = winner === 'aaa-first' ? 'bbb-history' : 'aaa-first';
        expect(store.get(COLLECTIONS.USERS, loser)!._migratedTo).toBe(winner);
    });

    it('SUPERSEDES duplicate rows sharing the email rather than deleting them', async () => {
        /*
         *   #681 THIS USED TO ASSERT THE DELETION, AND THE ASSERTION PASSED
         *   BECAUSE THE FIXTURE WAS EMPTY.
         *
         *   The old expectation was `store.get(..., 'stub-a')` is undefined —
         *   the rows were removed with `cleanBatch.delete(doc.ref)`, and
         *   NOTHING IN THAT BRANCH COPIED THEIR CONTENTS ANYWHERE FIRST. The
         *   test agreed because `stub-a` and `stub-b` were seeded as
         *   `{ email }` and there was nothing in them to lose.
         *
         *   MEASURED: seeding `stub-a` with a savings note and a
         *   cooperative_member role and running the OLD code, the test still
         *   passed and the data was gone. A control whose verdict depends on
         *   the fixture being harmless is not a control.
         *
         *   So the fixture carries data now, and the rows are kept. They are
         *   marked `_migratedTo` — the same tombstone `migrateLegacyUserData`
         *   writes (#490) and `profile-choice.ts` already knows to skip, so the
         *   login path, the ghost scan and the forensic behave exactly as they
         *   do for any migrated member. This is not a new contract.
         *
         *   #300 settled the principle for erasure: a related row is MARKED and
         *   keeps its status, dates and balances, precisely so a payout still
         *   owed can still be found. The standing instruction for this codebase
         *   is the same, and it is the reason #675 exists.
         */
        existingAuthRecord('real-uid');
        store.seed(COLLECTIONS.USERS, 'real-uid', { email: 'ada@example.com', fullName: 'Real' });
        store.seed(COLLECTIONS.USERS, 'stub-a', {
            email: 'ada@example.com',
            savingsHistoryNote: 'REAL MONEY',
            roles: ['cooperative_member'],
        });
        store.seed(COLLECTIONS.USERS, 'stub-b', { email: 'ada@example.com' });

        expect((await onboard()).success).toBe(true);

        //   The row carrying the auth id is still the one that wins.
        expect(store.get(COLLECTIONS.USERS, 'real-uid')).toBeDefined();

        //   And the others survive, pointing at it.
        const a = store.get(COLLECTIONS.USERS, 'stub-a');
        const b = store.get(COLLECTIONS.USERS, 'stub-b');
        expect(a).toBeDefined();
        expect(b).toBeDefined();
        expect(a!._migratedTo).toBe('real-uid');
        expect(b!._migratedTo).toBe('real-uid');
        //   THE assertion the old test could not make: nothing was destroyed.
        expect(a!.savingsHistoryNote).toBe('REAL MONEY');
        expect(a!.roles).toEqual(['cooperative_member']);
    });

    it('MIGRATES an unaligned document onto the auth UID, and keeps the original', async () => {
        /*
         *   The auth record exists but no Firestore document carries its uid.
         *   The legacy document's data is moved — losing it would lose the
         *   member's history, which the previous version of this test already
         *   said.
         *
         *   #681 AND THE ORIGINAL IS NOW KEPT TOO. It was deleted once its data
         *   had been copied, which is defensible for ONE row and was not what
         *   the code did: it deleted every row sharing the address, having
         *   copied only the one it picked — and it picked `stubs[0]`, whichever
         *   the database listed first.
         *
         *   Keeping the tombstone is also what makes the copy auditable. "This
         *   row's contents were moved to that one" is a statement somebody can
         *   check later; a missing row is not.
         */
        existingAuthRecord('real-uid');
        store.seed(COLLECTIONS.USERS, 'old-uid', {
            email: 'ada@example.com', savingsHistoryNote: 'kept', fullName: 'Old',
        });

        expect((await onboard()).success).toBe(true);

        expect(store.get(COLLECTIONS.USERS, 'real-uid')!.savingsHistoryNote).toBe('kept');

        const original = store.get(COLLECTIONS.USERS, 'old-uid');
        expect(original).toBeDefined();
        expect(original!._migratedTo).toBe('real-uid');
        expect(original!.savingsHistoryNote).toBe('kept');
    });

    it('AND CHOOSES THE SURVIVOR BY EVIDENCE, NOT BY WHICHEVER ROW CAME BACK FIRST', async () => {
        /*
         *   #681 The branch above took `stubs[0]` of an unordered query as the
         *   source of truth and deleted the rest, so a member with three
         *   profiles kept whatever happened to be in one of them.
         *
         *   #476 and #477 built `chooseProfileForAuthAccount` for exactly this
         *   question — it prefers a row that IDENTIFIES itself with the account
         *   (`supabaseAuthId`, `_migratedTo`) over one that merely shares an
         *   address — and this path was not using it.
         *
         *   Seeded so the identifying row is NOT first: `aaa-empty` sorts ahead
         *   of it by id and carries nothing, which is what the old code would
         *   have copied forward.
         */
        existingAuthRecord('real-uid');
        store.seed(COLLECTIONS.USERS, 'aaa-empty', { email: 'ada@example.com' });
        store.seed(COLLECTIONS.USERS, 'zzz-real', {
            email: 'ada@example.com',
            supabaseAuthId: 'real-uid',
            savingsHistoryNote: 'the real history',
        });

        expect((await onboard()).success).toBe(true);

        //   The identifying row's data moved forward, not the empty one's.
        expect(store.get(COLLECTIONS.USERS, 'real-uid')!.savingsHistoryNote).toBe('the real history');
        //   And both originals survive.
        expect(store.get(COLLECTIONS.USERS, 'aaa-empty')).toBeDefined();
        expect(store.get(COLLECTIONS.USERS, 'zzz-real')).toBeDefined();
    });

    it('REFUSES to merge a module row onto one that already exists — measured at 50,000 to 0', async () => {
        /*
         *   #682 THE MODULE MIGRATION MERGED ONE MEMBERSHIP ROW ONTO ANOTHER
         *   AND THEN DELETED THE EVIDENCE.
         *
         *   Each of eight collections was moved with
         *
         *       set(target, { ...source.data() }, { merge: true })
         *       delete(source)
         *
         *   and `merge: true` means THE SOURCE'S FIELDS WIN. Nothing checked
         *   whether the target already existed.
         *
         *   MEASURED BEFORE BEING FIXED, against the real adapter: a
         *   cooperative_members row at the target holding savingsBalance 50000,
         *   merged with a source holding 0, came out at 0 — and the source was
         *   then deleted, so the only other copy of the number went with it.
         *   That collection carries savingsBalance and lockedBalance. This is a
         *   member's cooperative savings.
         *
         *   It is reachable: `oldUidToMigrate` is set when no USERS document
         *   carries the auth id, which says nothing at all about whether a
         *   cooperative_members or wave_members row does.
         *
         *   Two rows carrying a version of one person's record in one module is
         *   the judgement #490 says the platform has no basis for making
         *   unattended. Both are left alone and the operator is told.
         */
        existingAuthRecord('real-uid');
        store.seed(COLLECTIONS.USERS, 'old-uid', { email: 'ada@example.com' });
        //   The member's real balance, already at the destination.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'real-uid', {
            userId: 'real-uid', savingsBalance: 50000,
        });
        //   And an emptier row under the old id, which used to win.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'old-uid', {
            userId: 'old-uid', savingsBalance: 0,
        });

        /*
         *   THE REFUSAL HAS TO REACH SOMEBODY. A mutant that downgraded the
         *   log from `error` to `debug` SURVIVED the first run: every
         *   assertion about the DATA still passed, and the operator was left
         *   with two unreconciled rows and no way to learn of them. Refusing
         *   silently is its own version of the defect this file keeps finding.
         */
        const { logger } = await import('@/lib/logger');
        const errors = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

        try {
            expect((await onboard(form({ roles: ['cooperative_member'] }))).success).toBe(true);

            //   THE assertion. Before #682 this was 0.
            expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, 'real-uid')!.savingsBalance).toBe(50000);
            //   And the source is still there to be reconciled, not deleted.
            const source = store.get(COLLECTIONS.COOPERATIVE_MEMBERS, 'old-uid');
            expect(source).toBeDefined();
            expect(source!.savingsBalance).toBe(0);

            //   And it was said out loud, naming the collection and both ids so
            //   the two rows can actually be found.
            const said = errors.mock.calls.map((c) => String(c[0])).join('\n');
            expect(said).toContain('REFUSED to merge');
            expect(said).toContain(COLLECTIONS.COOPERATIVE_MEMBERS);
            expect(said).toContain('old-uid');
            expect(said).toContain('real-uid');
        } finally {
            errors.mockRestore();
        }
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
        await onboard(form({ nin: '22107458391', bvn: '' }));

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

    /**
     *   #290 THE SAME THREE OUTCOMES, AS FIELDS.
     *
     *        Everything above was already true and already tested. What was
     *        missing is that the outcome existed ONLY as English prose, so
     *        ImportLegacyModal — the only caller — read `success`, dropped the
     *        rest, and printed one hardcoded sentence for all three cases. For
     *        the failed-email case that sentence claimed the email had been
     *        sent AND destroyed the temporary PIN, which is the only way into
     *        the account that had just been created.
     *
     *        message is deliberately unchanged; the four assertions above still
     *        pin it. See legacy-onboarding-outcome.render.test.tsx for what the
     *        admin now sees.
     */
    it('#290 reports isNewUser/emailSent as FIELDS, not only in the prose', async () => {
        const res: any = await onboard();

        expect({ isNewUser: res.isNewUser, emailSent: res.emailSent }).toEqual({
            isNewUser: true, emailSent: true,
        });
        // Nothing to hand over, so nothing is handed over.
        expect(res.temporaryPassword).toBeNull();
    });

    it('#290 RETURNS THE PIN AS A FIELD when the email failed', async () => {
        sendLegacyMemberWelcomeEmail.mockImplementation(async () =>
            ({ success: false, error: 'smtp down' }));

        const res: any = await onboard();

        expect(res.emailSent).toBe(false);
        expect(res.temporaryPassword).toMatch(/^\d{6}$/);
        // It is the same PIN the prose has always embedded, not a second one.
        expect(res.message).toContain(res.temporaryPassword);
        // And the same one the member's account was created with.
        const [, , sentPin] = sendLegacyMemberWelcomeEmail.mock.calls[0] as [string, string, string];
        expect(res.temporaryPassword).toBe(sentPin);
    });

    it('#290 says an EXISTING member got no email, and hands over no PIN', async () => {
        // The case with no send at all. A screen that cannot tell this apart
        // tells the admin an email went out to somebody nothing was sent to.
        existingAuthRecord('real-uid');
        store.seed(COLLECTIONS.USERS, 'real-uid', { email: 'ada@example.com' });

        const res: any = await onboard();

        expect({ isNewUser: res.isNewUser, emailSent: res.emailSent }).toEqual({
            isNewUser: false, emailSent: false,
        });
        // Their existing password stands, so there is no PIN to reveal — and
        // revealing one would be worse than saying nothing.
        expect(res.temporaryPassword).toBeNull();
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


// ─────────────────────────────────────────────────────────────────────────────
describe('#684 — a re-import does not rewrite the dates it already wrote', () => {
    /*
     *   The repair that stopped this screen re-initialising somebody reached
     *   THREE provisioning blocks of ten. The MONEY half landed where it
     *   mattered — savingsBalance, loanBalance, totalContributions and points
     *   are all guarded. The DATES were not: six blocks went on writing
     *   `createdAt: serverTimestamp()` unconditionally, and the academy
     *   application also rewrote `submittedAt`.
     *
     *   The comment stating the rule already named "a fresh `createdAt`" and
     *   "their join dates" as part of the defect, and was then applied to a
     *   third of the places it names. That is the shape this audit files more
     *   often than any other.
     *
     *   WHAT IT COSTS. `submittedAt` is what the registrant screens ORDER BY,
     *   so re-importing a member to correct a phone number moved their
     *   application to the front of somebody's review queue. `createdAt` is
     *   tenure — what "member since" reads. No money moves; history is
     *   rewritten silently, on a screen whose whole purpose is to be re-run.
     */
    const ORIGINAL = '2023-01-15T09:00:00.000Z';

    it.each([
        ['seller verification', COLLECTIONS.SELLER_VERIFICATIONS, 'legacy_real-uid', ['seller']],
        ['vendor settings', COLLECTIONS.VENDOR_SETTINGS, 'real-uid', ['seller']],
        ['academy application', COLLECTIONS.ACADEMY_APPLICATIONS, 'legacy_real-uid', ['academy_participant']],
        ['export application', COLLECTIONS.EXPORT_APPLICATIONS, 'legacy_real-uid', ['export_participant']],
        ['wave application', COLLECTIONS.WAVE_APPLICATIONS, 'legacy_real-uid', ['wave_participant']],
        ['farm nation application', COLLECTIONS.FARM_NATION_APPLICATIONS, 'legacy_real-uid', ['farmer']],
    ])('KEEPS THE ORIGINAL createdAt ON THE %s', async (_name, collection, docId, roles) => {
        existingAuthRecord('real-uid');
        store.seed(COLLECTIONS.USERS, 'real-uid', { email: 'ada@example.com' });
        store.seed(collection as string, docId as string, { userId: 'real-uid', createdAt: ORIGINAL });

        expect((await onboard(form({ roles }))).success).toBe(true);

        expect(store.get(collection as string, docId as string)!.createdAt).toBe(ORIGINAL);
    });

    it('AND THE ACADEMY APPLICATION KEEPS ITS submittedAt, WHICH THE REVIEW QUEUE ORDERS BY', async () => {
        existingAuthRecord('real-uid');
        store.seed(COLLECTIONS.USERS, 'real-uid', { email: 'ada@example.com' });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'legacy_real-uid', {
            userId: 'real-uid', submittedAt: ORIGINAL, createdAt: ORIGINAL,
        });

        await onboard(form({ roles: ['academy_participant'] }));

        expect(store.get(COLLECTIONS.ACADEMY_APPLICATIONS, 'legacy_real-uid')!.submittedAt).toBe(ORIGINAL);
    });

    it('AND A NEW RECORD STILL GETS ITS DATES — right for somebody who does not exist yet', async () => {
        /*
         *   THE control, and the reason `initialOnly` is not simply "never
         *   write these". A first import has to stamp them, or every legacy
         *   member arrives with no creation date and every screen that orders
         *   by one loses them.
         */
        existingAuthRecord('real-uid');
        store.seed(COLLECTIONS.USERS, 'real-uid', { email: 'ada@example.com' });

        await onboard(form({ roles: ['academy_participant'] }));

        const app = store.get(COLLECTIONS.ACADEMY_APPLICATIONS, 'legacy_real-uid')!;
        expect(app.createdAt).toBeDefined();
        expect(app.submittedAt).toBeDefined();
    });

    it('AND EVERY PROVISIONING BLOCK THAT STAMPS A DATE GUARDS IT', () => {
        /*
         *   The ratchet. The original repair was applied by hand to the blocks
         *   somebody happened to look at, and a seventh block added tomorrow
         *   would inherit the same omission.
         *
         *   Sound because it is narrow: it reads ONE file, splits it on the
         *   `.set(` calls that provision a document, and asks of each whether a
         *   date it stamps sits inside an `initialOnly`. The answer set is ten
         *   and every one has been read by hand.
         */
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/admin/_legacy.ts'), 'utf8');

        const DATES = ['createdAt', 'submittedAt', 'joinDate', 'enrolledAt'];
        const blocks = [...src.matchAll(/\b\w*[Bb]atch\.set\([\s\S]*?\}, \{ merge: true \}\);/g)]
            .map((m) => m[0])
            //   The migration mover is not a provisioning block: it copies a
            //   document wholesale and stamps nothing of its own.
            .filter((b) => !b.includes('...docSnap.data()'));

        //   The control: a regex that matched no blocks would report no
        //   offenders and mean nothing.
        expect(blocks.length).toBeGreaterThanOrEqual(9);

        const offenders: string[] = [];
        for (const block of blocks) {
            const guardAt = block.indexOf('...initialOnly(');
            for (const field of DATES) {
                const at = block.indexOf(`${field}: FieldValue.serverTimestamp()`);
                if (at < 0) continue;
                if (guardAt < 0 || at < guardAt) {
                    offenders.push(`${field} in ${block.slice(0, 60).replace(/\s+/g, ' ')}`);
                }
            }
        }

        expect({ offenders }).toEqual({ offenders: [] });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#685 — an import adds roles, it does not remove them', () => {
    /*
     *   `roles: data.roles` is written with `set(..., { merge: true })`, and
     *   merge protects fields the payload OMITS — an array it NAMES is replaced
     *   outright. ImportLegacyModal builds that array from its own checkboxes,
     *   whose initial state ticks ONLY THE MODULE THE ADMIN OPENED IT FROM. It
     *   never reads the person being imported.
     *
     *   So importing an existing cooperative member from the WAVE screen
     *   rewrote their roles to ["general_user", "wave_participant"].
     *
     *   WHAT IT COSTS, measured against the readers rather than assumed: their
     *   MONEY IS SAFE — canTransactAsMember reads the membership ROW's status,
     *   and checkModuleAccess Layer 2 reads serviceRegistrations, which is
     *   deep-merged and survives. What they lose is being COUNTED and CONTACTED
     *   as that kind of member: the broadcast audiences and the forensic
     *   samples both key on `roles array-contains cooperative_member`.
     *
     *   user-migration.ts already merges roles by UNION, precisely so a
     *   migration cannot remove what somebody already holds. Two paths, one
     *   contract, disagreeing.
     */
    it('KEEPS A ROLE THE FORM DID NOT TICK', async () => {
        existingAuthRecord('real-uid');
        store.seed(COLLECTIONS.USERS, 'real-uid', {
            email: 'ada@example.com',
            roles: ['general_user', 'cooperative_member', 'academy_participant'],
        });

        //   The WAVE screen: only wave is ticked.
        expect((await onboard(form({ roles: ['general_user', 'wave_participant'] }))).success).toBe(true);

        const roles = store.get(COLLECTIONS.USERS, 'real-uid')!.roles as string[];
        expect([...roles].sort()).toEqual(
            ['academy_participant', 'cooperative_member', 'general_user', 'wave_participant'],
        );
    });

    it('AND STILL APPLIES THE ONES IT WAS ASKED FOR', async () => {
        /*
         *   THE control on the line above. A "fix" that simply kept whatever
         *   was already there would satisfy "keeps a role the form did not
         *   tick" and leave the screen unable to grant anything — which is the
         *   whole reason an admin opens it.
         *
         *   A DISJOINT request, so the union has to carry both sides rather
         *   than getting the answer right by overlap.
         */
        existingAuthRecord('real-uid');
        store.seed(COLLECTIONS.USERS, 'real-uid', {
            email: 'ada@example.com',
            roles: ['cooperative_member'],
        });

        expect((await onboard(form({ roles: ['wave_participant'] }))).success).toBe(true);

        const roles = store.get(COLLECTIONS.USERS, 'real-uid')!.roles as string[];
        expect([...roles].sort()).toEqual(['cooperative_member', 'wave_participant']);
    });

    it('AND A NEW MEMBER GETS EXACTLY WHAT WAS TICKED', async () => {
        //   Nothing to preserve, so the union is the request. Without this, a
        //   bug that always returned the existing roles would pass the first
        //   test and give every new import an empty role set.
        existingAuthRecord('new-uid');

        await onboard(form({ roles: ['general_user', 'farmer'] }));

        const roles = store.get(COLLECTIONS.USERS, 'new-uid')!.roles as string[];
        expect([...roles].sort()).toEqual(['farmer', 'general_user']);
    });

    it('AND THE UNION CANNOT SMUGGLE IN A PRIVILEGED ROLE', async () => {
        /*
         *   The security half. The escalation guard tests `data.roles` — what
         *   was REQUESTED — and the union only ever adds what the target
         *   already holds, so it cannot grant anything. Asserted rather than
         *   reasoned about, because "the union preserves an existing admin" and
         *   "the union grants admin" look the same from one test.
         *
         *   Requesting super_admin as a plain admin is still refused.
         *
         *   NOTE ON THE HARNESS, which cost me a red run: actAs() defaults its
         *   second argument to ['super_admin']. A test that means "a plain
         *   admin" must say so, or it asserts the opposite of what it reads
         *   like — the guard permits, correctly, and the test blames the union.
         */
        actAs('admin-2', ['admin']);
        existingAuthRecord('real-uid');
        store.seed(COLLECTIONS.USERS, 'real-uid', { email: 'ada@example.com', roles: ['general_user'] });

        const result = await onboard(form({ roles: ['general_user', 'super_admin'] }));

        expect(result.success).toBe(false);
        expect(String((result as any).error)).toMatch(/super admin/i);
        //   And nothing was written.
        expect((store.get(COLLECTIONS.USERS, 'real-uid')!.roles as string[])).toEqual(['general_user']);
    });

    it('AND A CORRUPT roles FIELD DOES NOT TRAVEL INTO THE UNION', async () => {
        /*
         *   The union reads whatever is on the record, and this platform has
         *   records written by three different generations of importer. A
         *   `roles` holding a null or an object is not hypothetical tidiness:
         *   every reader of this field does `array-contains`, and the writers
         *   compare with `includes` — a non-string sails through both and then
         *   sits in the array forever, because the union preserves it on every
         *   subsequent import.
         *
         *   PRESERVING IS THE WHOLE POINT OF THIS FIX, so what it preserves has
         *   to be sound. Without the filter this test found nothing — which is
         *   how the line came to be written and left unmeasured.
         */
        existingAuthRecord('real-uid');
        store.seed(COLLECTIONS.USERS, 'real-uid', {
            email: 'ada@example.com',
            roles: ['cooperative_member', null, { role: 'admin' }, 42],
        });

        expect((await onboard(form({ roles: ['wave_participant'] }))).success).toBe(true);

        const roles = store.get(COLLECTIONS.USERS, 'real-uid')!.roles as string[];
        expect([...roles].sort()).toEqual(['cooperative_member', 'wave_participant']);
    });

    it('AND PRESERVING A PRIVILEGED ROLE THE MEMBER ALREADY HELD IS NOT ESCALATION', async () => {
        /*
         *   The other side of the same coin, and the reason the line above is
         *   worth asserting rather than reasoning about: "the union preserved
         *   an admin who was already an admin" and "the union granted admin"
         *   produce the same final role set, and only the starting state tells
         *   them apart.
         *
         *   A plain admin re-importing an existing super admin does not strip
         *   them — which is exactly the removal this finding is about, and it
         *   would be the most consequential instance of it. The guard reads
         *   what was REQUESTED, so this is permitted, and the union keeps what
         *   was already there.
         */
        actAs('admin-2', ['admin']);
        existingAuthRecord('real-uid');
        store.seed(COLLECTIONS.USERS, 'real-uid', {
            email: 'ada@example.com',
            roles: ['general_user', 'super_admin'],
        });

        expect((await onboard(form({ roles: ['general_user', 'wave_participant'] }))).success).toBe(true);

        const roles = store.get(COLLECTIONS.USERS, 'real-uid')!.roles as string[];
        expect([...roles].sort()).toEqual(['general_user', 'super_admin', 'wave_participant']);
    });
});

/*
 * ── #685 MUTATION TESTING ───────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the form's checkboxes are written wholesale again   KILLED
 *     the union drops the roles that were actually requested          KILLED
 *     the existing roles are read from the payload, not the record    KILLED
 *     a brand-new member is seeded with a role nobody ticked          KILLED
 *     non-string entries in a corrupt roles array carry through       KILLED
 *     the escalation guard is removed                                 KILLED
 *     the guard tests the MERGED set, so preserving an existing
 *       super admin becomes a refusal                                 KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword the log line                                             SURVIVED ✓
 *
 *   ONE MUTANT WAS WITHDRAWN AS EQUIVALENT, recorded rather than chased:
 *   making a missing record yield `data.roles` as the "existing" set. The union
 *   of the requested roles with themselves is the requested roles, so there is
 *   no observable difference and no test could have killed it. The replacement
 *   above — seeding a missing record with `['admin']` — probes the same line
 *   with an observable consequence.
 *
 *   AND THE FIRST VERSION OF THE ESCALATION TEST WAS WRONG, WHICH IS WORTH
 *   RECORDING. It called requireAdmin's mock and expected a refusal, and got a
 *   success. The guard was right and the test was wrong: actAs() defaults its
 *   roles argument to ['super_admin'], so "the acting admin" in that test was a
 *   super admin, who may indeed grant super_admin. A test that means a PLAIN
 *   admin has to say so. The same default sits under every test in this file
 *   that does not pass a second argument.
 */

// ─────────────────────────────────────────────────────────────────────────────
describe('#686 — a re-import does not delete the details it was not given', () => {
    /*
     *   The behavioural half of the adapter finding in
     *   lib/__tests__/an-absent-value-is-not-a-deletion.test.ts, and the reason
     *   that one matters. This user document carries three optional maps:
     *
     *       nextOfKin:    (name || phone)      ? { … } : undefined
     *       bankDetails:  accountNumber        ? { … } : undefined
     *       documents:    (validId || photo …) ? { … } : undefined
     *
     *   written with `batch.set(ref, userDoc, { merge: true })`. `undefined`
     *   used to reach the database as a DELETION, so whatever the admin did not
     *   retype was removed from the member's record.
     *
     *   THE FORM IS WHY THIS IS THE ORDINARY CASE RATHER THAN AN EDGE ONE.
     *   ImportLegacyModal opens empty every time — it never reads the person
     *   being imported, which is the same root as #685 — so an admin correcting
     *   somebody's phone number re-submitted blank document URLs and a blank
     *   next of kin along with it.
     *
     *   THE ID DOCUMENTS ARE THE WORST OF THE THREE. The Cloudinary asset
     *   survives, because #675 guards that, but the only record of its URL was
     *   the field being deleted. An asset nobody can find again is barely
     *   better off than a destroyed one, and it is harder to notice — the
     *   storage bill still says it is there.
     */
    const withDetails = () => {
        existingAuthRecord('real-uid');
        store.seed(COLLECTIONS.USERS, 'real-uid', {
            email: 'ada@example.com',
            roles: ['cooperative_member'],
            bankDetails: { accountNumber: '0123456789', bankName: 'Zenith', accountName: 'Ada Obi' },
            nextOfKin: { name: 'Chidi Obi', phone: '08099999999', relationship: 'Brother' },
            documents: {
                validId: { url: 'https://res.cloudinary.com/x/id.jpg', name: 'ID Document' },
                passportPhoto: { url: 'https://res.cloudinary.com/x/photo.jpg', name: 'Passport Photo' },
            },
        });
    };

    /**
     *   The modal's untouched form, reproduced exactly. ImportLegacyModal sends
     *   `...(formData.accountNumber ? { accountNumber: … } : {})` for every one
     *   of these — it OMITS the key rather than sending a blank string, which
     *   it must, because the schema marks them `.optional()` and would reject
     *   `""` against `/^\d{10}$/` and against `z.string().url()`.
     *
     *   So the value the action sees is `undefined`, and `undefined` is what
     *   used to reach the database as a deletion. Building this by DELETING
     *   keys rather than blanking them is the whole point: my first version
     *   passed empty strings, the schema refused the write, and three tests
     *   failed for a reason that had nothing to do with the finding.
     */
    const OPTIONAL_KEYS = [
        'accountNumber', 'accountName', 'bankName', 'bankCode',
        'nextOfKinName', 'nextOfKinPhone', 'nextOfKinRelationship', 'nextOfKinAddress',
        'validIdUrl', 'passportPhotoUrl', 'proofOfAddressUrl',
    ];
    const blankForm = (overrides: Record<string, unknown> = {}): any => {
        const f = form();
        for (const k of OPTIONAL_KEYS) delete f[k];
        return { ...f, ...overrides };
    };

    it('KEEPS THE BANK ACCOUNT PAYOUTS GO TO', async () => {
        withDetails();
        expect((await onboard(blankForm())).success).toBe(true);

        expect(store.get(COLLECTIONS.USERS, 'real-uid')!.bankDetails)
            .toEqual({ accountNumber: '0123456789', bankName: 'Zenith', accountName: 'Ada Obi' });
    });

    it('KEEPS THE NEXT OF KIN A COOPERATIVE LOAN IS GUARANTEED AGAINST', async () => {
        withDetails();
        expect((await onboard(blankForm())).success).toBe(true);

        expect(store.get(COLLECTIONS.USERS, 'real-uid')!.nextOfKin)
            .toMatchObject({ name: 'Chidi Obi', phone: '08099999999' });
    });

    it('KEEPS THE RECORD POINTING AT THE UPLOADED ID', async () => {
        //   The standing rule for this codebase is that nothing is destroyed.
        //   Deleting the URL is how an asset gets destroyed in practice without
        //   anything being deleted in Cloudinary.
        withDetails();
        expect((await onboard(blankForm())).success).toBe(true);

        const docs = store.get(COLLECTIONS.USERS, 'real-uid')!.documents;
        expect(docs?.validId?.url).toBe('https://res.cloudinary.com/x/id.jpg');
        expect(docs?.passportPhoto?.url).toBe('https://res.cloudinary.com/x/photo.jpg');
    });

    it('AND STILL WRITES THEM WHEN THE ADMIN DOES SUPPLY THEM', async () => {
        /*
         *   THE control. "Never write these fields" would satisfy all three
         *   assertions above and break the screen — this is the form an admin
         *   uses to ATTACH a member's documents in the first place.
         */
        withDetails();
        expect((await onboard(blankForm({
            accountNumber: '9876543210',
            bankName: 'GTB',
            validIdUrl: 'https://res.cloudinary.com/x/new-id.jpg',
        }))).success).toBe(true);

        const after = store.get(COLLECTIONS.USERS, 'real-uid')!;
        expect(after.bankDetails.accountNumber).toBe('9876543210');
        expect(after.documents.validId.url).toBe('https://res.cloudinary.com/x/new-id.jpg');
        //   And the merge keeps the half the new payload did not name.
        expect(after.documents.passportPhoto.url).toBe('https://res.cloudinary.com/x/photo.jpg');
    });

    it('AND A BRAND-NEW MEMBER WITH NO DETAILS GETS NO EMPTY SHELLS', async () => {
        //   The other control: skipping undefined must not become "write {}".
        //   An empty map reads as truthy, so a screen doing `if (user.documents)`
        //   would render a documents panel with nothing in it.
        existingAuthRecord('fresh-uid');
        await onboard(blankForm());

        const after = store.get(COLLECTIONS.USERS, 'fresh-uid')!;
        expect(after.bankDetails).toBeUndefined();
        expect(after.nextOfKin).toBeUndefined();
        expect(after.documents).toBeUndefined();
    });
});
