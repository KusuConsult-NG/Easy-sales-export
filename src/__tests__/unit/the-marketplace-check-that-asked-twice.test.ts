/**
 *   THE OWNER: "fix the checkMarketplaceStatusAction slowness next."
 *
 *   Their log, one session:
 *
 *       checkMarketplaceStatusAction took 3108ms
 *       checkMarketplaceStatusAction took 2231ms
 *       ... eight of them in forty-five seconds, 0.9s to 3.9s each
 *
 *   The third module to show this shape after WAVE (#263) and Farm Nation, so
 *   it is a pattern rather than a module's quirk.
 *
 * ── MEASURED, NOT GUESSED ───────────────────────────────────────────────────
 *
 *   #261's read meter, with a real per-request memoiser standing in for
 *   React's cache() — which is a PASS-THROUGH under jest, so a suite that
 *   skips that step measures a platform with no request memoisation at all.
 *
 *   A first-time visitor to /marketplace/onboarding, which is the commonest
 *   visitor that screen has, cost SEVEN reads:
 *
 *       1  users:doc                     the row
 *       2  users:doc                     THE SAME ROW, re-read by the forward
 *                                        identity walk
 *       3  users:query   ┐ the backward identity search
 *       4  users:query   ┘
 *       5  seller_verifications:query    userId IN <every id this person owns>
 *       6  marketplace_sellers:query     legacy fallback 1
 *       7  seller_verifications:query    userId == <live id> — A STRICT SUBSET
 *                                        OF 5, asked after 5 returned nothing
 *
 *   Two of the seven were answerable without asking. At page scope, with the
 *   module gate that runs above it:
 *
 *       before   11 reads
 *       after     7 reads
 *
 *   The extra two come from the identity search being paid ONCE instead of
 *   twice: #265 moved checkModuleAccess onto `ownedProfileIds`, and this action
 *   was still calling `ownedProfileIdsFor` — two cache() entry points over the
 *   same work, so neither could see the other's answer.
 *
 * ── AND A #692 DEFECT FOUND ON THE WAY ──────────────────────────────────────
 *
 *   The approved heal clears CacheKeys.userProfile after writing, because
 *   session-guard serves that copy for 300 seconds and #692 is the record of
 *   what forgetting it costs. The THREE legacy backfills below it write the
 *   same field and clear nothing — one control on one door out of four.
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

jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: jest.fn(async () => ({ success: true, limit: 100, remaining: 99, reset: 0 })) }),
    getClientIp: jest.fn(() => '127.0.0.1'),
    createRateLimitResponse: jest.fn(),
}));

const UID = 'shopper-1';
const EMAIL = 'shopper@example.test';

/** Today's cost of drawing /marketplace/onboarding for a first-time visitor. */
const READS_ALLOWED_PER_PAGE = 7;

let store: FakeDbHandle;

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, UID, {
        uid: UID, email: EMAIL, roles: ['general_user'],
        isVerified: true, profileComplete: true, serviceRegistrations: {},
    });
    (global as any).mockRequireSession = jest.fn(() => Promise.resolve({
        session: { user: { id: UID, email: EMAIL, roles: ['general_user'] } },
        error: null,
    }));
});

const statusAction = () => import('@/app/actions/marketplace/_mp_onboarding');

describe('what /marketplace/onboarding costs a first-time visitor', () => {
    it('DOES NOT GROW — seven reads is the ceiling, down from eleven', async () => {
        const { checkModuleAccess } = await import('@/lib/module-access-check');
        const { checkMarketplaceStatusAction } = await statusAction();
        store.reads.length = 0;

        await checkModuleAccess(UID, ['general_user'] as never, 'marketplace');
        await checkMarketplaceStatusAction();

        expect(store.reads.length).toBeLessThanOrEqual(READS_ALLOWED_PER_PAGE);
    });

    it('reads the caller\'s own row ONCE, not twice', async () => {
        //   The forward identity walk re-read the row the action had just
        //   fetched. It is answered from that row now.
        const { checkMarketplaceStatusAction } = await statusAction();
        store.reads.length = 0;

        await checkMarketplaceStatusAction();

        const ownRow = store.reads.filter((r) => r.collection === COLLECTIONS.USERS && r.id === UID);
        expect(ownRow.length).toBe(1);
    });

    it('ASKS seller_verifications ONCE, not twice for the same answer', async () => {
        const { checkMarketplaceStatusAction } = await statusAction();
        store.reads.length = 0;

        const result = await checkMarketplaceStatusAction();

        const verReads = store.reads.filter((r) => r.collection === COLLECTIONS.SELLER_VERIFICATIONS);
        expect(verReads.length).toBe(1);
        //   AND THE ANSWER IS UNCHANGED, which is what makes the saving free.
        expect(result).toEqual({ error: null, success: true, data: null });
    });

    it('STILL FINDS a verification filed under a superseded profile', async () => {
        //   The identity walk is narrowed, not deleted. A member whose rows
        //   were settled by the #724 tool has their verification under the id
        //   that lost, and this is a GATE on whether they can sell.
        store.seed(COLLECTIONS.USERS, 'old-id', {
            uid: 'old-id', email: 'old@example.test', _migratedTo: UID, serviceRegistrations: {},
        });
        store.seed(COLLECTIONS.SELLER_VERIFICATIONS, 'ver-1', {
            userId: UID, status: 'approved', accountType: 'seller',
            createdAt: '2026-01-01T00:00:00.000Z',
        });
        (global as any).mockRequireSession = jest.fn(() => Promise.resolve({
            session: { user: { id: 'old-id', email: 'old@example.test', roles: ['general_user'] } },
            error: null,
        }));

        const { checkMarketplaceStatusAction } = await statusAction();

        const result = await checkMarketplaceStatusAction();

        expect(result.data?.status).toBe('approved');
    });

    it('and the legacy fallback STILL RUNS when there is something for it to find', async () => {
        //   The skip is only ever taken when the owner-scoped query came back
        //   empty. A verification that exists must still be read.
        store.seed(COLLECTIONS.SELLER_VERIFICATIONS, 'ver-2', {
            userId: UID, status: 'pending', accountType: 'seller',
            createdAt: '2026-02-01T00:00:00.000Z',
        });

        const { checkMarketplaceStatusAction } = await statusAction();

        const result = await checkMarketplaceStatusAction();

        expect(result.data?.status).toBe('pending');
    });
});

describe('#692 — a backfill clears the profile it just corrected', () => {
    it('EVERY DOOR THAT WRITES THE REGISTRATION ALSO INVALIDATES', () => {
        /*
         *   Read from the source because driving all four heal paths needs four
         *   different fixtures, and the property worth holding is not "this one
         *   invalidates" but "none of them forgets" — which is a statement
         *   about the file.
         *
         *   session-guard serves CacheKeys.userProfile for 300 seconds. A
         *   backfill that writes serviceRegistrations.marketplace.status and
         *   does not clear it is invisible to every other reader for five
         *   minutes — to the very person who asked the platform to look again.
         */
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');
        const source = readFileSync(
            join(process.cwd(), 'src/app/actions/marketplace/_mp_onboarding.ts'), 'utf8');

        const writes = [...source.matchAll(/serviceRegistrations\.marketplace\.status/g)].length;
        const clears = [...source.matchAll(/invalidateServiceCache\(/g)].length;

        //   Four heal paths: the approved one, and the three legacy backfills
        //   that had no invalidation at all until this change.
        expect({ clears }).toEqual({ clears: 4 });
        expect(writes).toBeGreaterThanOrEqual(clears);
    });
});
