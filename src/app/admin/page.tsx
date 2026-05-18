import { requireSession } from "@/lib/session-guard";
import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";

export default async function AdminDashboard() {
    const sessionResult = await requireSession();
    
    if (!sessionResult.session) {
        redirect("/auth/login");
    }

    const roles = sessionResult.session.user?.roles || [];
    
    // Strict Silo Isolation: If a user has a module admin role, they are locked to that silo,
    // EVEN IF they are also granted super_admin or admin rights (as per user requirements).
    const isWaveAdmin = roles.includes("wave_admin");
    const isCoopAdmin = roles.includes("cooperative_admin");
    const isMktAdmin = roles.includes("marketplace_admin");
    const isExportAdmin = roles.includes("export_admin");
    const isFarmAdmin = roles.includes("farm_nation_admin");
    const isAcadAdmin = roles.includes("academy_admin");

    const isModuleAdmin = isWaveAdmin || isCoopAdmin || isMktAdmin || isExportAdmin || isFarmAdmin || isAcadAdmin;

    if (isModuleAdmin) {
        // They are a module admin, redirect them to their specific silo
        if (isWaveAdmin) redirect("/admin/wave");
        if (isCoopAdmin) redirect("/admin/cooperatives");
        if (isMktAdmin) redirect("/admin/marketplace");
        if (isExportAdmin) redirect("/admin/export");
        if (isFarmAdmin) redirect("/admin/farm-nation");
        if (isAcadAdmin) redirect("/admin/academy");
    }

    // Check if the user has a global admin role that is allowed to see the main dashboard
    const isGlobalAdmin = roles.includes("super_admin") || roles.includes("admin");
    
    if (!isGlobalAdmin) {
        // If they have some other role or none, kick them back
        redirect("/dashboard");
    }

    return <DashboardClient />;
}
