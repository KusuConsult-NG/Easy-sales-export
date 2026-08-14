/**
 * @jest-environment jsdom
 */

/**
 * Rendering tests for the dashboard — the page users land on after signing in.
 *
 * Its data comes from eight session-scoped server actions, introduced when the
 * browser stopped querying Supabase directly. That change was verified by tsc,
 * lint and a production build; none of them mounts the page, so how it behaves
 * when one of those eight fails had never been observed.
 *
 * It is observed here, and the answer was wrong. See the partial-failure block.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

const mockUseSession = jest.fn();
const m = {
    getMyServiceRegistrations: jest.fn(),
    getMyUnreadNotificationCount: jest.fn(),
    getMyUnreadMessageCount: jest.fn(),
    getMyNotifications: jest.fn(),
    getMyWalletBalance: jest.fn(),
    getMyActiveOrderCount: jest.fn(),
    getUpcomingEvents: jest.fn(),
    getRecentResources: jest.fn(),
};

jest.mock('next-auth/react', () => ({ useSession: () => mockUseSession() }));
jest.mock('@/app/actions/my-data', () => ({
    getMyServiceRegistrations: (...a: any[]) => m.getMyServiceRegistrations(...a),
    getMyUnreadNotificationCount: (...a: any[]) => m.getMyUnreadNotificationCount(...a),
    getMyUnreadMessageCount: (...a: any[]) => m.getMyUnreadMessageCount(...a),
    getMyNotifications: (...a: any[]) => m.getMyNotifications(...a),
    getMyWalletBalance: (...a: any[]) => m.getMyWalletBalance(...a),
    getMyActiveOrderCount: (...a: any[]) => m.getMyActiveOrderCount(...a),
    getUpcomingEvents: (...a: any[]) => m.getUpcomingEvents(...a),
    getRecentResources: (...a: any[]) => m.getRecentResources(...a),
}));
jest.mock('@/components/AnnouncementBanner', () => ({
    __esModule: true,
    default: () => null,
}));

import DashboardPage from '@/app/dashboard/page';

function signedIn() {
    mockUseSession.mockReturnValue({
        data: { user: { id: 'user-1', name: 'Amaka', email: 'a@b.com', roles: ['member'], serviceRegistrations: {} } },
        status: 'authenticated',
    });
}

/** Every action resolving, so a test can fail exactly one of them. */
function allSucceed() {
    m.getMyServiceRegistrations.mockResolvedValue({});
    m.getMyUnreadNotificationCount.mockResolvedValue(3);
    m.getMyUnreadMessageCount.mockResolvedValue(5);
    m.getMyNotifications.mockResolvedValue([]);
    m.getMyWalletBalance.mockResolvedValue(12500);
    m.getMyActiveOrderCount.mockResolvedValue(2);
    m.getUpcomingEvents.mockResolvedValue([]);
    m.getRecentResources.mockResolvedValue([]);
}

beforeEach(() => {
    jest.clearAllMocks();
    signedIn();
    allSucceed();
});

describe('dashboard — happy path', () => {
    it('mounts without throwing', async () => {
        expect(() => render(<DashboardPage />)).not.toThrow();
        await waitFor(() => expect(m.getMyWalletBalance).toHaveBeenCalled());
    });

    it('shows the figures the actions returned', async () => {
        render(<DashboardPage />);

        // Wallet balance is currency-formatted; the others are plain counts.
        expect(await screen.findByText(/12,500/)).toBeInTheDocument();
        expect(screen.getByText('5')).toBeInTheDocument();   // unread messages
        expect(screen.getByText('3')).toBeInTheDocument();   // notifications
    });

    it('calls every one of the eight actions', async () => {
        render(<DashboardPage />);
        await waitFor(() => {
            for (const fn of Object.values(m)) expect(fn).toHaveBeenCalled();
        });
    });
});

describe('dashboard — one action failing must not blank the rest', () => {
    // THE DEFECT THIS FOUND.
    //
    // The loader awaited Promise.all over all eight actions. Promise.all
    // rejects on the FIRST rejection and discards every other result, so one
    // failing action left the whole dashboard on its initial zeros: no wallet
    // balance, no counts, no notifications, no events.
    //
    // It is reachable. Each action in my-data.ts wraps its query in try/catch
    // and returns a safe default — but currentUserId(), which calls
    // requireSession(), sits OUTSIDE that try. A session lookup that throws
    // takes the entire page down rather than one tile.
    //
    // Promise.allSettled instead: each action's failure costs only its own
    // value, and the rest of the page renders.
    it('still renders the wallet balance when the message count fails', async () => {
        m.getMyUnreadMessageCount.mockRejectedValue(new Error('session lookup failed'));

        render(<DashboardPage />);

        expect(await screen.findByText(/12,500/)).toBeInTheDocument();
    });

    it('still renders the counts when the wallet balance fails', async () => {
        m.getMyWalletBalance.mockRejectedValue(new Error('boom'));

        render(<DashboardPage />);

        expect(await screen.findByText('5')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('leaves the failed value at its default rather than crashing', async () => {
        m.getMyWalletBalance.mockRejectedValue(new Error('boom'));

        render(<DashboardPage />);

        // ₦0 — the initial value, not a crash and not a stale figure.
        expect(await screen.findByText(/₦0|0\.00|^0$/)).toBeInTheDocument();
    });

    it('finishes loading even when every action fails', async () => {
        for (const fn of Object.values(m)) fn.mockRejectedValue(new Error('everything is down'));

        render(<DashboardPage />);

        // The spinner must not be permanent: a dead backend should leave the
        // page usable and empty, not stuck loading forever.
        await waitFor(() => {
            expect(screen.queryByText(/loading your dashboard/i)).not.toBeInTheDocument();
        });
    });
});
