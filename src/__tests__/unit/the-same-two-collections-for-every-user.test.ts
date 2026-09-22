/**
 * @jest-environment node
 */

/**
 * The dashboard read the same platform-wide collections once per caller.
 *
 *   THE OWNER: "fix the slowness of the entire app" — then, with a container
 *   log attached, "the app is still very very slow".
 *
 *   Upcoming events and WAVE resources are the same rows for everybody. They
 *   were fetched per caller anyway, and "per caller" is worse than it sounds:
 *
 *     - `dashboard/layout.tsx` awaits getMyDashboard() ON THE SERVER for every
 *       entry to /dashboard and its six sub-pages;
 *     - `NavSummaryProvider` then re-polls it every 8 seconds for as long as
 *       the tab stays visible;
 *     - links are prefetched by default — only 13 `prefetch={false}` exist in
 *       the whole app — so the render also ran for pages nobody opened. The
 *       production log's repeated "destination stream closed early" on
 *       `/dashboard?_rsc=` is exactly that: paid for, then thrown away.
 *
 *   Neither read carries a `.limit()`, so each costs up to the adapter's
 *   DEFAULT_QUERY_LIMIT rows in 1,000-row pages — up to five sequential round
 *   trips apiece — to render three tiles.
 *
 * WHY THIS FILE OVERRIDES THE GLOBAL next/cache MOCK.
 *
 *   jest.setup.js mocks `unstable_cache: (fn) => fn`. That is a pass-through,
 *   so under it this change is invisible and a test asserting on behaviour
 *   alone would pass just as well with the caching deleted. A real memoiser is
 *   installed here instead, which makes the round trips COUNTABLE — the number
 *   asserted below is the number of database reads a caller actually pays.
 *
 *   Verified by mutation: unwrapping either fetcher takes its count from 1 to
 *   the number of polls.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

const mockCacheRegistrations: Array<{ keys: string[]; opts: any }> = [];

jest.mock('next/cache', () => ({
    unstable_cache: (fn: any, keys: string[], opts: any) => {
        mockCacheRegistrations.push({ keys, opts });
        const memo = new Map<string, unknown>();
        return async (...args: unknown[]) => {
            const k = JSON.stringify(args);
            if (!memo.has(k)) memo.set(k, await fn(...args));
            return memo.get(k);
        };
    },
    revalidateTag: jest.fn(),
    updateTag: jest.fn(),
    revalidatePath: jest.fn(),
}));

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('@/lib/auth', () => ({
    auth: async () => null,
    signIn: async () => undefined,
    signOut: async () => undefined,
    handlers: {},
}));

let store: FakeDbHandle;

function actAs(id: string | null): void {
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles: ['general_user'], email: 'ada@example.com' } }, error: null },
    ));
}

/** Database reads issued so far. The fake dispatches doc and collection reads alike through this one mock. */
const readsSoFar = (): number => (globalThis as any).mockFirestoreGet.mock.calls.length;

const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const past = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

beforeEach(() => {
    jest.clearAllMocks();
    //   NOT cleared: a module registers its cache wrappers once, at import.
    //   Emptying this per test would assert on an empty list and pass for the
    //   wrong reason.
    store = installFakeDb();
    actAs('user-1');
});

function seedPlatformRows(): void {
    store.seed(COLLECTIONS.WAVE_TRAINING_EVENTS, 'w1', { title: 'Later', date: soon(9), status: 'upcoming' });
    store.seed(COLLECTIONS.WAVE_TRAINING_EVENTS, 'w2', { title: 'Sooner', date: soon(2), status: 'upcoming' });
    store.seed(COLLECTIONS.WAVE_TRAINING_EVENTS, 'w3', { title: 'Cancelled', date: soon(1), status: 'cancelled' });
    store.seed(COLLECTIONS.WAVE_TRAINING_EVENTS, 'w4', { title: 'Gone by', date: past(3), status: 'upcoming' });
    store.seed(COLLECTIONS.VILLAGE_MARKET_EVENTS, 'v1', { title: 'Market', startTime: soon(5), status: 'upcoming', location: 'Jos', state: 'Plateau' });

    store.seed(COLLECTIONS.WAVE_RESOURCES, 'r1', { title: 'Older', uploadedAt: past(9), isActive: true });
    store.seed(COLLECTIONS.WAVE_RESOURCES, 'r2', { title: 'Newest', uploadedAt: past(1), isActive: true });
    store.seed(COLLECTIONS.WAVE_RESOURCES, 'r3', { title: 'Withdrawn', uploadedAt: past(0), isActive: false });
}

describe('the same two collections, for every user, every eight seconds', () => {
    it('TEN POLLS OF THE EVENTS TILE COST TWO READS, not twenty', async () => {
        seedPlatformRows();
        const { getUpcomingEvents } = await import('@/app/actions/my-data');

        const before = readsSoFar();
        for (let i = 0; i < 10; i++) await getUpcomingEvents(3);
        const spent = readsSoFar() - before;

        //   Two collections, read once between them — not once per poll.
        expect(spent).toBe(2);
    });

    it('TEN POLLS OF THE RESOURCES TILE COST ONE READ, not ten', async () => {
        seedPlatformRows();
        const { getRecentResources } = await import('@/app/actions/my-data');

        const before = readsSoFar();
        for (let i = 0; i < 10; i++) await getRecentResources(3);

        expect(readsSoFar() - before).toBe(1);
    });

    it('THE ROWS ARE UNCHANGED — same filter, same sort, same slice', async () => {
        seedPlatformRows();
        const { getUpcomingEvents, getRecentResources } = await import('@/app/actions/my-data');

        //   Cancelled and already-past events are gone; the rest are soonest first.
        expect((await getUpcomingEvents(3)).map((e: any) => e.title)).toEqual(['Sooner', 'Market', 'Later']);

        //   Withdrawn resources are gone; the rest are newest first.
        expect((await getRecentResources(3)).map((r: any) => r.title)).toEqual(['Newest', 'Older']);
    });

    it('A DIFFERENT max IS A DIFFERENT ANSWER, not the first one reused', async () => {
        seedPlatformRows();
        const { getUpcomingEvents } = await import('@/app/actions/my-data');

        expect((await getUpcomingEvents(1)).map((e: any) => e.title)).toEqual(['Sooner']);
        expect((await getUpcomingEvents(3)).map((e: any) => e.title)).toEqual(['Sooner', 'Market', 'Later']);
    });

    it('THE SESSION CHECK IS OUTSIDE THE CACHE — a signed-out caller reads nothing', async () => {
        seedPlatformRows();
        actAs(null);
        const { getUpcomingEvents, getRecentResources } = await import('@/app/actions/my-data');

        const before = readsSoFar();
        expect(await getUpcomingEvents(3)).toEqual([]);
        expect(await getRecentResources(3)).toEqual([]);

        //   A cached scope may not read cookies, so the guard has to run first —
        //   and having run, it must not have cost a query either.
        expect(readsSoFar() - before).toBe(0);
    });

    it('BOTH FETCHERS CARRY A BOUNDED revalidate, so no writer has to remember a tag', async () => {
        await import('@/app/actions/my-data');

        const registered = mockCacheRegistrations.filter(c =>
            c.keys.includes('upcoming-events') || c.keys.includes('recent-resources'));

        expect(registered).toHaveLength(2);
        for (const r of registered) {
            expect(typeof r.opts?.revalidate).toBe('number');
            expect(r.opts.revalidate).toBeGreaterThan(0);
            //   Six files write these collections. Staleness has to expire on its
            //   own rather than depend on every one of them remembering.
            expect(r.opts.revalidate).toBeLessThanOrEqual(300);
        }
    });
});
