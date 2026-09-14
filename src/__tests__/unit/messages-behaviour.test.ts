/**
 * @jest-environment node
 */

/**
 * Messaging, EXECUTED — conversations, the admin view, the people-picker, the
 * support router, and the cooperative broadcast.
 *
 * At 38.1% statements / 22.7% branches. Three findings were located by running
 * it:
 *
 *   #96  Four sites test for the role "farmnation_admin". The role is
 *        `farm_nation_admin` and nothing writes the other spelling. So a real
 *        Farm Nation admin passed the endsWith("_admin") gate into the admin
 *        conversation list, matched no module filter inside it, and saw
 *        nothing — and canAccessConversation refused them every individual
 *        thread. In the other direction the admin lookup never returned them,
 *        so no farmer could open a support conversation with them, and module
 *        routing for "farmnation" always fell through to a global admin.
 *
 *   #97  getApprovedCooperativeMembersAction and
 *        broadcastToCooperativeMembersAction both gated on
 *        `roles.some(r => r.endsWith("_admin"))`, so an academy_admin, an
 *        export_admin, a wave_admin, a farm_nation_admin or a
 *        marketplace_admin could download every approved cooperative member's
 *        name, email, gender and state of origin, and message all of them under
 *        their own admin identity.
 *
 *   #98  markAsRead was the one entry point with no access check at all: a
 *        conversation id and a user id went straight into a write of
 *        `participantDetails.<userId>.lastRead`, on any conversation.
 *
 * Nothing is mocked but Redis, auth and Supabase's REST client — the fake
 * store, the messaging service and the permission matrix all run for real.
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

/**
 * The two lookups that reach for Supabase's REST client directly rather than
 * going through the adapter. Backed by the SAME fake store, so a test seeding a
 * user sees it from both paths.
 */
let store: FakeDbHandle;
jest.mock('@/lib/supabase', () => ({
    supabaseAdmin: {
        from: () => ({
            select: () => ({
                overlaps: async (_col: string, roles: string[]) => ({
                    data: (globalThis as unknown as { __fakeUsers: () => Array<[string, Record<string, any>]> })
                        .__fakeUsers()
                        .filter(([, u]) => (u.roles ?? []).some((r: string) => roles.includes(r)))
                        .map(([id, u]) => ({ id, email: u.email, roles: u.roles, raw_data: u })),
                    error: null,
                }),
            }),
        }),
    },
}));

const USER = 'user-1';
const OTHER = 'user-2';
const CONVS = COLLECTIONS.CONVERSATIONS;

function actAs(id: string | null, roles: string[] = ['general_user'], email = 'ada@example.com'): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles, email, name: 'Ada Obi' } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    (globalThis as { __fakeUsers?: unknown }).__fakeUsers = () => store.all(COLLECTIONS.USERS);
    actAs(USER);
});

async function actions() {
    return import('@/app/actions/messages');
}

const seedConversation = (id: string, data: Record<string, unknown>) =>
    store.seed(CONVS, id, { updatedAt: '2026-02-01T00:00:00.000Z', ...data });

// ─────────────────────────────────────────────────────────────────────────────
describe('getConversationsAction', () => {
    const list = async () => (await (await actions()).getConversationsAction()) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect((await list()).conversations).toEqual([]);
    });

    it('returns only the conversations the caller is in', async () => {
        seedConversation('mine', { participants: [USER, OTHER] });
        seedConversation('theirs', { participants: [OTHER, 'user-3'] });

        expect((await list()).conversations.map((c: any) => c.id)).toEqual(['mine']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getAllConversationsAdminAction — the module boundary', () => {
    const list = async () => (await (await actions()).getAllConversationsAdminAction()) as any;

    beforeEach(() => {
        seedConversation('coop', { participants: ['a', 'b'], context: 'cooperative_support' });
        seedConversation('academy', { participants: ['a', 'b'], context: 'academy_support' });
        seedConversation('farm', { participants: ['a', 'b'], context: 'farmnation_support' });
        seedConversation('export', { participants: ['a', 'b'], context: 'export_support' });
    });

    it('refuses an ordinary user', async () => {
        actAs(USER, ['general_user']);
        expect((await list()).error).toBeTruthy();
        expect((await list()).conversations).toEqual([]);
    });

    it('gives a global admin everything', async () => {
        actAs('admin-1', ['admin']);
        expect((await list()).conversations).toHaveLength(4);
    });

    it.each([
        ['cooperative_admin', 'coop'],
        ['academy_admin', 'academy'],
        ['export_admin', 'export'],
    ])('scopes a %s to their own module', async (role, expected) => {
        actAs('m-1', [role]);
        expect((await list()).conversations.map((c: any) => c.id)).toEqual([expected]);
    });

    it('SHOWS A farm_nation_admin THEIR MODULE — the role name was misspelled', async () => {
        // #96. Every module admin above saw their module; this one saw an empty
        // list, because the filter tested for "farmnation_admin" and the role is
        // farm_nation_admin. It passed the endsWith("_admin") gate and then
        // matched nothing.
        actAs('fn-1', ['farm_nation_admin']);
        expect((await list()).conversations.map((c: any) => c.id)).toEqual(['farm']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getMessagesAction and sendMessageAction', () => {
    const read = async (id = 'conv-1') => (await (await actions()).getMessagesAction(id)) as any;
    const send = async (text: string, id = 'conv-1') =>
        (await (await actions()).sendMessageAction(id, text)) as any;

    beforeEach(() => {
        seedConversation('conv-1', { participants: [USER, OTHER], context: 'farmnation_support' });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect((await read()).error).toBeTruthy();
    });

    it('refuses a conversation that does not exist', async () => {
        expect((await read('nope')).error).toBeTruthy();
    });

    it('refuses a stranger, in both directions', async () => {
        actAs('stranger', ['general_user']);

        expect((await read()).error).toContain('Access denied');
        expect(await send('hello')).toMatchObject({ success: false });
        expect(store.size('conversations/conv-1/messages')).toBe(0);
    });

    it('lets a participant send, and records the sender', async () => {
        expect(await send('hello there')).toMatchObject({ success: true });

        const [, message] = store.all('conversations/conv-1/messages')[0];
        expect(message).toMatchObject({
            senderId: USER, text: 'hello there', read: false, type: 'text',
        });
    });

    it('refuses an empty message', async () => {
        expect(await send('   ')).toMatchObject({ success: false });
        expect(store.size('conversations/conv-1/messages')).toBe(0);
    });

    it('lets the module admin of that context read and write it', async () => {
        // #96 again, on the per-conversation gate rather than the list.
        actAs('fn-1', ['farm_nation_admin']);

        expect((await read()).error).toBeNull();
        expect(await send('how can I help?')).toMatchObject({ success: true });
    });

    it('but not the admin of a DIFFERENT module', async () => {
        actAs('ac-1', ['academy_admin']);

        expect((await read()).error).toContain('Access denied');
        expect(await send('nosy')).toMatchObject({ success: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('markAsReadAction', () => {
    const mark = async (id = 'conv-1') => (await (await actions()).markAsReadAction(id)) as any;

    beforeEach(() => {
        seedConversation('conv-1', { participants: [OTHER, 'user-3'], participantDetails: {} });
    });

    it('REFUSES a caller who is not in the conversation', async () => {
        // #98. This took a conversation id and a user id and wrote
        // `participantDetails.<userId>.lastRead` straight onto the document —
        // the one messaging entry point with no access check, so any signed-in
        // caller could inject a key into any thread.
        expect(await mark()).toMatchObject({ success: false });
        expect(store.get(CONVS, 'conv-1')?.participantDetails).toEqual({});
    });

    it('refuses a conversation that does not exist', async () => {
        expect(await mark('nope')).toMatchObject({ success: false });
    });

    it('and a module admin, whose read receipt is not a participant\'s', async () => {
        seedConversation('conv-1', {
            participants: [OTHER, 'user-3'], context: 'academy_support', participantDetails: {},
        });
        actAs('ac-1', ['academy_admin']);

        expect(await mark()).toMatchObject({ success: false });
    });

    it('lets a PARTICIPANT mark it read', async () => {
        seedConversation('conv-1', { participants: [USER, OTHER], participantDetails: {} });

        expect(await mark()).toMatchObject({ success: true });
        expect(store.get(CONVS, 'conv-1')?.participantDetails?.[USER]?.lastRead).toBeDefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('startConversationAction', () => {
    const start = async (participant = OTHER, productId?: string, orderId?: string, context?: string) =>
        (await (await actions()).startConversationAction(participant, productId, orderId, context)) as any;

    beforeEach(() => {
        store.seedAll(COLLECTIONS.USERS, {
            [USER]: { fullName: 'Ada Obi', email: 'ada@example.com', roles: ['general_user'] },
            [OTHER]: { fullName: 'Bola Ade', email: 'bola@example.com', roles: ['seller'] },
        });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect((await start()).conversationId).toBeNull();
    });

    it('refuses messaging yourself', async () => {
        expect((await start(USER)).conversationId).toBeNull();
    });

    it('creates one conversation and REUSES it on a second call', async () => {
        const first = await start();
        expect(first.conversationId).toBeTruthy();

        const second = await start();
        expect(second.conversationId).toBe(first.conversationId);
        expect(store.size(CONVS)).toBe(1);
    });

    it('keeps a product thread separate from a plain one', async () => {
        const plain = await start();
        const product = await start(OTHER, 'product-9');

        expect(product.conversationId).not.toBe(plain.conversationId);
        expect(store.size(CONVS)).toBe(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('searchUsersAction', () => {
    const search = async (q: string) => (await (await actions()).searchUsersAction(q)) as any;

    beforeEach(() => {
        store.seedAll(COLLECTIONS.USERS, {
            [USER]: { fullName: 'Ada Obi', email: 'ada@example.com', roles: ['farmer'] },
            [OTHER]: { fullName: 'Bola Ade', email: 'bola@example.com', roles: ['general_user'] },
            'fn-admin': { fullName: 'Farm Admin', email: 'farmnation@example.com', roles: ['farm_nation_admin'] },
            'ac-admin': { fullName: 'Academy Admin', email: 'academy@example.com', roles: ['academy_admin'] },
        });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect((await search('bola')).users).toEqual([]);
    });

    it('returns nothing for a query under three characters', async () => {
        // A one-character substring query used to sweep the 500 most recently
        // active users — a user-list download wearing the clothes of a
        // people-picker.
        expect((await search('b')).users).toEqual([]);
        expect((await search('bo')).users).toEqual([]);
        expect((await search('bol')).users.length).toBeGreaterThan(0);
    });

    it('MASKS the email for a non-admin caller', async () => {
        const res = await search('bola');
        expect(res.users[0].email).not.toBe('bola@example.com');
        expect(res.users[0].email).toMatch(/^b•+@example\.com$/);
    });

    it('and shows it in full to an admin, who can read the user list anyway', async () => {
        actAs('admin-1', ['admin'], 'admin@example.com');
        store.seed(COLLECTIONS.USERS, 'admin-1', { roles: ['admin'], email: 'admin@example.com' });

        expect((await search('bola')).users[0].email).toBe('bola@example.com');
    });

    it('LISTS the farm_nation_admin on an empty query, so support is reachable', async () => {
        // #96. The empty-query branch exists so a user can reach support without
        // knowing anyone's name, and it queried a hand-written role list whose
        // Farm Nation entry matched nobody.
        const res = await search('');
        const roles = res.users.flatMap((u: any) => u.roles);

        expect(roles).toContain('farm_nation_admin');
    });

    it('AND NOT THE ACADEMY ADMIN, WHO ADMINISTERS NOTHING THIS CALLER DOES', async () => {
        /*
         *   #752 REVERSED THE SECOND HALF OF THE ASSERTION ABOVE, WHICH USED TO
         *   READ `expect(roles).toContain('academy_admin')`.
         *
         *   The caller here is a FARMER. #96's finding — that the Farm Nation
         *   admin must be reachable — is untouched and still asserted; what it
         *   also pinned, incidentally, was that this branch applied NO scoping
         *   at all, so every module's admin came back to everybody. The owner
         *   reported exactly that: "users are only supposed to message the
         *   admin on that module or super admin but other modules admin are
         *   also appearing in a different module".
         *
         *   Reachability was the finding; the absence of scoping was the
         *   accident beside it, and the test recorded both as if they were one.
         */
        const roles = (await search('')).users.flatMap((u: any) => u.roles);

        expect(roles).not.toContain('academy_admin');
    });

    it('does not return the caller to themselves', async () => {
        const res = await search('ada');
        expect(res.users.map((u: any) => u.uid)).not.toContain(USER);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('startSupportConversationAction', () => {
    const support = async (module?: string) =>
        (await (await actions()).startSupportConversationAction(module)) as any;

    beforeEach(() => {
        store.seedAll(COLLECTIONS.USERS, {
            [USER]: { fullName: 'Ada Obi', email: 'ada@example.com', roles: ['farmer'] },
            'fn-admin': { fullName: 'Farm Admin', email: 'fn@example.com', roles: ['farm_nation_admin'] },
            'global-admin': { fullName: 'Global', email: 'boss@example.com', roles: ['super_admin'] },
        });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect((await support()).conversationId).toBeNull();
    });

    it('ROUTES A FARMER TO THE FARM NATION ADMIN', async () => {
        // #96. The lookup was `roles.includes(`${module}_admin`)` — string
        // concatenation producing "farmnation_admin" for the one module whose
        // keyword and role name differ by more than a suffix — so this always
        // fell through to the global admin instead.
        const res = await support('farmnation');
        expect(res.conversationId).toBeTruthy();

        const [, conv] = store.all(CONVS)[0];
        expect(conv.participants).toContain('fn-admin');
        expect(conv.context).toBe('farmnation_support');
    });

    it('falls back to a global admin when the module has none', async () => {
        /*
         *   #752 CHANGED HOW THIS IS SET UP, BECAUSE THE OLD SETUP WAS THE
         *   DEFECT. It used to ask `support('academy')` — a FARMER requesting
         *   another module — and assert that the request fell through to the
         *   global admin. That passed for the wrong reason: the module
         *   parameter is caller-supplied and was trusted, so the fall-through
         *   was the second step of a route that should never have started.
         *   Had an academy_admin been seeded, the farmer would have been sent
         *   to them.
         *
         *   The claim worth keeping is the real one: when a member's OWN module
         *   has no admin, they reach a platform admin rather than nobody. So
         *   the Farm Nation admin is removed and the farmer asks for their own
         *   module.
         */
        store.clear();
        store.seedAll(COLLECTIONS.USERS, {
            [USER]: { fullName: 'Ada Obi', email: 'ada@example.com', roles: ['farmer'] },
            'global-admin': { fullName: 'Global', email: 'boss@example.com', roles: ['super_admin'] },
        });

        const res = await support('farmnation');
        expect(res.conversationId).toBeTruthy();
        expect(store.all(CONVS)[0][1].participants).toContain('global-admin');
    });

    it('AND A MODULE THE CALLER DOES NOT BELONG TO IS NOT HONOURED', async () => {
        /*
         *   The other half, which nothing asserted. `module` is a parameter of
         *   a server action, so any browser can send any string; an
         *   unrecognised one used to be unshifted onto the caller's own module
         *   list and then used to pick the admin.
         *
         *   Here the farmer asks for "academy" and reaches their own Farm
         *   Nation admin — and the thread is not stamped `academy_support`
         *   either, which under #635's scopes would have listed it in the
         *   academy admin's inbox whoever received it.
         */
        const res = await support('academy');
        expect(res.conversationId).toBeTruthy();

        const [, conv] = store.all(CONVS)[0];
        expect(conv.participants).toContain('fn-admin');
        expect(conv.context).toBe('general_support');
    });

    it('reports no admin available rather than throwing', async () => {
        store.clear();
        store.seed(COLLECTIONS.USERS, USER, { roles: ['farmer'], email: 'ada@example.com' });

        expect(await support()).toMatchObject({
            error: 'No admin available currently', conversationId: null,
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the cooperative roster and broadcast', () => {
    const roster = async () => (await (await actions()).getApprovedCooperativeMembersAction()) as any;
    const broadcast = async (uids: string[], msg: string) =>
        (await (await actions()).broadcastToCooperativeMembersAction(uids, msg)) as any;

    beforeEach(() => {
        store.seedAll(COLLECTIONS.COOPERATIVE_MEMBERS, {
            'm-1': {
                firstName: 'Ada', lastName: 'Obi', email: 'ada@example.com',
                membershipStatus: 'active', gender: 'female', stateOfOrigin: 'Plateau',
            },
            'm-2': {
                fullName: 'Bola Ade', email: 'bola@example.com',
                membershipStatus: 'approved', gender: 'male', stateOfOrigin: 'Lagos',
            },
            'm-3': { fullName: 'Not A Member', membershipStatus: 'pending' },
        });
        store.seedAll(COLLECTIONS.USERS, {
            'admin-1': { roles: ['admin'], email: 'admin@example.com' },
            'coop-admin': { roles: ['cooperative_admin'], email: 'coop@example.com' },
            'ac-admin': { roles: ['academy_admin'], email: 'ac@example.com' },
            'ex-admin': { roles: ['export_admin'], email: 'ex@example.com' },
            'wv-admin': { roles: ['wave_admin'], email: 'wv@example.com' },
            'fn-admin': { roles: ['farm_nation_admin'], email: 'fn@example.com' },
            'mkt-admin': { roles: ['marketplace_admin'], email: 'mkt@example.com' },
            'm-1': { roles: ['cooperative_member'], email: 'ada@example.com', fullName: 'Ada Obi' },
        });
        actAs('admin-1', ['admin'], 'admin@example.com');
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await roster()).toMatchObject({ success: false });
    });

    it('refuses an ordinary user', async () => {
        actAs(USER, ['cooperative_member']);
        expect(await roster()).toMatchObject({ success: false, error: 'Access denied' });
    });

    it.each(['academy_admin', 'export_admin', 'wave_admin', 'farm_nation_admin', 'marketplace_admin'])(
        'REFUSES a %s — the roster is the cooperative\'s', async (role) => {
            // #97. The gate was `roles.some(r => r.endsWith("_admin"))`, so every
            // module admin could download every member's name, email, gender and
            // state of origin.
            actAs('x-1', [role]);
            store.seed(COLLECTIONS.USERS, 'x-1', { roles: [role] });

            expect(await roster()).toMatchObject({ success: false, error: 'Access denied' });
            expect(await broadcast(['m-1'], 'hello')).toMatchObject({ success: false });
        });

    it.each(['admin', 'super_admin', 'cooperative_admin'])(
        'admits a %s', async (role) => {
            actAs('y-1', [role]);
            store.seed(COLLECTIONS.USERS, 'y-1', { roles: [role] });

            expect((await roster()).success).toBe(true);
        });

    it('returns active AND approved members, and nobody else', async () => {
        const res = await roster();
        expect(res.data.map((m: any) => m.uid).sort()).toEqual(['m-1', 'm-2']);
        expect(res.data.map((m: any) => m.fullName)).toEqual(['Ada Obi', 'Bola Ade']);
    });

    it('stamps a member number derived from the record, not from today', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'm-1', {
            fullName: 'Ada Obi', membershipStatus: 'active',
            createdAt: '2024-05-01T00:00:00.000Z',
        });

        const member = (await roster()).data.find((m: any) => m.uid === 'm-1');
        expect(member.memberNumber).toBe('ESE-COOP-2024-M-1');
    });

    it('refuses an empty broadcast, and one with no recipients', async () => {
        expect(await broadcast(['m-1'], '   ')).toMatchObject({ success: false });
        expect(await broadcast([], 'hello')).toMatchObject({ success: false });
        expect(store.size(CONVS)).toBe(0);
    });

    it('sends to each member, creating the thread once', async () => {
        expect(await broadcast(['m-1'], 'AGM on Friday')).toMatchObject({ sent: 1, failed: 0 });

        const [convId, conv] = store.all(CONVS)[0];
        expect(conv.context).toBe('cooperative_broadcast');
        expect(conv.participants).toEqual(expect.arrayContaining(['admin-1', 'm-1']));

        const messages = store.all(`conversations/${convId}/messages`);
        expect(messages).toHaveLength(1);
        expect(messages[0][1]).toMatchObject({ senderId: 'admin-1', text: 'AGM on Friday' });
    });

    it('reuses the existing direct thread rather than opening a second', async () => {
        await broadcast(['m-1'], 'first');
        const convId = store.all(CONVS)[0][0];

        await broadcast(['m-1'], 'second');

        expect(store.size(CONVS)).toBe(1);
        expect(store.all(`conversations/${convId}/messages`)).toHaveLength(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#752 — a member\'s message reaches their admin, END TO END', () => {
    /**
     *   ASKED BY THE OWNER — "does the message deliver end to end?" — and the
     *   honest answer before this existed was that nothing proved it.
     *
     *   #752's own suite mocks the messaging service, so it establishes that
     *   the PICKER offers the right admin and stops there. Every step after
     *   that was assumed: that the conversation is created with both people on
     *   it, that the text is stored, that the admin's inbox lists it, and that
     *   the admin can open it and read what was sent.
     *
     *   That last step is the one with real risk. #635 routes the admin inbox
     *   through `mayAccessConversation`, whose module branch matches a
     *   conversation's CONTEXT against the module's context list — and
     *   "general_support", which is what a member with no module produces, is
     *   in no module's list at all. A module admin reaches such a thread only
     *   via the participants check. That is a two-step argument about code in
     *   three files, which is exactly the kind of reasoning that should be run
     *   rather than believed.
     *
     *   Nothing is mocked here but Redis, auth and Supabase's REST client. The
     *   fake store, the messaging service, the scoping rules and the permission
     *   matrix all run for real.
     */
    const MEMBER = 'member-1';
    const COOP_ADMIN = 'coop-admin-1';

    const asMember = () => actAs(MEMBER, ['cooperative_member'], 'member@example.com');
    const asAdmin = () => actAs(COOP_ADMIN, ['cooperative_admin'], 'grace@easysalesexport.com');

    beforeEach(() => {
        store.seedAll(COLLECTIONS.USERS, {
            [MEMBER]: { fullName: 'Ada Obi', email: 'member@example.com', roles: ['cooperative_member'] },
            //   Deliberately an address with NO module word in it — the shape
            //   the old email-substring scoping made invisible to her own
            //   members.
            [COOP_ADMIN]: { fullName: 'Grace Bello', email: 'grace@easysalesexport.com', roles: ['cooperative_admin'] },
            'wave-admin-1': { fullName: 'Wave Admin', email: 'wave@easysalesexport.com', roles: ['wave_admin'] },
        });
        asMember();
    });

    it('THE WHOLE JOURNEY: picker → conversation → send → admin inbox → read', async () => {
        const a = await actions();

        //   1. The member opens Messages. The picker offers their own admin,
        //      and not the wave admin.
        const picked = (await a.searchUsersAction('')) as any;
        expect(picked.users.map((u: any) => u.uid)).toEqual([COOP_ADMIN]);

        //   2. They start a support conversation.
        const started = (await a.startSupportConversationAction('cooperative')) as any;
        expect(started.error).toBeNull();
        expect(started.conversationId).toBeTruthy();

        //   3. Both people are on it, and it is stamped as cooperative support.
        const [convId, conv] = store.all(CONVS)[0];
        expect(conv.participants).toEqual(expect.arrayContaining([MEMBER, COOP_ADMIN]));
        expect(conv.context).toBe('cooperative_support');

        //   4. They send a message, and it is STORED.
        const sent = (await a.sendMessageAction(convId, 'My contribution is missing')) as any;
        expect(sent.error).toBeFalsy();
        expect(store.all(`conversations/${convId}/messages`)).toHaveLength(1);

        //   5. The admin's own inbox lists it.
        asAdmin();
        expect(((await a.getConversationsAction()) as any).conversations.map((c: any) => c.id))
            .toContain(convId);

        //   6. AND THE ADMIN CAN OPEN IT AND READ WHAT WAS SENT. The step that
        //      "the picker returned the right person" does not establish.
        const opened = (await a.getMessagesAction(convId)) as any;
        expect(opened.error).toBeFalsy();
        expect(opened.messages.map((m: any) => m.text)).toContain('My contribution is missing');

        //   7. And the admin can reply, so it is a conversation and not a
        //      one-way drop.
        expect(((await a.sendMessageAction(convId, 'Checking now')) as any).error).toBeFalsy();
        asMember();
        expect(((await a.getMessagesAction(convId)) as any).messages.map((m: any) => m.text))
            .toContain('Checking now');
    });

    it('AND THE WAVE ADMIN CANNOT READ IT — the scoping holds at the far end', async () => {
        /*
         *   The other half of delivery: it reached the right person AND not the
         *   wrong one. Asserted through the real `mayAccessConversation`, not
         *   by inspecting the row.
         */
        const a = await actions();
        await a.startSupportConversationAction('cooperative');
        const convId = store.all(CONVS)[0][0];
        await a.sendMessageAction(convId, 'My contribution is missing');

        actAs('wave-admin-1', ['wave_admin'], 'wave@easysalesexport.com');

        expect(((await a.getConversationsAction()) as any).conversations.map((c: any) => c.id))
            .not.toContain(convId);
        expect(((await a.getMessagesAction(convId)) as any).messages).toEqual([]);
    });

    it('AND IT DELIVERS FOR A MEMBER WITH NO MODULE AT ALL', async () => {
        /*
         *   The general_user case — every new registration — where the thread
         *   is stamped "general_support", which belongs to no module's context
         *   list. The recipient reaches it as a PARTICIPANT, and this is the
         *   assertion that proves that argument rather than restating it.
         */
        const a = await actions();
        actAs(MEMBER, ['general_user'], 'member@example.com');
        store.seed(COLLECTIONS.USERS, MEMBER, {
            fullName: 'Ada Obi', email: 'member@example.com', roles: ['general_user'],
        });

        const started = (await a.startSupportConversationAction()) as any;
        expect(started.conversationId).toBeTruthy();

        const [convId, conv] = store.all(CONVS)[0];
        expect(conv.context).toBe('general_support');
        await a.sendMessageAction(convId, 'I cannot log in');

        //   Whoever they were routed to is a participant, and can read it.
        const recipient = (conv.participants as string[]).find((p) => p !== MEMBER)!;
        const recipientRoles = (store.get(COLLECTIONS.USERS, recipient) as any).roles;
        actAs(recipient, recipientRoles, 'x@example.com');

        expect(((await a.getMessagesAction(convId)) as any).messages.map((m: any) => m.text))
            .toContain('I cannot log in');
    });
});
