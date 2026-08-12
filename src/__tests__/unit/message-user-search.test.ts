/**
 * @jest-environment node
 */

/**
 * The people-picker was a user-list download.
 *
 * `searchUsersAction(query)` matched by SUBSTRING over fullName and email,
 * against the 500 most recently active users:
 *
 *     const matches = fullName.includes(trimmedQuery) || email.includes(trimmedQuery);
 *
 * with no minimum query length and no cap on results. A query of "a" therefore
 * returned most of that window — uid, full name, **email address** and roles —
 * to any signed-in caller. On a platform whose user export has already been
 * exposed once, that is a directory anybody can walk.
 *
 * WHAT THE FEATURE ACTUALLY NEEDS
 * -------------------------------
 * /messages prints the email under each result so a user can tell two accounts
 * with the same name apart. That is a fair need, and it does not require the
 * whole address. Non-admin callers now get a masked one — first letter, dots,
 * real domain — which still disambiguates. Admins, who can already read the
 * user list, keep the full address.
 *
 * Plus a three-character minimum and a 25-result cap. The empty-query branch is
 * untouched and deliberately so: it returns admins, so a user can reach support
 * without knowing anyone's name.
 *
 * WHAT WAS ALREADY RIGHT
 * ----------------------
 * More than expected, and stronger than in files audited earlier this week.
 * getApprovedCooperativeMembersAction and broadcastToCooperativeMembersAction
 * both re-read the caller's roles FROM THE DATABASE rather than trusting the
 * JWT — the live re-validation that admin-content.ts was missing in #114.
 * getAllConversationsAdminAction delegates its check into messagingService,
 * which throws for a non-admin.
 *
 * The exact-email lookup is left in place. It confirms whether an address is
 * registered, which is a real disclosure, but it is also how you start a
 * conversation with somebody whose name you do not know how to spell. Narrowing
 * it further is a product decision about how people find each other, not a
 * defect to fix unilaterally — so it is recorded here rather than changed.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const CALLER = 'caller-1';
const ADMIN = 'admin-1';

jest.mock('@/lib/supabase', () => ({
    supabase: {},
    supabaseAdmin: {
        from: () => ({
            select: () => ({
                overlaps: async () => ({
                    data: [{ id: 'admin-9', email: 'support@admin.easysalesexport.com', roles: ['admin'], raw_data: {} }],
                }),
            }),
        }),
    },
}));
jest.mock('@/infrastructure/messaging/service', () => ({
    getConversations: jest.fn(async () => []),
    getAllConversationsAdmin: jest.fn(async (roles: string[]) => {
        const ok = roles.some((r) => r === 'admin' || r === 'super_admin' || r.endsWith('_admin'));
        if (!ok) throw new Error('Access denied: Admin privileges required');
        return [];
    }),
    getMessages: jest.fn(async () => []),
    sendMessage: jest.fn(async () => ({ id: 'm1' })),
    markAsRead: jest.fn(async () => undefined),
    startConversation: jest.fn(async () => ({ id: 'c1' })),
    createSupportConversation: jest.fn(async () => ({ id: 'c1' })),
}));

function setCaller(id: string, dbRoles: string[]) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles: dbRoles }, },
        error: null,
    }));
    (global as any).mockFirestoreGet.mockImplementation((idOrCollection: string) => {
        if (idOrCollection === id) {
            return Promise.resolve({ exists: true, empty: false, docs: [], data: () => ({ roles: dbRoles }) });
        }
        // The three user queries the search runs.
        return Promise.resolve({
            exists: false, empty: false,
            docs: DIRECTORY.map((u) => ({ id: u.uid, data: () => u })),
            data: () => ({}),
        });
    });
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: false, empty: true, docs: [], data: () => ({}),
    }));
}

/** An ordinary slice of the user directory. */
const DIRECTORY = [
    { uid: 'u1', fullName: 'Amaka Obi', email: 'amaka.obi@example.com', roles: ['farmer'] },
    { uid: 'u2', fullName: 'Adamu Sani', email: 'adamu.sani@example.com', roles: ['seller'] },
    { uid: 'u3', fullName: 'Chinwe Eze', email: 'chinwe@example.com', roles: ['buyer'] },
];

async function search(query: string) {
    const { searchUsersAction } = await import('@/app/actions/messages');
    return searchUsersAction(query);
}

describe('searchUsersAction — finding one person, not listing everybody', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setCaller(CALLER, ['farmer']);
    });

    it('returns nothing for a one-character query', async () => {
        // THE test. "a" used to match most of the 500-user window.
        const r: any = await search('a');

        expect(r.users).toEqual([]);
    });

    it('returns nothing for a two-character query', async () => {
        const r: any = await search('am');

        expect(r.users).toEqual([]);
    });

    it('finds someone from a real query', async () => {
        // Vacuity guard. A minimum length that refused everything would break
        // the messages page without any other symptom.
        const r: any = await search('amaka');

        expect(r.users.length).toBeGreaterThan(0);
        expect(r.users[0].fullName).toBe('Amaka Obi');
    });

    it('masks the address for an ordinary caller', async () => {
        const r: any = await search('amaka');

        const found = r.users[0];
        expect(found.email).not.toBe('amaka.obi@example.com');
        // Still enough to tell two people apart: first letter and real domain.
        expect(found.email).toMatch(/^a•+@example\.com$/);
    });

    it('gives an admin the full address', async () => {
        // An admin can already read the user list; masking it here would only
        // obstruct support work.
        setCaller(ADMIN, ['admin']);

        const r: any = await search('amaka');

        expect(r.users[0].email).toBe('amaka.obi@example.com');
    });

    it('caps how many people one query can return', async () => {
        const many = Array.from({ length: 60 }, (_, i) => ({
            uid: `bulk-${i}`, fullName: `Person Number ${i}`, email: `person${i}@example.com`, roles: ['buyer'],
        }));
        (global as any).mockFirestoreGet.mockImplementation((idOrCollection: string) =>
            Promise.resolve(
                idOrCollection === CALLER
                    ? { exists: true, empty: false, docs: [], data: () => ({ roles: ['farmer'] }) }
                    : { exists: false, empty: false, docs: many.map((u) => ({ id: u.uid, data: () => u })), data: () => ({}) }
            )
        );

        const r: any = await search('person');

        expect(r.users.length).toBeLessThanOrEqual(25);
    });

    it('still returns admins for an empty query', async () => {
        // The support path: a user who knows nobody's name can still reach an
        // administrator. This branch is deliberately untouched.
        const r: any = await search('');

        expect(r.users.length).toBeGreaterThan(0);
        expect(r.users[0].roles).toContain('admin');
    });

    it('refuses an unauthenticated caller', async () => {
        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: null, error: { error: 'Authentication required' },
        }));

        const r: any = await search('amaka');

        expect(r.users).toEqual([]);
    });
});

describe('the admin endpoints re-read roles from the database', () => {
    beforeEach(() => jest.clearAllMocks());

    it('getAllConversationsAdminAction refuses a non-admin', async () => {
        // Delegated into messagingService, which throws. The action catches and
        // returns an empty list rather than leaking the reason.
        setCaller(CALLER, ['farmer']);
        const { getAllConversationsAdminAction } = await import('@/app/actions/messages');

        const r: any = await getAllConversationsAdminAction();

        expect(r.conversations).toEqual([]);
        expect(r.error).toBeTruthy();
    });

    it('getAllConversationsAdminAction serves an admin', async () => {
        setCaller(ADMIN, ['admin']);
        const { getAllConversationsAdminAction } = await import('@/app/actions/messages');

        const r: any = await getAllConversationsAdminAction();

        expect(r.error).toBeNull();
    });

    it('getApprovedCooperativeMembersAction refuses a non-admin', async () => {
        setCaller(CALLER, ['cooperative_member']);
        const { getApprovedCooperativeMembersAction } = await import('@/app/actions/messages');

        const r: any = await getApprovedCooperativeMembersAction();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/access denied/i);
    });

    it('broadcastToCooperativeMembersAction refuses a non-admin', async () => {
        // A mass message to every approved member is not a member's to send.
        setCaller(CALLER, ['cooperative_member']);
        const { broadcastToCooperativeMembersAction } = await import('@/app/actions/messages');

        const r: any = await broadcastToCooperativeMembersAction(['u1', 'u2'], 'hello');

        expect(r.success).toBe(false);
        expect(r.sent).toBe(0);
    });

    it('believes the database over a stale token', async () => {
        // The session still claims admin; the user record does not. These
        // endpoints read the record — the live re-validation admin-content.ts
        // was missing until #114.
        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: { user: { id: CALLER, email: 'c@e.com', roles: ['admin'] } },
            error: null,
        }));
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true, empty: false, docs: [], data: () => ({ roles: ['cooperative_member'] }),
        }));
        const { getApprovedCooperativeMembersAction } = await import('@/app/actions/messages');

        const r: any = await getApprovedCooperativeMembersAction();

        expect(r.success).toBe(false);
    });
});
