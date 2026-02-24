import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";

async function AdminLayoutContent({ children }: { children: React.ReactNode }) {
    const session = await auth();

    // Verify authentication and admin role
    if (!session?.user) {
        redirect("/auth/login?callbackUrl=/admin");
    }

    // Strict Role Check - Allow 'admin' and 'super_admin'
    // Note: session.user.roles is an array
    const isAdmin = session.user.roles?.includes("admin") || session.user.roles?.includes("super_admin");

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
