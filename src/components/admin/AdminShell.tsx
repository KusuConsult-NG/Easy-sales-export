import { redirect } from "next/navigation";
import { authErrorCodeFor } from "@/lib/auth-error-codes";
import { requireSession } from "@/lib/session-guard";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { AdminMfaGraceBanner } from "@/components/admin/AdminMfaGraceBanner";
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
        //   #927 A CODE, NOT THE PROSE. LoginForm renders only codes it knows —
        //   correctly, since arbitrary text in a URL on the password screen is a
        //   phishing hole — so the sentence this used to url-encode arrived as
        //   "Authentication failed." A suspended member read that as a typo.
        redirect(`/auth/login?error=${authErrorCodeFor(errorMessage)}`);
    }

    /**
     *   #959 THE GUARD TRAVELS WITH THE CHROME — AND NOW IT ASKS THE DATABASE.
     *
     *        The header above says "A page that draws the admin sidebar has, by
     *        construction, already refused everyone `isAdmin` rejects." True
     *        about PLACEMENT, and that was the claim being made. What it did not
     *        say, and what a reader would assume, is which `roles` those are:
     *        this line read `session.user.roles`, the two-minute-old JWT claim,
     *        while requireAdmin — the gate on every action these screens invoke
     *        — reads the row by id. So the portal could refuse an administrator
     *        that every action inside it would have admitted.
     *
     *        The owner reported exactly that, twice, and enrolling a second
     *        factor changed nothing because MFA was never what was refusing
     *        them. lib/admin-portal-roles carries the rule and the cost.
     */
    const { liveRolesForPortal } = await import("@/lib/admin-portal-roles");
    const roles = await liveRolesForPortal(sessionResult.session?.user?.id);
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
              *
              *   #959 AND THEY ARE NOW THE LIVE ONES, which makes this strictly
              *        better than it was: the nav drawn on the server is built
              *        from the row, so the client's useSession override can no
              *        longer replace a correct nav with a stale one.
              */}
            <AdminSidebar initialRoles={roles} />

            <main className="flex-1 lg:pl-64 min-h-screen transition-all">
                {/**
                  *   #939 THE ROLLOUT'S WARNING, WHICH UNTIL NOW REACHED NOBODY.
                  *
                  *        adminMfaVerdict returned `warn` for every unenrolled
                  *        administrator for fourteen days and adminMfaGate drops
                  *        every verdict that is not `enrol`, so the grace window
                  *        warned no one — and then #937 closed the gate on
                  *        administrators who had never been told it was coming.
                  *
                  *        HERE because this chrome is worn by both surfaces the
                  *        gate governs: everything under /admin, and
                  *        /loans/approve, which is not under it. A banner in
                  *        admin/layout.tsx would miss the second one, which is
                  *        exactly the bug #617 fixed about this same route.
                  *
                  *        It renders nothing for an administrator who has
                  *        enrolled.
                  *
                  *   #959 THIS USED TO SAY "the session is already in hand two
                  *        statements above, so this costs no read". That stopped
                  *        being true when the guard above started reading the
                  *        row, so it is corrected rather than left: the roles
                  *        cost ONE read for this whole request, shared with
                  *        app/admin/page.tsx through lib/current-user-doc's memo.
                  *        `mfaEnabled` is still the token's copy, which is what
                  *        middleware's own gate judges — the two agree by
                  *        construction, and the banner is advisory either way.
                  */}
                <AdminMfaGraceBanner
                    roles={roles}
                    mfaEnabled={sessionResult.session?.user?.mfaEnabled}
                />

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
