import { requireHubRegistration } from "@/lib/hub-guard";

export default async function FarmNationOnboardingLayout({ children }: { children: React.ReactNode }) {
    await requireHubRegistration();
    return <>{children}</>;
}
