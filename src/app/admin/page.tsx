import { requireSession } from "@/lib/session-guard";
import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";
import { adminLandingPath } from "@/lib/admin-permissions";
import { liveRolesForPortal } from "@/lib/admin-portal-roles";

export default async function AdminDashboard() {
    const sessionResult = await requireSession();

    if (!sessionResult.session) {
        redirect("/auth/login");
    }

    /**
     *   #959 THE ROLES COME FROM THE DATABASE, NOT FROM THE TOKEN.
     *
     *        This read `sessionResult.session.user?.roles`, a claim minted at
     *        sign-in from whatever getUserProfile returned and refreshed on a
     *        two-minute cycle. When it disagrees with the row every admin gate
     *        reads, `adminLandingPath` returns null for an administrator and
     *        this line sends them to the member dashboard — the bounce the owner
     *        reported, and the same shape #458 recorded when two orderings of
     *        this rule disagreed. It is now the same ROW as well as the same rule.
     *
     *        Shared with AdminShell through lib/current-user-doc, so the layout
     *        and this page cost ONE read between them, not two.
     */
    const roles = await liveRolesForPortal(sessionResult.session.user?.id);

    /**
     *   #458 THIS RESTATED THE LANDING RULE THAT actions/auth.ts ALREADY
     *        STATES, IN A DIFFERENT ORDER, AND WITH A COMMENT THAT DESCRIBED
     *        BEHAVIOUR NEITHER OF THEM HAD.
     *
     *        Somebody holding academy_admin and wave_admin was sent to Academy
     *        by login and to WAVE by this page. And a holder of the legacy
     *        `superadmin` spelling — which login honours as a global admin —
     *        matched nothing here and was bounced to /dashboard on arrival.
     *
     *        adminLandingPath is the one rule, and it resolves the legacy
     *        spelling before judging.
     */
    const landing = adminLandingPath(roles);

    if (landing === null) {
        // Not an admin at all.
        redirect("/dashboard");
    }
    if (landing !== "/admin") {
        // A module admin: their silo is their home.
        redirect(landing);
    }

    return <DashboardClient />;
}
