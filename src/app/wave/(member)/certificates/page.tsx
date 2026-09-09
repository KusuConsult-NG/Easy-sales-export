/**
 * WAVE certificates — the server half. See #543 / #545.
 */

import { getCurrentUserCertificatesAction } from "@/app/actions/wave";
import WaveCertificatesClient from "./WaveCertificatesClient";
import { seedOrNull } from "@/lib/server-seed";

/**
 *   #551 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function CertificatesPage() {
    const initial = seedOrNull(
        "wave certificates", await getCurrentUserCertificatesAction().catch(() => null),
    ) as any[] | null;

    return <WaveCertificatesClient initial={initial} />;
}
