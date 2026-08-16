/**
 * @jest-environment node
 */

/**
 * Admin API routes must block before they mutate.
 *
 * WHY BEHAVIOURAL, NOT A GREP
 * --------------------------
 * A static check that each admin route mentions requireAdmin/isAdmin would
 * pass on every route here — and would have passed on /api/admin/broadcast/
 * estimate, whose guard was present and reached around by
 * `?debug=antigravity`. Presence of a guard is not enforcement of a guard.
 *
 * So these call the real route handlers with (a) no session and (b) a
 * non-admin session, and assert two things each time:
 *   1. the status is 401 or 403, and
 *   2. THE SENSITIVE WORK NEVER RAN — no transaction, no cache purge.
 *
 * The second assertion is the one that matters. A route can return 403 and
 * still have done the work first; asserting only on the status would miss it.
 * That is the same vacuous-assertion trap the smoke suite and the payment mock
 * fell into, so it is called out here to stay avoided.
 *
 * TWO GUARD SEAMS, AND A DEFAULT WORTH KNOWING
 * --------------------------------------------
 * requireAdmin() calls auth() from @/lib/auth directly, so mocking auth drives
 * it. requireSession() is GLOBALLY mocked in jest.setup.js, and its default is
 * `{ session: { user: { roles: ['admin'] } } }` — every test is an admin
 * unless it says otherwise. That default is exactly why a route guard cannot be
 * caught by accident: a test has to drive global.mockRequireSession down to a
 * non-admin to exercise the block at all. These do.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockAuth = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/auth', () => ({ auth: () => mockAuth() }));

declare const global: any;

const NO_SESSION_RESULT = {
    session: null,
    error: { success: false, code: 'SESSION_EXPIRED', error: 'expired' },
};
const NON_ADMIN_RESULT = {
    session: { user: { id: 'u1', roles: ['member'], email: 'm@x.com' } },
    error: null,
};

// Spies on the sensitive effects. Asserting these were NOT called is how
// "blocked before doing anything" is proven.
const mockRunTransaction = jest.fn() as jest.Mock<any>;
const mockDocGet = jest.fn() as jest.Mock<any>;
const mockRevalidatePath = jest.fn();
const mockRevalidateTag = jest.fn();
const mockInvalidateStats = jest.fn() as jest.Mock<any>;

// A db whose reads succeed (so a non-admin's live-role fallback lookup returns
// a non-admin doc) but whose writes are observable.
const nonAdminDoc = { exists: true, data: () => ({ roles: ['member'] }) };
jest.mock('@/lib/supabase-db', () => {
    const db = {
        collection: () => ({
            doc: () => ({
                get: (...a: any[]) => mockDocGet(...a),
            }),
        }),
        runTransaction: (...a: any[]) => mockRunTransaction(...a),
    };
    return { supabaseDb: db, getAdminDb: () => db };
});

jest.mock('next/cache', () => ({
    revalidatePath: (...a: any[]) => mockRevalidatePath(...a),
    revalidateTag: (...a: any[]) => mockRevalidateTag(...a),
}));
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateAdminGlobalStats: (...a: any[]) => mockInvalidateStats(...a),
    invalidateCooperativeCache: jest.fn(),
}));
jest.mock('@/lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const NO_SESSION = null;
const NON_ADMIN = { user: { id: 'u1', roles: ['member'] } };

beforeEach(() => {
    jest.clearAllMocks();
    mockDocGet.mockResolvedValue(nonAdminDoc);
    mockRunTransaction.mockResolvedValue(undefined);
    mockInvalidateStats.mockResolvedValue(undefined);
});

// ─── approve-member: requireSession + isAdmin, mutates membership and roles ───

describe('POST /api/admin/cooperative/approve-member', () => {
    async function call(body = { memberId: 'm1' }) {
        const { POST } = await import('@/app/api/admin/cooperative/approve-member/route');
        return POST({ json: async () => body } as any);
    }

    it('401s an unauthenticated caller and runs no transaction', async () => {
        global.mockRequireSession.mockResolvedValueOnce(NO_SESSION_RESULT);
        const res = await call();
        expect(res.status).toBe(401);
        expect(mockRunTransaction).not.toHaveBeenCalled();
    });

    it('403s a non-admin and runs no transaction', async () => {
        // Non-admin session; the route's live-role fallback re-reads the user
        // doc, which the db mock returns as a plain member — still not admin.
        global.mockRequireSession.mockResolvedValueOnce(NON_ADMIN_RESULT);
        const res = await call();
        expect(res.status).toBe(403);
        expect(mockRunTransaction).not.toHaveBeenCalled();
    });
});

// ─── hard-reset: requireAdmin, purges every cache ─────────────────────────────

describe('GET /api/admin/maintenance/hard-reset', () => {
    async function call() {
        const { GET } = await import('@/app/api/admin/maintenance/hard-reset/route');
        return GET();
    }

    it('401s an unauthenticated caller and purges nothing', async () => {
        mockAuth.mockResolvedValue(NO_SESSION);
        const res = await call();
        expect(res.status).toBe(401);
        expect(mockRevalidatePath).not.toHaveBeenCalled();
        expect(mockInvalidateStats).not.toHaveBeenCalled();
    });

    it('401s a non-admin and purges nothing', async () => {
        // requireAdmin returns { error } for a non-admin; the route maps that to 401.
        mockAuth.mockResolvedValue(NON_ADMIN);
        const res = await call();
        expect(res.status).toBe(401);
        expect(mockRevalidatePath).not.toHaveBeenCalled();
        expect(mockInvalidateStats).not.toHaveBeenCalled();
    });
});
