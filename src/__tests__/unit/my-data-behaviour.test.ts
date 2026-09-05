/**
 * @jest-environment node
 */

/**
 * The session-scoped reads behind the dashboard, EXECUTED.
 *
 * At 26.8% statements / 12.9% functions — the lowest in the module list, and
 * the module whose whole purpose is that the browser no longer talks to the
 * database directly. One finding was located by running it:
 *
 *   #100 getMyActiveOrderCount filtered on `orderStatus`. Every writer of
 *        MARKETPLACE_ORDERS sets `status`; `orderStatus` exists only on the
 *        MarketplaceOrder interface and in that one filter, so it was undefined
 *        on every real order and the dashboard's Active Orders tile was
 *        structurally 0 for every buyer. Its hand-written status set was the
 *        wrong vocabulary too — "pending" and "confirmed" are not statuses any
 *        writer produces, while pending_payment, payment_received and disputed
 *        were missing.
 *
 * The rest executes the module's own stated rules: the user always comes from
 * the session, an unreadable session reads as signed out rather than rejecting,
 * and each function answers one question against its real collection.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

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

const ME = 'user-1';
const OTHER = 'user-2';

function actAs(id: string | null): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles: ['general_user'], email: 'ada@example.com' } }, error: null },
    ));
}

/** A session lookup that THROWS, rather than one that reports no session. */
function sessionThrows(): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => { throw new Error('auth backend down'); });
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(ME);
});

async function mine() {
    return import('@/app/actions/my-data');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('the session rule this module is built on', () => {
    it('reads a THROWN session as signed out rather than rejecting', async () => {
        // This module is the only one under src/app/actions NOT wrapped in
        // withSafeAction — these return raw values, so nothing converts a throw
        // into a result. The dashboard awaits eight of them together and one
        // rejection blanked the whole page.
        sessionThrows();
        const m = await mine();

        await expect(m.getMyServiceRegistrations()).resolves.toEqual({});
        await expect(m.getMyUnreadMessageCount()).resolves.toBe(0);
        await expect(m.getMyNotifications()).resolves.toEqual([]);
        await expect(m.getMyActiveOrderCount()).resolves.toBe(0);
        await expect(m.getMyWalletBalance()).resolves.toBe(0);
        await expect(m.getMyDisputes()).resolves.toEqual([]);
        await expect(m.getMyWithdrawals()).resolves.toEqual([]);
        await expect(m.getMyMembershipStatus('wave')).resolves.toMatchObject({ status: 'unauthenticated' });
    });

    it('takes no userId parameter anywhere — the module\'s first rule', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const { stripComments } = await import('@/lib/testing/strip-comments');

        const src = stripComments(readFileSync(
            join(process.cwd(), 'src/app/actions/my-data.ts'), 'utf8'));

        // A browser-supplied id is an authorisation bypass waiting to happen,
        // and the module says so at the top. Asserted, not merely documented.
        expect(src).not.toMatch(/export async function \w+\([^)]*\buserId\b/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getMyServiceRegistrations', () => {
    it('is empty when signed out or when the record is missing', async () => {
        actAs(null);
        expect(await (await mine()).getMyServiceRegistrations()).toEqual({});

        actAs(ME);
        expect(await (await mine()).getMyServiceRegistrations()).toEqual({});
    });

    it('returns the caller\'s own registrations', async () => {
        store.seed(COLLECTIONS.USERS, ME, {
            serviceRegistrations: { academy: { status: 'approved' } },
        });
        store.seed(COLLECTIONS.USERS, OTHER, {
            serviceRegistrations: { wave: { status: 'approved' } },
        });

        expect(await (await mine()).getMyServiceRegistrations())
            .toMatchObject({ academy: { status: 'approved' } });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getMyUnreadMessageCount', () => {
    const count = async () => (await mine()).getMyUnreadMessageCount();

    it('counts only conversations the caller is IN', async () => {
        // The browser version lost its array-contains filter, so it counted
        // every conversation on the platform and pulled those documents into
        // each signed-in browser.
        store.seedAll(COLLECTIONS.CONVERSATIONS, {
            mine: {
                participants: [ME, OTHER],
                lastMessage: { timestamp: '2026-03-01T00:00:00.000Z' },
                participantDetails: {},
            },
            theirs: {
                participants: [OTHER, 'user-3'],
                lastMessage: { timestamp: '2026-03-01T00:00:00.000Z' },
                participantDetails: {},
            },
        });

        expect(await count()).toBe(1);
    });

    it('is unread only when the last message is newer than the caller\'s last read', async () => {
        store.seedAll(COLLECTIONS.CONVERSATIONS, {
            read: {
                participants: [ME],
                lastMessage: { timestamp: '2026-03-01T00:00:00.000Z' },
                participantDetails: { [ME]: { lastRead: '2026-03-02T00:00:00.000Z' } },
            },
            unread: {
                participants: [ME],
                lastMessage: { timestamp: '2026-03-03T00:00:00.000Z' },
                participantDetails: { [ME]: { lastRead: '2026-03-02T00:00:00.000Z' } },
            },
            neverOpened: {
                participants: [ME],
                lastMessage: { timestamp: '2026-03-03T00:00:00.000Z' },
                participantDetails: {},
            },
            empty: { participants: [ME], participantDetails: {} },
        });

        expect(await count()).toBe(2);
    });

    it('reads somebody ELSE\'s lastRead as no help at all', async () => {
        store.seed(COLLECTIONS.CONVERSATIONS, 'c1', {
            participants: [ME, OTHER],
            lastMessage: { timestamp: '2026-03-03T00:00:00.000Z' },
            participantDetails: { [OTHER]: { lastRead: '2026-03-04T00:00:00.000Z' } },
        });

        expect(await count()).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('notifications', () => {
    const list = async (max?: number) => (await mine()).getMyNotifications(max as never);
    const unread = async () => (await mine()).getMyUnreadNotificationCount();
    const remove = async (id: string) => (await mine()).deleteMyNotification(id);

    beforeEach(() => {
        store.seedAll(COLLECTIONS.NOTIFICATIONS, {
            n1: { userId: ME, read: false, title: 'One', createdAt: '2026-01-01T00:00:00.000Z' },
            n2: { userId: ME, read: true, title: 'Two', createdAt: '2026-02-01T00:00:00.000Z' },
            n3: { userId: ME, read: false, title: 'Three', createdAt: '2026-03-01T00:00:00.000Z' },
            theirs: { userId: OTHER, read: false, title: 'Not mine', createdAt: '2026-04-01T00:00:00.000Z' },
        });
    });

    it('lists the caller\'s own, newest first', async () => {
        expect((await list()).map((n: any) => n.id)).toEqual(['n3', 'n2', 'n1']);
    });

    it('honours the limit', async () => {
        expect((await list(2)).map((n: any) => n.id)).toEqual(['n3', 'n2']);
    });

    it('counts only the caller\'s unread ones', async () => {
        expect(await unread()).toBe(2);
    });

    it('deletes the caller\'s own', async () => {
        expect(await remove('n1')).toEqual({ success: true });
        expect(store.get(COLLECTIONS.NOTIFICATIONS, 'n1')).toBeUndefined();
    });

    it('REFUSES somebody else\'s, and says the same thing as a missing one', async () => {
        // The browser issued this delete directly, meaning any id could be
        // passed. Reporting "not found" rather than "not yours" is what stops it
        // being an existence oracle.
        expect(await remove('theirs')).toEqual({ success: false, error: 'Notification not found' });
        expect(await remove('no-such-id')).toEqual({ success: false, error: 'Notification not found' });
        expect(store.get(COLLECTIONS.NOTIFICATIONS, 'theirs')).toBeDefined();
    });

    it('refuses when signed out', async () => {
        actAs(null);
        expect(await remove('n1')).toMatchObject({ success: false, error: 'Not signed in' });
        expect(store.get(COLLECTIONS.NOTIFICATIONS, 'n1')).toBeDefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getMyActiveOrderCount', () => {
    const count = async () => (await mine()).getMyActiveOrderCount();

    it('COUNTS ORDERS BY THE FIELD THE WRITERS ACTUALLY SET', async () => {
        // #100. This filtered on `orderStatus`, which no writer produces —
        // _payment_orders.ts writes `status: "pending_payment"`, the dispute
        // path transitions `status`, the fulfilment paths update `status`. The
        // tile was structurally 0 for every buyer.
        store.seedAll(COLLECTIONS.MARKETPLACE_ORDERS, {
            o1: { buyerId: ME, status: 'pending_payment' },
            o2: { buyerId: ME, status: 'payment_received' },
            o3: { buyerId: ME, status: 'processing' },
            o4: { buyerId: ME, status: 'shipped' },
            o5: { buyerId: ME, status: 'disputed' },
        });

        expect(await count()).toBe(5);
    });

    it('and uses the SHARED active set, not a fifth hand-written one', async () => {
        // "pending" and "confirmed" were in the old list and are not statuses
        // any writer produces; delivered, completed and cancelled are finished.
        store.seedAll(COLLECTIONS.MARKETPLACE_ORDERS, {
            done: { buyerId: ME, status: 'completed' },
            gone: { buyerId: ME, status: 'cancelled' },
            arrived: { buyerId: ME, status: 'delivered' },
            live: { buyerId: ME, status: 'shipped' },
        });

        expect(await count()).toBe(1);
    });

    it('counts only the caller\'s own orders', async () => {
        store.seedAll(COLLECTIONS.MARKETPLACE_ORDERS, {
            mine: { buyerId: ME, status: 'shipped' },
            theirs: { buyerId: OTHER, status: 'shipped' },
        });

        expect(await count()).toBe(1);
    });

    it('is zero when there are none', async () => {
        expect(await count()).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getUpcomingEvents and getRecentResources', () => {
    const events = async (max?: number) => (await mine()).getUpcomingEvents(max as never);
    const resources = async (max?: number) => (await mine()).getRecentResources(max as never);

    const soon = (days: number) =>
        new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    it('needs a session even though the content is platform-wide', async () => {
        actAs(null);
        expect(await events()).toEqual([]);
        expect(await resources()).toEqual([]);
    });

    it('merges both event sources, soonest first, and drops the past and the cancelled', async () => {
        store.seedAll(COLLECTIONS.WAVE_TRAINING_EVENTS, {
            w1: { title: 'Training A', date: soon(5), status: 'upcoming' },
            wOld: { title: 'Last year', date: soon(-30), status: 'upcoming' },
            wOff: { title: 'Called off', date: soon(2), status: 'cancelled' },
        });
        store.seedAll(COLLECTIONS.VILLAGE_MARKET_EVENTS, {
            v1: { title: 'Market Day', startTime: soon(1), status: 'upcoming', location: 'Jos', state: 'Plateau' },
        });

        const list = await events();
        expect(list.map((e: any) => e.id)).toEqual(['v1', 'w1']);
        expect(list[0]).toMatchObject({ type: 'village_market', location: 'Jos, Plateau' });
        expect(typeof list[0].date).toBe('string');
    });

    it('honours the event limit', async () => {
        store.seedAll(COLLECTIONS.WAVE_TRAINING_EVENTS, {
            a: { date: soon(1), status: 'upcoming' },
            b: { date: soon(2), status: 'upcoming' },
            c: { date: soon(3), status: 'upcoming' },
        });

        expect(await events(2)).toHaveLength(2);
    });

    it('lists ACTIVE resources newest first', async () => {
        store.seedAll(COLLECTIONS.WAVE_RESOURCES, {
            r1: { title: 'Old', uploadedAt: '2026-01-01T00:00:00.000Z' },
            r2: { title: 'New', uploadedAt: '2026-03-01T00:00:00.000Z' },
            r3: { title: 'Retired', uploadedAt: '2026-04-01T00:00:00.000Z', isActive: false },
            r4: { title: 'By createdAt', createdAt: '2026-02-01T00:00:00.000Z' },
        });

        expect((await resources(10)).map((r: any) => r.id)).toEqual(['r2', 'r4', 'r1']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getMyDisputes and getMyWalletBalance', () => {
    it('returns the caller\'s disputes, newest first', async () => {
        store.seedAll(COLLECTIONS.DISPUTES, {
            d1: { buyerId: ME, createdAt: '2026-01-01T00:00:00.000Z' },
            d2: { buyerId: ME, createdAt: '2026-03-01T00:00:00.000Z' },
            theirs: { buyerId: OTHER, createdAt: '2026-04-01T00:00:00.000Z' },
        });

        expect((await (await mine()).getMyDisputes()).map((d: any) => d.id)).toEqual(['d2', 'd1']);
    });

    it('reads the wallet keyed on the user id', async () => {
        store.seed(COLLECTIONS.WALLETS, ME, { balance: 12_500 });
        store.seed(COLLECTIONS.WALLETS, OTHER, { balance: 999_999 });

        expect(await (await mine()).getMyWalletBalance()).toBe(12_500);
    });

    it('is zero for a wallet that does not exist yet, or an unreadable balance', async () => {
        expect(await (await mine()).getMyWalletBalance()).toBe(0);

        store.seed(COLLECTIONS.WALLETS, ME, { balance: 'not a number' });
        expect(await (await mine()).getMyWalletBalance()).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getMyWithdrawals', () => {
    const list = async () => (await mine()).getMyWithdrawals();

    it('INCLUDES THE COOPERATIVE COLLECTION — the history used to be empty', async () => {
        // This read "withdrawals", the platform wallet collection, while every
        // cooperative withdrawal is written to cooperative_withdrawals. The only
        // caller is the member's cooperative withdrawal history page, which was
        // handed a list that structurally could not contain any and rendered "no
        // withdrawals yet" to members whose money had been paid out.
        store.seed(COLLECTIONS.COOPERATIVE_WITHDRAWALS, 'cw1', {
            userId: ME, amount: 20_000, requestedAt: '2026-02-01T00:00:00.000Z',
        });

        const rows = await list();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: 'cw1', source: 'cooperative' });
    });

    it('merges both sources, newest first, labelled by source', async () => {
        store.seed(COLLECTIONS.WITHDRAWALS, 'w1', {
            userId: ME, amount: 5_000, createdAt: '2026-03-01T00:00:00.000Z',
        });
        store.seed(COLLECTIONS.COOPERATIVE_WITHDRAWALS, 'cw1', {
            userId: ME, amount: 20_000, requestedAt: '2026-01-01T00:00:00.000Z',
        });

        const rows = await list();
        expect(rows.map((w: any) => [w.id, w.source])).toEqual([
            ['w1', 'wallet'], ['cw1', 'cooperative'],
        ]);
        // requestedAt falls back to createdAt, so a wallet row sorts too.
        expect(rows[0].requestedAt).toBeTruthy();
    });

    it('returns only the caller\'s own', async () => {
        store.seedAll(COLLECTIONS.COOPERATIVE_WITHDRAWALS, {
            mine: { userId: ME, requestedAt: '2026-01-01T00:00:00.000Z' },
            theirs: { userId: OTHER, requestedAt: '2026-02-01T00:00:00.000Z' },
        });

        expect((await list()).map((w: any) => w.id)).toEqual(['mine']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getMyApplicationStatus', () => {
    const status = async (collection: string, field = 'status') =>
        (await mine()).getMyApplicationStatus(collection, field);

    it('refuses a lookup that is not on the allowlist', async () => {
        // Rule 2: the browser picks from a fixed list; the collection, the
        // status field and the ownership filter are all decided server-side.
        //
        // #415. The refusal answers "unknown", not "pending". Nothing was
        // read, so there is no status to report — and "pending" is what the
        // five waiting screens act on.
        store.seed(COLLECTIONS.USERS, ME, { roles: ['admin'] });

        expect(await status('users')).toMatchObject({ status: 'unknown' });
        expect(await status(COLLECTIONS.WAVE_APPLICATIONS, 'somethingElse'))
            .toMatchObject({ status: 'unknown' });
    });

    it('returns the NEWEST application of that kind', async () => {
        store.seedAll(COLLECTIONS.WAVE_APPLICATIONS, {
            old: { userId: ME, status: 'rejected', rejectionReason: 'incomplete', createdAt: '2026-01-01T00:00:00.000Z' },
            recent: { userId: ME, status: 'approved', createdAt: '2026-03-01T00:00:00.000Z' },
        });

        expect(await status(COLLECTIONS.WAVE_APPLICATIONS)).toMatchObject({ status: 'approved' });
    });

    it('carries the rejection reason through', async () => {
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'a1', {
            userId: ME, status: 'rejected', rejectionReason: 'no proof of address',
            createdAt: '2026-01-01T00:00:00.000Z',
        });

        expect(await status(COLLECTIONS.ACADEMY_APPLICATIONS)).toMatchObject({
            status: 'rejected', rejectionReason: 'no proof of address',
        });
    });

    it('never reports somebody else\'s application', async () => {
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'theirs', {
            userId: OTHER, status: 'approved', createdAt: '2026-03-01T00:00:00.000Z',
        });

        expect(await status(COLLECTIONS.WAVE_APPLICATIONS)).toMatchObject({ status: 'pending' });
    });

    it('reads Farm Nation off the user record, where its onboarding state lives', async () => {
        store.seed(COLLECTIONS.USERS, ME, {
            serviceRegistrations: { farmNation: { status: 'approved' } },
        });

        expect(await (await mine()).getMyApplicationStatus(COLLECTIONS.USERS, 'farmNation'))
            .toMatchObject({ status: 'approved' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getMyMembershipStatus', () => {
    const status = async (moduleType: string) => (await mine()).getMyMembershipStatus(moduleType);

    it('is "unknown" for a module nobody has heard of', async () => {
        expect(await status('atlantis')).toMatchObject({ status: 'unknown' });
    });

    it('settles from the user record when the registration is decided', async () => {
        store.seed(COLLECTIONS.USERS, ME, {
            serviceRegistrations: { wave: { status: 'approved', tier: 'gold' } },
        });

        expect(await status('wave')).toMatchObject({
            status: 'approved', data: { tier: 'gold' },
        });
    });

    it('falls back to the application collection when the registration is NOT settled', async () => {
        store.seed(COLLECTIONS.USERS, ME, {
            serviceRegistrations: { wave: { status: 'pending' } },
        });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'a1', { userId: ME, status: 'under_review' });

        expect(await status('wave')).toMatchObject({ status: 'under_review' });
    });

    it('QUERIES THE COLLECTIONS THAT EXIST', async () => {
        // The browser version looked for "farmnation_applications" and
        // "export_applications", neither of which is written anywhere — the
        // writers use farm_nation_applications and
        // export_onboarding_applications. Those fallbacks never matched a row.
        store.seed(COLLECTIONS.FARM_NATION_APPLICATIONS, 'f1', { userId: ME, status: 'approved' });
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'e1', { userId: ME, status: 'approved' });

        expect(await status('farm-nation')).toMatchObject({ status: 'approved' });
        expect(await status('farmNation')).toMatchObject({ status: 'approved' });
        expect(await status('export')).toMatchObject({ status: 'approved' });
    });

    it('reads a cooperative membership under either registration key', async () => {
        store.seed(COLLECTIONS.USERS, ME, {
            serviceRegistrations: { cooperative: { status: 'active' } },
        });

        expect(await status('cooperative')).toMatchObject({ status: 'active' });
        expect(await status('cooperatives')).toMatchObject({ status: 'active' });
    });

    it('falls back to membershipStatus when the row has no status', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'm1', {
            userId: ME, membershipStatus: 'active',
        });

        expect(await status('cooperative')).toMatchObject({ status: 'active' });
    });

    it('has no fallback for marketplace, so it stays unknown', async () => {
        expect(await status('marketplace')).toMatchObject({ status: 'unknown' });
    });

    it('never reports somebody else\'s membership', async () => {
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'theirs', { userId: OTHER, status: 'approved' });
        expect(await status('wave')).toMatchObject({ status: 'unknown' });
    });
});
