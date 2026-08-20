/**
 * @jest-environment node
 */

/**
 * lib/chatbot-db.ts, EXECUTED. It was at 3.2%.
 *
 *   #191 THE GDPR PURGE ORPHANED THE MESSAGES IT WAS MEANT TO DELETE.
 *
 *        api/cron/gdpr-purge calls purgeChatbotDataOlderThan(90). It deleted up
 *        to 400 expired sessions and, per session, up to 400 messages:
 *
 *            .where("sessionId", "==", sessionId).limit(400)
 *
 *        A session with more than 400 messages lost its session row and KEPT the
 *        remainder — the user's own words, retained past the retention period.
 *        Permanently, too: the next run selects sessions by `lastMessageAt`, the
 *        session row is gone, so nothing ever looks for those messages again.
 *        Unreachable, undeletable, uncounted.
 *
 *        The batch was unbounded as well — 400 sessions times 400 messages is
 *        160,000 deletes in one commit, all-or-nothing, so a failure purged
 *        nothing. Same defect as #177 in purgeOldAuditLogs.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));

let store: FakeDbHandle;
const SESSIONS = COLLECTIONS.CHATBOT_SESSIONS;
const MESSAGES = COLLECTIONS.CHATBOT_MESSAGES;

const chatbot = async () => await import('@/lib/chatbot-db');

const daysAgo = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString();
};

const seedSession = (id: string, lastMessageDaysAgo: number, messages: number) => {
    store.seed(SESSIONS, id, {
        id, userId: `u-${id}`, userEmail: `${id}@e.com`, module: 'hub',
        startedAt: daysAgo(lastMessageDaysAgo + 1),
        lastMessageAt: daysAgo(lastMessageDaysAgo),
        messageCount: messages, escalated: false, resolved: false, tags: [],
    });
    for (let i = 0; i < messages; i++) {
        store.seed(MESSAGES, `${id}-m${i}`, {
            id: `${id}-m${i}`, sessionId: id, userId: `u-${id}`,
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `message ${i}`, module: 'hub',
            timestamp: daysAgo(lastMessageDaysAgo), isEscalation: false,
        });
    }
};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#191 — the purge leaves nothing behind', () => {
    it('deletes an expired session and all of its messages', async () => {
        seedSession('old', 120, 5);

        const deleted = await (await chatbot()).purgeChatbotDataOlderThan(90);

        expect(deleted).toBe(1);
        expect(store.size(SESSIONS)).toBe(0);
        expect(store.size(MESSAGES)).toBe(0);
    });

    it('DELETES EVERY MESSAGE OF A SESSION WITH MORE THAN 400', async () => {
        // The exact case that survived: 450 messages, a 400-row page limit.
        seedSession('chatty', 120, 450);

        const deleted = await (await chatbot()).purgeChatbotDataOlderThan(90);

        expect(deleted).toBe(1);
        expect(store.size(SESSIONS)).toBe(0);
        // Was 50 orphans, unreachable for ever after.
        expect(store.size(MESSAGES)).toBe(0);
    });

    it('leaves sessions inside the retention window alone', async () => {
        seedSession('recent', 10, 3);
        seedSession('old', 120, 3);

        const deleted = await (await chatbot()).purgeChatbotDataOlderThan(90);

        expect(deleted).toBe(1);
        expect(store.get(SESSIONS, 'recent')).toBeDefined();
        expect(store.size(MESSAGES)).toBe(3);
    });

    it('does not touch another session\'s messages', async () => {
        seedSession('old', 120, 2);
        seedSession('keep', 5, 2);

        await (await chatbot()).purgeChatbotDataOlderThan(90);

        const remaining = store.all(MESSAGES).map(([id]) => id).sort();
        expect(remaining).toEqual(['keep-m0', 'keep-m1']);
    });

    it('COMMITS IN CHUNKS rather than one all-or-nothing batch', async () => {
        seedSession('chatty', 120, 900);

        const { supabaseDb } = await import('@/lib/supabase-db');
        const commits = jest.fn();
        const realBatch = supabaseDb.batch.bind(supabaseDb);
        const spy = jest.spyOn(supabaseDb, 'batch').mockImplementation((() => {
            const b: any = realBatch();
            const realCommit = b.commit.bind(b);
            b.commit = async () => { commits(); return realCommit(); };
            return b;
        }) as never);

        await (await chatbot()).purgeChatbotDataOlderThan(90);
        spy.mockRestore();

        expect(store.size(MESSAGES)).toBe(0);
        expect(commits.mock.calls.length).toBeGreaterThan(1);
    });

    it('returns zero rather than failing when nothing has expired', async () => {
        seedSession('recent', 1, 2);
        expect(await (await chatbot()).purgeChatbotDataOlderThan(90)).toBe(0);
        expect(store.size(SESSIONS)).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('sessions and messages, executed', () => {
    it('creates a session with the counters a new conversation starts from', async () => {
        await (await chatbot()).createChatbotSession('s1', 'u1', 'u1@e.com', 'hub' as never);

        expect(store.get(SESSIONS, 's1')).toMatchObject({
            id: 's1', userId: 'u1', userEmail: 'u1@e.com', module: 'hub',
            messageCount: 0, escalated: false, resolved: false,
        });
    });

    it('records who resolved a session and when', async () => {
        store.seed(SESSIONS, 's1', { id: 's1', resolved: false });

        expect(await (await chatbot()).resolveSession('s1', 'admin-9'))
            .toMatchObject({ success: true });
        expect(store.get(SESSIONS, 's1')).toMatchObject({
            resolved: true, resolvedBy: 'admin-9',
        });
    });

    it('reports the session owner, and null for one that does not exist', async () => {
        store.seed(SESSIONS, 's1', { id: 's1', userId: 'u1' });
        const { getSessionOwner } = await chatbot();

        expect(await getSessionOwner('s1')).toBe('u1');
        expect(await getSessionOwner('nope')).toBeNull();
    });

    it('returns a thread in order, with its session', async () => {
        seedSession('s1', 1, 3);

        const { messages, session } = await (await chatbot()).getChatThread('s1');

        expect(session?.id).toBe('s1');
        expect(messages.map(m => m.content)).toEqual(['message 0', 'message 1', 'message 2']);
    });

    it('returns an empty thread rather than failing for an unknown session', async () => {
        const { messages, session } = await (await chatbot()).getChatThread('nope');
        expect(messages).toEqual([]);
        expect(session).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('escalation detection and tagging', () => {
    it.each([
        'I want to speak to a human',
        'This is a COMPLAINT',
        'i need help now',
    ])('flags %p as an escalation', async (msg) => {
        expect((await chatbot()).detectEscalation(msg)).toBe(true);
    });

    it('does not flag an ordinary question', async () => {
        const { detectEscalation } = await chatbot();
        expect(detectEscalation('How do I reset my password?')).toBe(false);
        expect(detectEscalation('')).toBe(false);
    });

    it.each([
        ['my payment was deducted twice', 'payment'],
        ['how do I verify my BVN', 'verification'],
        ['I want to join the cooperative', 'cooperative'],
        ['tell me about the academy course', 'academy'],
        ['I own farm land', 'farm_nation'],
        ['the WAVE programme for women', 'wave'],
    ])('tags %p as %s', async (msg, tag) => {
        expect((await chatbot()).inferTags(msg)).toContain(tag);
    });

    it('returns no tags for a message about nothing in particular', async () => {
        expect((await chatbot()).inferTags('hello there')).toEqual([]);
    });

    it('can return more than one tag', async () => {
        const tags = (await chatbot()).inferTags('my payment for the academy course failed');
        expect(tags).toEqual(expect.arrayContaining(['payment', 'academy']));
    });
});
