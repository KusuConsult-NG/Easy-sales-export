"use client";

import { createContext, useContext, useState, useMemo } from "react";
import { usePolling } from "@/hooks/usePolling";
import { getMyDashboard, getMyNavSummary, type MyDashboard, type MyNavSummary } from "@/app/actions/my-data";

/**
 * ONE poll behind the nav badges and, on /dashboard, the tiles as well.
 *
 *   #539 THE NAV POLLED THREE THINGS THE DASHBOARD WAS ALREADY FETCHING.
 *
 *   DashboardNav ran three pollers of its own — service registrations (8s),
 *   unread messages (8s), unread notifications (10s). The /dashboard page
 *   separately polled getMyDashboard (8s), which RETURNS ALL THREE. So every
 *   one of those values was fetched twice, about every eight seconds, for as
 *   long as the screen was open.
 *
 *   The duplication could not be seen from inside either component. The nav is
 *   rendered by the LAYOUT and the tiles by the PAGE, and a page cannot hand
 *   anything to its own parent layout — which is exactly why the provider has
 *   to live in the layout, above both.
 *
 * ── THE TWO MODES, AND WHY THERE ARE TWO ────────────────────────────────────
 *
 *   "full"  — /dashboard. Polls getMyDashboard once. The nav takes its three
 *             badges from the result and the page takes the other five values
 *             from the same object, so the screen makes ONE round trip where it
 *             used to make four.
 *
 *   "nav"   — /messages, which mounts the same nav with no dashboard to draw.
 *             Polls getMyNavSummary: the same three values, three queries
 *             rather than eight. Three round trips become one.
 *
 *   Giving /messages the full payload would have been simpler and would have
 *   made that screen do five queries it has no use for. Fewer round trips is
 *   the goal; more work per trip is not automatically a win.
 *
 * ── READING IT WHERE THERE IS NO PROVIDER ───────────────────────────────────
 *
 *   `useNavSummary()` returns null outside a provider rather than throwing, and
 *   DashboardNav falls back to its own polling when it gets null. That keeps
 *   the component correct if it is ever mounted somewhere new, and means this
 *   change cannot break a screen nobody remembered to wrap. The fallback is
 *   asserted in the tests, so it stays a real path and not a dead one.
 */

export interface NavSummaryValue {
    serviceRegistrations: Record<string, any>;
    unreadNotifications: number;
    unreadMessages: number;
    /** The rest of the dashboard payload — present only in "full" mode. */
    dashboard: MyDashboard | null;
    /** False until the first poll has come back, so a badge can hold its place. */
    loaded: boolean;
}

const NavSummaryContext = createContext<NavSummaryValue | null>(null);

/** The shared values, or null when no provider is mounted above. */
export function useNavSummary(): NavSummaryValue | null {
    return useContext(NavSummaryContext);
}

const EMPTY: MyNavSummary = {
    serviceRegistrations: {}, unreadNotifications: 0, unreadMessages: 0,
};

export function NavSummaryProvider({
    mode,
    userId,
    intervalMs = 8000,
    children,
}: {
    mode: "full" | "nav";
    userId: string | undefined;
    intervalMs?: number;
    children: React.ReactNode;
}) {
    const [summary, setSummary] = useState<MyNavSummary>(EMPTY);
    const [dashboard, setDashboard] = useState<MyDashboard | null>(null);
    const [loaded, setLoaded] = useState(false);

    usePolling(async () => {
        if (!userId) return;
        try {
            if (mode === "full") {
                const dash = await getMyDashboard();
                setDashboard(dash);
                setSummary({
                    serviceRegistrations: dash.serviceRegistrations,
                    unreadNotifications: dash.unreadNotifications,
                    unreadMessages: dash.unreadMessages,
                });
            } else {
                setSummary(await getMyNavSummary());
            }
        } catch (error) {
            //   A failed poll keeps the last good values rather than zeroing
            //   the badges — #416's rule, which this provider now owns on
            //   behalf of every consumer.
            console.error("NavSummaryProvider poll failed:", error);
        } finally {
            setLoaded(true);
        }
    }, intervalMs, { enabled: !!userId, restartKey: `${mode}:${userId ?? ""}` });

    const value = useMemo<NavSummaryValue>(() => ({
        serviceRegistrations: summary.serviceRegistrations,
        unreadNotifications: summary.unreadNotifications,
        unreadMessages: summary.unreadMessages,
        dashboard,
        loaded,
    }), [summary, dashboard, loaded]);

    return (
        <NavSummaryContext.Provider value={value}>
            {children}
        </NavSummaryContext.Provider>
    );
}
