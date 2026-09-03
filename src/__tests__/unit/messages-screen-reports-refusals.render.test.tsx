/**
 * @jest-environment jsdom
 */

/**
 *   #310 THREE SCREENS START A CONVERSATION. THE MESSAGES SCREEN WAS THE ONE
 *        THAT SAID NOTHING WHEN THE SERVER REFUSED.
 *
 *        startSupportConversationAction does not fail vaguely. It returns
 *        reasons a person could act on:
 *
 *            "No admin available currently"
 *            "You are the primary admin"
 *            "Failed to start support conversation"
 *
 *        cooperatives/(member)/directory shows them. dashboard/disputes shows
 *        them. /messages — the screen whose entire purpose is messaging, and
 *        the one carrying the "Contact Admin Support" button a member reaches
 *        for when something has gone wrong — discarded every one:
 *
 *            const result = await startSupportConversationAction();
 *            if (!isSessionExpired(result) && result.conversationId) { ... }
 *
 *        No else. The click did nothing at all. Not an error, not a spinner
 *        that stuck — nothing, so the member clicked it again.
 *
 *        That is #287's shape ("a refused loan application produced nothing at
 *        all") and #276's ("the door the UI uses was not the hardened one"),
 *        and the giveaway is that handleSend IN THIS SAME FILE gets it right:
 *        it reads result.success and toasts result.error. One author fixed one
 *        handler. Four siblings kept the old shape.
 *
 *   AND THE LIST BLANKED ITSELF — #307's SHAPE, AGAIN
 *
 *        getConversationsAction returns { error, conversations: [] } when it
 *        fails, and the poll guarded on `if (result.conversations)`, which is
 *        TRUE for an empty array. So a failed load REPLACED the user's
 *        conversations with none and the screen read "No conversations yet."
 *        An unread message from an admin, hidden by a network blip, indexed
 *        under "you have none". searchUsersAction had the identical shape:
 *        a search that never ran displayed as "no matches".
 *
 * WHY THIS MOUNTS THE PAGE
 * ------------------------
 * #287's mutation run settled this: a source ratchet that greps for
 * `showToast(` cannot tell live code from dead code, because `if (false)`
 * preserves the string. So the page is rendered, the button is pressed against
 * an action that refuses, and the assertion is that the reason reaches the
 * screen. There is no way to satisfy that without it actually doing so.
 *
 * It is also the second app-router page in this codebase to execute at all.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── the server actions, all of them controllable ─────────────────────────────
const mockGetConversations = jest.fn() as jest.Mock<any>;
const mockGetMessages = jest.fn() as jest.Mock<any>;
const mockSendMessage = jest.fn() as jest.Mock<any>;
const mockStartConversation = jest.fn() as jest.Mock<any>;
const mockSearchUsers = jest.fn() as jest.Mock<any>;
const mockMarkAsRead = jest.fn() as jest.Mock<any>;
const mockStartSupport = jest.fn() as jest.Mock<any>;

jest.mock('@/app/actions/messages', () => ({
    getConversationsAction: (...a: any[]) => mockGetConversations(...a),
    getMessagesAction: (...a: any[]) => mockGetMessages(...a),
    sendMessageAction: (...a: any[]) => mockSendMessage(...a),
    startConversationAction: (...a: any[]) => mockStartConversation(...a),
    searchUsersAction: (...a: any[]) => mockSearchUsers(...a),
    markAsReadAction: (...a: any[]) => mockMarkAsRead(...a),
    startSupportConversationAction: (...a: any[]) => mockStartSupport(...a),
}));

/** Every toast the screen raises, in order. */
const toasts: { message: string; kind: string }[] = [];
jest.mock('@/contexts/ToastContext', () => ({
    useToast: () => ({
        showToast: (message: string, kind: string) => { toasts.push({ message, kind }); },
    }),
}));

jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: { user: { id: 'member-1', name: 'Ada Obi' } }, status: 'authenticated' }),
}));

jest.mock('next/navigation', () => ({
    useSearchParams: () => new URLSearchParams(''),
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

import MessagesPage from '@/app/messages/page';

/** A conversation the member already has, so "blanked" is distinguishable. */
const EXISTING = {
    id: 'conv-1',
    participants: ['member-1', 'admin-1'],
    // `name`, not `fullName` — ParticipantInfo's own field. Getting this wrong
    // is what surfaced the unguarded `other?.name.charAt(0)` below.
    participantDetails: { 'admin-1': { uid: 'admin-1', name: 'Support Desk', email: 'a@e.com', lastRead: null } },
    lastMessage: { text: 'Hello', senderId: 'admin-1', timestamp: '2026-01-02T09:30:00.000Z' },
    unreadCount: { 'member-1': 0 },
};

beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    toasts.length = 0;

    mockGetConversations.mockResolvedValue({ conversations: [EXISTING], error: null });
    mockGetMessages.mockResolvedValue({ messages: [], error: null });
    mockMarkAsRead.mockResolvedValue({ success: true, error: null });
    mockSearchUsers.mockResolvedValue({ users: [], error: null });
});

afterEach(() => {
    jest.useRealTimers();
});

/**
 * Render and let the first poll settle.
 *
 * Waiting on the mock being CALLED is not enough — that resolves before React
 * has flushed setLoading(false), so every query below ran against the loading
 * spinner and found no buttons at all. Wait for the screen the poll produces.
 */
async function mount() {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<MessagesPage />);
    await screen.findByRole('heading', { name: 'Messages' });
    return user;
}

/** Open the New Chat panel, which is where both start-buttons live. */
async function openNewChat(user: ReturnType<typeof userEvent.setup>) {
    // The toggle is the only button in the header next to "Messages".
    const buttons = screen.getAllByRole('button');
    await user.click(buttons[0]!);
    await screen.findByText('Contact Admin Support');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#310 — Contact Admin Support, refused', () => {
    it('SHOWS THE REASON THE SERVER GAVE, rather than doing nothing at all', async () => {
        mockStartSupport.mockResolvedValue({ error: 'No admin available currently', conversationId: null });
        const user = await mount();
        await openNewChat(user);

        await user.click(screen.getByText('Contact Admin Support'));

        await waitFor(() => expect(toasts).toHaveLength(1));
        expect(toasts[0]).toEqual({ message: 'No admin available currently', kind: 'error' });
    });

    it('and the other real reason too — "You are the primary admin"', async () => {
        // Not a variant of the same assertion: this reason means the member
        // should stop trying, and it is the one most likely to be read as a
        // broken button when it is silent.
        mockStartSupport.mockResolvedValue({ error: 'You are the primary admin', conversationId: null });
        const user = await mount();
        await openNewChat(user);

        await user.click(screen.getByText('Contact Admin Support'));

        await waitFor(() => expect(toasts).toHaveLength(1));
        expect(toasts[0]!.message).toBe('You are the primary admin');
    });

    it('falls back to a message when the refusal carries no reason', async () => {
        mockStartSupport.mockResolvedValue({ conversationId: null });
        const user = await mount();
        await openNewChat(user);

        await user.click(screen.getByText('Contact Admin Support'));

        await waitFor(() => expect(toasts).toHaveLength(1));
        expect(toasts[0]!.message).toMatch(/contact support/i);
    });

    it('and says NOTHING when it succeeds, so the guard is not simply always-on', async () => {
        // Vacuity guard. Toasting unconditionally would pass all three above.
        mockStartSupport.mockResolvedValue({ conversationId: 'conv-9', error: null });
        const user = await mount();
        await openNewChat(user);

        await user.click(screen.getByText('Contact Admin Support'));

        await waitFor(() => expect(mockStartSupport).toHaveBeenCalled());
        expect(toasts).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#310 — starting a conversation with a person, refused', () => {
    it('reports the reason instead of leaving the panel open and silent', async () => {
        mockSearchUsers.mockResolvedValue({
            users: [{ uid: 'user-2', fullName: 'Chidi Eze', email: 'c•••@e.com' }],
            error: null,
        });
        mockStartConversation.mockResolvedValue({ error: 'Failed to start conversation', conversationId: null });
        const user = await mount();
        await openNewChat(user);

        await user.click(await screen.findByText('Chidi Eze'));

        await waitFor(() => expect(toasts).toHaveLength(1));
        expect(toasts[0]).toEqual({ message: 'Failed to start conversation', kind: 'error' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#310 — a failed load is not an empty one', () => {
    it('KEEPS THE CONVERSATIONS ON SCREEN when the poll fails, and says why', async () => {
        // THE test. The old guard `if (result.conversations)` was true for the
        // empty array a failure returns, so the member's list vanished and the
        // screen said they had none.
        mockGetConversations.mockResolvedValue({ error: 'Failed to load conversations', conversations: [] });
        await mount();

        expect(await screen.findByText(/may be out of date/i)).toBeInTheDocument();
        expect(screen.getByText(/Failed to load conversations/)).toBeInTheDocument();
        expect(screen.queryByText(/No conversations yet/)).not.toBeInTheDocument();
    });

    it('and still says "no conversations yet" when there genuinely are none', async () => {
        // Vacuity guard from the other side: treating every empty list as a
        // failure would hide the real empty state.
        mockGetConversations.mockResolvedValue({ conversations: [], error: null });
        await mount();

        expect(await screen.findByText(/No conversations yet/)).toBeInTheDocument();
        expect(screen.queryByText(/may be out of date/i)).not.toBeInTheDocument();
    });

    it('a failed user search says so rather than showing "no matches"', async () => {
        mockSearchUsers.mockResolvedValue({ error: 'Failed to search users', users: [] });
        const user = await mount();
        await openNewChat(user);

        await waitFor(() => expect(toasts).toHaveLength(1));
        expect(toasts[0]).toEqual({ message: 'Failed to search users', kind: 'error' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#310 — one bad row does not take the list down', () => {
    /**
     * Both of these were found by MOUNTING the page, not by reading it. The
     * suite crashed on a fixture and the crash was the component's, not the
     * fixture's — which is the whole argument for executing the component
     * layer rather than grepping it.
     */
    it('renders a conversation whose lastMessage timestamp is unreadable', async () => {
        // format(new Date(undefined)) throws RangeError: Invalid time value,
        // inside .map(), so ONE such row rendered nothing at all — for every
        // conversation, not just the broken one. #130's shape.
        mockGetConversations.mockResolvedValue({
            conversations: [
                { ...EXISTING, id: 'conv-bad', lastMessage: { text: 'Hi', senderId: 'admin-1', timestamp: undefined } },
                EXISTING,
            ],
            error: null,
        });
        await mount();

        // The good row still renders...
        expect(await screen.findByText('09:30')).toBeInTheDocument();
        // ...and the broken one renders WITHOUT a time rather than an epoch
        // 01:00 it cannot justify.
        expect(screen.getAllByText('Support Desk')).toHaveLength(2);
        expect(screen.getByText('Hi')).toBeInTheDocument();
    });

    it('and one whose participant carries no name', async () => {
        // `other?.name.charAt(0) || "U"` — the optional chain covered `other`
        // and not `name`, so the "U" fallback could never be reached: .charAt
        // on undefined raises before `||` is evaluated.
        mockGetConversations.mockResolvedValue({
            conversations: [{
                ...EXISTING,
                participantDetails: { 'admin-1': { uid: 'admin-1', email: 'a@e.com', lastRead: null } },
            }],
            error: null,
        });
        await mount();

        expect(await screen.findByText('U')).toBeInTheDocument();
        expect(screen.getByText('User')).toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#310 — the two screens that already got this right', () => {
    /**
     * Recorded so the fix is not mistaken for a new convention. These were the
     * evidence that the Messages screen was the odd one out rather than the
     * action being unusable — the same action, read correctly, twice.
     */
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

    it.each([
        ['src/app/cooperatives/(member)/directory/page.tsx'],
        ['src/app/dashboard/disputes/page.tsx'],
    ])('%s still reads result.error on a refused conversation', (rel) => {
        expect(src(rel)).toMatch(/showToast\(\s*\(?result[\s\S]{0,30}?\.error/);
    });
});
