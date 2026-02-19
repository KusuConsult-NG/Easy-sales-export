/**
 * Dashboard Layout
 * 
 * Server-side auth guard for the user dashboard.
 * Ensures unauthenticated users are redirected to login BEFORE the page renders.
 */

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();

    if (!session?.user) {
        redirect("/auth/login?callbackUrl=/dashboard");
    }

    return <>{children}</>;
}
