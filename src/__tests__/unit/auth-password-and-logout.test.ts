/**
 * @jest-environment node
 */

/**
 * changePasswordAction and logoutAction, EXECUTED.
 *
 * Both were at 0%. One of them is the account-recovery path a person uses after
 * a credential has been stolen, and the other is the one they use to leave.
 *
 * THE SECOND WRITE THAT CANNOT DO WHAT ITS COMMENT SAYS
 * ----------------------------------------------------
 * changePasswordAction writes the new password twice, and explains why:
 *
 *     // Firebase second, and it matters: lib/auth.ts falls back to it when
 *     // Supabase rejects a password, so leaving the old one there keeps a
 *     // superseded credential alive.
 *     await adminAuth.updateUser(session.user.id, { password: newPassword });
 *
 * The reasoning is sound and the call cannot carry it out. package.json maps
 *
 *     "firebase-admin": "file:./src/lib/shims/firebase-admin"
 *
 * and the shim's updateUser is one line:
 *
 *     supabaseAdmin.auth.admin.updateUserById(uid, updateData)
 *
 * So it writes to the SAME Supabase auth store the previous call just wrote to.
 * Firebase — the real identitytoolkit.googleapis.com service that lib/auth.ts's
 * fallback actually verifies against — is never touched, and the superseded
 * credential the comment is worried about is exactly as alive afterwards.
 *
 * Worse than a no-op, it uses the WRONG ID. The function goes to some care ten
 * lines above to distinguish `session.user.id` (the legacy profile id) from
 * `supabaseAuthId` (the Supabase account), because for a migrated account they
 * differ — and then passes the legacy one here. So for precisely the legacy
 * accounts this block exists to serve, it targets a Supabase id that does not
 * exist, throws, and is caught and logged as
 *
 *     "[changePassword] Legacy Firebase password update skipped"
 *
 * which reads like an optional step degrading gracefully rather than one that
 * has never once succeeded.
 *
 * THE PRECEDENT IS IN THIS FILE ALREADY
 * -------------------------------------
 * registerAction had the identical block and it was removed, with a comment
 * that states this exact reasoning: "package.json maps firebase-admin to
 * src/lib/shims/firebase-admin, so adminAuth.createUser writes to the SAME
 * Supabase auth store... confirmed by calling it, not by reading." The
 * conclusion was written down 200 lines above this call and not applied to it.
 *
 * NOT A LIVE CREDENTIAL HOLE, AND WHY
 * -----------------------------------
 * The obvious worry is that the stale Firebase password still logs you in.
 * It does not, and the reason is worth recording so nobody re-derives it: the
 * fallback in lib/auth.ts verifies against Firebase and then calls
 * supabaseAdmin.auth.admin.createUser to provision the account. For anyone who
 * has changed their password, that account already exists, so createUser
 * returns "already exists" and the branch throws auth/invalid-credential. The
 * fallback can only complete for an account NOT yet in Supabase. So this is a
 * dead write, not an open door — asserted below rather than assumed.
 *
 * THE COOKIE PREFIXES logoutAction CANNOT CLEAR
 * ---------------------------------------------
 * logoutAction clears four session-cookie names and four CSRF names with
 *
 *     cookieStore.set(name, "", { expires: new Date(0), path: "/" })
 *
 * Two of those names are `__Secure-` prefixed and two are `__Host-` prefixed,
 * and in production (useSecureCookies) those are the live ones. Both prefixes
 * are rejected by the browser unless the Set-Cookie carries the Secure
 * attribute, and this passes no `secure`. So the deletions the code is most
 * explicit about are the two the browser discards.
 *
 * signOut() clears the current session cookie itself with the right attributes,
 * so this is a belt-and-braces pass that fails rather than a broken logout —
 * said plainly here because the honest severity is the point.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

const LEGACY_PROFILE_ID = 'firebase-legacy-uid';
const SUPABASE_ACCOUNT_ID = 'supabase-uuid-1';
const EMAIL = 'learner@example.com';

const updateUserById = jest.fn(async (_id: string, _p: Record<string, unknown>) => ({ error: null as any }));
const adminUpdateUser = jest.fn(async (_id: string, _p: Record<string, unknown>) => ({}));
const signInWithPassword = jest.fn(async (_c: { email: string; password: string }) => ({
    data: { user: { id: SUPABASE_ACCOUNT_ID } } as any,
    error: null as any,
}));

let sessionUser: Record<string, unknown> | null = null;

jest.mock('@/lib/supabase', () => ({
    supabaseAdmin: {
        auth: { admin: { updateUserById: (id: string, p: Record<string, unknown>) => updateUserById(id, p) } },
    },
}));
jest.mock('@/lib/firebase-admin', () => ({
    adminAuth: { updateUser: (id: string, p: Record<string, unknown>) => adminUpdateUser(id, p) },
}));
jest.mock('@supabase/supabase-js', () => ({
    createClient: () => ({ auth: { signInWithPassword: (c: any) => signInWithPassword(c) } }),
}));
jest.mock('@/lib/auth', () => ({
    auth: async () => (sessionUser ? { user: sessionUser } : null),
    signOut: jest.fn(async () => undefined),
}));
jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: async () => ({ success: true }) }),
    loginLimiter: { check: async () => ({ success: true }) },
    getActionClientIp: async () => '127.0.0.1',
    checkRateLimit: async () => ({ success: true }),
}));
jest.mock('resend', () => ({
    Resend: class { emails = { send: async () => ({ error: null }) }; },
}));

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    updateUserById.mockImplementation(async () => ({ error: null }));
    adminUpdateUser.mockImplementation(async () => ({}));
    signInWithPassword.mockImplementation(async () => ({
        data: { user: { id: SUPABASE_ACCOUNT_ID } }, error: null,
    }));
    sessionUser = {
        id: LEGACY_PROFILE_ID,
        email: EMAIL,
        authAt: Math.floor(Date.now() / 1000) - 60,
    };
});

async function actions() {
    return import('@/app/actions/auth');
}

const GOOD = 'Str0ng!NewPassw0rd';
const CURRENT = '0ldPassw0rd!x';

// ─── the premise, pinned at its source ───────────────────────────────────────

describe('the shim this finding rests on', () => {
    it('package.json really does map firebase-admin at the shim', () => {
        // Every claim above depends on this line. Read rather than remembered,
        // so the finding fails loudly if the dependency is ever made real.
        //
        // It is declared in devDependencies, which is its own oddity:
        // src/lib/firebase-admin.ts is production code and imports
        // `firebase-admin/auth` at module scope, so an install with
        // --omit=dev would not resolve it. Nothing is broken today — every
        // build path here installs dev dependencies, and the target is a
        // file: path inside this repo either way — so this is recorded and
        // asserted where it actually lives rather than moved, which is a
        // packaging decision rather than a defect fix.
        const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
        const declared = pkg.dependencies?.['firebase-admin'] ?? pkg.devDependencies?.['firebase-admin'];

        expect(declared).toBe('file:./src/lib/shims/firebase-admin');
        expect(pkg.dependencies?.['firebase-admin']).toBeUndefined();
    });

    it('and the shim\'s updateUser writes to Supabase, not to Firebase', () => {
        const shim = readFileSync(join(process.cwd(), 'src/lib/shims/firebase-admin/auth.js'), 'utf-8');
        const body = shim.slice(shim.indexOf('async updateUser('));

        expect(body.slice(0, body.indexOf('async deleteUser')))
            .toContain('supabaseAdmin.auth.admin.updateUserById(uid, updateData)');
    });
});

// ─── the password change ─────────────────────────────────────────────────────

describe('changePasswordAction writes the new password once, to the right account', () => {
    function seedLegacyProfile(): void {
        // A migrated legacy account: the profile is keyed by the old id and
        // records the Supabase account separately. This is the case the removed
        // block claimed to serve, and the case it got wrong.
        store.seed(COLLECTIONS.USERS, LEGACY_PROFILE_ID, {
            email: EMAIL,
            supabaseAuthId: SUPABASE_ACCOUNT_ID,
            requiresPasswordChange: true,
        });
    }

    it('updates the Supabase account the credential actually lives in', async () => {
        seedLegacyProfile();

        const res: any = await (await actions()).changePasswordAction(CURRENT, GOOD);

        expect(res.success).toBe(true);
        expect(updateUserById).toHaveBeenCalledTimes(1);
        expect(updateUserById).toHaveBeenCalledWith(SUPABASE_ACCOUNT_ID, { password: GOOD });
    });

    it('AND MAKES NO SECOND WRITE THROUGH THE FIREBASE SHIM', async () => {
        // Was: adminAuth.updateUser(session.user.id, ...) — the same Supabase
        // store via the shim, addressed by the LEGACY id, which for this
        // account is not a Supabase account id at all.
        seedLegacyProfile();

        await (await actions()).changePasswordAction(CURRENT, GOOD);

        expect(adminUpdateUser).not.toHaveBeenCalled();
    });

    it('reports failure when the one write that matters fails', async () => {
        // The whole point of removing the second write is that the first is
        // load-bearing. If it does not land, this must not say "changed".
        seedLegacyProfile();
        updateUserById.mockImplementation(async () => ({ error: { message: 'nope' } }));

        const res: any = await (await actions()).changePasswordAction(CURRENT, GOOD);

        expect(res.success).toBe(false);
    });

    it('clears the forced-change flag and stamps the revocation point', async () => {
        seedLegacyProfile();

        await (await actions()).changePasswordAction(CURRENT, GOOD);

        const profile = store.get(COLLECTIONS.USERS, LEGACY_PROFILE_ID)!;
        expect(profile.requiresPasswordChange).toBeUndefined();
        expect(profile.sessionsValidFrom).toBe(sessionUser!.authAt);
    });

    it('does not revoke when this session records no issue time, rather than guessing', async () => {
        // Fails OPEN deliberately: a wrong value signs out a user who did
        // nothing wrong, a missing one leaves a session that still expires.
        seedLegacyProfile();
        sessionUser = { id: LEGACY_PROFILE_ID, email: EMAIL };

        const res: any = await (await actions()).changePasswordAction(CURRENT, GOOD);

        expect(res.success).toBe(true);
        expect(store.get(COLLECTIONS.USERS, LEGACY_PROFILE_ID)!.sessionsValidFrom).toBeUndefined();
    });

    it('refuses a new password that would not pass registration', async () => {
        seedLegacyProfile();

        const res: any = await (await actions()).changePasswordAction(CURRENT, 'short');

        expect(res.success).toBe(false);
        expect(updateUserById).not.toHaveBeenCalled();
    });

    it('refuses re-using the current password', async () => {
        seedLegacyProfile();

        const res: any = await (await actions()).changePasswordAction(GOOD, GOOD);

        expect(res.success).toBe(false);
        expect(updateUserById).not.toHaveBeenCalled();
    });

    it('refuses an unauthenticated caller', async () => {
        sessionUser = null;

        const res: any = await (await actions()).changePasswordAction(CURRENT, GOOD);

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/unauthorized/i);
    });
});

// ─── the stale Firebase credential, and why it is not a door ─────────────────

describe('the credential the removed block worried about', () => {
    it('cannot be used, because the legacy fallback refuses an account already in Supabase', () => {
        /**
         * Read from lib/auth.ts rather than asserted from behaviour, because
         * the branch is an HTTP call to Google. The claim is narrow: after the
         * Firebase REST check passes, the fallback provisions the account in
         * Supabase, and an "already exists" answer is turned into a refusal.
         * Anyone who has changed their password already exists, so the stale
         * Firebase password cannot complete a login.
         */
        const auth = readFileSync(join(process.cwd(), 'src/lib/auth.ts'), 'utf-8');

        expect(auth).toContain("createError.message?.includes('already exists')");
        expect(auth).toContain('throw new Error("auth/invalid-credential")');
    });
});

// ─── logout ──────────────────────────────────────────────────────────────────

describe('logoutAction clears cookies the browser will accept', () => {
    type SetCall = { name: string; opts: Record<string, unknown> };

    async function runLogout(host: string): Promise<SetCall[]> {
        const calls: SetCall[] = [];
        jest.doMock('next/headers', () => ({
            cookies: async () => ({
                set: (name: string, _v: string, opts: Record<string, unknown>) => { calls.push({ name, opts }); },
            }),
            headers: async () => ({ get: (k: string) => (k === 'host' ? host : null) }),
        }));
        jest.doMock('next/cache', () => ({
            revalidatePath: jest.fn(), revalidateTag: jest.fn(), updateTag: jest.fn(),
        }));

        const { logoutAction } = await import('@/app/actions/auth');
        await logoutAction();
        return calls;
    }

    beforeEach(() => { jest.resetModules(); });

    it('EVERY __Secure- AND __Host- DELETION CARRIES THE Secure ATTRIBUTE', async () => {
        // Was: none of them did. A Set-Cookie for either prefix without Secure
        // is rejected outright, so the two names that are live in production
        // were the two the browser threw away.
        const calls = await runLogout('app.example.com');
        const prefixed = calls.filter(c => c.name.startsWith('__Secure-') || c.name.startsWith('__Host-'));

        expect(prefixed.length).toBeGreaterThan(0);
        expect(prefixed.filter(c => c.opts.secure !== true).map(c => c.name)).toEqual([]);
    });

    it('and no __Host- deletion carries a Domain, which that prefix forbids', async () => {
        const calls = await runLogout('app.example.com');
        const host = calls.filter(c => c.name.startsWith('__Host-'));

        expect(host.length).toBeGreaterThan(0);
        expect(host.filter(c => c.opts.domain !== undefined).map(c => c.name)).toEqual([]);
    });

    it('which holds because only the session list is Domain-scoped and none of it is __Host-', () => {
        /**
         * The property above is true today for a structural reason, not
         * because the loop checks for it: `__Host-` names appear only in the
         * CSRF list, which is never Domain-scoped. A per-name guard in the
         * session loop would never fire — it survived mutation, which is how
         * this was noticed — so the invariant is pinned here instead, over
         * the list where it can actually be broken by adding a name.
         */
        const source = readFileSync(join(process.cwd(), 'src/app/actions/auth.ts'), 'utf-8');
        const tokenNames = source.slice(source.indexOf('const tokenNames = ['));
        const list = tokenNames.slice(0, tokenNames.indexOf(']'));

        expect(list).toContain('__Secure-authjs.session-token');
        expect(list).not.toContain('__Host-');
    });

    it('clears both the current and the legacy session cookie names', async () => {
        const calls = await runLogout('app.example.com');
        const names = new Set(calls.map(c => c.name));

        expect(names.has('authjs.session-token')).toBe(true);
        expect(names.has('__Secure-authjs.session-token')).toBe(true);
        expect(names.has('next-auth.session-token')).toBe(true);
    });

    it('does not set a Domain on localhost, where there is no registrable domain', async () => {
        const calls = await runLogout('localhost:3000');

        expect(calls.filter(c => c.opts.domain !== undefined)).toEqual([]);
    });
});
