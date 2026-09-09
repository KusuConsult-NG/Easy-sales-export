/**
 * @jest-environment jsdom
 */

/**
 *   #560 WHERE A SEED GOES DECIDES WHETHER THE POLLER'S FIRST TICK IS FREE OR
 *        WASTED — AND #558 GOT ONE HALF OF THAT RULE.
 *
 *   #558 seeded /dashboard/notifications and had to pass `immediate: false` to
 *   startVisibilityAwareInterval, because otherwise the browser re-asked the
 *   server, 0ms after hydrating, for exactly what it had just been sent.
 *
 *   Batch 14 seeds two more polled screens — the escrow chat and the messages
 *   list — and doing the same thing to them would have been a DEFECT. The
 *   difference is where the seed goes:
 *
 *     SEED IN useState (notifications).  The poller's `load` fetches
 *     unconditionally, so the first tick is a wasted round trip and must be
 *     suppressed. State already holds the answer, so nothing is lost.
 *
 *     SEED IN THE LOADER (escrow chat, messages).  The first tick is what
 *     CONSUMES the seed. It costs no round trip at all — and suppressing it
 *     would leave a seeded screen sitting on a spinner for a full interval,
 *     five seconds in the chat and eight in the list, having made the screen
 *     slower in the name of making it faster.
 *
 *   I wrote `immediate: !hasSeed` into the escrow chat first, by analogy, and
 *   it was wrong. The tests below are what the rule looks like when it is
 *   checked rather than remembered.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   Neither screen polls less often than it did, and neither shows staler data.
 *   The cadence is unchanged; only the first read moves from the browser to the
 *   server. And every seed is optional: a failed server read seeds null and the
 *   client polls exactly as before, which is the other half of what is checked
 *   here.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the chat's first tick suppressed (`immediate: false`)     KILLED (1 test)
 *     the message list's first tick suppressed                  KILLED (1)
 *     the chat's message seed ignored                           KILLED (2)
 *     the chat's escrow seed ignored                            KILLED (1)
 *     the conversation seed ignored                             KILLED (1)
 *     the payment gate's seed ignored                           KILLED (1)
 *     #561's crash fix reverted                                 KILLED (1)
 *     reword this header                                        SURVIVED, as intended
 *
 * ── AND THE INSTRUMENT WAS WRONG THREE TIMES BEFORE IT WAS RIGHT ────────────
 *
 *   Every one of these read as "the seed does not work" and was a fault in the
 *   test, not the code. Recorded rather than tidied away, because the next
 *   person writing a render test for a seeded screen will hit all three:
 *
 *     the useSession mock returned a NEW OBJECT on every call, so the chat's
 *     authorisation effect re-ran, the take-once seed was spent by the first
 *     run and the second called the real action;
 *
 *     findByText with FAKE TIMERS advances the clock — past five seconds — so
 *     the poll the test exists to prove unnecessary fired before the assertion
 *     below it ran;
 *
 *     the message fixture used `content` and `createdAt` where the screen reads
 *     `message` and `timestamp`. That one was not only a fault: it is what
 *     uncovered #561 below.
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';

const showToast = jest.fn();
const push = jest.fn();
const replace = jest.fn();
const router = { push, replace, refresh: jest.fn() };

const e = {
    getEscrowTransactionByIdAction: jest.fn(),
    getEscrowMessagesAction: jest.fn(),
    sendEscrowMessageAction: jest.fn(),
};
const msg = {
    getConversationsAction: jest.fn(),
    getMessagesAction: jest.fn(),
    markAsReadAction: jest.fn(),
    sendMessageAction: jest.fn(),
    searchUsersAction: jest.fn(),
    startConversationAction: jest.fn(),
    startSupportConversationAction: jest.fn(),
};
const co = { getMembershipAction: jest.fn(), initiateCooperativePaymentAction: jest.fn() };

//   ONE session object, not a fresh one per render.
//
//   AUDIT THE INSTRUMENT BEFORE BELIEVING THE MEASUREMENT — the third time this
//   audit has been caught by it. The first spelling returned a new object
//   literal from useSession, so `session` changed identity on every render, the
//   chat's authorisation effect re-ran, the take-once seed was spent by the
//   first run and the second called the real action. The tests read as "the
//   seed is ignored" when the seed was working and the mock was not.
const SESSION = {
    data: { user: { id: 'u1', name: 'Ada', email: 'ada@example.test', roles: ['user'] } },
    status: 'authenticated',
};
jest.mock('next-auth/react', () => ({
    useSession: () => SESSION,
    signOut: jest.fn(),
}));
jest.mock('next/navigation', () => ({
    useRouter: () => router,
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/messages',
    useParams: () => ({ id: 'esc-1' }),
}));
jest.mock('@/contexts/ToastContext', () => ({
    useToast: () => ({ showToast }),
    ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/app/actions/marketplace', () => ({
    getEscrowTransactionByIdAction: (...a: any[]) => e.getEscrowTransactionByIdAction(...a),
    getEscrowMessagesAction: (...a: any[]) => e.getEscrowMessagesAction(...a),
    sendEscrowMessageAction: (...a: any[]) => e.sendEscrowMessageAction(...a),
}));
jest.mock('@/app/actions/messages', () => ({
    getConversationsAction: (...a: any[]) => msg.getConversationsAction(...a),
    getMessagesAction: (...a: any[]) => msg.getMessagesAction(...a),
    markAsReadAction: (...a: any[]) => msg.markAsReadAction(...a),
    sendMessageAction: (...a: any[]) => msg.sendMessageAction(...a),
    searchUsersAction: (...a: any[]) => msg.searchUsersAction(...a),
    startConversationAction: (...a: any[]) => msg.startConversationAction(...a),
    startSupportConversationAction: (...a: any[]) => msg.startSupportConversationAction(...a),
}));
jest.mock('@/app/actions/cooperative', () => ({
    getMembershipAction: (...a: any[]) => co.getMembershipAction(...a),
    initiateCooperativePaymentAction: (...a: any[]) => co.initiateCooperativePaymentAction(...a),
}));

const ESCROW = { id: 'esc-1', buyerId: 'u1', sellerId: 'u2', amount: 50000, status: 'funded' };

//   `message`, not `content`: the field the chat actually renders. Getting
//   this wrong is how #561 was found — a row whose shape does not match what
//   the screen reads is exactly what a writer producing the wrong field name
//   would put in the database.
const CHAT_MESSAGES = [
    {
        id: 'm1',
        senderId: 'u2',
        senderName: 'Chidi',
        message: 'The consignment left Onitsha this morning',
        timestamp: new Date(2026, 0, 1).toISOString(),
    },
];

const CONVERSATIONS = [{
    id: 'conv-1',
    participants: ['u1', 'u2'],
    participantDetails: { u2: { name: 'Chidi Nwosu' } },
    lastMessage: 'hello',
    updatedAt: new Date(2026, 0, 1).toISOString(),
}];

beforeEach(() => {
    jest.clearAllMocks();
    (Element.prototype as any).scrollIntoView = jest.fn();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#560 — a seed in the LOADER keeps its immediate tick', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    async function renderChat(initial: any) {
        const { default: EscrowChatClient } = await import('@/app/escrow/[id]/chat/EscrowChatClient');
        render(<EscrowChatClient escrowId="esc-1" initial={initial} />);
        //   loadMessages defers its own setState with setTimeout(..., 0) — a
        //   deliberate hop out of the render pass — which fake timers hold
        //   until something advances them. Advancing by 1ms lets that land
        //   without reaching the 5s poll, which is what the tests measure.
        //   Three flushes, and each one is needed: the loader awaits (a
        //   microtask), then defers its setState with setTimeout(..., 0) (a
        //   timer fake timers hold), then React commits (another microtask).
        //   1ms, not 5000 — reaching the poll would defeat what is measured.
        await act(async () => { await Promise.resolve(); });
        await act(async () => { jest.advanceTimersByTime(1); await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });
    }

    it('A SEEDED CHAT PAINTS ITS THREAD AT ONCE AND CALLS NOTHING', async () => {
        //   THE CLAIM, and the one `immediate: false` would break: the seed is
        //   only consumed when loadMessages runs, so suppressing the first tick
        //   would leave this spinning for five seconds.
        await renderChat({
            escrow: { success: true, error: null, data: ESCROW },
            messages: { success: true, error: null, data: CHAT_MESSAGES },
        });

        await act(async () => { await Promise.resolve(); });

        //   getByText, NOT findByText. With fake timers, findByText's waitFor
        //   ADVANCES THE CLOCK — past five seconds — so the poll it is meant to
        //   prove unnecessary fires before the assertion under it runs. The
        //   flushes in renderChat have already made the thread present, so the
        //   synchronous query is both correct and the only honest one here.
        expect(screen.getByText(/left Onitsha this morning/i)).toBeInTheDocument();
        expect(e.getEscrowMessagesAction).not.toHaveBeenCalled();
        expect(e.getEscrowTransactionByIdAction).not.toHaveBeenCalled();
    });

    it('AND IT IS STILL POLLING — one interval later, it asks', async () => {
        //   The vacuity guard. A seeded chat that never polls again is a chat
        //   that stops receiving messages.
        e.getEscrowMessagesAction.mockResolvedValue({ success: true, error: null, data: CHAT_MESSAGES });

        await renderChat({
            escrow: { success: true, error: null, data: ESCROW },
            messages: { success: true, error: null, data: CHAT_MESSAGES },
        });
        await act(async () => { await Promise.resolve(); });
        expect(e.getEscrowMessagesAction).not.toHaveBeenCalled();

        await act(async () => { jest.advanceTimersByTime(5000); await Promise.resolve(); });

        await waitFor(() => expect(e.getEscrowMessagesAction).toHaveBeenCalledTimes(1));
    });

    it('AND AN UNSEEDED CHAT MAKES BOTH READS ITSELF', async () => {
        e.getEscrowTransactionByIdAction.mockResolvedValue({ success: true, error: null, data: ESCROW });
        e.getEscrowMessagesAction.mockResolvedValue({ success: true, error: null, data: CHAT_MESSAGES });

        await renderChat(null);

        await waitFor(() => expect(e.getEscrowTransactionByIdAction).toHaveBeenCalledWith('esc-1'));
        await waitFor(() => expect(e.getEscrowMessagesAction).toHaveBeenCalledWith('esc-1'));
    });

    it('#561 — AND ONE MESSAGE WITH NO TIMESTAMP NO LONGER TAKES THE CHAT DOWN', async () => {
        /**
         *   Not a hypothetical. groupMessagesByDate started `currentDate` at the
         *   empty string, and formatDate RETURNS the empty string for a missing
         *   timestamp — so the first undated message took the "same day as the
         *   last one" branch with no group yet created and dereferenced
         *   groups[-1]. A TypeError during render: the buyer and seller arguing
         *   about money got a blank screen, not a blank row.
         *
         *   Found from a fixture that used the wrong field name, which is
         *   exactly what a writer that forgets one produces.
         */
        await renderChat({
            escrow: { success: true, error: null, data: ESCROW },
            messages: {
                success: true, error: null,
                data: [
                    { id: 'm0', senderId: 'u2', senderName: 'Chidi', message: 'Undated line' },
                    ...CHAT_MESSAGES,
                ],
            },
        });

        expect(screen.getByText(/Undated line/i)).toBeInTheDocument();
        expect(screen.getByText(/left Onitsha this morning/i)).toBeInTheDocument();
    });

    it('AND A SEEDED CHAT STILL TURNS AWAY SOMEBODY WHO IS NEITHER PARTY', async () => {
        //   The authorisation is deliberately NOT decided on the server — the
        //   client compares the row against its own session. Seeding the row
        //   must not become a way past that.
        await renderChat({
            escrow: {
                success: true, error: null,
                data: { ...ESCROW, buyerId: 'someone-else', sellerId: 'another' },
            },
            messages: { success: true, error: null, data: CHAT_MESSAGES },
        });

        await waitFor(() => expect(push).toHaveBeenCalledWith('/escrow'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#560 — the same rule on the conversation list', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    async function renderMessages(initial: any) {
        const { default: MessagesClient } = await import('@/app/messages/MessagesClient');
        render(<MessagesClient initial={initial} />);
    }

    it('A SEEDED LIST SHOWS ITS CONVERSATIONS AND ASKS FOR NOTHING', async () => {
        await renderMessages({ conversations: CONVERSATIONS, error: null });

        expect(await screen.findByText(/Chidi Nwosu/i)).toBeInTheDocument();
        expect(msg.getConversationsAction).not.toHaveBeenCalled();
    });

    it('AND IT STILL POLLS EIGHT SECONDS LATER', async () => {
        msg.getConversationsAction.mockResolvedValue({ conversations: CONVERSATIONS, error: null });

        await renderMessages({ conversations: CONVERSATIONS, error: null });
        await screen.findByText(/Chidi Nwosu/i);
        expect(msg.getConversationsAction).not.toHaveBeenCalled();

        await act(async () => { jest.advanceTimersByTime(8000); await Promise.resolve(); });

        await waitFor(() => expect(msg.getConversationsAction).toHaveBeenCalledTimes(1));
    });

    it('AND A SEEDED REFUSAL IS STILL A REFUSAL, NOT AN EMPTY LIST', async () => {
        //   #310 — getConversationsAction returns { error, conversations: [] }
        //   on failure, and an empty array is truthy. The seed carries the whole
        //   result precisely so that distinction stays in one place.
        await renderMessages({ conversations: [], error: 'Could not reach the server.' });

        expect(await screen.findByText(/Could not reach the server/i)).toBeInTheDocument();
        expect(msg.getConversationsAction).not.toHaveBeenCalled();
    });

    it('AND AN UNSEEDED LIST FETCHES ON MOUNT, AS BEFORE', async () => {
        msg.getConversationsAction.mockResolvedValue({ conversations: CONVERSATIONS, error: null });

        await renderMessages(null);

        await waitFor(() => expect(msg.getConversationsAction).toHaveBeenCalled());
        expect(await screen.findByText(/Chidi Nwosu/i)).toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#560 — the cooperative payment gate decides before the page is sent', () => {
    async function renderGate(initial: any) {
        const { default: CooperativePaymentClient } =
            await import('@/app/cooperatives/payment/CooperativePaymentClient');
        render(<CooperativePaymentClient initial={initial} />);
    }

    it('AN ALREADY-PAID MEMBER IS SENT TO ONBOARDING WITHOUT A READ', async () => {
        await renderGate({
            success: true, error: null,
            data: { membership: { membershipStatus: 'pending', paymentStatus: 'completed' } },
        });

        await waitFor(() => expect(replace).toHaveBeenCalledWith('/cooperatives/onboarding'));
        expect(co.getMembershipAction).not.toHaveBeenCalled();
    });

    it('AND SOMEBODY WITH NO MEMBERSHIP STAYS ON THE PAYMENT SCREEN', async () => {
        //   The vacuity guard: a gate that redirected everybody would pass the
        //   test above and nobody could ever pay.
        await renderGate({ success: true, error: null, data: { membership: null } });

        await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
        expect(replace).not.toHaveBeenCalled();
    });
});
