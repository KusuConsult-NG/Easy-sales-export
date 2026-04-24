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

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    await requireHubRegistration();

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Shared nav (sidebar on desktop / top bar + drawer on mobile) */}
            <DashboardNav />

            {/* Main content — offset by sidebar width on desktop, top bar height on mobile */}
            <main className="lg:ml-60 pt-16 lg:pt-0 min-h-screen">
                {children}
            </main>
        </div>
    );
}
