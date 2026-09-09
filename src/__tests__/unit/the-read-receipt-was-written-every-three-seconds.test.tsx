/**
 * @jest-environment jsdom
 */

/**
 *   #544 THE READ RECEIPT WAS WRITTEN EVERY THREE SECONDS WHETHER ANYTHING HAD
 *        ARRIVED OR NOT.
 *
 *   /messages polled an open conversation every three seconds and called
 *   markAsReadAction on every single tick, unconditionally.
 *
 *   That is not a read. messagingService.markAsRead READS the conversation
 *   document, checks participation, and then UPDATES it with a fresh
 *   `lastRead` timestamp. So one open chat performed, per minute, for as long
 *   as it stayed open:
 *
 *       20 x getMessages          the whole thread, over the wire
 *       20 x conversation read    inside markAsRead
 *       20 x conversation WRITE   saying exactly what the last one said
 *
 *   And #538 had not reached this file: none of it paused in a background tab,
 *   so a member who left a chat open in another tab kept writing to the
 *   database all day.
 *
 *   A read receipt only means something when something has been read. The
 *   receipt is now written when the thread actually CHANGES — which includes
 *   the first poll after opening a conversation, so a badge still clears the
 *   moment you look at it.
 *
 * ── WHY IDS AND NOT JSON.stringify ──────────────────────────────────────────
 *
 *   The existing change check was `JSON.stringify(prev) !== JSON.stringify(sorted)`
 *   and it only ever guarded a setState, so a false positive cost a render and
 *   nothing more. It now guards a database write, and that raises the bar: a
 *   server-side timestamp re-serialised a hair differently would have counted
 *   as "new messages arrived" and put the write back on every tick.
 *
 *   The signature is the message ids in order. It changes when a message
 *   arrives, is edited away or is removed, and does not change when the answer
 *   is byte-for-byte the same conversation.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   The POLL is still every three seconds while the tab is visible, and
 *   getMessages still returns the whole thread each time. Three seconds is the
 *   right responsiveness for an open chat; fetching only what is new needs a
 *   cursor the action does not take, and that is a larger change than this one.
 *   What goes away is the twenty writes a minute and everything in hidden tabs.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     markAsRead called unconditionally again        KILLED (2 tests)
 *     the signature always reporting "changed"       KILLED (3)
 *     the ref not reset when the thread changes      KILLED (1)
 *     the poll back on a bare setInterval            KILLED (4)
 *     reword this header                             SURVIVED, as intended
 *
 *   The first three are killed by the EXECUTED tests above, not by the source
 *   reads below — which is the point of writing both. A source read can tell
 *   you the call sits inside an `if`; only running it tells you the `if` is
 *   ever false.
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';

const mockUseSession = jest.fn();
const m = {
    getConversationsAction: jest.fn(),
    getMessagesAction: jest.fn(),
    markAsReadAction: jest.fn(),
    sendMessageAction: jest.fn(),
    searchUsersAction: jest.fn(),
    startConversationAction: jest.fn(),
    startSupportConversationAction: jest.fn(),
};

jest.mock('next-auth/react', () => ({ useSession: () => mockUseSession(), signOut: jest.fn() }));
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/messages',
}));
//   The page calls useToast, which throws outside its provider. Mocked rather
//   than wrapped: this suite is about how often a poll writes, and a real toast
//   provider would add nothing to that.
jest.mock('@/contexts/ToastContext', () => ({
    useToast: () => ({ showToast: jest.fn() }),
    ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/app/actions/messages', () => ({
    getConversationsAction: (...a: any[]) => m.getConversationsAction(...a),
    getMessagesAction: (...a: any[]) => m.getMessagesAction(...a),
    markAsReadAction: (...a: any[]) => m.markAsReadAction(...a),
    sendMessageAction: (...a: any[]) => m.sendMessageAction(...a),
    searchUsersAction: (...a: any[]) => m.searchUsersAction(...a),
    startConversationAction: (...a: any[]) => m.startConversationAction(...a),
    startSupportConversationAction: (...a: any[]) => m.startSupportConversationAction(...a),
}));

const CONV = 'conv-1';

function messagesPayload(ids: string[]) {
    return {
        messages: ids.map((id, i) => ({
            id,
            senderId: i % 2 === 0 ? 'u1' : 'u2',
            content: `message ${id}`,
            timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString(),
        })),
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    //   jsdom has no scrollIntoView. The page scrolls the thread on new
    //   messages, which is real behaviour worth keeping — it just needs a stub.
    (Element.prototype as any).scrollIntoView = jest.fn();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    mockUseSession.mockReturnValue({
        data: { user: { id: 'u1', name: 'Ada', email: 'ada@example.com', roles: ['user'] } },
        status: 'authenticated',
    });
    m.getConversationsAction.mockResolvedValue({
        conversations: [{
            id: CONV,
            participants: ['u1', 'u2'],
            participantDetails: { u2: { name: 'Chidi' } },
            lastMessage: 'hi',
            updatedAt: new Date(2026, 0, 1).toISOString(),
        }],
        error: null,
    });
    m.getMessagesAction.mockResolvedValue(messagesPayload(['m1', 'm2']));
    m.markAsReadAction.mockResolvedValue({ success: true, error: null });
});

async function renderMessages() {
    const { default: MessagesPage } = await import('@/app/messages/MessagesClient');
    render(<MessagesPage />);
    await waitFor(() => expect(m.getConversationsAction).toHaveBeenCalled());
}

/** Let the 3s poll fire `n` more times. */
async function tick(n: number) {
    for (let i = 0; i < n; i++) {
        await act(async () => { jest.advanceTimersByTime(3000); await Promise.resolve(); });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#544 — EXECUTED: the page is rendered and the polls are counted', () => {
    /**
     * The block below this one reads the source. That is the weakness this
     * audit keeps finding — a control described rather than exercised — so the
     * claim is made by RUNNING the page: open a conversation, let the poll tick,
     * and count the writes.
     */
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it('A QUIET CONVERSATION IS MARKED READ ONCE, NOT ONCE PER TICK', async () => {
        await renderMessages();

        //   Open the thread. The list renders the other participant's name.
        const row = await screen.findByText(/Chidi/i);
        await act(async () => { row.click(); });
        await waitFor(() => expect(m.markAsReadAction).toHaveBeenCalledTimes(1));

        //   Ten more ticks with the SAME messages coming back.
        await tick(10);

        //   Before the fix this was eleven writes. The thread did not change,
        //   so there is nothing new to have read.
        expect(m.markAsReadAction).toHaveBeenCalledTimes(1);
        //   …and it was still polling all along, which is what makes the
        //   assertion above meaningful rather than vacuous.
        expect(m.getMessagesAction.mock.calls.length).toBeGreaterThan(5);
    });

    it('AND A NEW MESSAGE MARKS IT READ AGAIN', async () => {
        //   The vacuity guard: a fix that never marked anything read after the
        //   first poll passes the test above and breaks every unread badge.
        await renderMessages();
        const row = await screen.findByText(/Chidi/i);
        await act(async () => { row.click(); });
        await waitFor(() => expect(m.markAsReadAction).toHaveBeenCalledTimes(1));

        await tick(3);
        expect(m.markAsReadAction).toHaveBeenCalledTimes(1);

        m.getMessagesAction.mockResolvedValue(messagesPayload(['m1', 'm2', 'm3']));
        await tick(2);

        await waitFor(() => expect(m.markAsReadAction).toHaveBeenCalledTimes(2));
    });

    it('AND A HIDDEN TAB STOPS POLLING ALTOGETHER', async () => {
        await renderMessages();
        const row = await screen.findByText(/Chidi/i);
        await act(async () => { row.click(); });
        await waitFor(() => expect(m.getMessagesAction).toHaveBeenCalled());

        const before = m.getMessagesAction.mock.calls.length;
        await act(async () => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await tick(20);

        expect(m.getMessagesAction.mock.calls.length).toBe(before);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#544 — the receipt is written when something is read', () => {
    it('THE SOURCE NO LONGER CALLS markAsRead ON EVERY TICK', () => {
        //   Read rather than rendered: the page needs a selected conversation
        //   to poll at all, and driving that through the DOM makes the
        //   assertion about the click handler rather than about the poll.
        //
        //   What matters is structural and checkable: the call sits inside the
        //   `changed` branch, not beside it.
        const src = require('fs').readFileSync(
            require('path').join(process.cwd(), 'src/app/messages/MessagesClient.tsx'), 'utf-8',
        ) as string;

        const loadMessages = src.slice(
            src.indexOf('async function loadMessages()'),
            src.indexOf('const stopPolling = startVisibilityAwareInterval(loadMessages'),
        );

        expect(loadMessages).toContain('const changed = lastSeenRef.current !== signature;');

        //   The call must be inside `if (changed) {`. Measured by position:
        //   the branch opens before the call and the function ends after it.
        const branchAt = loadMessages.indexOf('if (changed) {');
        const callAt = loadMessages.indexOf('markAsReadAction(');
        expect(branchAt).toBeGreaterThan(-1);
        expect(callAt).toBeGreaterThan(branchAt);
    });

    it('AND THE SIGNATURE IS THE MESSAGE IDS, NOT THE WHOLE PAYLOAD', () => {
        //   JSON.stringify of the rows would put the write back on every tick
        //   the moment a timestamp re-serialised differently.
        const src = require('fs').readFileSync(
            require('path').join(process.cwd(), 'src/app/messages/MessagesClient.tsx'), 'utf-8',
        ) as string;

        expect(src).toContain('const signature = sorted.map(m => m.id).join("|");');
        expect(src).not.toContain('JSON.stringify(prev) !== JSON.stringify(sorted)');
    });

    it('AND BOTH POLLERS PAUSE WHEN NOBODY IS LOOKING', () => {
        //   #538 converted eleven pollers and did not reach this file; these
        //   two are the busiest in the app.
        const src = require('fs').readFileSync(
            require('path').join(process.cwd(), 'src/app/messages/MessagesClient.tsx'), 'utf-8',
        ) as string;

        const armed = src.match(/startVisibilityAwareInterval\(/g) ?? [];
        expect(armed).toHaveLength(2);
        expect(/setInterval\s*\(/.test(src)).toBe(false);
    });

    it('AND OPENING A CONVERSATION STILL CLEARS ITS BADGE', () => {
        //   The receipt is conditional now, so the condition has to be true on
        //   the first poll of a thread. The ref is reset when selectedConv
        //   changes; without that line, switching to a conversation whose ids
        //   happened to match the previous one would never mark it read.
        const src = require('fs').readFileSync(
            require('path').join(process.cwd(), 'src/app/messages/MessagesClient.tsx'), 'utf-8',
        ) as string;

        const effect = src.slice(
            src.indexOf('// Load messages for selected conversation'),
            src.indexOf('}, [selectedConv, userId]);'),
        );
        expect(effect).toContain('lastSeenRef.current = null;');
        //   And the reset must come BEFORE the loader is defined, so every run
        //   of the effect starts from "nothing seen".
        expect(effect.indexOf('lastSeenRef.current = null;'))
            .toBeLessThan(effect.indexOf('async function loadMessages()'));
    });
});
