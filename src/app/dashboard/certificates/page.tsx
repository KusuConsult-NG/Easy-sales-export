/**
 * A member's certificates — the server half. See #543 / #545 / #562.
 *
 * This was a "use client" page whose first act on mount was TWO `fetch` calls
 * back to this same application — /api/certificates and
 * /api/academy/certificates — after the page had already been rendered,
 * downloaded and hydrated. Both now read through the shared readers the routes
 * themselves use, so the rules those endpoints carry (#303's retirement filter,
 * #425's completion source, the WAVE branch's four field spellings) have one
 * definition and two callers each rather than a copy per caller.
 *
 * Reading through the shared function also removes the shape mismatch #563 was
 * about: the seeded path receives arrays, not two differently-enveloped JSON
 * bodies that a reader can get wrong.
 */

import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { readAcademyCertificates, readUploadedCertificates } from "@/lib/certificates-reader";
import CertificatesClient from "./CertificatesClient";

/**
 *   #562 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function CertificatesPage() {
    const session = await auth().catch(() => null);
    const userId = session?.user?.id;

    if (!userId) {
        //   No session resolved here: the client falls back to the two routes,
        //   which do their own requireSession and answer 401. Nothing is
        //   decided about access on this page that was not already decided
        //   there.
        return <CertificatesClient initial={null} />;
    }

    const [uploaded, academy] = await Promise.all([
        readUploadedCertificates(userId).catch((error) => {
            logger.error("[certificates] uploaded read failed; the client will fetch", error);
            return null;
        }),
        readAcademyCertificates(userId).catch((error) => {
            logger.error("[certificates] academy read failed; the client will fetch", error);
            return null;
        }),
    ]);

    /**
     * All or nothing, in ONE expression.
     *
     *   One list seeded while the other still fetches is a screen that looks
     *   loaded and is half empty — exactly what #563 looked like from the
     *   outside, and a client handed a seed stops fetching, so it is strictly
     *   worse than not seeding at all.
     *
     *   Written first as a `complete` flag AND a second `&& uploaded && academy`
     *   in the JSX, which is two guards for one rule — and mutation testing
     *   showed the consequence at once: flipping the flag from `&&` to `||`
     *   changed nothing, because the other guard still held. A rule with two
     *   homes has no home. One expression now, and the suite kills the mutant.
     */
    const initial = uploaded !== null && academy !== null
        ? { uploaded, academy: academy.certificates }
        : null;

    return <CertificatesClient initial={initial} />;
}
