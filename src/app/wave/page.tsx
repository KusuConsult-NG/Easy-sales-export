import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkModuleAccess } from "@/lib/module-access-check";

export default async function WAVEPage() {
    const session = await auth();
    
    if (session?.user?.id) {
        const roles = session.user.roles || [];
        const hasAccess = await checkModuleAccess(session.user.id, roles as any, "wave");
        
        if (hasAccess) {
            redirect("/wave/dashboard");
        }
        
        const serviceRegistrations = (session.user as any).serviceRegistrations || {};
        const waveRegStatus = serviceRegistrations.wave?.status;
        if (waveRegStatus === "pending" || waveRegStatus === "under_review") {
            redirect("/wave/application/review-pending");
        }
    }
    
    redirect("/wave/landing");
}
