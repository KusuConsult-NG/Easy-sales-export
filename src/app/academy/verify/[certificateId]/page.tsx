/**
 * Public certificate verification — the server half. See #543 / #545 / #564.
 *
 * THIS IS THE PAGE A THIRD PARTY LANDS ON FROM A PRINTED CREDENTIAL. It was a
 * "use client" page that fetched its own application's verify route on mount,
 * so an employer following a link from a CV got a spinner first — and on a
 * verification page a spinner reads as "this link is broken", which is exactly
 * the doubt the credential exists to remove.
 *
 * It resolves on the server now and arrives with a verdict, through the same
 * reader the route uses: WAVE certificates verifiable too, #430's
 * resolve-by-number, and only credentials the platform ISSUED.
 *
 * A resolved "not found" is seeded as an answer. Only a FAILED read seeds null,
 * and then the client asks over HTTP exactly as it did before — a page that
 * could not check must not say "invalid".
 */

import { readCertificateVerification } from "@/lib/certificate-verification-reader";
import { logger } from "@/lib/logger";
import CertificateVerificationClient from "./CertificateVerificationClient";

/**
 *   #564 EXPLICITLY DYNAMIC — a credential's validity is not a build-time fact.
 */
export const dynamic = "force-dynamic";

export default async function CertificateVerificationPage({
    params,
}: {
    params: Promise<{ certificateId: string }>;
}) {
    const { certificateId } = await params;

    const initial = await readCertificateVerification(certificateId).catch((error) => {
        logger.error("[verify] read failed; the client will fetch instead", error);
        return null;
    });

    return (
        <CertificateVerificationClient
            certificateId={certificateId}
            initial={initial as any}
        />
    );
}
