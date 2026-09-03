/**
 * @jest-environment node
 */

/**
 * The NextAuth jwt and session callbacks, EXECUTED.
 *
 * lib/auth.ts was at 0% — jest.setup.js mocks the whole module globally, so
 * nothing in it had ever run in a test. That is a problem, because these two
 * callbacks are where the platform decides, on every single request, whether a
 * token still represents somebody who may act:
 *
 *   - SESSION REVOCATION. resetPasswordAction stamps `sessionsValidFrom` on the
 *     profile; a token minted before that point was authenticated with a
 *     credential that no longer exists — including, in the case this protects
 *     against, whoever prompted the reset. The comparison is strictly-before, and
 *     it FAILS OPEN by design: the cost of a false positive is signing out every
 *     user on the platform.
 *   - THE BAN CHECK. A banned or suspended profile nulls session.user and clears
 *     the Firebase token.
 *   - THE MIGRATION INTERCEPTOR. A profile carrying `_migratedTo` swaps the
 *     token's id for the target's, so a legacy account keeps working.
 *   - THE SYNC WINDOW. The profile is re-read at most every two minutes, which is
 *     the latency both the revocation and the ban inherit.
 *
 * HOW IT IS TESTED WITHOUT SIGNING ANYBODY IN
 * -------------------------------------------
 * `next-auth` is mocked to CAPTURE the configuration object rather than build a
 * handler, so the real callbacks can be called directly with a token and a
 * profile. Nothing here needs a browser, a cookie or a running app — which is
 * exactly why the callbacks are worth pulling out and executing.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

type Callbacks = {
    jwt(params: Record<string, unknown>): Promise<Record<string, unknown>>;
    session(params: Record<string, unknown>): Promise<Record<string, unknown>>;
};

/** The config lib/auth.ts hands to NextAuth. */
let captured: { callbacks: Callbacks; session?: Record<string, unknown> } | null = null;

jest.mock('next-auth', () => ({
    __esModule: true,
    default: (config: { callbacks: Callbacks }) => {
        captured = config as never;
        return { handlers: {}, signIn: jest.fn(), signOut: jest.fn(), auth: jest.fn() };
    },
    // lib/auth.ts subclasses this so a thrown error carries a code the sign-in
    // page can render — a plain Error always shows the generic 'Configuration'
    // page. A stand-in class is enough; the subclassing is what has to work.
    CredentialsSignin: class extends Error {
        code = 'credentials';
        type = 'CredentialsSignin';
    },
}));

// ESM-only, so Jest cannot parse it. Mocked to a plain factory — the credentials
// provider's own authorize() is not what these tests are about.
jest.mock('next-auth/providers/credentials', () => ({
    __esModule: true,
    default: (config: unknown) => config,
}));

const getUserProfile = jest.fn(async (_id: string) => null as Record<string, unknown> | null);
jest.mock('@/lib/user-cache', () => ({
    getUserProfile: (id: string) => getUserProfile(id),
    invalidateUserProfile: jest.fn(),
}));

const createCustomToken = jest.fn(
    async (_uid: string, _claims: Record<string, unknown>) => 'minted-firebase-token');
jest.mock('@/lib/firebase-admin', () => ({
    getAdminAuth: () => ({ createCustomToken }),
    getAdminDb: () => ({}),
    adminAuth: { createCustomToken },
}));

async function callbacks(): Promise<Callbacks> {
    // requireActual, because jest.setup.js replaces this module globally — which
    // is why it sat at 0% coverage.
    jest.requireActual('@/lib/auth');
    if (!captured) throw new Error('lib/auth.ts did not call NextAuth');
    return captured.callbacks;
}

beforeEach(() => {
    jest.clearAllMocks();
    getUserProfile.mockImplementation(async () => null);
    createCustomToken.mockImplementation(async () => 'minted-firebase-token');
});

/** A token past its sync window, so the callback re-reads the profile. */
function staleToken(extra: Record<string, unknown> = {}) {
    return { id: 'user-1', lastSyncedAt: 0, ...extra };
}

// ─── the sync window ─────────────────────────────────────────────────────────

describe('the profile sync', () => {
    it('re-reads the profile when the token has never been synced', async () => {
        getUserProfile.mockImplementation(async () => ({ roles: ['seller'] }));
        const cb = await callbacks();

        const token = await cb.jwt({ token: { id: 'user-1' } });

        expect(getUserProfile).toHaveBeenCalledWith('user-1');
        expect(token.roles).toEqual(['seller']);
        expect(token.lastSyncedAt).toBeGreaterThan(0);
    });

    it('and NOT again inside the two-minute window', async () => {
        // The whole point of the window: this callback runs on every request, and
        // re-reading the profile each time is a database round trip per page load
        // for every signed-in user.
        getUserProfile.mockImplementation(async () => ({ roles: ['seller'] }));
        const cb = await callbacks();

        await cb.jwt({ token: { id: 'user-1', lastSyncedAt: Date.now() - 30_000 } });

        expect(getUserProfile).not.toHaveBeenCalled();
    });

    it('but does once the window has passed', async () => {
        getUserProfile.mockImplementation(async () => ({ roles: ['seller'] }));
        const cb = await callbacks();

        await cb.jwt({ token: { id: 'user-1', lastSyncedAt: Date.now() - 3 * 60 * 1000 } });

        expect(getUserProfile).toHaveBeenCalled();
    });

    it('and immediately on an explicit update, whatever the window says', async () => {
        // What a role change relies on. Without this an admin granting a role
        // waits up to two minutes for it to take effect.
        getUserProfile.mockImplementation(async () => ({ roles: ['admin'] }));
        const cb = await callbacks();

        const token = await cb.jwt({
            token: { id: 'user-1', lastSyncedAt: Date.now() },
            trigger: 'update',
        });

        expect(getUserProfile).toHaveBeenCalled();
        expect(token.roles).toEqual(['admin']);
    });

    it('syncing the fields the rest of the platform reads off the token', async () => {
        getUserProfile.mockImplementation(async () => ({
            roles: ['seller', 'cooperative_member'],
            onboardingCompleted: true,
            sellerVerificationStatus: 'approved',
            serviceRegistrations: { export: { status: 'approved' } },
            gender: 'female',
        }));
        const cb = await callbacks();

        const token = await cb.jwt({ token: staleToken() });

        expect(token.roles).toEqual(['seller', 'cooperative_member']);
        expect(token.onboardingCompleted).toBe(true);
        expect(token.sellerVerificationStatus).toBe('approved');
        expect(token.serviceRegistrations).toEqual({ export: { status: 'approved' } });
        expect(token.gender).toBe('female');
    });

    it('and leaving the token alone when the profile cannot be read', async () => {
        // Fails open. A cache outage that signed everybody out would be a worse
        // failure than a stale role for two minutes.
        getUserProfile.mockImplementation(async () => { throw new Error('cache down'); });
        const cb = await callbacks();

        const token = await cb.jwt({ token: staleToken({ roles: ['seller'] }) });

        expect(token.roles).toEqual(['seller']);
    });

    it('and doing nothing at all for a token with no id', async () => {
        const cb = await callbacks();
        await cb.jwt({ token: {} });
        expect(getUserProfile).not.toHaveBeenCalled();
    });
});

// ─── session revocation ──────────────────────────────────────────────────────

describe('session revocation after a password reset', () => {
    const RESET_AT = 1_700_000_000_000;

    /**
     *   #343 THESE MOCKS DESCRIBED A PROFILE NOBODY PRODUCED.
     *
     *        Every case below stubs getUserProfile as
     *
     *            async () => ({ sessionsValidFrom: RESET_AT, roles: [] })
     *
     *        and the predicate under test is correct given that shape. The real
     *        getUserProfile builds its result from a CLOSED FIELD LIST that did
     *        not contain sessionsValidFrom, so live it was always undefined,
     *        `revokedBefore` was 0, and `token.sessionRevoked` was false for
     *        every session that ever existed — #306's revocation never revoked
     *        anything.
     *
     *        The write side was tested, the read side was tested against a
     *        fabricated profile, and the projection joining them was tested by
     *        nothing. The cases stay as they are — the predicate is worth
     *        pinning — and the missing half is now in
     *        cached-profile-carries-what-auth-decides-on.test.ts, which asserts
     *        against the REAL builder.
     */
    it('marks a token minted BEFORE the reset as revoked', async () => {
        getUserProfile.mockImplementation(async () => ({ sessionsValidFrom: RESET_AT, roles: [] }));
        const cb = await callbacks();

        const token = await cb.jwt({ token: staleToken({ authAt: RESET_AT - 1000 }) });

        expect(token.sessionRevoked).toBe(true);
    });

    it('and one minted after as fine', async () => {
        getUserProfile.mockImplementation(async () => ({ sessionsValidFrom: RESET_AT, roles: [] }));
        const cb = await callbacks();

        const token = await cb.jwt({ token: staleToken({ authAt: RESET_AT + 1000 }) });

        expect(token.sessionRevoked).toBe(false);
    });

    it('with the comparison STRICTLY before, so the resetting session survives', async () => {
        // The boundary decides whether the person who just reset their own
        // password is signed out by their own reset. Strictly-before keeps them
        // in.
        getUserProfile.mockImplementation(async () => ({ sessionsValidFrom: RESET_AT, roles: [] }));
        const cb = await callbacks();

        const token = await cb.jwt({ token: staleToken({ authAt: RESET_AT }) });

        expect(token.sessionRevoked).toBe(false);
    });

    it('falling back to iat, which is in SECONDS', async () => {
        // NextAuth records iat in seconds and authAt in milliseconds. Comparing
        // seconds against a millisecond timestamp would make every token look
        // older than every reset, and sign the whole platform out.
        getUserProfile.mockImplementation(async () => ({ sessionsValidFrom: RESET_AT, roles: [] }));
        const cb = await callbacks();

        const before = await cb.jwt({ token: staleToken({ iat: (RESET_AT - 5000) / 1000 }) });
        expect(before.sessionRevoked).toBe(true);

        const after = await cb.jwt({ token: staleToken({ iat: (RESET_AT + 5000) / 1000 }) });
        expect(after.sessionRevoked).toBe(false);
    });

    it('and FAILING OPEN when the profile records no revocation point', async () => {
        getUserProfile.mockImplementation(async () => ({ roles: [] }));
        const cb = await callbacks();

        const token = await cb.jwt({ token: staleToken({ authAt: 1 }) });

        expect(token.sessionRevoked).toBe(false);
    });

    it('or when the token records no issue time', async () => {
        // Both halves of the fail-open. Either missing means the question cannot
        // be answered, and the answer to an unanswerable question here is "leave
        // them signed in".
        getUserProfile.mockImplementation(async () => ({ sessionsValidFrom: RESET_AT, roles: [] }));
        const cb = await callbacks();

        const token = await cb.jwt({ token: staleToken() });

        expect(token.sessionRevoked).toBe(false);
    });
});

// ─── the ban check ───────────────────────────────────────────────────────────

describe('the ban check', () => {
    it.each([
        ['isBanned', { isBanned: true }],
        ['status banned', { status: 'banned' }],
        ['suspended', { suspended: true }],
    ])('marks a token banned from %s', async (_label, profile) => {
        // Three spellings, one state. A check reading only `isBanned` leaves a
        // suspended member signed in — which is the same shape as the cooperative
        // suspension that revoked nothing.
        getUserProfile.mockImplementation(async () => ({ roles: [], ...profile }));
        const cb = await callbacks();

        const token = await cb.jwt({ token: staleToken() });

        expect(token.isBanned).toBe(true);
    });

    it('and an ordinary profile as not banned', async () => {
        getUserProfile.mockImplementation(async () => ({ roles: ['user'] }));
        const cb = await callbacks();

        const token = await cb.jwt({ token: staleToken() });
        expect(token.isBanned).toBe(false);
    });
});

// ─── the migration interceptor ───────────────────────────────────────────────

describe('a migrated account', () => {
    /**
     *   #343 THESE THREE ALSO DESCRIBED A SHAPE NOBODY PRODUCES.
     *
     *        They stubbed getUserProfile as `{ _migratedTo: 'new-1', ... }` and
     *        the callback read `(cachedProfile as any)._migratedTo`. The REAL
     *        getUserProfile never returns that field: it follows the pointer
     *        ITSELF —
     *
     *            if (userData._migratedTo && userData._migratedTo !== userId)
     *                return getUserProfile(migratedId);
     *
     *        — and hands back the TARGET profile, whose `id` is the migrated id.
     *        So the branch in the callback could never run, and `token.id` kept
     *        the legacy id while roles, serviceRegistrations and every other
     *        claim came from the migrated account.
     *
     *        Same cast, same file, same finding as sessionsValidFrom. Rewritten
     *        against the real contract: what comes back is the target profile,
     *        and the id it carries is the fact to act on.
     */
    it('swaps the token id for the migration target', async () => {
        // What getUserProfile('legacy-1') actually returns after following the
        // pointer: the NEW account's profile, carrying the new id.
        getUserProfile.mockImplementation(async () => ({ id: 'new-1', roles: ['seller'] }));

        const cb = await callbacks();
        const token = await cb.jwt({ token: { id: 'legacy-1', lastSyncedAt: 0 } });

        expect(token.id).toBe('new-1');
        expect(token.roles).toEqual(['seller']);
    });

    it('and leaves the token alone when the target cannot be loaded', async () => {
        // Half a migration is worse than none. getUserProfile returns null when
        // the pointer names a row that is gone — its recursive call finds
        // nothing — so there is no profile to adopt and the token is untouched.
        getUserProfile.mockImplementation(async () => null);

        const cb = await callbacks();
        const token = await cb.jwt({ token: { id: 'legacy-1', lastSyncedAt: 0 } });

        expect(token.id).toBe('legacy-1');
    });

    it('and does not move an id that is already the right one', async () => {
        // An unmigrated account returns its own id, so the comparison is false
        // and nothing is rewritten. getUserProfile's own guard
        // (`_migratedTo !== userId`) is what stops a self-pointer looping.
        getUserProfile.mockImplementation(async () => ({ id: 'user-1', roles: ['self'] }));

        const cb = await callbacks();
        const token = await cb.jwt({ token: staleToken() });

        expect(token.id).toBe('user-1');
        expect(getUserProfile).toHaveBeenCalledTimes(1);
    });
});

// ─── the session callback ────────────────────────────────────────────────────

describe('building the session', () => {
    function sessionParams(token: Record<string, unknown>) {
        return { session: { user: { id: 'user-1' } } as Record<string, unknown>, token };
    }

    it('nulls the user when the token is banned', async () => {
        const cb = await callbacks();
        const session = await cb.session(sessionParams({ id: 'user-1', isBanned: true }));

        expect(session.user).toBeNull();
        expect(session.firebaseToken).toBeUndefined();
        expect(createCustomToken).not.toHaveBeenCalled();
    });

    it('and when the session was revoked — same treatment, same reason', async () => {
        const cb = await callbacks();
        const session = await cb.session(sessionParams({ id: 'user-1', sessionRevoked: true }));

        expect(session.user).toBeNull();
        expect(createCustomToken).not.toHaveBeenCalled();
    });

    it('clearing a Firebase token that had already been minted', async () => {
        // The token is the credential the browser uses against Firebase directly.
        // Leaving it on a revoked session hands out access the session no longer
        // grants.
        const cb = await callbacks();
        const token = { id: 'user-1', sessionRevoked: true, firebaseToken: 'stale-token' };
        const session = await cb.session(sessionParams(token));

        expect(session.firebaseToken).toBeUndefined();
        expect(token.firebaseToken).toBeUndefined();
    });

    /**
     *   THE MINTING TESTS ARE GONE, AND WHAT THEY WERE TESTING WITH THEM.
     *
     *        Five tests stood here — mint, reuse inside fifty minutes, re-mint
     *        past it, fall back to the stale token when minting fails, stay
     *        usable when it fails with nothing cached — around a block in
     *        lib/auth.ts that computed
     *
     *            adminAuth.createCustomToken(token.id, { roles, verified })
     *
     *        package.json maps firebase-admin to the local shim, and that
     *        method is `return "mock-custom-token";`. Every session carried the
     *        same literal string, shipped to the browser, shaped like a
     *        credential. Nothing read it: `firebaseToken` appears nowhere
     *        outside lib/auth.ts and this file. The client half is a stub too.
     *
     *        These tests could not see any of that BECAUSE THEY MOCKED IT.
     *        `createCustomToken` was stubbed to return
     *        'minted-firebase-token', and the assertions were about the cache
     *        around it. Mocking the one function whose real implementation is
     *        the defect is what kept thirty-five lines of dead machinery
     *        looking alive, and counted this file as covered.
     *
     *        The lesson is not "do not mock". It is that a mock standing in for
     *        a dependency you have never read is an assumption, and this suite
     *        had one at its centre.
     */
    it('DOES NOT MINT ANYTHING, BECAUSE THERE IS NOTHING TO MINT', async () => {
        const cb = await callbacks();

        const session = await cb.session(sessionParams({ id: 'user-1', roles: ['seller'] }));

        expect(createCustomToken).not.toHaveBeenCalled();
        expect(session.firebaseToken).toBeUndefined();
        expect(session.user).not.toBeNull();
    });

    it('and the shim it used to call really does return a constant', () => {
        // The premise, read from the shim rather than remembered. If this is
        // ever made real, the removal above is worth revisiting.
        const shim = readFileSync(
            join(process.cwd(), 'src/lib/shims/firebase-admin/auth.js'), 'utf-8');
        const body = shim.slice(shim.indexOf('async createCustomToken('));

        expect(body.slice(0, body.indexOf('}'))).toContain('return "mock-custom-token"');
    });

    it('and nothing in the application reads a firebaseToken', () => {
        // The other half of the argument for deleting it. Scoped to src, and
        // excluding this file and lib/auth.ts, which discuss it.
        const hits: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) { walk(full); continue; }
                if (!/\.tsx?$/.test(entry)) continue;
                const rel = full.replace(process.cwd() + '/', '');
                if (rel === 'src/lib/auth.ts' || rel.includes('auth-callbacks-behaviour')) continue;
                if (readFileSync(full, 'utf-8').includes('firebaseToken')) hits.push(rel);
            }
        };
        walk(join(process.cwd(), 'src'));

        expect(hits).toEqual([]);
    });
});

// ─── fresh sign-in ───────────────────────────────────────────────────────────

describe('a fresh sign-in', () => {
    it('clears any cached Firebase token from the previous session', async () => {
        // Signing in as somebody else on the same browser must not inherit the
        // previous account's Firebase credential.
        const cb = await callbacks();

        const token = await cb.jwt({
            token: { id: 'user-1', lastSyncedAt: Date.now(), firebaseToken: 'previous', firebaseTokenMintedAt: 1 },
            user: { id: 'user-1' },
        });

        expect(token.firebaseToken).toBeUndefined();
        expect(token.firebaseTokenMintedAt).toBeUndefined();
    });
});
