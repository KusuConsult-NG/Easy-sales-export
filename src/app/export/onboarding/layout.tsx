import { requireHubRegistration } from "@/lib/hub-guard";

export default async function ExportOnboardingLayout({ children }: { children: React.ReactNode }) {
    await requireHubRegistration();
    return <>{children}</>;
}
