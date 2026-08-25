/**
 * @jest-environment node
 */

/**
 * src/app/actions/chatbot-admin.ts was at 0% — every one of its four actions,
 * and the admin panel they feed, had never been executed by a test.
 *
 * Three defects, all in the same shape the audit keeps finding: a write that
 * reports success without having written anything.
 *
 *   #246 A FAILED SESSION CREATE ORPHANED EVERY MESSAGE IN THAT CONVERSATION.
 *   #247 RESOLVING A SESSION THAT DOES NOT EXIST REPORTED SUCCESS.
 *   #248 THE ASSISTANT'S REPLY COULD SORT ABOVE THE QUESTION IT ANSWERED.
 *
 * Each is described at its own describe() below.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

const mockLogAdminAction = jest.fn(async () => ({})) as jest.Mock<any>;
jest.mock('@/lib/audit-log', () => ({
    logAdminAction: (...a: any[]) => mockLogAdminAction(...a),
    createAdminAuditLog: jest.fn(async () => ({})),
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

let store: FakeDbHandle;
const SESSIONS = COLLECTIONS.CHATBOT_SESSIONS;
const MESSAGES = COLLECTIONS.CHATBOT_MESSAGES;

const admin = async () => await import('@/app/actions/chatbot-admin');
const chatdb = async () => await import('@/lib/chatbot-db');

const asRoles = (roles: string[]) => mockRequireSession.mockResolvedValue({
    session: { user: { id: 'admin-1', email: 'a@e.com', roles } },
    error: null,
});

/** A session document as createChatbotSession writes one. */
const session = (id: string, over: Record<string, unknown> = {}) => ({
    id, userId: 'u-1', userEmail: 'u@e.com', module: 'hub',
    startedAt: new Date('2026-08-01T09:00:00Z'),
    lastMessageAt: new Date('2026-08-01T09:05:00Z'),
    messageCount: 2, escalated: false, resolved: false,
    resolvedBy: null, resolvedAt: null, tags: [],
    ...over,
});

beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    store = installFakeDb();
    asRoles(['super_admin']);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the four actions are super_admin only', () => {
    // Chat transcripts are the most sensitive free text on the platform: users
    // type account numbers, complaints and personal circumstances into them.
    const call = async (name: string) => {
        const a = await admin() as any;
        return name === 'sessions' ? a.getChatSessionsAction({})
            : name === 'thread' ? a.getChatThreadAction('s-1')
            : name === 'resolve' ? a.resolveSessionAction('s-1')
            : a.getChatbotStatsAction();
    };

    it.each(['sessions', 'thread', 'resolve', 'stats'])(
        '%s refuses an ordinary admin', async (name) => {
            asRoles(['admin', 'marketplace_admin']);
            store.seed(SESSIONS, 's-1', session('s-1'));

            expect((await call(name)).error).toMatch(/super_admin/i);
        });

    it.each(['sessions', 'thread', 'resolve', 'stats'])(
        '%s refuses an unauthenticated caller', async (name) => {
            mockRequireSession.mockResolvedValue({ session: null, error: { error: 'expired' } });
            expect((await call(name)).error).toMatch(/authenticated/i);
        });

    it('a refused resolve writes nothing and records nothing', async () => {
        asRoles(['admin']);
        store.seed(SESSIONS, 's-1', session('s-1'));

        await (await admin()).resolveSessionAction('s-1');

        expect(store.get(SESSIONS, 's-1')?.resolved).toBe(false);
        expect(mockLogAdminAction).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#247 — resolving a session that does not exist', () => {
    /**
     *   #247 RESOLVING A SESSION THAT DOES NOT EXIST REPORTED SUCCESS.
     *
     *        resolveSession called `.update()` on the session document, and an
     *        update against a missing row is a documented SILENT NO-OP in this
     *        adapter (supabase-db.ts) — zero rows matched, no error raised. So
     *        resolveSessionAction returned { success: true } for any id at all,
     *        the admin page showed the resolve as having worked, and
     *        logAdminAction wrote "Admin resolved chatbot session <id>" into the
     *        permanent audit record for a session nobody ever resolved.
     *
     *        The realistic way in is not a typo: it is an escalated session the
     *        90-day GDPR purge has already deleted, still open in a stale admin
     *        tab. The admin clicks Resolve, sees success, and the escalation is
     *        neither resolved nor still visible as needing attention.
     */
    it('IS REFUSED, NOT REPORTED AS SUCCESS', async () => {
        const res = await (await admin()).resolveSessionAction('no-such-session') as any;

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/not found|does not exist/i);
    });

    it('AND WRITES NO AUDIT ROW CLAIMING IT WAS RESOLVED', async () => {
        await (await admin()).resolveSessionAction('no-such-session');
        expect(mockLogAdminAction).not.toHaveBeenCalled();
    });

    it('still resolves a session that does exist, and records who did it', async () => {
        store.seed(SESSIONS, 's-1', session('s-1', { escalated: true }));

        const res = await (await admin()).resolveSessionAction('s-1') as any;
        expect(res.success).toBe(true);

        const row = store.get(SESSIONS, 's-1')!;
        expect(row.resolved).toBe(true);
        expect(row.resolvedBy).toBe('admin-1');
        expect(row.resolvedAt).toBeTruthy();

        expect(mockLogAdminAction).toHaveBeenCalledWith(
            'chatbot_session_resolved', 'admin-1', 's-1', 'chatbot_session', expect.any(String));
    });

    it('refuses an empty session id before touching anything', async () => {
        const res = await (await admin()).resolveSessionAction('') as any;
        expect(res.success).toBe(false);
        expect(mockLogAdminAction).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#246 — a message whose session document is missing', () => {
    /**
     *   #246 A FAILED SESSION CREATE ORPHANED EVERY MESSAGE IN THAT CONVERSATION.
     *
     *        createChatbotSession swallows its own failure by design — "a
     *        database failure NEVER surfaces an error to the user's chat
     *        experience", per the file header. Reasonable. But saveMessageAsync
     *        then wrote the messages and called `sessionRef.update(...)`, and an
     *        update against a missing row is a SILENT NO-OP here. So one
     *        transient error at session-create time produced a conversation
     *        that:
     *
     *          - never appears in the admin panel, which lists SESSIONS;
     *          - never counts as escalated, however plainly the user asked for a
     *            human, because `escalated: true` went to the missing row;
     *          - is never deleted by the 90-day GDPR purge, which selects
     *            sessions by lastMessageAt and deletes their messages. No
     *            session row means nothing ever looks for those messages again:
     *            unreachable, undeletable, retained past the retention period.
     *
     *        That last one is #191 exactly — the purge orphaning the messages it
     *        was meant to delete — arriving by a different road.
     *
     *        The session row is reconstituted with set(merge) now, so a message
     *        can always be found from the session it belongs to. The purge also
     *        sweeps messages on their OWN timestamp, so an orphan from before
     *        this fix is reachable rather than immortal.
     */
    const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

    it('RECREATES THE SESSION ROW SO THE CONVERSATION IS NOT LOST', async () => {
        const { saveMessageAsync } = await chatdb();

        // No createChatbotSession — this is the state after it failed.
        saveMessageAsync('m-1', 's-orphan', 'u-1', 'user', 'my money is gone', 'hub', false);
        await flush();

        expect(store.get(MESSAGES, 'm-1')).toBeTruthy();
        // Was: undefined — the message existed and its session did not.
        const row = store.get(SESSIONS, 's-orphan');
        expect(row).toBeTruthy();
        expect(row!.userId).toBe('u-1');
        expect(row!.module).toBe('hub');
        expect(row!.messageCount).toBe(1);
    });

    it('AND THE ESCALATION FLAG SURVIVES, SO THE ADMIN PANEL SEES IT', async () => {
        const { saveMessageAsync } = await chatdb();
        saveMessageAsync('m-1', 's-orphan', 'u-1', 'user', 'I need to speak to a human', 'hub', true);
        await flush();

        expect(store.get(SESSIONS, 's-orphan')?.escalated).toBe(true);
    });

    it('and the reconstituted session is listed for an admin, not invisible', async () => {
        const { saveMessageAsync } = await chatdb();
        saveMessageAsync('m-1', 's-orphan', 'u-1', 'user', 'contact support please', 'hub', true);
        await flush();

        const res = await (await admin()).getChatSessionsAction({ escalatedOnly: true });
        expect(res.sessions.map(s => s.id)).toContain('s-orphan');
    });

    it('an ordinary message still increments the existing session, not replaces it', async () => {
        store.seed(SESSIONS, 's-1', session('s-1', { messageCount: 2, tags: ['payment'] }));
        const { saveMessageAsync } = await chatdb();

        saveMessageAsync('m-9', 's-1', 'u-1', 'user', 'how do I register?', 'hub', false);
        await flush();

        const row = store.get(SESSIONS, 's-1')!;
        expect(row.messageCount).toBe(3);
        expect(row.userEmail).toBe('u@e.com');           // not wiped
        expect(row.tags).toEqual(expect.arrayContaining(['payment', 'registration']));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#246 — the purge can reach an orphaned message', () => {
    it('DELETES A MESSAGE OLDER THAN THE CUTOFF EVEN WITH NO SESSION ROW', async () => {
        const old = new Date('2020-01-01T00:00:00Z');
        store.seed(MESSAGES, 'm-old', {
            id: 'm-old', sessionId: 's-gone', userId: 'u-1', role: 'user',
            content: 'personal details', module: 'hub', timestamp: old, isEscalation: false,
        });

        const { purgeChatbotDataOlderThan } = await chatdb();
        await purgeChatbotDataOlderThan(90);

        // Was: retained forever — nothing selects a message whose session is gone.
        expect(store.get(MESSAGES, 'm-old')).toBeUndefined();
    });

    it('and leaves a recent orphan alone', async () => {
        store.seed(MESSAGES, 'm-new', {
            id: 'm-new', sessionId: 's-gone', userId: 'u-1', role: 'user',
            content: 'hello', module: 'hub', timestamp: new Date(), isEscalation: false,
        });

        const { purgeChatbotDataOlderThan } = await chatdb();
        await purgeChatbotDataOlderThan(90);

        expect(store.get(MESSAGES, 'm-new')).toBeTruthy();
    });

    it('still deletes an old session together with its messages', async () => {
        const old = new Date('2020-01-01T00:00:00Z');
        store.seed(SESSIONS, 's-old', session('s-old', { lastMessageAt: old }));
        store.seed(MESSAGES, 'm-a', { id: 'm-a', sessionId: 's-old', timestamp: old, role: 'user', content: 'x' });

        const { purgeChatbotDataOlderThan } = await chatdb();
        const count = await purgeChatbotDataOlderThan(90);

        expect(count).toBe(1);
        expect(store.get(SESSIONS, 's-old')).toBeUndefined();
        expect(store.get(MESSAGES, 'm-a')).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#248 — the order of a turn in the transcript', () => {
    /**
     *   #248 THE ASSISTANT'S REPLY COULD SORT ABOVE THE QUESTION IT ANSWERED.
     *
     *        Both messages of a turn are written by two fire-and-forget calls
     *        made one line apart, and each stamps its own Timestamp.now().
     *        Timestamp.now() has MILLISECOND precision (firestore-compat), and
     *        the second closure runs synchronously as soon as the first awaits —
     *        microseconds later. The two rows therefore carry the SAME
     *        timestamp, essentially always.
     *
     *        getChatThread orders by `timestamp` alone, so the tie is broken by
     *        whatever the database feels like returning. An admin reading an
     *        escalated complaint can be shown the answer above the question.
     *        getRecentSessionTurns has the same order, and that one is replayed
     *        to the model as conversation history.
     *
     *        The ids already encode the intended order (`_u_<ms>`, `_a_<ms+1>`),
     *        so the information existed; nothing used it. The route now passes
     *        each message its own timestamp, which is the value those ids were
     *        derived from anyway.
     */
    const at = (ms: number) => new Date(ms);
    const BASE = Date.UTC(2026, 7, 1, 9, 0, 0);

    it('THE QUESTION COMES BEFORE THE ANSWER, NOT WHICHEVER THE DB RETURNS FIRST', async () => {
        // The shape every conversation stored before this fix: ONE timestamp
        // for both halves of the turn. Seeded assistant-first, because that is
        // the order a tie in `timestamp` can legitimately return — and the
        // order this adapter's id fallback gives, "s1_a_" sorting before
        // "s1_u_". Rows already in the database still look like this, so the
        // reader has to be right about them and not only about new writes.
        store.seed(MESSAGES, `s1_a_${BASE + 1}`, {
            id: `s1_a_${BASE + 1}`, sessionId: 's1', role: 'assistant',
            content: 'You can register at /signup.', timestamp: at(BASE), isEscalation: false,
        });
        store.seed(MESSAGES, `s1_u_${BASE}`, {
            id: `s1_u_${BASE}`, sessionId: 's1', role: 'user',
            content: 'How do I register?', timestamp: at(BASE), isEscalation: false,
        });

        const { messages } = await (await chatdb()).getChatThread('s1');
        expect(messages.map(m => m.role)).toEqual(['user', 'assistant']);
    });

    it('and the two messages of one turn no longer share a timestamp', async () => {
        const { saveMessageAsync } = await chatdb();
        saveMessageAsync(`s2_u_${BASE}`, 's2', 'u-1', 'user', 'q', 'hub', false, BASE);
        saveMessageAsync(`s2_a_${BASE + 1}`, 's2', 'u-1', 'assistant', 'a', 'hub', false, BASE + 1);
        for (let i = 0; i < 5; i++) await Promise.resolve();

        const u = store.get(MESSAGES, `s2_u_${BASE}`)!;
        const a = store.get(MESSAGES, `s2_a_${BASE + 1}`)!;
        const ms = (t: any) => (t?.toDate ? t.toDate() : new Date(t)).getTime();
        expect(ms(a.timestamp)).toBeGreaterThan(ms(u.timestamp));
    });

    it('the context replayed to the model is in the order it was said', async () => {
        store.seed(MESSAGES, `s3_a_${BASE + 1}`, {
            id: `s3_a_${BASE + 1}`, sessionId: 's3', role: 'assistant',
            content: 'ANSWER', timestamp: at(BASE),
        });
        store.seed(MESSAGES, `s3_u_${BASE}`, {
            id: `s3_u_${BASE}`, sessionId: 's3', role: 'user',
            content: 'QUESTION', timestamp: at(BASE),
        });

        const turns = await (await chatdb()).getRecentSessionTurns('s3', 10);
        expect(turns.map(t => t.content)).toEqual(['QUESTION', 'ANSWER']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the admin list and stats, executed', () => {
    it('lists sessions newest first and reports hasMore honestly', async () => {
        for (let i = 0; i < 5; i++) {
            store.seed(SESSIONS, `s-${i}`, session(`s-${i}`, {
                lastMessageAt: new Date(Date.UTC(2026, 7, 1 + i)),
            }));
        }

        const res = await (await admin()).getChatSessionsAction({ limit: 3 });
        expect(res.sessions.map(s => s.id)).toEqual(['s-4', 's-3', 's-2']);
        expect(res.hasMore).toBe(true);

        const all = await (await admin()).getChatSessionsAction({ limit: 25 });
        expect(all.hasMore).toBe(false);
    });

    it('filters on module, escalated and unresolved', async () => {
        store.seed(SESSIONS, 'a', session('a', { module: 'marketplace', escalated: true, resolved: false }));
        store.seed(SESSIONS, 'b', session('b', { module: 'marketplace', escalated: false, resolved: true }));
        store.seed(SESSIONS, 'c', session('c', { module: 'academy', escalated: true, resolved: true }));

        const acts = await admin();
        expect((await acts.getChatSessionsAction({ module: 'marketplace' as any })).sessions.map(s => s.id))
            .toEqual(expect.arrayContaining(['a', 'b']));
        expect((await acts.getChatSessionsAction({ escalatedOnly: true })).sessions.map(s => s.id).sort())
            .toEqual(['a', 'c']);
        expect((await acts.getChatSessionsAction({ unresolvedOnly: true })).sessions.map(s => s.id))
            .toEqual(['a']);
    });

    it('counts every session, not one capped page', async () => {
        for (let i = 0; i < 120; i++) {
            store.seed(SESSIONS, `s-${i}`, session(`s-${i}`, { module: i < 70 ? 'hub' : 'academy' }));
        }

        const stats = await (await admin()).getChatbotStatsAction();
        expect(stats.totalSessions).toBe(120);          // was: exactly 100, forever
        expect(stats.mostActiveModule).toBe('hub');
    });

    it('reports no most-active module when there are no sessions at all', async () => {
        const stats = await (await admin()).getChatbotStatsAction();
        expect(stats.totalSessions).toBe(0);
        expect(stats.mostActiveModule).toBeNull();
    });

    it('returns the thread and its session for one id', async () => {
        store.seed(SESSIONS, 's-1', session('s-1'));
        store.seed(MESSAGES, 'm-1', {
            id: 'm-1', sessionId: 's-1', role: 'user', content: 'hi',
            timestamp: new Date(Date.UTC(2026, 7, 1)), isEscalation: false,
        });
        store.seed(MESSAGES, 'm-other', {
            id: 'm-other', sessionId: 's-2', role: 'user', content: 'not mine',
            timestamp: new Date(Date.UTC(2026, 7, 1)),
        });

        const res = await (await admin()).getChatThreadAction('s-1');
        expect(res.session?.userEmail).toBe('u@e.com');
        expect(res.messages.map(m => m.content)).toEqual(['hi']);
    });

    it('refuses an empty session id for the thread', async () => {
        const res = await (await admin()).getChatThreadAction('');
        expect(res.error).toMatch(/sessionId required/i);
        expect(res.session).toBeNull();
    });
});
