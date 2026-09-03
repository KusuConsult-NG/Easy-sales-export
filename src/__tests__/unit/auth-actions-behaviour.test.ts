/**
 * @jest-environment node
 */

/**
 * The post-login redirect and registration, EXECUTED.
 *
 * At 16.8%. getPostLoginRedirect decides where every single sign-in lands, and it
 * has eight branches with a strict order of precedence. Getting the order wrong
 * is not a cosmetic bug: it is a legacy member skipping a forced password change,
 * or a module admin landing on a member dashboard they cannot use.
 *
 * The precedence, from the top:
 *
 *   1. requiresPasswordChange  — an admin-onboarded account with a shared
 *                                password MUST change it before anything else
 *   2. any admin role          — global admins to /admin, a module admin to that
 *                                module's own console
 *   3. an approved module      — straight to that module's dashboard, bypassing
 *                                getPrimaryApp because JWT roles go stale for
 *                                hours after an approval
 *   4. everyone else           — /dashboard
 *
 * Every one of those reads a document, so a call-recorder harness returned
 * whatever the test stubbed and the ORDER could not be checked at all.
 *
 * Registration's phone-uniqueness guard is the other thing here worth executing:
 * it is the only check standing between the platform and multi-account fraud on
 * one phone number, and it is a query.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

const createUser = jest.fn(async (_args: Record<string, unknown>) => ({
    data: { user: { id: 'supabase-uid-1' } },
    error: null as { message: string } | null,
}));
const listUsers = jest.fn(async () => ({ data: { users: [] as Array<{ id: string; email: string }> } }));

/** The ownership proof for #238: the anon client's password check. */
const signInWithPassword = jest.fn(async (_c: { email: string; password: string }) => ({
    data: { user: null as { id: string } | null }, error: { message: 'Invalid login credentials' } as { message: string } | null,
}));
jest.mock('@supabase/supabase-js', () => ({
    createClient: () => ({
        auth: { signInWithPassword: (c: { email: string; password: string }) => signInWithPassword(c) },
    }),
}));

jest.mock('@/lib/supabase', () => ({
    supabaseAdmin: {
        auth: { admin: { createUser: (a: Record<string, unknown>) => createUser(a), listUsers: () => listUsers() } },
        from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
        rpc: async () => ({ data: null, error: null }),
    },
}));

jest.mock('resend', () => ({
    Resend: class { emails = { send: async () => ({ error: null }) }; },
}));

const check = jest.fn(async (_key: string) => ({ success: true, remaining: 4 }));
// The whole module, because actions/auth.ts uses getActionClientIp from it as
// well as rateLimit. A partial mock leaves the other export undefined and the
// action fails with "is not a function" — the third time in this audit that a
// mock covering two thirds of a module's surface has looked like a defect in the
// code under test.
jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: (key: string) => check(key) }),
    loginLimiter: { check: (key: string) => check(key) },
    getActionClientIp: async () => '127.0.0.1',
    checkRateLimit: async () => ({ success: true }),
}));

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    createUser.mockImplementation(async () => ({ data: { user: { id: 'supabase-uid-1' } }, error: null }));
    listUsers.mockImplementation(async () => ({ data: { users: [] } }));
    signInWithPassword.mockImplementation(async () => ({
        data: { user: null }, error: { message: 'Invalid login credentials' },
    }));
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key';
    check.mockImplementation(async () => ({ success: true, remaining: 4 }));
});

async function actions() {
    return import('@/app/actions/auth');
}

const EMAIL = 'member@example.com';

function seedUser(extra: Record<string, unknown>): void {
    store.seed(COLLECTIONS.USERS, 'user-1', { email: EMAIL, roles: ['user'], ...extra });
}

async function redirectFor(email = EMAIL): Promise<string | undefined> {
    // #239: the action answers for the SESSION, not for the parameter — an
    // unauthenticated caller used to be able to map any address to its
    // account's shape. The harness therefore logs the caller in as the address
    // it is asking about, which is exactly what LoginForm's post-signIn call
    // looks like.
    const { auth } = await import('@/lib/auth');
    (auth as unknown as jest.Mock<any>).mockResolvedValue({ user: { id: 'user-1', email } });
    const { getPostLoginRedirect } = await actions();
    const result = await getPostLoginRedirect(email);
    return (result as { data?: { redirectUrl?: string } }).data?.redirectUrl
        ?? (result as { redirectUrl?: string }).redirectUrl;
}

// ─── the precedence ──────────────────────────────────────────────────────────

describe('#239 — the redirect describes the SESSION, not any email a caller types', () => {
    /**
     * getPostLoginRedirect is a "use server" export — a public endpoint — and
     * it answered for ANY email, no session required. The redirect it returns
     * is a description of the account: "/admin" says the address belongs to an
     * admin, "/wave/dashboard" names their module,
     * "/auth/reset-legacy-password" says a forced reset is pending. An
     * unauthenticated caller could walk an address list through it and map who
     * is who on the platform.
     */
    it('AN UNAUTHENTICATED CALLER LEARNS NOTHING ABOUT AN ADMIN', async () => {
        seedUser({ roles: ['super_admin'] });
        const { auth } = await import('@/lib/auth');
        (auth as unknown as jest.Mock<any>).mockResolvedValue(null);

        const { getPostLoginRedirect } = await actions();
        const result = await getPostLoginRedirect(EMAIL) as any;

        // Was: /admin — the account's shape, handed to anyone.
        expect(result.data?.redirectUrl ?? result.redirectUrl).toBe('/dashboard');
    });

    it('NOR ABOUT A PENDING FORCED PASSWORD RESET', async () => {
        seedUser({ requiresPasswordChange: true });
        const { auth } = await import('@/lib/auth');
        (auth as unknown as jest.Mock<any>).mockResolvedValue(null);

        const { getPostLoginRedirect } = await actions();
        const result = await getPostLoginRedirect(EMAIL) as any;

        expect(result.data?.redirectUrl ?? result.redirectUrl).toBe('/dashboard');
    });

    it("and a logged-in caller asking about SOMEBODY ELSE gets their own answer", async () => {
        seedUser({ roles: ['super_admin'] });
        store.seed(COLLECTIONS.USERS, 'user-2', { email: 'me@example.com', roles: ['general_user'] });
        const { auth } = await import('@/lib/auth');
        (auth as unknown as jest.Mock<any>).mockResolvedValue({ user: { id: 'user-2', email: 'me@example.com' } });

        const { getPostLoginRedirect } = await actions();
        const result = await getPostLoginRedirect(EMAIL) as any;

        // The parameter names the admin; the answer is the caller's own.
        expect(result.data?.redirectUrl ?? result.redirectUrl).not.toBe('/admin');
    });

    it('and an auth() failure fails closed to the generic dashboard', async () => {
        seedUser({ roles: ['super_admin'] });
        const { auth } = await import('@/lib/auth');
        (auth as unknown as jest.Mock<any>).mockRejectedValue(new Error('deadlock'));

        const { getPostLoginRedirect } = await actions();
        const result = await getPostLoginRedirect(EMAIL) as any;

        expect(result.data?.redirectUrl ?? result.redirectUrl).toBe('/dashboard');
    });
});

describe('a forced password change comes first', () => {
    it('before the admin console', async () => {
        // THE precedence test. An admin-onboarded account carries a password
        // somebody else chose. Sending an admin straight to /admin would let them
        // work indefinitely on a credential they never set.
        seedUser({ roles: ['super_admin'], requiresPasswordChange: true });

        expect(await redirectFor()).toBe('/auth/reset-legacy-password');
    });

    it('and before an approved module dashboard', async () => {
        seedUser({
            requiresPasswordChange: true,
            serviceRegistrations: { wave: { status: 'approved' } },
        });

        expect(await redirectFor()).toBe('/auth/reset-legacy-password');
    });

    it('while an account that does not need one goes on as normal', async () => {
        seedUser({ roles: ['super_admin'] });
        expect(await redirectFor()).toBe('/admin');
    });
});

describe('an administrator lands on a console', () => {
    it('a global admin on /admin', async () => {
        for (const role of ['admin', 'super_admin', 'superadmin']) {
            store.clear();
            seedUser({ roles: [role] });
            expect(await redirectFor()).toBe('/admin');
        }
    });

    it('and "superadmin" is recognised even though it is not in the UserRole union', async () => {
        // The legacy spelling. `roles` is typed UserRole[] but read straight out
        // of the database, so at runtime it holds whatever is stored — and
        // treating the declared type as a guarantee here would quietly demote
        // everyone still carrying it.
        seedUser({ roles: ['superadmin'] });
        expect(await redirectFor()).toBe('/admin');
    });

    it.each([
        ['academy_admin', '/admin/academy'],
        ['wave_admin', '/admin/wave'],
        ['marketplace_admin', '/admin/marketplace'],
        ['cooperative_admin', '/admin/cooperatives'],
        ['export_admin', '/admin/export'],
        ['farm_nation_admin', '/admin/farm-nation'],
    ])('%s on its own module console', async (role, expected) => {
        store.clear();
        seedUser({ roles: [role] });
        expect(await redirectFor()).toBe(expected);
    });

    it('but a GLOBAL admin who also holds a module role still lands on /admin', async () => {
        // The module console is for silo-isolated admins. A super_admin who also
        // carries wave_admin runs the whole platform, and dropping them into the
        // WAVE console every login is wrong.
        seedUser({ roles: ['super_admin', 'wave_admin'] });
        expect(await redirectFor()).toBe('/admin');
    });
});

describe('an approved module takes the member straight to its dashboard', () => {
    it.each([
        ['academy', '/academy/dashboard'],
        ['wave', '/wave/dashboard'],
        ['export', '/export/dashboard'],
        ['marketplace', '/marketplace/buyer/dashboard'],
        ['cooperatives', '/cooperatives/dashboard'],
        ['farmNation', '/farm-nation/dashboard'],
        ['farm_nation', '/farm-nation/dashboard'],
    ])('%s', async (module, expected) => {
        store.clear();
        seedUser({ serviceRegistrations: { [module]: { status: 'approved' } } });
        expect(await redirectFor()).toBe(expected);
    });

    it('accepting "active" as well as "approved"', async () => {
        seedUser({ serviceRegistrations: { wave: { status: 'active' } } });
        expect(await redirectFor()).toBe('/wave/dashboard');
    });

    it('and bypassing the role-based lookup, because JWT roles go stale', async () => {
        // The reason this branch exists. An admin approves the module; the
        // member's session still carries the old roles for up to an hour. Routing
        // on the REGISTRATION rather than the role is what makes the approval take
        // effect on the next login.
        seedUser({
            roles: ['user'],
            serviceRegistrations: { cooperatives: { status: 'approved' } },
        });

        expect(await redirectFor()).toBe('/cooperatives/dashboard');
    });

    it('while a pending registration does NOT', async () => {
        seedUser({ serviceRegistrations: { wave: { status: 'pending' } } });
        expect(await redirectFor()).toBe('/dashboard');
    });

    it('and an unknown module name falls through to /dashboard rather than the marketing hub', async () => {
        // getPrimaryApp answers "/" when no role names a module — the Hub. Landing
        // a signed-in member on the marketing page is not what this branch wants,
        // and it is not what used to happen.
        seedUser({ serviceRegistrations: { some_new_module: { status: 'approved' } } });
        expect(await redirectFor()).toBe('/dashboard');
    });
});

describe('everyone else', () => {
    it('a member with no registrations goes to the dashboard', async () => {
        seedUser({});
        expect(await redirectFor()).toBe('/dashboard');
    });

    it('and so does an address with no account at all', async () => {
        expect(await redirectFor('nobody@example.com')).toBe('/dashboard');
    });

    it('matching the address case-insensitively', async () => {
        // Addresses are typed. A lookup that missed on capitalisation would send
        // an admin to the member dashboard because they typed their own address
        // with a capital letter.
        seedUser({ email: 'member@example.com', roles: ['super_admin'] });
        expect(await redirectFor('Member@Example.COM')).toBe('/admin');
    });

    it('and does not adopt ANOTHER account’s registrations', async () => {
        // The query test. A record exists; it belongs to somebody else.
        store.seed(COLLECTIONS.USERS, 'other', {
            email: 'other@example.com',
            roles: ['super_admin'],
            serviceRegistrations: { wave: { status: 'approved' } },
        });
        seedUser({});

        expect(await redirectFor()).toBe('/dashboard');
    });
});

// ─── registration ────────────────────────────────────────────────────────────

describe('registration', () => {
    function form(extra: Record<string, string> = {}): FormData {
        const fd = new FormData();
        const fields: Record<string, string> = {
            fullName: 'Ada Obi',
            email: 'new@example.com',
            password: 'Str0ng!Passw0rd',
            confirmPassword: 'Str0ng!Passw0rd',
            phone: '08031111111',
            gender: 'female',
            ...extra,
        };
        for (const [k, v] of Object.entries(fields)) fd.set(k, v);
        return fd;
    }

    it('refuses a phone number that already has an account', async () => {
        // THE guard, and the only thing standing between the platform and
        // multi-account fraud on one number. It is a QUERY, so it could not be
        // tested before.
        store.seed(COLLECTIONS.USERS, 'existing', {
            email: 'first@example.com', phone: '08031111111',
        });

        const { registerAction } = await actions();
        const result = await registerAction(null, form());

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/phone number already exists/i);
        expect(createUser).not.toHaveBeenCalled();
    });

    it('comparing the NORMALISED number, so +234 and 0803 are one account', async () => {
        // Two spellings of one number. A raw string comparison lets the same
        // person register twice by typing it differently.
        store.seed(COLLECTIONS.USERS, 'existing', {
            email: 'first@example.com', phone: '+2348031111111',
        });

        const { registerAction } = await actions();
        const result = await registerAction(null, form({ phone: '08031111111' }));

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/phone number already exists/i);
    });

    it('and lets a genuinely new number through', async () => {
        // The complement. Without it the guard above would also pass for an
        // action that refused everybody.
        store.seed(COLLECTIONS.USERS, 'existing', {
            email: 'first@example.com', phone: '08039999999',
        });

        const { registerAction } = await actions();
        await registerAction(null, form({ phone: '08031111111' }));

        expect(createUser).toHaveBeenCalled();
    });

    it('refusing when the rate limit is spent, before creating anything', async () => {
        check.mockImplementation(async () => ({ success: false, remaining: 0 }));

        const { registerAction } = await actions();
        const result = await registerAction(null, form());

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/too many/i);
        expect(createUser).not.toHaveBeenCalled();
    });

    it('and refusing a submission that fails the schema', async () => {
        const { registerAction } = await actions();
        const result = await registerAction(null, form({ email: 'not-an-address' }));

        expect(result.success).toBe(false);
        expect(createUser).not.toHaveBeenCalled();
    });

    it('creating the account in the auth store with a lowercased address', async () => {
        // The address is the identity. Registering "Ada@Example.com" and signing
        // in as "ada@example.com" has to be the same account.
        const { registerAction } = await actions();
        await registerAction(null, form({ email: 'Ada@Example.com' }));

        expect(createUser).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'ada@example.com' }));
    });

    /**
     *   #238 REGISTERING WITH SOMEBODY ELSE'S EMAIL REWROTE THEIR ACCOUNT.
     *
     *        When Supabase said the address was taken, this branch looked the
     *        existing account up by email and ADOPTED its id — no password
     *        check. The profile write then ran against users/{that id} with
     *        set(merge), where an array is a value: the victim's fullName,
     *        phone and gender were overwritten with whatever the form said and
     *        their `roles` were REPLACED with ["general_user"]. Submitting the
     *        register form with an admin's email and any password at all
     *        demoted that admin, from an unauthenticated page.
     *
     *        The branch exists for one legitimate case — the user whose first
     *        attempt crashed between the auth write and the profile write,
     *        retrying — and the proof of being that user is the password. It is
     *        verified against the existing account now, and even then the
     *        profile is only created when it is genuinely missing.
     *
     *        The test above this block used to PIN the defect: it asserted that
     *        listUsers-based adoption succeeded. (listUsers was its own fault —
     *        one page, so past ~50 accounts the recovery path silently died.)
     */
    it('#238: adopts the existing auth account ONLY when the password proves ownership', async () => {
        createUser.mockImplementation(async () => ({
            data: { user: null as never }, error: { message: 'User already been registered' },
        }));
        signInWithPassword.mockImplementation(async () => ({
            data: { user: { id: 'existing-uid' } }, error: null,
        }));
        // The crash-recovery state: auth account exists, no profile document.

        const { registerAction } = await actions();
        const result = await registerAction(null, form());

        expect(result.success).toBe(true);
        expect(signInWithPassword).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'new@example.com' }));
        expect(store.get(COLLECTIONS.USERS, 'existing-uid')?.fullName).toBe('Ada Obi');
    });

    it('#238: A WRONG PASSWORD ADOPTS NOTHING AND WRITES NOTHING', async () => {
        /**
         * Two audits fixed this branch and the merge had to choose between the
         * REPLIES, not the protections — both refuse to adopt the account.
         *
         * #238 refused and said "already been registered". #363 refused and
         * said nothing at all, because that message is an enumeration oracle
         * on a form needing no session: anyone could post an address and learn
         * whether it holds an account. The merged action keeps #363's reply,
         * so a non-owner now gets exactly what a real signup returns and the
         * owner is told by email instead.
         *
         * What #238 asserted that still holds, and is what this test is for:
         * nothing is adopted and nothing is written.
         */
        createUser.mockImplementation(async () => ({
            data: { user: null as never }, error: { message: 'User already been registered' },
        }));
        signInWithPassword.mockImplementation(async () => ({
            data: { user: null }, error: { message: 'Invalid login credentials' },
        }));

        const { registerAction } = await actions();
        const result: any = await registerAction(null, form());

        // Was: the account adopted anyway, the victim's profile rewritten and
        // their roles reset, success reported to the impostor.
        expect(store.size(COLLECTIONS.USERS)).toBe(0);
        expect(listUsers).not.toHaveBeenCalled();
        // And the reply gives the prober nothing — see register-enumeration.
        expect(String(result.error ?? '')).not.toMatch(/already been registered/i);
    });

    it("#238: AND A COMPLETE ACCOUNT IS NEVER REWRITTEN, EVEN BY ITS OWNER", async () => {
        // Re-registering with the RIGHT password must not reset a real profile
        // to day-one defaults — roles included. Naming the account here is safe
        // because only somebody who just proved the password can reach it.
        createUser.mockImplementation(async () => ({
            data: { user: null as never }, error: { message: 'User already been registered' },
        }));
        signInWithPassword.mockImplementation(async () => ({
            data: { user: { id: 'existing-uid' } }, error: null,
        }));
        store.seed(COLLECTIONS.USERS, 'existing-uid', {
            email: 'new@example.com', fullName: 'The Real Ada',
            phone: '08099999999', roles: ['general_user', 'admin'],
        });

        const { registerAction } = await actions();
        const result: any = await registerAction(null, form());

        expect(result.success).toBe(false);
        expect(String(result.error)).toMatch(/log in/i);
        const victim = store.get(COLLECTIONS.USERS, 'existing-uid')!;
        expect(victim.fullName).toBe('The Real Ada');
        expect(victim.phone).toBe('08099999999');
        expect(victim.roles).toEqual(['general_user', 'admin']);
    });

    it('and surfacing any other auth failure rather than swallowing it', async () => {
        createUser.mockImplementation(async () => ({
            data: { user: null as never }, error: { message: 'password too weak' },
        }));

        const { registerAction } = await actions();
        const result = await registerAction(null, form());

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/password too weak/i);
    });

    it('and reporting a thrown auth error as a system error, not as the user’s fault', async () => {
        createUser.mockImplementation(async () => { throw new Error('network down'); });

        const { registerAction } = await actions();
        const result = await registerAction(null, form());

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/authentication system error/i);
    });
});

describe('the duplicate-phone guard sees every spelling that is stored', () => {
    /**
     * registerAction normalises before it writes, so an account created HERE
     * carries +234…. Four other writers put the RAW value on the same field:
     * the bulk member import (admin/_legacy), seller approval
     * (admin/_marketplace), export onboarding, and the KYC action.
     *
     * So the users collection holds both spellings, and a check asking only for
     * +234… could not see a member who arrived by any of those routes — which is
     * most of the platform, because the bulk import is where the members came
     * from. The guard was blind to exactly the population it most needed to see.
     */
    function form(phone: string): FormData {
        const fd = new FormData();
        for (const [k, v] of Object.entries({
            fullName: 'Ada Obi',
            email: 'new@example.com',
            password: 'Str0ng!Passw0rd',
            confirmPassword: 'Str0ng!Passw0rd',
            phone,
            gender: 'female',
        })) fd.set(k, v);
        return fd;
    }

    it.each([
        ['the normalised form, as registration writes it', '+2348031111111'],
        ['the national form, as the bulk import writes it', '08031111111'],
        ['the country-code form with no plus', '2348031111111'],
    ])('catches a duplicate stored in %s', async (_label, stored) => {
        store.seed(COLLECTIONS.USERS, 'existing', { email: 'first@example.com', phone: stored });

        const { registerAction } = await actions();
        const result = await registerAction(null, form('08031111111'));

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/phone number already exists/i);
        expect(createUser).not.toHaveBeenCalled();
    });

    it('whichever spelling the new registrant types', async () => {
        store.seed(COLLECTIONS.USERS, 'existing', { email: 'first@example.com', phone: '08031111111' });

        const { registerAction } = await actions();
        for (const typed of ['+2348031111111', '2348031111111', '0803 111 1111']) {
            jest.clearAllMocks();
            const result = await registerAction(null, form(typed));
            expect(result.success).toBe(false);
        }
    });

    it('and still lets a genuinely different number through', async () => {
        // The complement. Without it, an `in` over four variants that had
        // accidentally become an unfiltered scan would look like a working guard.
        store.seed(COLLECTIONS.USERS, 'existing', { email: 'first@example.com', phone: '08039999999' });

        const { registerAction } = await actions();
        await registerAction(null, form('08031111111'));

        expect(createUser).toHaveBeenCalled();
    });

    it('the variants themselves being the four a caller can produce', async () => {
        const { phoneLookupVariants } = await import('@/lib/phone');

        expect(phoneLookupVariants('08031111111').sort())
            .toEqual(['+2348031111111', '08031111111', '2348031111111'].sort());

        // A number that cannot be normalised falls back to the raw string rather
        // than to an empty list — an empty `in` matches nothing, which would turn
        // the guard off for anything unusual.
        expect(phoneLookupVariants('12345')).toEqual(['12345']);
        expect(phoneLookupVariants('')).toEqual([]);
        expect(phoneLookupVariants(null)).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('preValidateLoginAction — the login gate, executed for the first time', () => {
    /**
     * The largest never-run block in the auth actions (lines ~257–560): the
     * Supabase sign-in, the profile fetch, the auto-repair for a missing
     * profile, and the ban check. No new defects asserted here — the
     * enumeration oracle at the end of the failure path is an owner decision
     * already on record — but a login gate that has never executed is how the
     * five-logins lockout (documented inside it) survived to production.
     */
    const call = async (email = 'ada@example.com', password = 'Str0ng!Passw0rd') =>
        (await (await actions()).preValidateLoginAction({ email, password })) as any;

    const supabaseAccepts = (uid = 'sb-uid-1') =>
        signInWithPassword.mockImplementation(async () => ({
            data: { user: { id: uid } }, error: null,
        }));

    it('accepts a valid login and leaves the profile alone', async () => {
        supabaseAccepts('sb-uid-1');
        store.seed(COLLECTIONS.USERS, 'sb-uid-1', {
            email: 'ada@example.com', roles: ['general_user'], _migratedAt: '2026-01-01',
        });

        expect(await call()).toMatchObject({ success: true });
    });

    it('refuses a banned account even with the right password', async () => {
        supabaseAccepts('sb-uid-1');
        store.seed(COLLECTIONS.USERS, 'sb-uid-1', {
            email: 'ada@example.com', roles: ['general_user'], _migratedAt: '2026-01-01',
            isBanned: true,
        });

        const res = await call();
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/suspended/i);
    });

    it('and a suspended flag the same way', async () => {
        supabaseAccepts('sb-uid-1');
        store.seed(COLLECTIONS.USERS, 'sb-uid-1', {
            email: 'ada@example.com', roles: ['general_user'], _migratedAt: '2026-01-01',
            suspended: true,
        });

        expect(await call()).toMatchObject({ success: false });
    });

    it('auto-repairs a missing profile rather than locking the account out', async () => {
        supabaseAccepts('sb-uid-1');
        // Auth account exists, no profile row at all — the lockout state.

        const res = await call();

        expect(res.success).toBe(true);
        const repaired = store.get(COLLECTIONS.USERS, 'sb-uid-1');
        expect(repaired).toBeDefined();
        expect(repaired!.roles).toEqual(['general_user']);
        expect(repaired!.profileComplete).toBe(false);
    });

    it('rejects malformed input before touching any store', async () => {
        const res = await call('not-an-email', 'x');
        expect(res.success).toBe(false);
        expect(signInWithPassword).not.toHaveBeenCalled();
    });

    it('reports a wrong password without a stack trace', async () => {
        signInWithPassword.mockImplementation(async () => ({
            data: { user: null }, error: { message: 'Invalid login credentials' },
        }));
        store.seed(COLLECTIONS.USERS, 'u1', { email: 'ada@example.com' });

        const res = await call();
        expect(res.success).toBe(false);
        expect(typeof res.error).toBe('string');
    });
});
