import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session-guard";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";

/**
 * The admin portal's chrome: the sidebar, the guard, and the content column.
 *
 *   #617 A SCREEN IN THE ADMIN SIDEBAR THAT DID NOT GET THE ADMIN SIDEBAR.
 *
 *        In Next.js the layout comes from the URL, not from the link that was
 *        clicked. `src/app/admin/layout.tsx` draws this chrome for everything
 *        under /admin — and "Business Loans" in that same sidebar points at
 *        /loans/approve, which is not under /admin and has no layout of its own.
 *        So it fell through to the root layout and an administrator following an
 *        admin link arrived at a screen wearing the MEMBER chrome: Messages,
 *        profile, log out, their own email address, and no way back into the
 *        portal except the browser's back button.
 *
 *        #384 wired that link and recorded a deliberate decision not to move the
 *        route: "moving a route to fix a missing link is a change with more ways
 *        to go wrong than the one being fixed." That was sound reasoning about
 *        the LINK. It did not consider that in this framework a route's POSITION
 *        chooses its layout, so wiring the link made the screen reachable and
 *        left it dressed as somebody else's.
 *
 *   WHY A COMPONENT RATHER THAN A SECOND LAYOUT
 *
 *        The obvious fix is to copy admin/layout.tsx into loans/approve/. That
 *        is TWO HAND-MAINTAINED COPIES OF ONE CONTRACT — the defect this audit
 *        keeps finding, most recently in its own test files — and the copy that
 *        drifts would be the one nobody looks at. The guard, the sidebar and the
 *        column are defined once, here, and both layouts render it.
 *
 *        THE GUARD TRAVELS WITH THE CHROME, which is the part that matters most.
 *        A page that draws the admin sidebar has, by construction, already
 *        refused everyone `isAdmin` rejects. The two cannot come apart.
 */
export default async function AdminShellContent({ children }: { children: React.ReactNode }) {
    const sessionResult = await requireSession();

    if (!sessionResult.session) {
        const errorMessage = sessionResult.error?.error || "Authentication required";
        redirect(`/auth/login?error=${encodeURIComponent(errorMessage)}`);
    }

    const roles = sessionResult.session?.user?.roles || [];
    const { isAdmin } = await import("@/lib/admin-permissions");

    if (!isAdmin(roles)) {
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

            <main className="flex-1 lg:pl-64 min-h-screen transition-all">
                <div className="w-full">
                    {children}
                </div>
            </main>
        </div>
    );
}

/** The shell with its error boundary — what a layout should render. */
export function AdminShell({ children }: { children: React.ReactNode }) {
    return (
        <ErrorBoundary>
            <AdminShellContent>{children}</AdminShellContent>
        </ErrorBoundary>
    );
}
