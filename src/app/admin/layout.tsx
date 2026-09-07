import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session-guard";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { canAccessAdminRoute } from "@/lib/admin-permissions";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
    const roles = sessionResult.session?.user?.roles || [];
    const { isAdmin } = await import("@/lib/admin-permissions");
    const hasAdminAccess = isAdmin(roles);

    if (!hasAdminAccess) {
        redirect("/dashboard");
    }

    return (
        <div className="flex min-h-screen bg-slate-50">
            {/**
              *   #484 THE ROLES ARE ALREADY IN HAND HERE — HAND THEM DOWN.
              *
              *        This component awaited the session and refused everyone
              *        isAdmin() rejects two statements ago. Rendering the
              *        sidebar with no props sent it back to the network for the
              *        same answer, and until that returned it drew an empty nav
              *        captioned "Signed in as Moderator" over a super_admin.
              *
              *        With this the nav is right in the server's own HTML and
              *        that window does not exist. useSession still overrides it
              *        the moment it resolves, so a role revoked mid-session
              *        still takes the link away.
              */}
            <AdminSidebar initialRoles={roles} />

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
