import { requireSession } from "@/lib/session-guard";
import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";

export default async function AdminDashboard() {
    const sessionResult = await requireSession();
    
    if (!sessionResult.session) {
        redirect("/auth/login");
    }

    const roles = sessionResult.session.user?.roles || [];
    
    // Check if the user has a global admin role that is allowed to see the main dashboard
    const isGlobalAdmin = roles.includes("super_admin") || roles.includes("admin");
    
    if (!isGlobalAdmin) {
        // They are a module admin, redirect them to their specific silo
        if (roles.includes("wave_admin")) redirect("/admin/wave");
        if (roles.includes("cooperative_admin")) redirect("/admin/cooperatives");
        if (roles.includes("marketplace_admin")) redirect("/admin/marketplace");
        if (roles.includes("export_admin")) redirect("/admin/export");
        if (roles.includes("farm_nation_admin")) redirect("/admin/farm-nation");
        if (roles.includes("academy_admin")) redirect("/admin/academy");
        
        // If they have some other role or none, kick them back
        redirect("/dashboard");
    }

    return <DashboardClient />;
}
