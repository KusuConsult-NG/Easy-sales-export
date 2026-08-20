/**
 * @jest-environment node
 */

/**
 * The admin USER management surface, EXECUTED — the user table behind
 * /admin/users, the verification toggles, the KYC toggles, the role editor and
 * the account unlock.
 *
 * At 40%, and the uncovered 60% is `getUsersAction`, which is the single most
 * defensive reader in the codebase. It exists because this platform's user
 * documents come from at least four schema generations, and it has to produce
 * one table row from any of them:
 *
 *   - a name from firstName/lastName, or fullName, or name, or a module's
 *     profile — REJECTING the placeholders "User"/"Unknown"/"N/A" that the
 *     ghost-account auto-repair wrote before April 2026;
 *   - a state and LGA that may be a string, a nested address, or an OBJECT
 *     (which crashes React if it reaches the table);
 *   - KYC from `kyc.*` or the legacy top-level fields;
 *   - `isVerified ?? verified ?? false`, because 34k+ legacy users have
 *     `verified: true` and no `isVerified` — which is why the status filter is
 *     applied in MEMORY and not in the query;
 *   - and a deduplication by email, because session-guard's ghost repair
 *     created second documents for real people.
 *
 * Every one of those is a fallback chain, and a fallback chain is exactly what
 * a call-recorder harness cannot check: the query returned a stub, so the chain
 * ran on data the test wrote by hand and proved nothing about the shapes the
 * database actually holds.
 *
 * THE ROLE EDITOR IS THE SECURITY BOUNDARY
 * ----------------------------------------
 * `updateUserRolesAction` writes the roles array wholesale, and the role schema
 * accepts "admin" and "super_admin" as values. The self-demotion guard does not
 * catch privilege ESCALATION, because adding a role is not removing one — so an
 * admin calling it on their own id with ["super_admin"] passed. The rule that
 * closes it is asserted here in both directions.
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

const resetLoginAttempts = jest.fn(async (_email: string) => undefined);
jest.mock('@/lib/rate-limit', () => ({
    resetLoginAttempts: (email: string) => resetLoginAttempts(email),
    checkLoginAttempts: async () => ({ allowed: true, remaining: 5 }),
    recordFailedLogin: async () => undefined,
}));

let store: FakeDbHandle;

const USERS = COLLECTIONS.USERS;

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
    resetLoginAttempts.mockImplementation(async () => undefined);
    store = installFakeDb();
    actAs('admin-1');
});

async function actions() {
    return import('@/app/actions/admin/_users');
}

function seedUser(id: string, extra: Record<string, unknown> = {}): void {
    store.seed(USERS, id, {
        email: `${id}@example.com`,
        firstName: 'Ada',
        lastName: 'Obi',
        phone: '08012345678',
        roles: ['general_user'],
        createdAt: '2026-01-01T00:00:00.000Z',
        ...extra,
    });
}

const listUsers = async (options?: any) =>
    (await (await actions()).getUsersAction(options)) as any;
const rows = (res: any) => (res.data as any[]).map((u) => u.id);
const read = (id: string) => store.get(USERS, id) as Record<string, any>;

// ─────────────────────────────────────────────────────────────────────────────
describe('getUsersAction — who may read it', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await listUsers()).toMatchObject({ success: false });
    });

    it('refuses a role without users:read, and says which roles it saw', async () => {
        // The message names the roles on purpose: the commonest cause is a stale
        // JWT after a promotion, and "sign out and back in" is the fix.
        actAs('user-1', ['user']);
        const res = await listUsers();

        expect(res.success).toBe(false);
        expect(res.error).toContain('users:read');
        expect(res.error).toContain('[user]');
    });

    it('names "none" rather than an empty bracket for a session with no roles', async () => {
        actAs('user-1', []);
        expect(((await listUsers()) as any).error).toContain('none');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getUsersAction — deriving a row from any schema generation', () => {
    it('builds a name from firstName and lastName', async () => {
        seedUser('u1', { firstName: 'Ada', lastName: 'Obi' });
        expect((await listUsers()).data[0].name).toBe('Ada Obi');
    });

    it('falls back to fullName', async () => {
        seedUser('u1', { firstName: undefined, lastName: undefined, fullName: 'Ngozi Eze' });
        expect((await listUsers()).data[0].name).toBe('Ngozi Eze');
    });

    it('then to the AUTH display name held in `name` (finding #85)', async () => {
        // The mapper's own comment names this schema generation as supported,
        // and the chain read `displayName` and never `name` — so with no
        // firstName and no fullName it fell through to the PHONE NUMBER, while
        // cooperative/_coop_identity.ts, admin/_marketplace.ts and
        // lib/seller-trust.ts all resolve the same field to a name.
        seedUser('u1', { firstName: undefined, lastName: undefined, name: 'Chidi Okafor' });
        expect((await listUsers()).data[0].name).toBe('Chidi Okafor');
    });

    it('and only then to the phone number, and then the email', async () => {
        // The control: `name` did not displace the fallbacks, it joined ahead of
        // them.
        seedUser('u1', { firstName: undefined, lastName: undefined, phone: '08012345678' });
        expect((await listUsers()).data[0].name).toBe('08012345678');

        store.clear();
        seedUser('u2', {
            firstName: undefined, lastName: undefined, phone: undefined,
            email: 'ada@example.com',
        });
        expect((await listUsers()).data[0].name).toBe('ada@example.com');
    });

    it('does not take a PLACEHOLDER `name` over the phone number', async () => {
        seedUser('u1', { firstName: undefined, lastName: undefined, name: 'Unknown' });
        expect((await listUsers()).data[0].name).toBe('08012345678');
    });

    it.each(['User', 'Unknown', 'Unknown User', 'N/A', ''])(
        'REJECTS the placeholder %p written by the ghost-account repair', async (placeholder) => {
            seedUser('u1', {
                firstName: placeholder, lastName: placeholder, fullName: placeholder,
                name: placeholder, email: 'ada@example.com',
            });

            const [row] = (await listUsers()).data;
            expect(row.name).not.toBe(placeholder);
        });

    it('recovers a real name from a module registration when the top level is a placeholder', async () => {
        seedUser('u1', {
            firstName: 'User', lastName: undefined, fullName: 'Unknown',
            serviceRegistrations: {
                wave: { status: 'approved', profile: { firstName: 'Ngozi', lastName: 'Eze' } },
            },
        });

        const [row] = (await listUsers()).data;
        expect(row.firstName).toBe('Ngozi');
        expect(row.lastName).toBe('Eze');
    });

    it('reads the state and LGA from a nested address', async () => {
        seedUser('u1', {
            state: undefined, lga: undefined,
            address: { state: 'Plateau', lga: 'Jos North', street: '12 Market Road' },
        });

        expect((await listUsers()).data[0]).toMatchObject({ state: 'Plateau', lga: 'Jos North' });
    });

    it('FLATTENS a state stored as an object, which would otherwise crash the table', async () => {
        // React throws on an object rendered as a child. A user document with
        // `address.state = { state: "Plateau" }` took the whole admin users page
        // down rather than showing one odd row.
        seedUser('u1', { address: { state: { state: 'Plateau' }, lga: { name: 'Jos North' } } });

        const [row] = (await listUsers()).data;
        expect(row.state).toBe('Plateau');
        expect(row.lga).toBe('Jos North');
        expect(typeof row.state).toBe('string');
    });

    it('and reports an empty string for a state it cannot flatten', async () => {
        seedUser('u1', { address: { state: { unexpected: true } } });

        const [row] = (await listUsers()).data;
        expect(row.state).toBe('');
        expect(row.lga).toBe('');
    });

    it('prefers the nested kyc.* fields and falls back to the legacy top level', async () => {
        seedUser('nested', {
            kyc: { bvn: 'HASH-A', bvnVerified: true, nin: 'HASH-B', ninVerified: false, status: 'pending' },
            bvn: 'IGNORED',
        });
        seedUser('legacy', {
            bvn: 'HASH-C', bvnVerified: true, nin: 'HASH-D', ninVerified: true,
            createdAt: '2026-02-01T00:00:00.000Z',
        });

        const byId = Object.fromEntries(((await listUsers()).data as any[]).map((u) => [u.id, u]));
        expect(byId.nested).toMatchObject({ bvn: 'HASH-A', bvnVerified: true, ninVerified: false });
        expect(byId.legacy).toMatchObject({ bvn: 'HASH-C', bvnVerified: true, ninVerified: true });
    });

    it('treats "verified" as verified, for the 34k legacy users with no isVerified', async () => {
        seedUser('legacy', { isVerified: undefined, verified: true });
        seedUser('modern', { isVerified: true, createdAt: '2026-02-01T00:00:00.000Z' });
        seedUser('neither', { createdAt: '2026-03-01T00:00:00.000Z' });

        const byId = Object.fromEntries(((await listUsers()).data as any[]).map((u) => [u.id, u]));
        expect(byId.legacy.isVerified).toBe(true);
        expect(byId.modern.isVerified).toBe(true);
        expect(byId.neither.isVerified).toBe(false);
    });

    it('synthesises bank details from the loose fields when there is no bankDetails object', async () => {
        seedUser('u1', {
            bankName: 'Zenith', bankAccountNumber: '0123456789', bankAccountName: 'Ada Obi',
        });

        expect((await listUsers()).data[0].bankDetails).toMatchObject({
            bankName: 'Zenith', accountNumber: '0123456789', accountName: 'Ada Obi',
        });
    });

    it('falls back to the derived name for an account name nobody recorded', async () => {
        seedUser('u1', { firstName: 'Ada', lastName: 'Obi', bankName: 'Zenith' });
        expect((await listUsers()).data[0].bankDetails.accountName).toBe('Ada Obi');
    });

    it('finds a gender recorded on a module registration', async () => {
        seedUser('u1', {
            gender: undefined,
            serviceRegistrations: { wave: { status: 'approved', profile: { gender: 'female' } } },
        });

        expect((await listUsers()).data[0].gender).toBe('female');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getUsersAction — modules, deduplication and filters', () => {
    it('derives the modules a user is enrolled in, under either Farm Nation spelling', async () => {
        seedUser('u1', {
            serviceRegistrations: {
                academy: { status: 'approved' },
                farm_nation: { status: 'active' },
                wave: { status: 'rejected' },
            },
        });

        const [row] = (await listUsers()).data;
        expect((row.activeModules as string[]).sort()).toEqual(['academy', 'farm-nation']);
        expect(row.moduleCount).toBe(2);
    });

    it('counts a SUSPENDED registration as enrolled, because they are still a member', async () => {
        seedUser('u1', { serviceRegistrations: { cooperatives: { status: 'suspended' } } });
        expect((await listUsers()).data[0].activeModules).toEqual(['cooperatives']);
    });

    it('does not count a registration in a status nobody recognises', async () => {
        seedUser('u1', { serviceRegistrations: { academy: { status: 'withdrawn' } } });
        expect((await listUsers()).data[0].activeModules).toEqual([]);
    });

    it('DEDUPLICATES by email, keeping the richer document', async () => {
        // session-guard's ghost repair created second documents for real people.
        // Showing both makes the admin table lie about how many users exist.
        seedUser('ghost', {
            email: 'ada@example.com', firstName: 'User', lastName: undefined,
            phone: undefined, serviceRegistrations: undefined,
        });
        seedUser('real', {
            email: 'ada@example.com', firstName: 'Ada', lastName: 'Obi',
            phone: '08012345678', bvn: 'HASH', nin: 'HASH2',
            serviceRegistrations: { academy: { status: 'approved' } },
            createdAt: '2026-02-01T00:00:00.000Z',
        });

        const res = await listUsers();
        expect(res.data).toHaveLength(1);
        expect(res.data[0].id).toBe('real');
    });

    it('breaks a richness tie by keeping the OLDER account', async () => {
        seedUser('newer', { email: 'ada@example.com', createdAt: '2026-06-01T00:00:00.000Z' });
        seedUser('older', { email: 'ada@example.com', createdAt: '2024-01-01T00:00:00.000Z' });

        expect(rows(await listUsers())).toEqual(['older']);
    });

    it('filters by role, in the query', async () => {
        seedUser('seller', { roles: ['general_user', 'seller'] });
        seedUser('plain', { roles: ['general_user'], createdAt: '2026-02-01T00:00:00.000Z' });

        expect(rows(await listUsers({ role: 'seller' }))).toEqual(['seller']);
        expect(rows(await listUsers({ role: 'all' }))).toHaveLength(2);
    });

    it('filters by verification status IN MEMORY, so the legacy shape is included', async () => {
        seedUser('legacy-verified', { isVerified: undefined, verified: true });
        seedUser('unverified', { createdAt: '2026-02-01T00:00:00.000Z' });

        expect(rows(await listUsers({ status: 'verified' }))).toEqual(['legacy-verified']);
        expect(rows(await listUsers({ status: 'unverified' }))).toEqual(['unverified']);
    });

    it('filters by state, ignoring a trailing "State" and the casing', async () => {
        seedUser('jos', { address: { state: 'Plateau State' } });
        seedUser('lagos', { address: { state: 'Lagos' }, createdAt: '2026-02-01T00:00:00.000Z' });

        expect(rows(await listUsers({ state: 'plateau' }))).toEqual(['jos']);
    });

    it('filters by LGA', async () => {
        seedUser('north', { address: { lga: 'Jos North' } });
        seedUser('south', { address: { lga: 'Jos South' }, createdAt: '2026-02-01T00:00:00.000Z' });

        expect(rows(await listUsers({ lga: 'jos south' }))).toEqual(['south']);
    });

    it('filters by gender', async () => {
        seedUser('f', { gender: 'Female' });
        seedUser('m', { gender: 'male', createdAt: '2026-02-01T00:00:00.000Z' });

        expect(rows(await listUsers({ gender: 'female' }))).toEqual(['f']);
    });

    it('filters by a specific module, and by "multi"', async () => {
        seedUser('one', { serviceRegistrations: { academy: { status: 'approved' } } });
        seedUser('two', {
            serviceRegistrations: { academy: { status: 'approved' }, wave: { status: 'active' } },
            createdAt: '2026-02-01T00:00:00.000Z',
        });
        seedUser('none', { createdAt: '2026-03-01T00:00:00.000Z' });

        expect(rows(await listUsers({ modules: 'wave' }))).toEqual(['two']);
        expect(rows(await listUsers({ modules: 'multi' }))).toEqual(['two']);
        expect(rows(await listUsers({ modules: 'all' }))).toHaveLength(3);
    });

    it('filters by a date range IN MEMORY as well, so a legacy string date cannot leak past', async () => {
        // Cross-type ordering used to let string-based createdAt values slip past
        // the query boundary, so the memory pass is a definitive backstop rather
        // than a duplicate.
        seedUser('early', { createdAt: '2026-01-15T00:00:00.000Z' });
        seedUser('mid', { createdAt: '2026-03-15T00:00:00.000Z' });
        seedUser('late', { createdAt: '2026-06-15T00:00:00.000Z' });

        expect(rows(await listUsers({ fromDate: '2026-02-01', toDate: '2026-04-30' })))
            .toEqual(['mid']);
    });

    it('sorts newest first, and honours an ascending order', async () => {
        seedUser('older', { createdAt: '2026-01-01T00:00:00.000Z' });
        seedUser('newer', { createdAt: '2026-06-01T00:00:00.000Z' });

        expect(rows(await listUsers())).toEqual(['newer', 'older']);
        expect(rows(await listUsers({ sortOrder: 'asc' }))).toEqual(['older', 'newer']);
    });

    it('sorts by gender, newest first within a gender', async () => {
        seedUser('f-old', { gender: 'female', createdAt: '2026-01-01T00:00:00.000Z' });
        seedUser('f-new', { gender: 'female', createdAt: '2026-06-01T00:00:00.000Z' });
        seedUser('m1', { gender: 'male', createdAt: '2026-03-01T00:00:00.000Z' });

        expect(rows(await listUsers({ sortBy: 'gender', sortOrder: 'desc' })))
            .toEqual(['m1', 'f-new', 'f-old']);
    });

    it('pages by PAGE NUMBER, reporting hasMore and the absolute count', async () => {
        for (const n of [1, 2, 3]) {
            seedUser(`u${n}`, { createdAt: `2026-0${n}-01T00:00:00.000Z` });
        }

        const page0 = await listUsers({ limit: 2, page: 0 });
        expect(page0.data).toHaveLength(2);
        expect(page0.hasMore).toBe(true);
        expect(page0.lastDocId).toBe('1');
        expect(page0.meta.totalCount).toBe(3);

        const page1 = await listUsers({ limit: 2, page: 1 });
        expect(page1.data).toHaveLength(1);
        expect(page1.hasMore).toBe(false);
    });

    it('reports the FILTERED count when a location filter is on, not the whole table', async () => {
        seedUser('jos', { address: { state: 'Plateau' } });
        seedUser('lagos', { address: { state: 'Lagos' }, createdAt: '2026-02-01T00:00:00.000Z' });

        expect((await listUsers({ state: 'Plateau' })).meta.totalCount).toBe(1);
    });

    it('returns an empty page, not everything, when a search matches nobody', async () => {
        seedUser('u1');
        const res = await listUsers({ search: 'nobody-by-that-name' });

        expect(res.data).toEqual([]);
        expect(res.hasMore).toBe(false);
        expect(res.meta.totalCount).toBe(0);
    });

    it('finds a user by email through the search helper', async () => {
        seedUser('u1', { email: 'ngozi@example.com' });
        seedUser('u2', { email: 'other@example.com', createdAt: '2026-02-01T00:00:00.000Z' });

        expect(rows(await listUsers({ search: 'ngozi@example.com' }))).toEqual(['u1']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('toggleUserVerificationAction', () => {
    const toggle = async (id: string) =>
        (await (await actions()).toggleUserVerificationAction(id)) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await toggle('u1')).toMatchObject({ success: false });
    });

    it('refuses a role without users:update', async () => {
        actAs('mod-1', ['moderator']);
        seedUser('u1');
        expect(((await toggle('u1')) as any).error).toContain('users:update');
        expect(read('u1').isVerified).toBeUndefined();
    });

    it('says so when the user does not exist', async () => {
        expect(await toggle('nope')).toMatchObject({ success: false, error: 'User not found' });
    });

    it('verifies an unverified user, stamping who and when', async () => {
        seedUser('u1', { isVerified: false });

        const res = await toggle('u1');
        expect(res).toMatchObject({ success: true });
        expect(res.message).toContain('verified');

        const user = read('u1');
        expect(user.isVerified).toBe(true);
        expect(user.kycStatus).toBe('verified');
        expect(user.kyc.status).toBe('verified');
        expect(user.verifiedBy).toBe('admin-1');
        expect(typeof user.verifiedAt).toBe('string');
    });

    it('and UNVERIFIES a verified one, clearing the stamp', async () => {
        seedUser('u1', { isVerified: true, verifiedAt: '2026-01-01T00:00:00.000Z' });

        const res = await toggle('u1');
        expect(res.message).toContain('unverified');

        const user = read('u1');
        expect(user.isVerified).toBe(false);
        expect(user.kycStatus).toBe('pending');
        expect(user.verifiedAt).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('toggleUserKycVerificationAction', () => {
    const toggle = async (id: string, field: any, current: boolean) =>
        (await (await actions()).toggleUserKycVerificationAction(id, field, current)) as any;

    it('refuses a role without users:update', async () => {
        actAs('mod-1', ['moderator']);
        seedUser('u1');
        expect(((await toggle('u1', 'bvn', false)) as any).error).toContain('users:update');
    });

    it('says so when the user does not exist', async () => {
        expect(await toggle('nope', 'bvn', false))
            .toMatchObject({ success: false, error: 'User not found' });
    });

    it('writes BOTH the nested and the legacy field, so either reader agrees', async () => {
        seedUser('u1', { kyc: { bvn: 'HASH' } });

        expect(await toggle('u1', 'bvn', false)).toMatchObject({ success: true });

        const user = read('u1');
        expect(user.kyc.bvnVerified).toBe(true);
        expect(user.bvnVerified).toBe(true);
        expect(user.kyc.bvnStatus).toBe('verified');
    });

    it('un-verifies when the current status says verified', async () => {
        seedUser('u1', { kyc: { bvn: 'HASH', bvnVerified: true } });

        const res = await toggle('u1', 'bvn', true);
        expect(res.message).toContain('unverified');
        expect(read('u1').kyc.bvnVerified).toBe(false);
        expect(read('u1').kyc.bvnStatus).toBe('unverified');
    });

    it('raises the OVERALL kyc status only when the other identity is settled too', async () => {
        // Verifying the BVN of somebody whose NIN is on file but unverified must
        // not mark the account KYC-complete.
        seedUser('u1', { kyc: { bvn: 'HASH-A', nin: 'HASH-B', ninVerified: false } });

        await toggle('u1', 'bvn', false);

        expect(read('u1').kyc.status).toBe('pending');
        expect(read('u1').kycVerified).toBe(false);
    });

    it('and does raise it when the other one is already verified', async () => {
        seedUser('u1', { kyc: { bvn: 'HASH-A', nin: 'HASH-B', ninVerified: true } });

        await toggle('u1', 'bvn', false);

        expect(read('u1').kyc.status).toBe('verified');
        expect(read('u1').kycVerified).toBe(true);
    });

    it('treats a MISSING other identity as nothing to wait for', async () => {
        seedUser('u1', { kyc: { bvn: 'HASH-A' } });

        await toggle('u1', 'bvn', false);

        expect(read('u1').kyc.status).toBe('verified');
    });

    it('leaves the overall status alone for tin and cac', async () => {
        seedUser('u1', { kyc: { status: 'pending' } });

        await toggle('u1', 'tin', false);

        expect(read('u1').tinVerified).toBe(true);
        expect(read('u1').kyc.status).toBe('pending');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('updateUserRolesAction', () => {
    const update = async (id: string, roles: string[]) =>
        (await (await actions()).updateUserRolesAction(id, roles)) as any;

    it('refuses a role without users:assign_roles', async () => {
        actAs('mod-1', ['moderator']);
        seedUser('u1');
        expect(((await update('u1', ['seller'])) as any).error).toContain('users:assign_roles');
        expect(read('u1').roles).toEqual(['general_user']);
    });

    it('refuses an admin removing their OWN admin privileges', async () => {
        seedUser('admin-1', { roles: ['super_admin'] });
        expect(await update('admin-1', ['general_user'])).toMatchObject({
            success: false, error: 'Cannot remove your own admin privileges',
        });
        expect(read('admin-1').roles).toEqual(['super_admin']);
    });

    it('refuses a plain ADMIN granting admin authority to anyone', async () => {
        // The self-demotion guard does not catch escalation — adding a role is
        // not removing one — so an admin calling this on their own id with
        // ["super_admin"] passed it. The rule is that any resulting role set
        // containing admin or super_admin needs a super_admin to write it.
        actAs('admin-2', ['admin']);
        seedUser('u1');

        expect(await update('u1', ['general_user', 'admin'])).toMatchObject({
            success: false, error: 'Only a super admin can grant admin roles',
        });
        expect(read('u1').roles).toEqual(['general_user']);
    });

    it('and refuses them escalating THEMSELVES', async () => {
        actAs('admin-2', ['admin']);
        seedUser('admin-2', { roles: ['admin'] });

        expect(((await update('admin-2', ['admin', 'super_admin'])) as any).error)
            .toBe('Only a super admin can grant admin roles');
        expect(read('admin-2').roles).toEqual(['admin']);
    });

    it('a SUPER ADMIN may grant it — the refusal is a permission, not a wall', async () => {
        seedUser('u1');
        expect(await update('u1', ['general_user', 'admin'])).toMatchObject({ success: true });
        expect(read('u1').roles).toEqual(['general_user', 'admin']);
    });

    it('a plain admin may still assign ordinary roles', async () => {
        actAs('admin-2', ['admin']);
        seedUser('u1');

        expect(await update('u1', ['general_user', 'investor'])).toMatchObject({ success: true });
        expect(read('u1').roles).toEqual(['general_user', 'investor']);
    });

    it('writes general_user, the BASE role, rather than refusing it (finding #86)', async () => {
        // schemas.ts's UserRoleSchema accepted `general_user`,
        // `marketplace_buyer` and `field_officer`; write-guard.ts's own
        // hand-written list did not. So all three passed validation and were
        // then refused at the write boundary with "[writeGuard] Schema
        // violation in admin/updateUserRoles".
        //
        // general_user is on essentially every ordinary account, and this action
        // writes the roles array WHOLESALE — the existing role has to be sent
        // back with any addition — so editing an ordinary user's roles failed
        // every time, with a message that reads like an internal error.
        seedUser('u1', { roles: ['general_user'] });

        expect(await update('u1', ['general_user'])).toMatchObject({ success: true });
        expect(read('u1').roles).toEqual(['general_user']);
    });

    it.each(['marketplace_buyer', 'field_officer'])(
        'and writes %p, which the two lists also disagreed about', async (role) => {
            seedUser('u1');
            expect(await update('u1', ['general_user', role])).toMatchObject({ success: true });
            expect(read('u1').roles).toEqual(['general_user', role]);
        });

    it('refuses to make somebody a SELLER before their verification is approved', async () => {
        // userService's integrity rule, on the TRANSITION rather than the state:
        // it fires when this update adds the role, and leaves an existing seller
        // whose status is not approved alone — that is a data-repair problem,
        // not a reason to refuse every write to the record.
        seedUser('u1', { sellerVerificationStatus: 'pending' });

        expect(((await update('u1', ['general_user', 'seller'])) as any).error)
            .toContain("Cannot assign 'seller' role");
        expect(read('u1').roles).toEqual(['general_user']);
    });

    it('and allows it once the verification IS approved', async () => {
        seedUser('u1', { sellerVerificationStatus: 'approved' });

        expect(await update('u1', ['general_user', 'seller'])).toMatchObject({ success: true });
        expect(read('u1').roles).toEqual(['general_user', 'seller']);
    });

    it('leaves an EXISTING seller editable even while unapproved', async () => {
        seedUser('u1', { roles: ['general_user', 'seller'], sellerVerificationStatus: 'pending' });

        expect(await update('u1', ['general_user', 'seller', 'investor']))
            .toMatchObject({ success: true });
        expect(read('u1').roles).toEqual(['general_user', 'seller', 'investor']);
    });

    it('refuses a role the schema does not recognise', async () => {
        seedUser('u1');
        expect(((await update('u1', ['wizard'])) as any).success).toBe(false);
        expect(read('u1').roles).toEqual(['general_user']);
    });

    it('refuses an empty role list', async () => {
        seedUser('u1');
        expect(((await update('u1', [])) as any).success).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('updateUserGenderAction and unlockUserAccount', () => {
    it('gender: refuses a role without users:update', async () => {
        actAs('mod-1', ['moderator']);
        seedUser('u1');
        expect(((await (await actions()).updateUserGenderAction('u1', 'female')) as any).error)
            .toContain('users:update');
        expect(read('u1').gender).toBeUndefined();
    });

    it('gender: records it for an admin', async () => {
        seedUser('u1');
        expect(await (await actions()).updateUserGenderAction('u1', 'female'))
            .toMatchObject({ success: true });
        expect(read('u1').gender).toBe('female');
    });

    it('unlock: refuses a role without users:read', async () => {
        actAs('nobody', ['user']);
        expect(((await (await actions()).unlockUserAccount('ada@example.com')) as any).error)
            .toContain('users:read');
        expect(resetLoginAttempts).not.toHaveBeenCalled();
    });

    it('unlock: refuses something that is not an email address', async () => {
        expect(await (await actions()).unlockUserAccount('not-an-email'))
            .toMatchObject({ success: false, error: 'Invalid email address' });
        expect(resetLoginAttempts).not.toHaveBeenCalled();
    });

    it('unlock: resets the login attempts for an admin', async () => {
        const res = (await (await actions()).unlockUserAccount('ada@example.com')) as any;

        expect(res.success).toBe(true);
        expect(res.message).toContain('ada@example.com');
        expect(resetLoginAttempts).toHaveBeenCalledWith('ada@example.com');
    });
});
