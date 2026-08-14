/**
 * @jest-environment node
 */

/**
 * When requireSession could not verify a session, it handed back the raw JWT —
 * including its administrative roles.
 *
 * THE BUG
 * -------
 * The live profile lookup is wrapped in a try/catch that ends:
 *
 *     } catch (e) {
 *         console.error("[SessionGuard] Verification failed:", e);
 *         // Fail open if database lookup fails for some reason or network
 *         // error to avoid breaking platform
 *     }
 *
 * and the function then falls through to `return { session, error: null }` with
 * the untouched NextAuth session. Two things do not happen on that path:
 *
 *   1. The ban and suspension check never runs — it sits inside `if (data)`.
 *   2. `session.user.roles` is not replaced by the live roles. The force-sync
 *      that exists precisely to beat a stale JWT is skipped, so the token's
 *      roles stand, up to eight hours after they were minted.
 *
 * Point 2 is the one that matters, because of how the codebase asks the
 * question: 99 files under src/app decide administrative authority by reading
 * `session.user.roles` off this function's result, against 14 that call
 * requireAdmin. So a revoked administrator kept administrative access for the
 * life of their token, on any request where this lookup happened to fail.
 *
 * TWO GUARDS, OPPOSITE POLICIES
 * -----------------------------
 * requireAdmin answers the same question in the same codebase, and says:
 *
 *     // Fail closed — never grant access if we cannot verify the live role
 *
 * Which policy applied depended on which guard a given route imported. They
 * agree now.
 *
 * WHAT IS DELIBERATELY UNCHANGED
 * ------------------------------
 * The fail-open itself, for ordinary users. It is a real availability trade —
 * a database blip should not sign every shopper out — and an ordinary token
 * grants nothing that needs live confirmation. The narrowing is to elevated
 * roles only, where the token grants authority that is supposed to be
 * revocable.
 *
 * Accepted with it: during a failed lookup an ordinary user's ban check is
 * still skipped for that request. Closing that means failing closed for
 * everyone, which is the availability decision this trade already made.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/**
 * jest.setup.js replaces this module wholesale — `requireSession: () =>
 * global.mockRequireSession()` — which is right for the hundred suites that
 * only need a caller. It also means the real function had never been executed
 * by any test, which is how the fail-open path went unexamined. This suite is
 * the one that runs it.
 */
jest.unmock('@/lib/session-guard');
jest.mock('server-only', () => ({}));

const auth = jest.fn<any>();
const getCached = jest.fn<any>();
const collection = jest.fn<any>();

jest.mock('@/lib/auth', () => ({ auth: (...a: any[]) => auth(...a) }));

jest.mock('@/lib/redis', () => ({
    getCached: (...a: any[]) => getCached(...a),
    setCache: jest.fn(async () => undefined),
    CacheKeys: { userProfile: (id: string) => `user:${id}` },
    CACHE_TTL: { USER_PROFILE: 300 },
}));

jest.mock('@/lib/supabase-db', () => ({
    getAdminDb: () => ({ collection: (...a: any[]) => collection(...a) }),
}));

jest.mock('@/lib/logger', () => ({
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

function sessionWith(roles: string[]) {
    return { user: { id: 'u1', email: 'u@example.com', name: 'Ada', roles } };
}

/** The lookup throws — the state the catch was written for. */
function lookupExplodes() {
    getCached.mockRejectedValue(new Error('redis down'));
    collection.mockImplementation(() => {
        throw new Error('database unreachable');
    });
}

/** The lookup succeeds and returns a live profile. */
function lookupReturns(profile: any) {
    getCached.mockResolvedValue(profile);
}

beforeEach(() => {
    jest.resetModules();
    auth.mockReset();
    getCached.mockReset();
    collection.mockReset();
});

describe('an unverifiable session cannot carry admin authority', () => {
    it.each([
        ['admin'],
        ['super_admin'],
        ['wave_admin'],
        ['cooperative_admin'],
        ['marketplace_admin'],
        ['export_admin'],
        ['farm_nation_admin'],
        ['academy_admin'],
    ])('refuses a %s whose live roles could not be read', async (role) => {
        // THE test. This returned the JWT — with that role intact — to the 99
        // files that read session.user.roles to decide what an admin may do.
        auth.mockResolvedValue(sessionWith([role]));
        lookupExplodes();
        const { requireSession } = await import('@/lib/session-guard');

        const result = await requireSession();

        expect(result.session).toBeNull();
        expect(result.error?.error).toMatch(/could not confirm your administrator access/i);
    });

    it('refuses when an admin role sits alongside ordinary ones', async () => {
        auth.mockResolvedValue(sessionWith(['general_user', 'seller', 'admin']));
        lookupExplodes();
        const { requireSession } = await import('@/lib/session-guard');

        const result = await requireSession();

        expect(result.session).toBeNull();
    });
});

describe('an ordinary user still rides out the blip', () => {
    it.each([['general_user'], ['seller'], ['wave_participant'], []])(
        'admits %s when the lookup fails',
        async (...roles: any[]) => {
            // The availability trade this fail-open was written for, kept.
            const list = roles.flat().filter(Boolean) as string[];
            auth.mockResolvedValue(sessionWith(list));
            lookupExplodes();
            const { requireSession } = await import('@/lib/session-guard');

            const result = await requireSession();

            expect(result.session).not.toBeNull();
            expect(result.error).toBeNull();
        }
    );
});

describe('a successful lookup is unaffected', () => {
    it('an admin whose live roles confirm it is admitted', async () => {
        // Vacuity guard: every assertion above is satisfied by a guard that
        // refuses all administrators, which would lock the admin suite out.
        auth.mockResolvedValue(sessionWith(['admin']));
        lookupReturns({ roles: ['admin'], serviceRegistrations: null });
        const { requireSession } = await import('@/lib/session-guard');

        const result = await requireSession();

        expect(result.session).not.toBeNull();
        expect(result.session?.user.roles).toEqual(['admin']);
    });

    it('and live roles still override the token', async () => {
        // The force-sync this function exists for: the JWT says admin, the
        // database says the role is gone, and the database wins.
        auth.mockResolvedValue(sessionWith(['admin']));
        lookupReturns({ roles: ['general_user'], serviceRegistrations: null });
        const { requireSession } = await import('@/lib/session-guard');

        const result = await requireSession();

        expect(result.session?.user.roles).toEqual(['general_user']);
    });

    it('a banned account is still refused', async () => {
        // The other check that the fail-open path skipped.
        auth.mockResolvedValue(sessionWith(['general_user']));
        lookupReturns({ roles: ['general_user'], isBanned: true });
        const { requireSession } = await import('@/lib/session-guard');

        const result = await requireSession();

        expect(result.session).toBeNull();
        expect(result.error?.error).toMatch(/suspended/i);
    });

    it('no session at all is still no session', async () => {
        auth.mockResolvedValue(null);
        const { requireSession } = await import('@/lib/session-guard');

        const result = await requireSession();

        expect(result.session).toBeNull();
        expect(result.error?.error).toMatch(/expired/i);
    });
});

describe('the two guards now agree', () => {
    it('requireAdmin still says fail closed, and session-guard now does too', async () => {
        const { readFileSync } = require('fs');
        const { join } = require('path');
        const requireAdminSrc: string = readFileSync(
            join(process.cwd(), 'src/lib/require-admin.ts'),
            'utf-8'
        );
        const guardSrc: string = readFileSync(
            join(process.cwd(), 'src/lib/session-guard.ts'),
            'utf-8'
        );

        expect(requireAdminSrc).toContain('Fail closed');
        expect(guardSrc).toContain('verificationFailed');
        expect(guardSrc).toContain('isAdmin((session.user as any).roles)');
    });
});
