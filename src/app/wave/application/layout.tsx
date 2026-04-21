import { requireHubRegistration } from "@/lib/hub-guard";

export default async function WaveApplicationLayout({ children }: { children: React.ReactNode }) {
    await requireHubRegistration();
    return <>{children}</>;
}
