/**
 *   THE OWNER: "fix the farm nation one next."
 *
 *   The same shape #270 found on marketplace, and one more underneath it that
 *   #270 could not see because it only looked at one module.
 *
 * ── MEASURED, NOT GUESSED ───────────────────────────────────────────────────
 *
 *   #261's read meter, with a real per-request memoiser standing in for
 *   React's cache() — a PASS-THROUGH under jest, so a suite that skips that
 *   step measures a platform with no request memoisation at all. Baseline is
 *   the tree WITH #270 already in, so none of this double-counts it:
 *
 *       /farm-nation/onboarding   11 reads → 7
 *       checkFarmNationStatus      6 reads → 5   (the action alone)
 *       /marketplace/onboarding     7 reads → 6
 *       a WAVE page draw            8 reads → 7
 *
 *   THREE CHANGES, AND THE THIRD IS THE ONE THAT REACHES EVERY MODULE.
 *
 *   1. checkFarmNationStatusAction re-read the caller's own row inside
 *      `ownedProfileIdsFor`'s forward walk — the row it had fetched four lines
 *      earlier. #270's `isLiveUserRow` branch, applied here.
 *
 *   2. The same call was written out TWICE, once in a try and once in its
 *      catch, so the "fallback" re-asked the identical question. Hoisted.
 *
 *   3. checkModuleAccess read `users/<id>` with a bare `.doc(id).get()`.
 *      lib/current-user-doc's own header names this exact read as one of the
 *      four copies it counted on a single page draw — and it was still bare on
 *      the gate that EVERY module layout runs on EVERY page. That one line is
 *      why WAVE and marketplace move too, and neither of those modules is what
 *      the owner asked about.
 *
 * ── WHY THE MEMO IS SAFE ON A GATE ──────────────────────────────────────────
 *
 *   Because a gate does not only read — it HEALS, six times in that file. All
 *   six call `invalidateServiceCache` immediately after writing, and that
 *   drops the memo (`forgetUserDoc`) before it touches Redis. Without that
 *   the gate would serve its own reader the copy taken before the grant,
 *   which is #692 exactly. The last test here pins it.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

//   A real per-request memoiser. See the header.
jest.mock('react', () => {
    const actual: any = jest.requireActual('react');
    return {
        ...actual,
        cache: (fn: any) => {
            const memo = new Map<string, any>();
            return (...args: any[]) => {
                const key = JSON.stringify(args);
                if (!memo.has(key)) memo.set(key, fn(...args));
                return memo.get(key);
            };
        },
    };
});

/*
 *   ONLY SO THE REAL cache-invalidation CAN BE LOADED. It imports ./redis,
 *   which pulls @upstash/redis — ESM that jest cannot parse — and the last
 *   test here has to run the REAL invalidateServiceCache rather than the
 *   suite-wide stub. Nothing else in this file touches the cache.
 */
jest.mock('@/lib/redis', () => ({
    deleteCache: jest.fn(async () => true),
    CacheKeys: { userProfile: (id: string) => `user:profile:${id}` },
}));

jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: jest.fn(async () => ({ success: true, limit: 100, remaining: 99, reset: 0 })) }),
    getClientIp: jest.fn(() => '127.0.0.1'),
    createRateLimitResponse: jest.fn(),
}));

const UID = 'farmer-1';
const EMAIL = 'farmer@example.test';

/** Today's cost of drawing each screen for a member with nothing filed yet. */
const CEILING = {
    farmNationAction: 5,   // was 6
    farmNationPage: 7,     // was 11
    marketplacePage: 6,    // was 7, after #270 took it from 11
    wavePage: 7,           // was 8
};

let store: FakeDbHandle;

const sessionAs = (id: string, email: string) => {
    (global as any).mockRequireSession = jest.fn(() => Promise.resolve({
        session: { user: { id, email, roles: ['general_user'] } },
        error: null,
    }));
};

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, UID, {
        uid: UID, email: EMAIL, roles: ['general_user'],
        isVerified: true, profileComplete: true, serviceRegistrations: {},
    });
    sessionAs(UID, EMAIL);
});

const ownRowReads = () =>
    store.reads.filter((r: any) => r.collection === COLLECTIONS.USERS && r.id === UID).length;

describe('what /farm-nation/onboarding costs a member who has not applied', () => {
    it('the action reads the caller\'s own row ONCE, not twice', async () => {
        const { checkFarmNationStatusAction } = await import('@/app/actions/farm-nation/_fn_onboarding');
        store.reads.length = 0;

        await checkFarmNationStatusAction();

        expect(ownRowReads()).toBe(1);
    });

    it('DOES NOT GROW — five reads is the action\'s ceiling, down from six', async () => {
        const { checkFarmNationStatusAction } = await import('@/app/actions/farm-nation/_fn_onboarding');
        store.reads.length = 0;

        const result = await checkFarmNationStatusAction();

        expect(store.reads.length).toBeLessThanOrEqual(CEILING.farmNationAction);
        //   AND THE ANSWER IS UNCHANGED, which is what makes the saving free.
        expect(result).toEqual({ success: true, data: null, error: null });
    });

    it('DOES NOT GROW — seven reads is the page\'s ceiling, down from eleven', async () => {
        const mod = await import('@/app/actions/farm-nation/_fn_onboarding');
        store.reads.length = 0;

        await mod.checkFarmNationStatusAction();
        await mod.checkFarmNationAccessAction();

        expect(store.reads.length).toBeLessThanOrEqual(CEILING.farmNationPage);
    });

    it('STILL FINDS an application filed under a superseded profile', async () => {
        //   The identity walk is narrowed, not deleted. A member whose rows
        //   were settled by the #724 tool has their application under the id
        //   that lost, and this is a GATE on whether they get in.
        store.seed(COLLECTIONS.USERS, 'old-id', {
            uid: 'old-id', email: 'old@example.test', _migratedTo: UID, serviceRegistrations: {},
        });
        store.seed(COLLECTIONS.FARM_NATION_APPLICATIONS, 'app-1', {
            userId: UID, status: 'pending', submittedAt: '2026-01-01T00:00:00.000Z',
        });
        sessionAs('old-id', 'old@example.test');

        const { checkFarmNationStatusAction } = await import('@/app/actions/farm-nation/_fn_onboarding');

        const result = await checkFarmNationStatusAction();

        expect(result.data).toBe('pending');
    });
});

describe('the gate and the screen behind it read the same row once', () => {
    it('farm nation — the gate does not re-ask for a row the memo holds', async () => {
        const { checkModuleAccess } = await import('@/lib/module-access-check');
        const { checkFarmNationStatusAction } = await import('@/app/actions/farm-nation/_fn_onboarding');
        store.reads.length = 0;

        await checkFarmNationStatusAction();
        await checkModuleAccess(UID, ['general_user'] as never, 'farm-nation');

        expect(ownRowReads()).toBe(1);
    });

    it('marketplace — same row, same once', async () => {
        const { checkModuleAccess } = await import('@/lib/module-access-check');
        const { checkMarketplaceStatusAction } = await import('@/app/actions/marketplace/_mp_onboarding');
        store.reads.length = 0;

        await checkModuleAccess(UID, ['general_user'] as never, 'marketplace');
        await checkMarketplaceStatusAction();

        expect(ownRowReads()).toBe(1);
        expect(store.reads.length).toBeLessThanOrEqual(CEILING.marketplacePage);
    });

    it('WAVE — the module the owner did not ask about moves too', async () => {
        const { checkModuleAccess } = await import('@/lib/module-access-check');
        const { checkWaveStatusAction } = await import('@/app/actions/wave/_wv_membership');
        store.reads.length = 0;

        await checkModuleAccess(UID, ['general_user'] as never, 'wave');
        await checkWaveStatusAction();

        expect(ownRowReads()).toBe(1);
        expect(store.reads.length).toBeLessThanOrEqual(CEILING.wavePage);
    });
});

describe('#692 — the memo is dropped by the heals that write the row', () => {
    it('A GRANT IS NEVER SERVED THE COPY TAKEN BEFORE IT', async () => {
        /*
         *   This is the whole licence for putting a gate's read behind a
         *   request memo. checkModuleAccess heals SIX times, and every one of
         *   those writes calls invalidateServiceCache — which forgets this
         *   row before it clears Redis. If it ever stops doing that, the gate
         *   will approve a member and then read back the row that says it
         *   did not.
         */
        const { readUserDocOnce } = await import('@/lib/current-user-doc');
        //   THE REAL MODULE, NOT THE SUITE-WIDE STUB. jest.setup.js replaces
        //   @/lib/cache-invalidation for all 974 suites with a fake that calls
        //   forgetUserDoc itself — so a test importing it the ordinary way
        //   asserts that THE STUB is correct and would survive deleting the
        //   line from production. Caught by mutation: the mutant landed on the
        //   real file and all eight tests still passed.
        const { invalidateServiceCache } =
            jest.requireActual<typeof import('@/lib/cache-invalidation')>('@/lib/cache-invalidation');
        store.reads.length = 0;

        await readUserDocOnce(UID);
        await readUserDocOnce(UID);
        expect(ownRowReads()).toBe(1);

        await invalidateServiceCache(UID, 'farm-nation');

        await readUserDocOnce(UID);
        expect(ownRowReads()).toBe(2);
    });

    it('AND THE GATE NEVER WRITES THE ROW WITHOUT DROPPING IT', () => {
        /*
         *   Read from the source because driving all six heal paths needs six
         *   different fixtures, and the property worth holding is not "this
         *   one invalidates" but "none of them forgets" — a statement about
         *   the file.
         *
         *   This is the licence for the memo above. Before it, a heal that
         *   skipped the invalidation cost only a stale Redis copy; now it
         *   would also hand the rest of the request the row as it read
         *   BEFORE the grant it just wrote.
         */
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');
        const source = readFileSync(join(process.cwd(), 'src/lib/module-access-check.ts'), 'utf8');

        /*
         *   ANCHORED TO THE START OF A STATEMENT, not matched anywhere in the
         *   file. A bare /invalidateServiceCache\(userId/ counts the text
         *   inside a comment too — so commenting a call out left the count
         *   unchanged and the mutant survived. #268's lesson, second sitting:
         *   a ratchet that greps for a string is pinned by every mention of
         *   that string, including the ones that do nothing.
         */
        const writes = [...source.matchAll(
            /^\s*await db\.collection\(COLLECTIONS\.USERS\)\.doc\(userId\)\.(?:set|update)\(/gm)].length;
        const clears = [...source.matchAll(
            /^\s*await invalidateServiceCache\(userId/gm)].length;

        expect({ writes, clears }).toEqual({ writes: 6, clears: 6 });
    });
});
