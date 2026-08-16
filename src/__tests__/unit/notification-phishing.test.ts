/**
 * @jest-environment node
 */

/**
 * Anyone could put a message with a link into anybody's notification feed.
 *
 * `createNotificationAction` had **no session check of any kind**. It is a
 * `"use server"` export, so an unauthenticated request could write a
 * notification to any userId with any title, message and link — and it renders
 * in the platform's own notification centre, where a user has every reason to
 * trust it. "Your payment could not be processed — update your details here" is
 * a phishing message with the platform's name on it.
 *
 * `createBulkNotificationsAction` was the same hole aimed at a list of people.
 *
 * AND ONE THAT SAID IT WAS SAFE
 * -----------------------------
 * `markAllAsReadAction(userId)` required a session and then did this:
 *
 *     // Securely delegate to infrastructure layer
 *     return await notificationService.markAllAsRead(userId);
 *
 * The infrastructure layer does not check either — `markAllAsRead(userId)`
 * queries by that id and writes, with no notion of who asked. So any signed-in
 * user could clear anybody's unread notifications, including the alerts about a
 * withdrawal or a dispute that the owner had not read yet.
 *
 * `getUserNotificationsAction` and `getUnreadCountAction` in the same file
 * already compared against the session. Only the write did not.
 *
 * THE LINK
 * --------
 * Every internal caller uses a relative path — /loans,
 * /admin/marketplace/disputes/…, /courses/…/certificate — so requiring one
 * costs nothing and removes the off-site destination. Protocol-relative URLs
 * ("//evil.example") are refused too: absolute to a browser, relative-looking to
 * a naive check.
 *
 * WHY THE CRON ROUTE CHANGED
 * --------------------------
 * api/cron/release-escrow imported the ACTION, and a cron run has no session.
 * It now calls notificationService.createNotification directly — the same layer
 * the action delegates to — and it is already gated by CRON_SECRET. Trusted
 * server callers use the service; the action is the public door.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const CALLER = 'caller-1';
const VICTIM = 'victim-1';
const ADMIN = 'admin-1';

const mockCreate = jest.fn(async () => ({ success: true, error: null, data: null })) as jest.Mock<any>;
const mockCreateBulk = jest.fn(async () => ({ success: true, error: null, data: null })) as jest.Mock<any>;
const mockMarkAll = jest.fn(async () => ({ success: true, error: null, data: null })) as jest.Mock<any>;
const mockGetUser = jest.fn(async () => []) as jest.Mock<any>;
const mockUnread = jest.fn(async () => 7) as jest.Mock<any>;

jest.mock('@/infrastructure/notifications/service', () => ({
    createNotification: (...a: any[]) => mockCreate(...a),
    createBulkNotifications: (...a: any[]) => mockCreateBulk(...a),
    markAllAsRead: (...a: any[]) => mockMarkAll(...a),
    getUserNotifications: (...a: any[]) => mockGetUser(...a),
    getUnreadCount: (...a: any[]) => mockUnread(...a),
    markNotificationAsRead: jest.fn(async () => ({ success: true, error: null, data: null })),
}));

function setSession(id: string | null, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, email: `${id}@e.com`, name: id, roles } }, error: null }
    ));
}

const message = {
    userId: VICTIM,
    type: 'payment' as const,
    title: 'Your payment could not be processed',
    message: 'Update your card details to avoid losing access.',
};

async function create(overrides: Record<string, any> = {}) {
    const { createNotificationAction } = await import('@/app/actions/notifications');
    return createNotificationAction({ ...message, ...overrides } as any);
}

describe('creating a notification needs a session', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    it('refuses an unauthenticated caller, and writes nothing', async () => {
        // THE test. This endpoint had no session check at all, and its output
        // appears in the platform's own notification centre.
        setSession(null);

        const r: any = await create();

        expect(r.success).toBe(false);
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('refuses an unauthenticated bulk send', async () => {
        setSession(null);
        const { createBulkNotificationsAction } = await import('@/app/actions/notifications');

        const r: any = await createBulkNotificationsAction([VICTIM, 'other-1'], message as any);

        expect(r.success).toBe(false);
        expect(mockCreateBulk).not.toHaveBeenCalled();
    });

    it('still lets a signed-in caller notify somebody', async () => {
        // Vacuity guard, and it matters: eight action files and the escrow flow
        // send notifications to OTHER people — a seller about an order, a buyer
        // about a dispute. A guard requiring target === self would break all of
        // them.
        setSession(CALLER);

        const r: any = await create();

        expect(r.success).toBe(true);
        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ userId: VICTIM }));
    });
});

describe('the link has to stay on the platform', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(CALLER);
    });

    it('refuses an absolute URL', async () => {
        const r: any = await create({ link: 'https://evil.example/login' });

        expect(r.success).toBe(false);
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('refuses a protocol-relative URL', async () => {
        // "//evil.example" is absolute to a browser and looks relative to a
        // check that only tests for a leading slash.
        const r: any = await create({ link: '//evil.example/login' });

        expect(r.success).toBe(false);
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('accepts the relative paths every internal caller uses', async () => {
        for (const link of ['/loans', '/admin/marketplace/disputes/abc', '/courses/x/certificate']) {
            jest.clearAllMocks();
            const r: any = await create({ link });
            expect(r.success).toBe(true);
        }
    });

    it('accepts a notification with no link', async () => {
        const r: any = await create({ link: undefined });

        expect(r.success).toBe(true);
    });
});

describe('marking all as read belongs to the owner', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    async function markAll(target: string) {
        const { markAllAsReadAction } = await import('@/app/actions/notifications');
        return markAllAsReadAction(target);
    }

    it('refuses to clear another user\'s notifications', async () => {
        // The comment said "Securely delegate to infrastructure layer"; the
        // infrastructure layer takes the id and writes.
        setSession(CALLER);

        const r: any = await markAll(VICTIM);

        expect(r.success).toBe(false);
        expect(mockMarkAll).not.toHaveBeenCalled();
    });

    it('lets a user clear their own', async () => {
        setSession(CALLER);

        const r: any = await markAll(CALLER);

        expect(r.success).toBe(true);
        expect(mockMarkAll).toHaveBeenCalledWith(CALLER);
    });

    it('lets an admin clear somebody else\'s', async () => {
        setSession(ADMIN, ['admin']);

        const r: any = await markAll(VICTIM);

        expect(r.success).toBe(true);
    });

    it('refuses an unauthenticated caller', async () => {
        setSession(null);

        const r: any = await markAll(VICTIM);

        expect(r.success).toBe(false);
        expect(mockMarkAll).not.toHaveBeenCalled();
    });
});

describe('the reads, which were already scoped', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    it('refuses to list another user\'s notifications', async () => {
        setSession(CALLER);
        const { getUserNotificationsAction } = await import('@/app/actions/notifications');

        const r = await getUserNotificationsAction(VICTIM);

        expect(r).toEqual([]);
        expect(mockGetUser).not.toHaveBeenCalled();
    });

    it('refuses another user\'s unread count', async () => {
        setSession(CALLER);
        const { getUnreadCountAction } = await import('@/app/actions/notifications');

        const r = await getUnreadCountAction(VICTIM);

        expect(r).toBe(0);
        expect(mockUnread).not.toHaveBeenCalled();
    });

    it('admits a super_admin, not only the literal admin role', async () => {
        // These checked `roles.includes('admin')` alone, so a super_admin
        // without that literal role was refused — the same narrow check fixed
        // for land verification in #115 and dispute assignment in #122.
        setSession('super-1', ['super_admin']);
        const { getUnreadCountAction } = await import('@/app/actions/notifications');

        const r = await getUnreadCountAction(VICTIM);

        expect(r).toBe(7);
    });

    it('serves a user their own notifications', async () => {
        setSession(CALLER);
        const { getUserNotificationsAction } = await import('@/app/actions/notifications');

        await getUserNotificationsAction(CALLER);

        expect(mockGetUser).toHaveBeenCalledWith(CALLER);
    });
});
