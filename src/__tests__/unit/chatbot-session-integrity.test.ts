/**
 * @jest-environment node
 */

/**
 * The chat endpoint took the conversation, and whose conversation it was, from
 * the caller.
 *
 * /api/ai is otherwise one of the better-built routes in the codebase: a
 * per-user Redis rate limit of 15 messages an hour, a feature toggle, a module
 * allow-list, a session guard, and a rules-based fallback when OpenAI is
 * unavailable. Three things were taken on trust.
 *
 * 1. THE SESSION ID
 * -----------------
 *     const sessionId: string = clientSessionId || randomUUID();
 *     const isNewSession = !clientSessionId;
 *
 * Messages are written with the caller's userId and the SUPPLIED sessionId, and
 * getChatThread — what an admin reads — selects on sessionId alone:
 *
 *     .where("sessionId", "==", sessionId).orderBy("timestamp", "asc")
 *
 * So posting with somebody else's session id put your messages into their
 * transcript. saveMessageAsync also increments that session's messageCount,
 * sets `escalated` when detectEscalation fires on YOUR text, and arrayUnions
 * inferred tags onto their session document.
 *
 * Session ids are randomUUID, so this needed an id to be known rather than
 * guessed — which lowers the odds and does not make the check optional. Ids are
 * handed to the client, and verifying one costs a single read.
 *
 * A second consequence: an id with no session behind it skipped
 * createChatbotSession entirely, because isNewSession was false whenever
 * anything was supplied. The messages were written and the session document
 * they counted against did not exist.
 *
 * 2. THE CONVERSATION HISTORY
 * ---------------------------
 *     for (const msg of history.slice(-6)) {
 *         if (msg.role === "user" || msg.role === "assistant") {
 *             conversationMessages.push({ role: msg.role, content: String(msg.content) });
 *         }
 *     }
 *
 * `history` is request body. Entries with role "assistant" were passed straight
 * into the model context, so the caller wrote what the assistant had previously
 * said — prompt injection requiring no cleverness. A support bot can be told it
 * already agreed to something and asked to confirm it, and the reply is stored
 * and read by staff.
 *
 * Context is read back from storage now. That is the only version of it the
 * caller cannot author.
 *
 * 3. THE SIZE OF ANY OF IT
 * ------------------------
 * No bound on the message or on a history entry. The rate limit caps requests
 * at 15 an hour and says nothing about their size, so one caller could write
 * fifteen arbitrarily large documents an hour into CHATBOT_MESSAGES and send
 * the same upstream to OpenAI. max_tokens: 300 bounds the reply, not the
 * prompt.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function codeOnly(src: string): string {
    return src
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

const route = source('src/app/api/ai/route.ts');
const db = source('src/lib/chatbot-db.ts');

describe('a session id has to be one of yours', () => {
    it('the owner is checked before anything is written', () => {
        // THE test.
        const code = codeOnly(route);

        expect(code).toContain('getSessionOwner(String(clientSessionId))');
        expect(code).toContain('owner !== userId');
        expect(code).not.toContain('const sessionId: string = clientSessionId || randomUUID();');
    });

    it('the check precedes the session write and the message write', () => {
        // Ordering: an owner verified after the transcript is appended to has
        // verified nothing.
        const ownerAt = route.indexOf('getSessionOwner(');
        const createAt = route.indexOf('createChatbotSession(');
        const saveAt = route.indexOf('saveMessageAsync(');

        expect(ownerAt).toBeGreaterThan(-1);
        expect(createAt).toBeGreaterThan(ownerAt);
        expect(saveAt).toBeGreaterThan(ownerAt);
    });

    it('an unknown id starts a session rather than orphaning messages', () => {
        // isNewSession was `!clientSessionId`, so any supplied id skipped
        // createChatbotSession — messages counted against a document that was
        // never created.
        expect(route).toContain('isNewSession = owner === null');
    });

    it('a caller with no session id still gets one', () => {
        // Vacuity guard: refusing every request without a stored session would
        // make the assistant unreachable for a first-time user.
        expect(route).toContain('sessionId = randomUUID()');
    });

    it('the reader an admin uses still selects on sessionId alone', () => {
        // Which is why the write side has to be right — recorded so that the
        // reason for the check above stays visible next to it.
        expect(db).toContain('.where("sessionId", "==", sessionId)');
    });
});

describe('the assistant\'s prior turns are not written by the caller', () => {
    it('history is read from storage', () => {
        expect(route).toContain('getRecentSessionTurns(sessionId, MAX_HISTORY_TURNS)');
    });

    it('nothing from the request body reaches the model context', () => {
        const code = codeOnly(route);

        expect(code).not.toContain('history.slice(-6)');
        expect(code).not.toContain('msg.role === "assistant"');
        // The body is not even destructured for it any more.
        expect(code).not.toContain('module: rawModule, history,');
    });

    it('the stored turns keep both roles, so context is still context', () => {
        // Vacuity guard: dropping assistant turns entirely would make every
        // reply amnesiac and quietly ruin the feature.
        expect(db).toContain('m.role === "user" || m.role === "assistant"');
    });

    it('turns come back oldest-first', () => {
        // Queried newest-first to get the LAST n, then reversed. Handing the
        // model a reversed conversation is a subtle way to make it useless.
        const fn = db.slice(db.indexOf('export async function getRecentSessionTurns'));

        expect(fn.slice(0, 900)).toContain('.orderBy("timestamp", "desc")');
        expect(fn.slice(0, 900)).toContain('.reverse()');
    });

    it('the current message is still sent', () => {
        expect(route).toContain('conversationMessages.push({ role: "user", content: message })');
    });
});

describe('none of it is unbounded', () => {
    it('a long message is refused', () => {
        expect(route).toContain('message.length > MAX_MESSAGE_CHARS');
        expect(route).toContain('const MAX_MESSAGE_CHARS = 2000');
    });

    it('the refusal happens before the message is stored or sent upstream', () => {
        const limitAt = route.indexOf('message.length > MAX_MESSAGE_CHARS');
        const openAiAt = route.indexOf('api.openai.com');
        const saveAt = route.indexOf('saveMessageAsync(');

        expect(limitAt).toBeGreaterThan(-1);
        expect(openAiAt).toBeGreaterThan(limitAt);
        expect(saveAt).toBeGreaterThan(limitAt);
    });

    it('a recalled turn is truncated too', () => {
        // Stored rows predate the cap, so the bound has to be applied on the
        // way out as well as on the way in.
        expect(route).toContain('turn.content.slice(0, MAX_HISTORY_CHARS)');
    });

    it('the number of recalled turns is bounded', () => {
        expect(route).toContain('const MAX_HISTORY_TURNS = 6');
    });

    it('an ordinary message is not refused', () => {
        // Vacuity guard: a limit of zero satisfies every assertion above.
        const cap = Number(route.match(/const MAX_MESSAGE_CHARS = (\d+)/)?.[1]);

        expect(cap).toBeGreaterThan(500);
    });
});

describe('what was already right', () => {
    it('per-user rate limiting, keyed on the account', () => {
        expect(route).toContain('chatbotRateLimiter.limit(userId)');
        expect(route).toContain('Ratelimit.slidingWindow(15, "1 h")');
    });

    it('the module is checked against a list', () => {
        expect(route).toContain('VALID_MODULES.includes(rawModule) ? rawModule : "hub"');
    });

    it('a session is required', () => {
        const guardAt = route.indexOf('if (!session?.user?.id)');
        const bodyAt = route.indexOf('await req.json()');

        expect(guardAt).toBeGreaterThan(-1);
        expect(bodyAt).toBeGreaterThan(guardAt);
    });

    it('the feature toggle defaults open on a database failure', () => {
        // Deliberate, and stated as such in the route. Pinned because it is the
        // opposite of the fail-closed rule elsewhere and should stay a decision
        // rather than drift into one.
        expect(route).toContain('return true; // Default open on DB failure');
    });
});
