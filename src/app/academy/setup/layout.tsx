/**
 * Academy Setup Layout
 * 
 * Server-side auth guard for the academy setup/onboarding page.
 * Ensures unauthenticated users are redirected to login BEFORE the page renders,
 * preventing the client-side useSession() race condition.
 */

import { requireHubRegistration } from "@/lib/hub-guard";

export default async function AcademySetupLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    await requireHubRegistration();

    return <>{children}</>;
}
