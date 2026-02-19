/**
 * Cooperatives Payment Layout
 * 
 * Server-side auth guard for the cooperatives payment page.
 * Ensures unauthenticated users are redirected to login BEFORE the page renders,
 * preventing the client-side useSession() race condition.
 */

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function CooperativesPaymentLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();

    if (!session?.user) {
        redirect("/auth/login?callbackUrl=/cooperatives/payment");
    }

    return <>{children}</>;
}
