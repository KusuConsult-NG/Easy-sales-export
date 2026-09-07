/**
 * @jest-environment node
 */

/**
 *   #482 THE SEGMENT COUNTERS WERE CACHED FOR TEN MINUTES TO PAY FOR AN EXPENSE
 *   THAT NO LONGER EXISTS.
 *
 *   The owner asked for them live. Before #473 that would have been the wrong
 *   answer: the only way to produce active / pending / stalled / ghost was to
 *   read the whole users table — 51 pages and 4.6 MB on this data, fired at
 *   once — and ten minutes of staleness was a fair price for not doing that on
 *   every page load.
 *
 *   #473 replaced it with one RPC. Measured on 50,017 users, five runs:
 *
 *       count_user_segments()   58, 54, 52, 52, 50 ms
 *
 *   Fifty milliseconds is not worth ten minutes of wrong numbers. And the
 *   staleness cost more than time: Redis is not configured, so the cache is
 *   #459's in-memory fallback and lives PER CONTAINER — two admins on two
 *   Railway instances could read different totals for the same platform at the
 *   same moment, with no way to tell which was current.
 *
 *   THE FALLBACK KEEPS ITS CACHE, AND THAT IS THE WHOLE CARE IN THIS CHANGE.
 *   When migration 029 is absent the code still pages the entire users table.
 *   Removing the cache from THAT path would run 51 simultaneous whole-table
 *   reads on every admin page load — strictly worse than the behaviour #473
 *   removed, arriving as a change that reads like a simplification. So the cheap
 *   path is live and the expensive path is cached. The cache follows the cost,
 *   which is what it was always for.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the live path cached again                  KILLED
 *     the fallback's cache removed too            KILLED
 *     the RPC result cached before returning      KILLED
 *     the fallback preferred over the RPC         KILLED
 *     reword this header                          SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const SERVICE = 'src/services/analytics.service.ts';
const source = () => stripComments(readFileSync(SERVICE, 'utf-8'));

/** The body of getUserSegmentsCached, which is the whole subject here. */
function wrapper(): string {
    const code = source();
    const start = code.indexOf('private async getUserSegmentsCached');
    const next = code.indexOf('\n    ', code.indexOf('{', start));
    const end = code.indexOf('\n    async ', start) > -1
        ? code.indexOf('\n    async ', start)
        : code.length;
    return code.slice(start, Math.max(end, next + 1));
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#482 — the counters are live when the cheap path is available', () => {
    it('NOTHING READS A CACHE BEFORE THE LIVE CALL', () => {
        //   The assertion the owner asked for, and the one that took two goes.
        //
        //   IT FIRST NAMED THE IDENTIFIER — `body.indexOf('getCached<UserSegments>')`
        //   — and a mutant that imported the same function under a different
        //   name and read the cache FIRST sailed through. The counters would
        //   have stayed ten minutes stale while every test agreed they were
        //   live. Eighth time in this audit a source assertion pinned to a
        //   spelling has been too narrow to hold.
        //
        //   So this bans the CAPABILITY, not the name: nothing resembling a
        //   cache may appear in the region before the live result is returned,
        //   whatever it is called.
        const body = wrapper();
        const live = body.indexOf('countUserSegmentsInDatabase()');

        expect(live).toBeGreaterThan(-1);
        expect(body).toContain('if (live) return live;');

        //   Measured from AFTER the signature line: the method is CALLED
        //   getUserSegmentsCached, so a bare 'Cached' matches its own name and
        //   fails on correct code — which it did, on the first attempt at this.
        const body2 = body.slice(body.indexOf('\n'));
        const before = body2.slice(0, body2.indexOf('if (live) return live;'));

        for (const cacheish of ['redis', 'getCached', 'cacheKey', 'setCache', 'unstable_cache']) {
            expect({ readsCacheFirst: cacheish, found: before.includes(cacheish) })
                .toEqual({ readsCacheFirst: cacheish, found: false });
        }
    });

    it('AND THE LIVE RESULT IS NOT WRITTEN TO THE CACHE ON THE WAY OUT', () => {
        //   Caching it would make the NEXT reader stale even though this one was
        //   live — the same defect, one request later.
        const body = wrapper();
        const live = body.indexOf('if (live) return live;');
        const beforeReturn = body.slice(0, live);

        expect(beforeReturn).not.toContain('setCache');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#482 — and the expensive path is still protected', () => {
    /**
     * This is the half that makes the change safe rather than reckless. Without
     * migration 029 the fallback pages the whole users table — 51 requests at
     * once on this data. Uncached, that runs on every admin page load.
     */
    it('THE FALLBACK STILL READS AND WRITES THE CACHE', () => {
        const body = wrapper();
        const fallback = body.slice(body.indexOf('if (live) return live;'));

        expect(fallback).toContain('getCached<UserSegments>');
        expect(fallback).toContain('setCache(cacheKey, segments, 600)');
        expect(fallback).toContain('this.calculateUserSegments()');
    });

    it('AND THE WHOLE-TABLE READ IT PROTECTS IS STILL THERE TO PROTECT', () => {
        //   Control: if calculateUserSegments were deleted, every assertion
        //   above would pass and the fallback would be gone — which is fine
        //   until a database turns up without 029, and then the dashboard is
        //   blank instead of slow.
        const code = source();

        expect(code).toContain('private async calculateUserSegments()');
        expect(code).toMatch(/Math\.ceil\(count \/ pageSize\)/);
    });

    it('and the RPC is still preferred over it', () => {
        const body = wrapper();

        expect(body.indexOf('countUserSegmentsInDatabase()'))
            .toBeLessThan(body.indexOf('this.calculateUserSegments()'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#482 — the reason is recorded where the decision is', () => {
    it('THE MEASUREMENT THAT JUSTIFIES LIVE IS IN THE CODE', () => {
        //   The cache was correct before #473 and is wrong after it. Somebody
        //   reading this later needs the number that changed the answer, not
        //   just the answer.
        const code = readFileSync(SERVICE, 'utf-8');

        expect(code).toContain('58, 54, 52, 52, 50 ms');
        expect(code).toContain('per CONTAINER');
    });
});
