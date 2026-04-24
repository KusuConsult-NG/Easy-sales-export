import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session-guard";

export const dynamic = 'force-dynamic';

export default async function MarketplaceDashboardRedirect() {
    const { session } = await requireSession();
    
    if (!session || !session.user) {
        redirect("/auth/login?callbackUrl=/marketplace/dashboard");
    }

    const roles = session.user.roles || [];
    
    // If they are a seller, take them to seller dashboard
    if (roles.includes("seller")) {
        redirect("/marketplace/seller/dashboard");
    }
    
    // Otherwise, assume buyer or general user
    redirect("/marketplace/buyer/dashboard");
}
