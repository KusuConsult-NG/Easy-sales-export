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

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const sessionResult = await requireHubRegistration();

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
            <NavSummaryProvider mode="full" userId={sessionResult.session?.user?.id}>
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
