/**
 * @jest-environment node
 */

/**
 * admin-content.ts — content approval for products, land and export listings.
 *
 * WHAT THIS FILE GOT RIGHT, AND WHAT IT DID NOT
 * ---------------------------------------------
 * `getContentApprovalItemsAction` re-reads the caller's roles from the database
 * before listing anything — the "Live role re-validation — bypasses stale JWT"
 * pattern used in admin.ts and both escrow files. That is stronger than most of
 * the codebase.
 *
 * `approveContentAction` and `rejectContentAction`, twenty lines below it,
 * checked `session.user.roles` alone. They mark land VERIFIED, put products
 * live and publish export listings — so the read was better protected than the
 * writes beside it.
 *
 * HOW BIG A DEAL THIS IS
 * ----------------------
 * Smaller than it sounds, and worth saying plainly. Role changes invalidate the
 * user's cache and the JWT callback resynchronises roles from it, so a revoked
 * admin's token does not stay authoritative for long. This is a consistency fix
 * — the mutating endpoints should not be weaker than the read next to them —
 * not the closing of a live hole. It costs one document read on an action an
 * admin performs by hand.
 *
 * `getPendingContentAction` LOOKS unguarded and is not: it delegates to
 * getContentApprovalItemsAction, which does the whole check. That is the
 * delegation shape the per-function auth scanner follows, and the reason it
 * follows it — a guard one call away is still a guard, and a scanner that could
 * not see through it would report a false positive here.
 *
 * WHAT IS ASSERTED BEYOND THE GUARDS
 * ----------------------------------
 * That each content type writes the right fields, because the three branches of
 * the switch are easy to confuse and only one of them sets `verified: true` on
 * a piece of land.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const ADMIN = 'admin-1';
const SELLER = 'seller-1';
const ITEM = 'item-1';
const OWNER = 'owner-1';

jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: jest.fn(async () => ({})),
    invalidateServiceCache: jest.fn(async () => ({})),
    invalidateAdminGlobalStats: jest.fn(async () => ({})),
    invalidateAllCaches: jest.fn(async () => ({})),
}));
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: jest.fn(async () => ({})),
    createBulkNotificationsAction: jest.fn(async () => ({})),
}));

/**
 * The session carries one set of roles; the USER DOCUMENT carries another.
 *
 * Keeping them separate is the whole point here — the fix is that the mutating
 * endpoints believe the document, not the token. A fixture that returned the
 * same roles for both could not tell the two implementations apart.
 */
function setCaller(opts: { sessionRoles: string[]; dbRoles: string[]; id?: string }) {
    const id = opts.id ?? ADMIN;
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles: opts.sessionRoles } },
        error: null,
    }));
    (global as any).mockFirestoreGet.mockImplementation((docId: string) => Promise.resolve(
        docId === id
            ? { exists: true, empty: false, docs: [], data: () => ({ roles: opts.dbRoles }) }
            : { exists: true, empty: false, docs: [], data: () => ({ ownerId: OWNER, title: 'A listing' }) }
    ));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [], data: () => ({ ownerId: OWNER, title: 'A listing' }),
    }));
}

function allWrites(): Record<string, any>[] {
    const g = global as any;
    return [
        ...g.mockFirestoreUpdate.mock.calls,
        ...g.mockFirestoreSet.mock.calls,
        ...g.mockFirestoreTxUpdate.mock.calls,
        ...g.mockFirestoreTxSet.mock.calls,
    ].map((c: any[]) => c[c.length - 1]).filter(Boolean);
}

async function approve(type: string) {
    const { approveContentAction } = await import('@/app/actions/admin-content');
    return approveContentAction(ITEM, type as any);
}

async function reject(type: string, reason = 'Does not meet listing standards') {
    const { rejectContentAction } = await import('@/app/actions/admin-content');
    return rejectContentAction(ITEM, type as any, reason);
}

describe('approve and reject believe the database, not the token', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    it('refuses an approval from a token that still claims admin after revocation', async () => {
        // THE test. The JWT says admin; the user record no longer does.
        setCaller({ sessionRoles: ['admin'], dbRoles: ['seller'] });

        const r: any = await approve('land');

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/unauthori[sz]ed/i);
        expect(allWrites().filter((p) => p && 'verified' in p)).toEqual([]);
    });

    it('refuses a rejection from the same stale token', async () => {
        setCaller({ sessionRoles: ['admin'], dbRoles: ['seller'] });

        const r: any = await reject('products');

        expect(r.success).toBe(false);
        expect(allWrites().filter((p) => p && p.status === 'rejected')).toEqual([]);
    });

    it('refuses a caller with no admin role in either place', async () => {
        setCaller({ sessionRoles: ['seller'], dbRoles: ['seller'], id: SELLER });

        const r: any = await approve('products');

        expect(r.success).toBe(false);
    });

    it('still lets a real admin approve, so the refusals are not vacuous', async () => {
        setCaller({ sessionRoles: ['admin'], dbRoles: ['admin'] });

        const r: any = await approve('products');

        expect(r.success).toBe(true);
    });
});

describe('each content type is approved as its own kind of thing', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setCaller({ sessionRoles: ['admin'], dbRoles: ['admin'] });
    });

    it('activates a product', async () => {
        await approve('products');

        const patch = allWrites().find((p) => p && 'approvedBy' in p);
        expect(patch?.status).toBe('active');
        expect(patch?.approvedBy).toBe(ADMIN);
    });

    it('marks land verified, which no other branch does', async () => {
        // The land branch is the one with consequences beyond visibility:
        // farm-nation-admin.ts transfers ownership of land whose listing is
        // verified, so this flag sits upstream of a property changing hands.
        await approve('land');

        const patch = allWrites().find((p) => p && 'verified' in p);
        expect(patch?.verified).toBe(true);
        expect(patch?.verificationStatus).toBe('approved');
        expect(patch?.verifiedBy).toBe(ADMIN);
    });

    it('publishes an export listing', async () => {
        await approve('export');

        const patch = allWrites().find((p) => p && 'isActive' in p);
        expect(patch?.status).toBe('live');
        expect(patch?.isActive).toBe(true);
    });

    it('refuses a content type that is not one of the three', async () => {
        // `type` is typed as ContentType, which is a compile-time claim only —
        // a server action can be called with anything.
        const r: any = await approve('users');

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/invalid content type/i);
        expect(allWrites()).toEqual([]);
    });
});

describe('rejection requires a usable reason', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setCaller({ sessionRoles: ['admin'], dbRoles: ['admin'] });
    });

    it('refuses a reason that is too short to tell anyone anything', async () => {
        const r: any = await reject('products', 'no');

        expect(r.success).toBe(false);
        expect(allWrites()).toEqual([]);
    });

    it('refuses an empty reason', async () => {
        const r: any = await reject('products', '');

        expect(r.success).toBe(false);
        expect(allWrites()).toEqual([]);
    });

    it('refuses a reason longer than the 500-character limit', async () => {
        const r: any = await reject('products', 'x'.repeat(501));

        expect(r.success).toBe(false);
        expect(allWrites()).toEqual([]);
    });

    it('records a proper rejection with its reason', async () => {
        // Vacuity guard for the three above.
        const r: any = await reject('products', 'Photographs do not match the described product');

        expect(r.success).toBe(true);
        const patch = allWrites().find((p) => p && p.status === 'rejected');
        expect(patch?.rejectionReason).toBe('Photographs do not match the described product');
    });
});

describe('getPendingContentAction — guarded by delegation', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    it('refuses a non-admin even though it has no guard of its own', async () => {
        // It calls getContentApprovalItemsAction, which does the whole check.
        // A guard one call away is still a guard — this is the shape the
        // per-function auth scanner follows, and this test is why that
        // behaviour is worth keeping.
        setCaller({ sessionRoles: ['seller'], dbRoles: ['seller'], id: SELLER });
        const { getPendingContentAction } = await import('@/app/actions/admin-content');

        const r: any = await getPendingContentAction();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/unauthori[sz]ed/i);
    });

    it('refuses a stale admin token too, through the same delegation', async () => {
        setCaller({ sessionRoles: ['admin'], dbRoles: ['seller'] });
        const { getPendingContentAction } = await import('@/app/actions/admin-content');

        const r: any = await getPendingContentAction();

        expect(r.success).toBe(false);
    });
});
