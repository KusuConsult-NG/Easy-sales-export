/**
 * Cooperatives Onboarding Layout
 * 
 * Server-side auth guard for the cooperatives onboarding form.
 * Ensures unauthenticated users are redirected to login BEFORE the page renders,
 * preventing the client-side useSession() race condition.
 */

import { requireHubRegistration } from "@/lib/hub-guard";

export default async function CooperativesOnboardingLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    await requireHubRegistration();

    return <>{children}</>;
}
