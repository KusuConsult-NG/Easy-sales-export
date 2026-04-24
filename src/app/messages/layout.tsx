import { redirect } from "next/navigation";
import { requireHubRegistration } from "@/lib/hub-guard";
import DashboardNav from "@/components/dashboard/DashboardNav";

export default async function MessagesLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const sessionResult = await requireHubRegistration();

    if (!sessionResult.session) {
        redirect("/auth/login?callbackUrl=/messages");
    }

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
            {/* Shared Dashboard Navigation */}
            <DashboardNav />

            {/* Main content — offset by sidebar width on desktop, top bar height on mobile */}
            <main className="flex-1 lg:ml-60 pt-14 lg:pt-0 min-w-0 h-screen overflow-hidden">
                {children}
            </main>
        </div>
    );
}
