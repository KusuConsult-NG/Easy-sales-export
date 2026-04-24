import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session-guard";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";

async function AdminLayoutContent({ children }: { children: React.ReactNode }) {
    const sessionResult = await requireSession();

    // Verify authentication
    if (!sessionResult.session) {
        const errorMessage = sessionResult.error?.error || "Authentication required";
        redirect(`/auth/login?error=${encodeURIComponent(errorMessage)}`);
    }

    // Strict Role Check - Allow 'admin' and 'super_admin' using synchronized live roles
    const isAdmin = sessionResult.session.user.roles?.includes("admin") || sessionResult.session.user.roles?.includes("super_admin");

    if (!isAdmin) {
        redirect("/dashboard");
    }

    return (
        <div className="flex min-h-screen bg-slate-50">
            {/* Admin Sidebar */}
            <AdminSidebar />

            {/* Main Content Area */}
            <main className="flex-1 lg:pl-64 min-h-screen transition-all">
                {/* Remove top padding if not needed, or add if using a topbar */}
                <div className="w-full">
                    {children}
                </div>
            </main>
        </div>
    );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    return (
        <ErrorBoundary>
            <AdminLayoutContent>{children}</AdminLayoutContent>
        </ErrorBoundary>
    );
}
