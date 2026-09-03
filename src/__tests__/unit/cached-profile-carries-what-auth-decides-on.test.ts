/**
 * @jest-environment node
 */

/**
 *   #343 SECURITY: CHANGING YOUR PASSWORD NEVER SIGNED THE INTRUDER OUT.
 *
 *        #306 made changePasswordAction and resetPasswordAction stamp
 *        `sessionsValidFrom` on the user document, and the jwt callback in
 *        lib/auth.ts decide revocation from it:
 *
 *            const revokedBefore = Number((cachedProfile as any).sessionsValidFrom) || 0;
 *            token.sessionRevoked = revokedBefore > 0 && issuedAtMs > 0
 *                                   && issuedAtMs < revokedBefore;
 *
 *        `cachedProfile` is what lib/user-cache.ts's getUserProfile returns,
 *        and that function builds its result from a CLOSED FIELD LIST —
 *        id, email, displayName, roles, serviceRegistrations, profileComplete,
 *        requiresPasswordChange, isBanned, ... — which did not include
 *        `sessionsValidFrom`.
 *
 *        So `revokedBefore` was Number(undefined) || 0 = 0, the predicate
 *        short-circuited on `revokedBefore > 0`, and `token.sessionRevoked` was
 *        FALSE for every session that has ever existed on this platform. The
 *        fix that exists to eject somebody holding a stolen cookie ejected
 *        nobody.
 *
 *        THE `as any` IS WHAT LET IT COMPILE. CachedUserProfile did not declare
 *        the field; the cast said "trust me". Same shape as #256.
 *
 *        AND THE SUITE COULD NOT SEE IT, because it mocked the join:
 *
 *            getUserProfile.mockImplementation(async () =>
 *                ({ sessionsValidFrom: RESET_AT, roles: [] }));
 *
 *        A shape no writer produces — the #335 trap. The write was tested, the
 *        predicate was tested, and the projection between them was tested by
 *        nothing. This file is that missing half: it runs the REAL builder.
 *
 *        THE SECOND HALF: NOTHING CLEARED THE CACHE.
 *
 *        The entry lives for CACHE_TTL.USER_PROFILE — five minutes — and
 *        neither writer invalidated it. Two consequences, on the same key:
 *
 *          sessionsValidFrom       revocation waited out the TTL on top of the
 *                                  jwt callback's own 2-minute sync interval.
 *          requiresPasswordChange  session-guard and hub-guard both redirect to
 *                                  /auth/reset-legacy-password while it is set.
 *                                  A legacy member who completed the reset was
 *                                  sent straight back to the page they had just
 *                                  finished — a loop, for five minutes, on the
 *                                  one screen they cannot skip.
 *
 *        THE SAME CAST HID A SECOND DEAD BRANCH. The jwt callback's migration
 *        interceptor read `(cachedProfile as any)._migratedTo`, which
 *        getUserProfile also never returns — it resolves the migration itself
 *        and hands back the target profile. So `token.id` kept the LEGACY id
 *        while every other claim came from the migrated account. It now
 *        compares the id the profile actually came back with.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const REVOKE_AT = 1_700_000_000_000;

const store = new Map<string, any>();
const setCache = jest.fn(async (k: string, v: unknown, _ttl?: number) => { store.set(k, v); });
const getCached = jest.fn(async (k: string) => store.get(k) ?? null);
const deleteCache = jest.fn(async (k: string) => { store.delete(k); });

jest.mock('@/lib/redis', () => ({
    getCached: (k: string) => getCached(k),
    setCache: (k: string, v: unknown, ttl?: number) => setCache(k, v, ttl),
    deleteCache: (k: string) => deleteCache(k),
    CacheKeys: { userProfile: (id: string) => `user:profile:${id}` },
    CACHE_TTL: { USER_PROFILE: 300 },
    redis: null,
}));

// The Supabase read misses so the Firestore fallback runs — one place to put
// the fixture, and the path both branches converge on.
jest.mock('@/lib/supabase', () => ({
    supabaseAdmin: {
        from: () => ({
            select: () => ({ eq: () => ({ single: async () => ({ data: null, error: new Error('miss') }) }) }),
        }),
    },
}));

const USER_ROW: Record<string, any> = {
    email: 'ada@example.com',
    fullName: 'Ada Obi',
    roles: ['member'],
    profileComplete: true,
    requiresPasswordChange: true,
    sessionsValidFrom: REVOKE_AT,
};

jest.mock('@/lib/firebase-admin', () => ({
    getAdminDb: () => ({
        collection: () => ({
            doc: () => ({ get: async () => ({ exists: true, data: () => USER_ROW }) }),
        }),
    }),
}));

beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
});

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

// ─────────────────────────────────────────────────────────────────────────────
describe('#343 — the cached profile carries the revocation point', () => {
    it('THE REAL BUILDER RETURNS sessionsValidFrom', async () => {
        // THE test. Everything else in this finding follows from this field
        // being absent from the object the jwt callback reads.
        const { getUserProfile } = await import('@/lib/user-cache');

        const profile = await getUserProfile('u1');

        expect(profile).not.toBeNull();
        expect(profile!.sessionsValidFrom).toBe(REVOKE_AT);
    });

    it('and the value that reaches the CACHE carries it too', async () => {
        // The jwt callback reads through the cache on the second call, so a
        // field present on the fresh read and dropped on the way in would fail
        // exactly one request in five minutes.
        const { getUserProfile } = await import('@/lib/user-cache');
        await getUserProfile('u1');

        expect(store.get('user:profile:u1').sessionsValidFrom).toBe(REVOKE_AT);

        const second = await getUserProfile('u1');
        expect(second!.sessionsValidFrom).toBe(REVOKE_AT);
    });

    it('the fields already carried are still carried', async () => {
        // Vacuity guard: adding one key must not have disturbed the projection.
        const { getUserProfile } = await import('@/lib/user-cache');
        const p = (await getUserProfile('u1'))!;

        expect(p.roles).toEqual(['member']);
        expect(p.profileComplete).toBe(true);
        expect(p.requiresPasswordChange).toBe(true);
        expect(p.email).toBe('ada@example.com');
    });

    it('a row with no revocation point yields undefined, not 0 — the fail-open case', async () => {
        // lib/auth.ts fails open deliberately: `revokedBefore > 0` must be
        // false when nothing was ever stamped, or every user on the platform is
        // signed out at once.
        const { getUserProfile } = await import('@/lib/user-cache');
        delete USER_ROW.sessionsValidFrom;
        try {
            const p = (await getUserProfile('u2'))!;
            expect(p.sessionsValidFrom).toBeUndefined();
            expect(Number(p.sessionsValidFrom) || 0).toBe(0);
        } finally {
            USER_ROW.sessionsValidFrom = REVOKE_AT;
        }
    });

    it('and a non-numeric one does too rather than becoming NaN', async () => {
        const { getUserProfile } = await import('@/lib/user-cache');
        USER_ROW.sessionsValidFrom = 'not a timestamp';
        try {
            const p = (await getUserProfile('u3'))!;
            expect(p.sessionsValidFrom).toBeUndefined();
        } finally {
            USER_ROW.sessionsValidFrom = REVOKE_AT;
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#343 — the type is what checks it now, not a cast', () => {
    it('CachedUserProfile DECLARES sessionsValidFrom', () => {
        expect(source('src/lib/user-cache.ts')).toMatch(/sessionsValidFrom\?: number;/);
    });

    it('and the jwt callback reads it WITHOUT `as any`', () => {
        const auth = source('src/lib/auth.ts');

        expect(auth).toContain('Number(cachedProfile.sessionsValidFrom) || 0');
        expect(auth).not.toContain('(cachedProfile as any).sessionsValidFrom');
    });

    it('the migration interceptor no longer reads a field nobody returns', () => {
        const auth = source('src/lib/auth.ts');

        expect(auth).not.toContain('(cachedProfile as any)._migratedTo');
        expect(auth).toContain('cachedProfile.id !== token.id');
    });

    it('and getUserProfile really does resolve the migration itself', () => {
        // The claim the repair rests on: the interceptor was dead because the
        // field is consumed one level down.
        const cache = source('src/lib/user-cache.ts');

        expect(cache).toContain('userData._migratedTo');
        expect(cache).toContain('return getUserProfile(migratedId)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#343 — and the writers clear the cache they decide through', () => {
    it('changePasswordAction invalidates the cached profile', () => {
        // Without this the revocation it just stamped waits out a five-minute
        // TTL, and a legacy member is bounced back onto the reset page they
        // just completed for the same five minutes.
        expect(source('src/app/actions/auth.ts')).toContain('invalidateUserCache(session.user.id)');
    });

    it('and so does the password reset', () => {
        expect(source('src/app/actions/password-reset.ts'))
            .toContain('invalidateUserCache(profileDocId)');
    });

    it('invalidateUserCache really clears THE key these guards read', () => {
        // Pinned against the invalidator, not assumed: session-guard and
        // hub-guard both read CacheKeys.userProfile.
        const inval = source('src/lib/cache-invalidation.ts');

        expect(inval).toContain('deleteCache(CacheKeys.userProfile(userId))');
        expect(source('src/lib/session-guard.ts')).toContain('CacheKeys.userProfile(session.user.id)');
        expect(source('src/lib/hub-guard.ts')).toContain('CacheKeys.userProfile(sessionResult.session.user.id)');
    });

    it('the guards really do redirect on requiresPasswordChange', () => {
        // The other half of the loop, pinned so the cost above is not asserted
        // from memory.
        expect(source('src/lib/hub-guard.ts')).toMatch(
            /requiresPasswordChange[\s\S]{0,120}reset-legacy-password/);
        expect(source('src/lib/session-guard.ts')).toContain('data.requiresPasswordChange');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#343 — the ratchet: nothing else is read off the projection blind', () => {
    it('every field lib/auth.ts reads from cachedProfile is one the builder sets', () => {
        // This is the check that would have caught it. A new
        // `cachedProfile.somethingElse` that getUserProfile does not carry is
        // undefined at runtime and silent — which is how a security decision
        // came to be made on a value that was never there.
        const auth = source('src/lib/auth.ts');
        const cache = source('src/lib/user-cache.ts');

        const read = new Set(
            [...auth.matchAll(/cachedProfile(?:\s+as\s+any\))?\)?\.([A-Za-z_][A-Za-z0-9_]*)/g)]
                .map((m) => m[1]),
        );
        expect(read.size).toBeGreaterThan(8);      // vacuity guard on the scan

        // The object literal getUserProfile returns.
        const built = cache.slice(
            cache.indexOf('const profile: CachedUserProfile = {'),
            cache.indexOf('await setCache(cacheKey, profile'),
        );
        expect(built.length).toBeGreaterThan(200); // vacuity guard on the slice

        const missing = [...read].filter((f) => !new RegExp(`^\\s*${f}:`, 'm').test(built));

        expect(missing).toEqual([]);
    });
});
