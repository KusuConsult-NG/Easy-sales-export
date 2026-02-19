/**
 * Academy Setup Layout
 * 
 * Server-side auth guard for the academy setup/onboarding page.
 * Ensures unauthenticated users are redirected to login BEFORE the page renders,
 * preventing the client-side useSession() race condition.
 */

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function AcademySetupLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();

    if (!session?.user) {
        redirect("/auth/login?callbackUrl=/academy/setup");
    }

    return <>{children}</>;
}
