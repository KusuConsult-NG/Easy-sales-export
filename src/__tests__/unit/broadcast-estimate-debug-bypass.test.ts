/**
 * @jest-environment node
 */

/**
 * A query parameter switched off the admin check on the broadcast estimate.
 *
 * THE BUG
 * -------
 *     const isTest = req.nextUrl.searchParams.get("debug") === "antigravity";
 *     if (!isTest) {
 *         const { session } = await requireSession();
 *         if (!session?.user || !isAdmin(session.user.roles)) return 403;
 *     }
 *
 * so `POST /api/admin/broadcast/estimate?debug=antigravity` ran with no session
 * at all. The middleware does not cover it: PROTECTED_PATHS gates `/admin`, and
 * this path is `/api/admin/...`, which starts with `/api`. The route's own check
 * was the only one there was.
 *
 * WHAT AN ANONYMOUS CALLER GOT
 * ----------------------------
 *   count, totalMatches   the size of any audience, for any state filter posted
 *   moduleStats           approved / pending / rejected / suspended breakdowns
 *   sample                five real names and email addresses
 *
 * The audience and the state come from the request body, so the caller chooses
 * whose five names. getCleanBroadcastList reads the users collection and the
 * module collections to answer, under this route's 300-second budget, for anyone
 * who could issue a request.
 *
 * THE SAME DEFECT, A SECOND TIME
 * ------------------------------
 * #154 removed `process.env.ADMIN_OVERRIDE === "true"` from
 * getCleanBroadcastListAction, where it skipped the same check on the same data,
 * and closed with:
 *
 *     Every caller of both functions is already an admin surface —
 *     /admin/communications/history, /admin/communications/broadcast, and the
 *     two /api/admin/broadcast routes — so nothing legitimate changes.
 *
 * That took the routes' own guards as given. One of them had a switch of its
 * own. A query parameter is the worse of the two: ADMIN_OVERRIDE needed deploy
 * access to set, `?debug=antigravity` needed a URL. It is also the reason this
 * route escaped: it does not call the action that was fixed. It imported
 * previewBroadcastAction and never used it, calling the unguarded
 * getCleanBroadcastList directly.
 *
 * "antigravity" appeared exactly once in the repository — in that line. Nothing
 * sent it; the broadcast page POSTs its filters with no query string. So it was
 * removed rather than narrowed, as ADMIN_OVERRIDE was.
 *
 * ALSO FIXED
 * ----------
 * The body was parsed and logged before the guard, so an anonymous request wrote
 * its own content into our logs — including, for a csv_upload audience, the
 * address list it posted. Read after admission now, and only the audience name
 * is logged.
 *
 * No rate limit, on the same scan /api/admin/broadcast/send performs. #180 threw
 * that route; estimating costs the same and was free. Keyed on the account, for
 * the reason given there: an admin behind a shared IP should not spend everyone
 * else's allowance.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const requireSession = jest.fn<any>();
const getCleanBroadcastList = jest.fn<any>();
const limiterCheck = jest.fn<any>();

jest.mock('@/lib/session-guard', () => ({
    requireSession: (...args: any[]) => requireSession(...args),
}));

jest.mock('@/lib/broadcast-logic', () => ({
    getCleanBroadcastList: (...args: any[]) => getCleanBroadcastList(...args),
}));

jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: (...args: any[]) => limiterCheck(...args) }),
    createRateLimitResponse: () => ({ status: 429, json: async () => ({ success: false }) }),
}));

const ANONYMOUS = { session: null, error: { error: 'Authentication required' } };

const ADMIN = {
    session: { user: { id: 'admin-1', roles: ['super_admin'] } },
    error: null,
};

const LIST = {
    success: true,
    error: null,
    data: {
        recipients: [
            { uid: 'u1', email: 'ada@example.com', name: 'Ada', state: 'Kano', lastActive: new Date() },
            { uid: 'u2', email: 'bola@example.com', name: 'Bola', state: 'Lagos', lastActive: new Date() },
        ],
        count: 2,
        originalDocCount: 37000,
        moduleStats: { total: 2, approved: 2, pending: 0, rejected: 0, suspended: 0 },
    },
};

/**
 * A request whose body THROWS if read. The guard must refuse an anonymous
 * caller without ever parsing what they posted — asserting on the 403 alone
 * would pass against a route that logged the body first and refused after.
 */
function request(query: string, body: any = { audience: 'all' }, bodyReadable = true) {
    return {
        nextUrl: { searchParams: new URLSearchParams(query) },
        json: async () => {
            if (!bodyReadable) throw new Error('body must not be read before the caller is admitted');
            return body;
        },
    } as any;
}

async function post(req: any) {
    const { POST } = await import('@/app/api/admin/broadcast/estimate/route');
    return (await POST(req)) as any;
}

describe('the debug switch is gone', () => {
    beforeEach(() => {
        jest.resetModules();
        requireSession.mockReset();
        getCleanBroadcastList.mockReset();
        limiterCheck.mockReset();
        limiterCheck.mockResolvedValue({ success: true, limit: 100, remaining: 99, reset: 0 });
    });

    it('refuses an anonymous caller sending ?debug=antigravity', async () => {
        // THE test. This exact URL returned the recipient list.
        requireSession.mockResolvedValue(ANONYMOUS);

        const res = await post(request('debug=antigravity'));

        expect(res.status).toBe(403);
    });

    it('and does not scan the database for them', async () => {
        // The 403 above is worth little if the work happened first. It also
        // costs: this route carries a 300-second budget for a full scan.
        requireSession.mockResolvedValue(ANONYMOUS);

        await post(request('debug=antigravity'));

        expect(getCleanBroadcastList).not.toHaveBeenCalled();
    });

    it('and does not read their body before refusing them', async () => {
        // The parse and the logger.debug of `filters` both preceded the guard.
        // A csv_upload audience carries the caller's own address list.
        requireSession.mockResolvedValue(ANONYMOUS);

        const res = await post(request('debug=antigravity', null, false));

        expect(res.status).toBe(403);
    });

    it('refuses a signed-in account that is not an admin', async () => {
        requireSession.mockResolvedValue({
            session: { user: { id: 'u9', roles: ['general_user'] } },
            error: null,
        });

        const res = await post(request('debug=antigravity'));

        expect(res.status).toBe(403);
        expect(getCleanBroadcastList).not.toHaveBeenCalled();
    });

    it('refuses without the parameter too', async () => {
        // Vacuity guard on the guard: the fix must not be "special-case that one
        // string", which the next debug value would walk straight past.
        requireSession.mockResolvedValue(ANONYMOUS);

        for (const query of ['', 'debug=antigravity', 'debug=anything-else', 'debug=true&x=1']) {
            const res = await post(request(query));
            expect(`${query || '(none)'}: ${res.status}`).toBe(`${query || '(none)'}: 403`);
        }
    });

    it('the route reads no query parameter at all', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(
            join(process.cwd(), 'src/app/api/admin/broadcast/estimate/route.ts'),
            'utf-8'
        );
        // The old line survives in the comment recording what it was. What must
        // not survive is a condition.
        const code = src
            .split('\n')
            .filter((l) => {
                const t = l.trim();
                return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
            })
            .join('\n');

        expect(code).not.toContain('searchParams');
    });
});

describe('an admin still gets the estimate', () => {
    beforeEach(() => {
        jest.resetModules();
        requireSession.mockReset();
        getCleanBroadcastList.mockReset();
        limiterCheck.mockReset();
        limiterCheck.mockResolvedValue({ success: true, limit: 100, remaining: 99, reset: 0 });
        requireSession.mockResolvedValue(ADMIN);
        getCleanBroadcastList.mockResolvedValue(LIST);
    });

    it('answers with the count and the totals', async () => {
        // The other vacuity guard: every assertion above is satisfied by a route
        // that refuses everyone, which would break the broadcast screen.
        const res = await post(request(''));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.data.count).toBe(2);
        expect(body.data.totalMatches).toBe(37000);
        expect(body.data.moduleStats.approved).toBe(2);
    });

    it('and a sample narrowed to name and email', async () => {
        // Not the whole recipient record, which is what previewBroadcastAction
        // returns and why this route does not delegate to it.
        const res = await post(request(''));
        const body = await res.json();

        expect(body.data.sample).toEqual([
            { name: 'Ada', email: 'ada@example.com' },
            { name: 'Bola', email: 'bola@example.com' },
        ]);
    });

    it('the filters posted reach the query', async () => {
        await post(request('', { audience: 'cooperative_members', state: 'Kano' }));

        expect(getCleanBroadcastList).toHaveBeenCalledWith({
            audience: 'cooperative_members',
            state: 'Kano',
        });
    });
});

describe('throttled on the account, like the send route', () => {
    beforeEach(() => {
        jest.resetModules();
        requireSession.mockReset();
        getCleanBroadcastList.mockReset();
        limiterCheck.mockReset();
        requireSession.mockResolvedValue(ADMIN);
        getCleanBroadcastList.mockResolvedValue(LIST);
    });

    it('keys the limit on the user id, not the address', async () => {
        limiterCheck.mockResolvedValue({ success: true, limit: 100, remaining: 99, reset: 0 });

        await post(request(''));

        expect(limiterCheck).toHaveBeenCalledWith('admin-1');
    });

    it('refuses once the limit is spent, before scanning', async () => {
        limiterCheck.mockResolvedValue({ success: false, limit: 100, remaining: 0, reset: 0 });

        const res = await post(request(''));

        expect(res.status).toBe(429);
        expect(getCleanBroadcastList).not.toHaveBeenCalled();
    });
});
