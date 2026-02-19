/**
 * WAVE Application Layout
 * 
 * Server-side auth guard for the WAVE application form.
 * Ensures unauthenticated users are redirected to login BEFORE the page renders,
 * preventing the client-side useSession() race condition where the session
 * briefly flashes "unauthenticated" before the JWT cookie is recognized.
 * 
 * This follows the same pattern as the admin layout (admin/layout.tsx).
 */

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function WaveApplicationLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();

    // Server-side auth check — redirect to login if not authenticated
    if (!session?.user) {
        redirect("/auth/login?callbackUrl=/wave/application");
    }

    return <>{children}</>;
}
