/**
 * @jest-environment node
 */

/**
 * TWO DEFECTS IN ONE BRANCH OF registerAction, AND THE SECOND HID BEHIND THE
 * FIRST.
 *
 * When Supabase answered "already been registered", this ran:
 *
 *     const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
 *     const match = existingUsers?.users?.find(u => u.email === ...);
 *     if (match) { canonicalUid = match.id; }
 *
 * ANYONE COULD OVERWRITE ANYONE'S PROFILE, WITH NO PASSWORD
 * ---------------------------------------------------------
 * Adopting `match.id` let execution fall through to the profile write —
 * `.doc(canonicalUid).set({ ...userProfile }, { merge: true })` — so submitting
 * the PUBLIC registration form with a known email and any password at all
 * rewrote that account's fullName, firstName, lastName, phone, gender and
 * `roles: ["general_user"]`.
 *
 * That demotes an admin to a general user and replaces the phone number
 * account recovery is sent to. No credential was needed: createUser had
 * already failed, so the caller never proved anything about the address they
 * were claiming. The id is adopted now only when the caller signs in with the
 * password they submitted, and even then only if no profile exists — an
 * account that is already complete must log in rather than be reset to
 * day-one defaults.
 *
 * AND THE REPLY ANNOUNCED THAT THE ADDRESS WAS REGISTERED
 * ------------------------------------------------------
 * "A user with this email address has already been registered" is an
 * enumeration oracle on a form needing no session, on a platform holding
 * savings, loans and investment records.
 *
 * A generic message alone would NOT have closed it. The client used to call
 * signIn() with the typed credentials the moment registration succeeded, so a
 * real signup logged in and a probe did not — the answer was still there, in
 * the outcome rather than the wording. Registration no longer signs anyone in;
 * both register clients send everyone to the login page. That is what lets the
 * two replies be identical rather than merely similarly worded, and it is why
 * the client change is part of this fix rather than a separate tidy-up.
 *
 * The person who owns the address is told by email instead, which is where
 * that information belongs — rate-limited per address, because otherwise the
 * registration form becomes a mail bomb aimed at anyone whose address you know.
 *
 * WHAT IS STILL OPEN, SAID PLAINLY
 * --------------------------------
 * Timing. The two paths do different work before replying — one creates an
 * account and writes a profile, the other attempts a sign-in and queues mail.
 * A determined attacker with clean measurements may still tell them apart.
 * That is a far weaker signal than a plain-text answer, and closing it means
 * equalising the work rather than the reply.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

const VICTIM_AUTH_ID = 'victim-supabase-uuid';
const VICTIM_EMAIL = 'admin@example.com';
const ATTACKER_PASSWORD = 'Attacker!Passw0rd';
const VICTIM_PASSWORD = 'V1ctim!RealPassw0rd';

const createUser = jest.fn(async (_a: Record<string, unknown>) => ({
    data: { user: { id: 'fresh-uuid' } } as any,
    error: null as { message: string } | null,
}));
const listUsers = jest.fn(async () => ({
    data: { users: [{ id: VICTIM_AUTH_ID, email: VICTIM_EMAIL }] },
}));
const signInWithPassword = jest.fn(async (c: { email: string; password: string }) =>
    c.password === VICTIM_PASSWORD
        ? { data: { user: { id: VICTIM_AUTH_ID } } as any, error: null as any }
        : { data: { user: null } as any, error: { message: 'Invalid login credentials' } },
);
const sendEmailNotification = jest.fn(async (_d: Record<string, unknown>) => ({ success: true }));

jest.mock('@/lib/supabase', () => ({
    supabaseAdmin: {
        auth: { admin: {
            createUser: (a: Record<string, unknown>) => createUser(a),
            listUsers: () => listUsers(),
        } },
        from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
        rpc: async () => ({ data: null, error: null }),
    },
}));
jest.mock('@supabase/supabase-js', () => ({
    createClient: () => ({ auth: { signInWithPassword: (c: any) => signInWithPassword(c) } }),
}));
jest.mock('@/lib/email-notifications', () => ({
    sendEmailNotification: (d: Record<string, unknown>) => sendEmailNotification(d),
    getBaseUrl: () => 'https://easysalesexport.com',
}));
jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: async () => ({ success: true, remaining: 4 }) }),
    loginLimiter: { check: async () => ({ success: true, remaining: 4 }) },
    getActionClientIp: async () => '127.0.0.1',
    checkRateLimit: async () => ({ success: true }),
}));
jest.mock('resend', () => ({
    Resend: class { emails = { send: async () => ({ error: null }) }; },
}));
jest.mock('next/headers', () => ({
    headers: async () => ({ get: () => '' }),
    cookies: async () => ({ set: () => undefined, get: () => undefined }),
}));

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    createUser.mockImplementation(async () => ({
        data: { user: null }, error: { message: 'A user with this email address has already been registered' },
    }));
    listUsers.mockImplementation(async () => ({ data: { users: [{ id: VICTIM_AUTH_ID, email: VICTIM_EMAIL }] } }));
});

async function actions() {
    return import('@/app/actions/auth');
}

function form(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return fd;
}

function registration(email: string, password: string): FormData {
    return form({
        fullName: 'Attacker Person',
        email,
        password,
        confirmPassword: password,
        phone: '08030000001',
        gender: 'male',
    });
}

/** The victim: an admin whose profile is keyed by their Supabase auth id. */
function seedVictim(): void {
    store.seed(COLLECTIONS.USERS, VICTIM_AUTH_ID, {
        uid: VICTIM_AUTH_ID,
        email: VICTIM_EMAIL,
        fullName: 'Real Admin',
        firstName: 'Real',
        lastName: 'Admin',
        phone: '+2348099999999',
        roles: ['super_admin'],
        isVerified: true,
        profileComplete: true,
    });
}

// ─── the takeover ────────────────────────────────────────────────────────────

describe('registering with somebody else\'s address', () => {
    it('DOES NOT TOUCH THEIR PROFILE', async () => {
        // Was: listUsers() handed back the victim's id, and the profile write
        // below merged the attacker's details over it.
        seedVictim();
        const { registerAction } = await actions();

        await registerAction({}, registration(VICTIM_EMAIL, ATTACKER_PASSWORD));

        const victim = store.get(COLLECTIONS.USERS, VICTIM_AUTH_ID)!;
        expect(victim.fullName).toBe('Real Admin');
        expect(victim.phone).toBe('+2348099999999');
        expect(victim.roles).toEqual(['super_admin']);
    });

    it('DOES NOT DEMOTE AN ADMIN TO general_user', async () => {
        // The sharpest consequence, pinned on its own: the profile write set
        // roles: ["general_user"] unconditionally.
        seedVictim();
        const { registerAction } = await actions();

        await registerAction({}, registration(VICTIM_EMAIL, ATTACKER_PASSWORD));

        expect(store.get(COLLECTIONS.USERS, VICTIM_AUTH_ID)!.roles).toEqual(['super_admin']);
    });

    it('does not resolve the address to an account id at all', async () => {
        // listUsers() was the mechanism. Nothing should be asking the auth
        // provider to name the holder of an address on an anonymous request.
        seedVictim();
        const { registerAction } = await actions();

        await registerAction({}, registration(VICTIM_EMAIL, ATTACKER_PASSWORD));

        expect(listUsers).not.toHaveBeenCalled();
    });
});

// ─── the oracle ──────────────────────────────────────────────────────────────

describe('the reply does not say whether the address is registered', () => {
    it('A TAKEN ADDRESS AND A FREE ONE GET THE SAME PAYLOAD', async () => {
        // The finding in one assertion. Every field, not just the message:
        // a differing redirectUrl would answer the question just as well.
        seedVictim();
        const { registerAction } = await actions();

        const taken: any = await registerAction({}, registration(VICTIM_EMAIL, ATTACKER_PASSWORD));

        createUser.mockImplementation(async () => ({ data: { user: { id: 'fresh-uuid' } }, error: null }));
        const free: any = await registerAction({}, registration('nobody@example.com', ATTACKER_PASSWORD));

        expect(taken).toEqual(free);
        expect(taken.success).toBe(true);
    });

    it('and never names the address as already registered', async () => {
        seedVictim();
        const { registerAction } = await actions();

        const res: any = await registerAction({}, registration(VICTIM_EMAIL, ATTACKER_PASSWORD));

        expect(String(res.error ?? '')).not.toMatch(/already been registered/i);
        expect(String(res.error ?? '')).not.toMatch(/already exists/i);
    });

    it('writes nothing for the address it did not create', async () => {
        // The reply claims success; the store must still be untouched.
        seedVictim();
        const before = store.all(COLLECTIONS.USERS).length;
        const { registerAction } = await actions();

        await registerAction({}, registration(VICTIM_EMAIL, ATTACKER_PASSWORD));

        expect(store.all(COLLECTIONS.USERS)).toHaveLength(before);
    });

    it('TELLS THE PERSON WHO ACTUALLY OWNS THE ADDRESS', async () => {
        // The information is not secret from them — only from the prober. This
        // is what stops the fix from silently swallowing a real signal.
        seedVictim();
        const { registerAction } = await actions();

        await registerAction({}, registration(VICTIM_EMAIL, ATTACKER_PASSWORD));

        expect(sendEmailNotification).toHaveBeenCalledTimes(1);
        const sent = sendEmailNotification.mock.calls[0][0] as Record<string, string>;
        expect(sent.to).toBe(VICTIM_EMAIL);
        expect(sent.message).toMatch(/already exists/i);
    });

    it('and sends no such mail for an address that was genuinely free', async () => {
        createUser.mockImplementation(async () => ({ data: { user: { id: 'fresh-uuid' } }, error: null }));
        const { registerAction } = await actions();

        await registerAction({}, registration('nobody@example.com', ATTACKER_PASSWORD));

        expect(sendEmailNotification).not.toHaveBeenCalled();
    });
});

// ─── the owner's own path still works ────────────────────────────────────────

describe('someone re-registering their own address', () => {
    it('resumes when the account exists but the profile never landed', async () => {
        // A registration that died between creating the auth account and
        // writing the profile. Proving the password is what distinguishes this
        // from the takeover above.
        const { registerAction } = await actions();

        const res: any = await registerAction({}, registration(VICTIM_EMAIL, VICTIM_PASSWORD));

        expect(res.success).toBe(true);
        expect(store.get(COLLECTIONS.USERS, VICTIM_AUTH_ID)).toBeDefined();
    });

    it('but a complete account is told to log in rather than reset to defaults', async () => {
        // Naming the account here is safe: only somebody who just proved the
        // password can reach this branch.
        seedVictim();
        const { registerAction } = await actions();

        const res: any = await registerAction({}, registration(VICTIM_EMAIL, VICTIM_PASSWORD));

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/please log in/i);
        expect(store.get(COLLECTIONS.USERS, VICTIM_AUTH_ID)!.roles).toEqual(['super_admin']);
    });
});
