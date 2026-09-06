import { requireSession } from "@/lib/session-guard";
import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";
import { adminLandingPath } from "@/lib/admin-permissions";

export default async function AdminDashboard() {
    const sessionResult = await requireSession();
    
    if (!sessionResult.session) {
        redirect("/auth/login");
    }

    const roles = sessionResult.session.user?.roles || [];

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
