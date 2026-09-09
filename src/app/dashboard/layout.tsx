/**
 * Dashboard Layout
 *
 * Server-side auth guard + shared navigation for the user dashboard.
 * Renders a persistent left sidebar (desktop) / top bar (mobile) so users
 * can navigate between all dashboard sub-pages without knowing the URLs.
 */

import { redirect } from "next/navigation";
import { requireHubRegistration } from "@/lib/hub-guard";
import DashboardNav from "@/components/dashboard/DashboardNav";
import { NavSummaryProvider } from "@/contexts/NavSummaryContext";
import { getMyDashboard } from "@/app/actions/my-data";

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const sessionResult = await requireHubRegistration();

    /**
     *   #540 FETCHED HERE, ON THE SERVER, BEFORE ANY HTML IS SENT.
     *
     *   This layout is a server component and was already awaiting the guard
     *   above, so the payload costs no extra round trip to the browser — it
     *   rides along in the HTML.
     *
     *   What it replaces is worse than it looks: the browser used to receive a
     *   dashboard of empty tiles, download the JS bundle, hydrate, and only
     *   THEN ask for the numbers. The page appeared to have loaded long before
     *   it had anything on it.
     *
     *   The client keeps polling for updates; it just no longer has to make the
     *   first call.
     */
    const initialDashboard = sessionResult.session?.user?.id
        ? await getMyDashboard().catch(() => null)
        : null;

    return (
        <div className="min-h-screen bg-slate-50">
            {/*
                #539 ONE poll for the nav AND the page beneath it.

                The nav's three badges and the dashboard page's tiles came from
                the same getMyDashboard payload and were fetched separately —
                four pollers on this screen, three of them redundant. The
                provider has to sit HERE, above both, because a page cannot hand
                anything to its own parent layout.
            */}
            <NavSummaryProvider
                mode="full"
                userId={sessionResult.session?.user?.id}
                initialDashboard={initialDashboard}
            >
                {/* Shared nav (sidebar on desktop / top bar + drawer on mobile) */}
                <DashboardNav />

                {/* Main content — offset by sidebar width on desktop, top bar height on mobile */}
                <main className="lg:ml-60 pt-16 lg:pt-0 min-h-screen">
                    {children}
                </main>
            </NavSummaryProvider>
        </div>
    );
}
