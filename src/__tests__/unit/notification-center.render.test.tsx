/**
 * @jest-environment jsdom
 */

/**
 * Rendering tests for the notification bell.
 *
 * This component crashed every page it appeared on — which is every page —
 * whenever the signed-in user had a notification. The cause was a date shape:
 * a Firestore Timestamp that has crossed to a client component is a plain
 * object with `_seconds` and no methods, and the code called a date function on
 * it directly. It is now guarded by date-utils.toDate.
 *
 * Nothing tested that. The fix was verified by reading the source, because no
 * test in this repository mounted a component. So the guard could be removed by
 * a later refactor and the whole application would break again with every check
 * still green.
 *
 * These tests mount it. The serialized-Timestamp case below is the specific
 * regression.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockUseSession = jest.fn();
const mockGetMyNotifications = jest.fn();
const mockMarkAsRead = jest.fn().mockResolvedValue({ success: true });
const mockMarkAllAsRead = jest.fn().mockResolvedValue({ success: true });

jest.mock('next-auth/react', () => ({
    useSession: () => mockUseSession(),
}));

jest.mock('@/app/actions/my-data', () => ({
    getMyNotifications: (...args: any[]) => mockGetMyNotifications(...args),
}));

jest.mock('@/app/actions/notifications', () => ({
    markNotificationAsReadAction: (...args: any[]) => mockMarkAsRead(...args),
    markAllAsReadAction: (...args: any[]) => mockMarkAllAsRead(...args),
}));

import NotificationCenter from '@/components/layout/NotificationCenter';

/** A signed-in session. `system` is a universal notification type, so module
 *  subscriptions do not affect visibility. */
function signedIn() {
    mockUseSession.mockReturnValue({
        data: { user: { id: 'user-1', email: 'a@b.com', roles: ['member'], serviceRegistrations: {} } },
        status: 'authenticated',
    });
}

function notification(overrides: Record<string, any> = {}) {
    return {
        id: 'n1',
        userId: 'user-1',
        type: 'system',
        title: 'Payment received',
        message: 'Your contribution was recorded',
        read: false,
        createdAt: new Date('2026-08-01T10:00:00.000Z').toISOString(),
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockGetMyNotifications.mockResolvedValue([]);
});

describe('NotificationCenter — visibility', () => {
    it('renders nothing when signed out', () => {
        mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
        const { container } = render(<NotificationCenter />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders the bell when signed in', async () => {
        signedIn();
        render(<NotificationCenter />);
        await waitFor(() => expect(mockGetMyNotifications).toHaveBeenCalled());
        expect(screen.getByRole('button')).toBeInTheDocument();
    });
});

describe('NotificationCenter — unread badge', () => {
    it('shows no count when everything is read', async () => {
        signedIn();
        mockGetMyNotifications.mockResolvedValue([notification({ read: true })]);

        render(<NotificationCenter />);
        await waitFor(() => expect(mockGetMyNotifications).toHaveBeenCalled());

        expect(screen.queryByText('1')).not.toBeInTheDocument();
    });

    it('counts unread notifications', async () => {
        signedIn();
        mockGetMyNotifications.mockResolvedValue([
            notification({ id: 'n1', read: false }),
            notification({ id: 'n2', read: false }),
            notification({ id: 'n3', read: true }),
        ]);

        render(<NotificationCenter />);
        expect(await screen.findByText('2')).toBeInTheDocument();
    });

    it('caps the badge at 99+', async () => {
        signedIn();
        mockGetMyNotifications.mockResolvedValue(
            Array.from({ length: 150 }, (_, i) => notification({ id: `n${i}`, read: false }))
        );

        render(<NotificationCenter />);
        expect(await screen.findByText('99+')).toBeInTheDocument();
    });
});

describe('NotificationCenter — the date crash', () => {
    // The regression. Each shape below has reached this component in
    // production at some point, depending on which path loaded the data.
    const shapes: Array<[string, any]> = [
        ['ISO string (what serializeDocs sends)', '2026-08-01T10:00:00.000Z'],
        ['Date object', new Date('2026-08-01T10:00:00.000Z')],
        ['serialized admin Timestamp (_seconds, no methods)', { _seconds: 1785931200, _nanoseconds: 0 }],
        ['serialized client Timestamp (seconds, no methods)', { seconds: 1785931200, nanoseconds: 0 }],
        ['a live Timestamp with toDate()', { toDate: () => new Date('2026-08-01T10:00:00.000Z') }],
    ];

    it.each(shapes)('opens and renders a relative time for a %s', async (_label, createdAt) => {
        signedIn();
        mockGetMyNotifications.mockResolvedValue([notification({ createdAt })]);

        render(<NotificationCenter />);
        await waitFor(() => expect(mockGetMyNotifications).toHaveBeenCalled());

        // Opening the panel is what renders the date. Before the guard, this
        // threw and took the page with it.
        fireEvent.click(screen.getByRole('button'));

        expect(await screen.findByText('Payment received')).toBeInTheDocument();
        // date-fns renders "... ago" / "in ...". Anything unparseable throws
        // rather than rendering, so reaching this line is the assertion.
        expect(screen.getByText(/ago|in /i)).toBeInTheDocument();
    });

    it('survives a createdAt that is missing entirely', async () => {
        signedIn();
        mockGetMyNotifications.mockResolvedValue([notification({ createdAt: undefined })]);

        render(<NotificationCenter />);
        await waitFor(() => expect(mockGetMyNotifications).toHaveBeenCalled());

        expect(() => fireEvent.click(screen.getByRole('button'))).not.toThrow();
        expect(await screen.findByText('Payment received')).toBeInTheDocument();
    });
});

describe('NotificationCenter — panel contents', () => {
    it('shows the empty state when there is nothing', async () => {
        signedIn();
        mockGetMyNotifications.mockResolvedValue([]);

        render(<NotificationCenter />);
        await waitFor(() => expect(mockGetMyNotifications).toHaveBeenCalled());
        fireEvent.click(screen.getByRole('button'));

        expect(await screen.findByText(/no notifications yet/i)).toBeInTheDocument();
    });

    it('renders the title and message of each notification', async () => {
        signedIn();
        mockGetMyNotifications.mockResolvedValue([
            notification({ id: 'n1', title: 'Loan approved', message: 'Your loan was approved' }),
        ]);

        render(<NotificationCenter />);
        await waitFor(() => expect(mockGetMyNotifications).toHaveBeenCalled());
        fireEvent.click(screen.getByRole('button'));

        expect(await screen.findByText('Loan approved')).toBeInTheDocument();
        expect(screen.getByText('Your loan was approved')).toBeInTheDocument();
    });

    it('marks unread notifications as read when the panel is opened', async () => {
        signedIn();
        mockGetMyNotifications.mockResolvedValue([
            notification({ id: 'n1', read: false }),
            notification({ id: 'n2', read: false }),
        ]);

        render(<NotificationCenter />);
        await waitFor(() => expect(mockGetMyNotifications).toHaveBeenCalled());

        fireEvent.click(screen.getByRole('button'));

        await waitFor(() => {
            expect(mockMarkAsRead).toHaveBeenCalledWith('n1');
            expect(mockMarkAsRead).toHaveBeenCalledWith('n2');
        });
    });

    it('leaves the "Mark all read" button unreachable — it is dead UI', async () => {
        // Not a wish, a record of what the component does.
        //
        // The header renders "Mark all read" only when unreadCount > 0, and the
        // effect above marks every visible unread notification as read the
        // moment isOpen flips — optimistically and synchronously in state. So
        // by the time the panel is on screen the count is 0 and the button has
        // gone. It exists for one render and cannot be clicked.
        //
        // markAllAsReadAction is therefore unreachable from this component.
        // Whether to drop the button or stop auto-marking on open is a product
        // decision; this test fails if either is changed, which is the point.
        signedIn();
        mockGetMyNotifications.mockResolvedValue([notification({ read: false })]);

        render(<NotificationCenter />);
        await waitFor(() => expect(mockGetMyNotifications).toHaveBeenCalled());
        fireEvent.click(screen.getByRole('button'));

        // The notification itself is there…
        expect(await screen.findByText('Payment received')).toBeInTheDocument();
        // …but the button that would mark it read is already gone.
        expect(screen.queryByText(/mark all read/i)).not.toBeInTheDocument();
        expect(mockMarkAllAsRead).not.toHaveBeenCalled();
    });
});
