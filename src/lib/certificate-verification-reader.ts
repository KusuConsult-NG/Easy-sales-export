import "server-only";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isIssuedCertificate } from "@/lib/certificate-kind";

/**
 * The public certificate verifier, defined once.
 *
 *   #564 /academy/verify/[certificateId] ASKED THIS APPLICATION FOR THIS OVER
 *        HTTP — and it is the page a third party lands on from a printed
 *        credential, so it is the one place a spinner reads as "this link is
 *        broken" rather than "this is slow".
 *
 *   The route's body moves here so the page can resolve the credential on the
 *   SERVER and arrive already showing a verdict. The route calls this too.
 *
 * ── WHAT THIS FUNCTION IS CARRYING ──────────────────────────────────────────
 *
 *   Three findings live in these thirty lines, which is exactly why they are
 *   not being copied into a page:
 *
 *     WAVE CERTIFICATES ARE VERIFIABLE HERE TOO. The platform issues into two
 *     collections and the only public verifier looked in one, so every WAVE
 *     certificate was unverifiable and the verificationUrl stamped on it
 *     pointed at a route with no handler. A credential carrying a link that
 *     404s is worse than one carrying none.
 *
 *     #430 RESOLVE BY THE NUMBER THE HOLDER WAS ACTUALLY GIVEN. The lookup was
 *     by document id — `{userId}_{courseId}` — while what the learner is shown,
 *     on the page and the PDF and in the LinkedIn entry, is
 *     `ACAD-{year}-{course}-{user}`. The one string a third party ever holds
 *     was the one string this could not resolve.
 *
 *     ONLY ISSUED CREDENTIALS ARE VERIFIABLE. This answered isValid: true for
 *     ANY document id in the certificates collection, and uploadCertificateAction
 *     hands the uploader the id of the row it creates. So anyone could attach a
 *     PDF and have the platform publicly vouch for it. A row that exists but was
 *     not issued gets the same 404 an unknown id gets, because "this id exists
 *     and is not a certificate" is not something a verifier needs to be told.
 *
 *   The lookups stay in the same ORDER for the same reason they were written
 *   that way: an academy id keeps its single read, and each further lookup runs
 *   only when the one before it missed.
 */

export type VerifiedCertificate = {
    id: string;
    userName: string;
    courseTitle: string;
    completionDate: Date;
    grade?: string;
    certificateNumber?: string | null;
    programme?: "academy" | "wave";
    isValid: true;
};

export type VerificationResult =
    | { found: true; certificate: VerifiedCertificate }
    | { found: false };

const NOT_FOUND: VerificationResult = { found: false };

export async function readCertificateVerification(
    certificateId: string,
): Promise<VerificationResult> {
    const certificateDoc = await db.collection(COLLECTIONS.CERTIFICATES).doc(certificateId).get();

    //   Checked second so an academy id keeps its existing single lookup, and
    //   only when the first misses.
    let waveDoc: Awaited<ReturnType<typeof certificateDoc.ref.get>> | null = null;
    if (!certificateDoc.exists) {
        waveDoc = await db.collection(COLLECTIONS.WAVE_CERTIFICATES).doc(certificateId).get();
    }

    //   #430 — tried last, so an id lookup keeps its single read.
    let byNumberId: string | null = null;
    let byNumberData: Record<string, any> | null = null;
    if (!certificateDoc.exists && !waveDoc?.exists) {
        const numbered = await db.collection(COLLECTIONS.CERTIFICATES)
            .where("certificateNumber", "==", certificateId)
            .limit(1)
            .get();
        if (!numbered.empty) {
            byNumberId = numbered.docs[0].id;
            byNumberData = numbered.docs[0].data();
        }
    }

    if (byNumberData) {
        //   The same issued-vs-attached rule as the id path below. A row found
        //   by number is no more trusted than one found by id.
        if (!isIssuedCertificate(byNumberData)) return NOT_FOUND;

        return {
            found: true,
            certificate: {
                id: byNumberId as string,
                userName: byNumberData.userName,
                courseTitle: byNumberData.courseTitle,
                completionDate: byNumberData.completionDate?.toDate?.() || new Date(),
                grade: byNumberData.grade,
                certificateNumber: byNumberData.certificateNumber || certificateId,
                programme: "academy",
                isValid: true,
            },
        };
    }

    if (!certificateDoc.exists && !waveDoc?.exists) return NOT_FOUND;

    if (waveDoc?.exists) {
        const waveData = waveDoc.data()!;
        return {
            found: true,
            certificate: {
                id: waveDoc.id,
                //   The WAVE writer's field names. Nothing in this collection is
                //   user-uploaded, so there is no issued-vs-attached question to
                //   settle here the way there is for COLLECTIONS.CERTIFICATES.
                userName: waveData.memberName || "",
                courseTitle: waveData.programName || "WAVE Programme",
                completionDate:
                    waveData.issuedDate?.toDate?.()
                    ?? (waveData.issuedDate ? new Date(waveData.issuedDate) : null)
                    ?? waveData.issuedAt?.toDate?.()
                    ?? new Date(),
                grade: undefined,
                certificateNumber: waveData.certificateNumber || null,
                programme: "wave",
                isValid: true,
            },
        };
    }

    const certData = certificateDoc.data()!;

    if (!isIssuedCertificate(certData)) return NOT_FOUND;

    return {
        found: true,
        certificate: {
            id: certificateDoc.id,
            userName: certData.userName,
            courseTitle: certData.courseTitle,
            completionDate: certData.completionDate?.toDate?.() || new Date(),
            grade: certData.grade,
            isValid: true,
        },
    };
}
