export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isIssuedCertificate } from "@/lib/certificate-kind";

/**
 * API Route: Verify Certificate (Public)
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ certificateId: string }> }
) {
    try {
        const { certificateId } = await params;

        // Get certificate (Admin SDK)
        const certificateDoc = await db.collection(COLLECTIONS.CERTIFICATES).doc(certificateId).get();

        /**
         * WAVE certificates are verifiable here too.
         *
         * The platform issues credentials into two collections and this — the only
         * public verifier — looked in one. So every WAVE certificate was
         * unverifiable, and the `verificationUrl` its writer stamped onto each one
         * pointed at /wave/verify-certificate/..., a route with no page and no
         * handler anywhere in the app. A credential carrying a link that 404s is
         * worse than one carrying none: the link is the part a third party is meant
         * to trust.
         *
         * Checked second so an academy id keeps its existing single lookup, and
         * only when the first misses.
         */
        let waveDoc: Awaited<ReturnType<typeof certificateDoc.ref.get>> | null = null;
        if (!certificateDoc.exists) {
            waveDoc = await db.collection(COLLECTIONS.WAVE_CERTIFICATES).doc(certificateId).get();
        }

        /**
         *   #430 — RESOLVE BY THE NUMBER THE HOLDER WAS ACTUALLY GIVEN.
         *
         *   This looked up by DOCUMENT ID only. An academy certificate's
         *   document id is `{userId}_{courseId}`, and what the learner is shown
         *   — on the page, on the PDF and in the LinkedIn entry — is
         *   `ACAD-{year}-{course}-{user}`. So the one string a third party ever
         *   holds was the one string this endpoint could not resolve.
         *
         *   Issuing certificates (#430) without this would have fixed the count
         *   and left the verify link answering "Certificate not found" exactly
         *   as before — the fix reaching one of the places that needed it,
         *   which is the failure this whole finding is about.
         *
         *   Tried last, so an id lookup keeps its single read.
         */
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
            const numberedData = byNumberData;
            // The same issued-vs-attached rule as the id path below. A row
            // found by number is no more trusted than one found by id.
            if (!isIssuedCertificate(numberedData)) {
                return NextResponse.json(
                    { success: false, message: "Certificate not found or invalid" },
                    { status: 404 }
                );
            }
            return NextResponse.json({
                success: true,
                certificate: {
                    id: byNumberId,
                    userName: numberedData.userName,
                    courseTitle: numberedData.courseTitle,
                    completionDate: numberedData.completionDate?.toDate?.() || new Date(),
                    grade: numberedData.grade,
                    certificateNumber: numberedData.certificateNumber || certificateId,
                    programme: "academy",
                    isValid: true,
                },
            });
        }

        if (!certificateDoc.exists && !waveDoc?.exists) {
            return NextResponse.json(
                { success: false, message: "Certificate not found or invalid" },
                { status: 404 }
            );
        }

        if (waveDoc?.exists) {
            const waveData = waveDoc.data()!;
            return NextResponse.json({
                success: true,
                certificate: {
                    id: waveDoc.id,
                    // The WAVE writer's field names. Nothing in this collection is
                    // user-uploaded, so there is no issued-vs-attached question to
                    // settle here the way there is for COLLECTIONS.CERTIFICATES.
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
            });
        }

        const certData = certificateDoc.data()!;

        // This endpoint answered `isValid: true` for ANY document id in the
        // certificates collection, and uploadCertificateAction returns the id of
        // the row it creates to whoever uploaded the file. So anyone could
        // attach a PDF to their profile and have the platform publicly vouch for
        // its id as a certificate.
        //
        // Only credentials the platform issued are verifiable. Answering with
        // the same 404 an unknown id gets, because "this id exists but is not a
        // certificate" is not something a verifier needs to be told.
        if (!isIssuedCertificate(certData)) {
            return NextResponse.json(
                { success: false, message: "Certificate not found or invalid" },
                { status: 404 }
            );
        }

        const certificate = {
            id: certificateDoc.id,
            userName: certData.userName,
            courseTitle: certData.courseTitle,
            completionDate: certData.completionDate?.toDate?.() || new Date(),
            grade: certData.grade,
            isValid: true,
        };

        return NextResponse.json({
            success: true,
            certificate
        });
    } catch (error) {
        logger.error("Failed to verify certificate:", error);
        return NextResponse.json(
            { success: false, message: "Verification failed" },
            { status: 500 }
        );
    }
}
