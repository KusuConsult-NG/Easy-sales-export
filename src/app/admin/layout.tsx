import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session-guard";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { canAccessAdminRoute } from "@/lib/admin-permissions";
import { headers } from "next/headers";

async function AdminLayoutContent({ children }: { children: React.ReactNode }) {
    const sessionResult = await requireSession();

    // Verify authentication
    if (!sessionResult.session) {
        const errorMessage = sessionResult.error?.error || "Authentication required";
        redirect(`/auth/login?error=${encodeURIComponent(errorMessage)}`);
    }

    const headerList = await headers();
    const pathname = headerList.get("x-invoke-path") || "/admin";
    
    // Strict Role Check - Allow 'admin', 'super_admin' and module admins using synchronized live roles
    const roles = sessionResult.session.user.roles || [];
    const hasAdminAccess = canAccessAdminRoute(roles, pathname);

    if (!hasAdminAccess) {
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
