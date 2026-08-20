export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { isIssuedCertificate } from "@/lib/certificate-kind";
import {
    academyCertificateNumber,
    completionDateOf,
    hasEarnedAcademyCertificate,
} from "@/lib/academy-certificate";

/**
 * GET /api/academy/certificates
 * Returns all Academy-earned certificates for the logged-in user.
 *
 * Reads from:
 *   - certificates (rows the platform ISSUED — see lib/certificate-kind)
 *   - user_progress/{uid}/courses (courses finished but not yet issued a row)
 *   - wave_certificates (if user earned a WAVE cert)
 *
 * Supports cursor-based pagination:
 *   ?cursor=<ISO timestamp of last item's issuedAt>
 *   ?limit=<number, default 20, max 50>
 *
 * Response: { success, data: { certificates }, meta: { cursor, hasMore } }
 */
export async function GET(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, data: null, error: "Unauthorized", meta: { cursor: null, hasMore: false } },
                { status: 401 }
            );
        }

        const userId = session.user.id;
        const { searchParams } = new URL(request.url);
        const rawLimit = parseInt(searchParams.get("limit") || "20");
        const limit = Math.min(Math.max(rawLimit, 1), 50);
        const cursorParam = searchParams.get("cursor");

        type Certificate = {
            id: string;
            courseName: string;
            courseId: string;
            issuedAt: string;
            certificateUrl?: string;
            /**
             * Where the certificate can be OPENED, decided here rather than
             * guessed by the caller. /dashboard/certificates built this itself
             * as `/academy/certificate/${cert.id}` — and that route reads its
             * `[certificateId]` segment as a COURSE id, so a document id sent
             * the learner to a page that could not resolve a course. WAVE rows
             * have no such page, and now say so by omitting this rather than by
             * linking to `/academy/certificate/wave`.
             */
            viewUrl?: string;
            grade?: string;
            source: "academy" | "wave";
        };

        const certificates: Certificate[] = [];

        /**
         * 1. Academy course completions
         *
         * THIS QUERIED A STATE NOTHING EVER WROTE.
         *
         *     .collection(COURSE_ENROLLMENTS)
         *     .where("userId", "==", userId)
         *     .where("status", "==", "completed")
         *     ...
         *     if (d.certificateIssuedAt || d.completedAt)
         *
         * course_enrollments has exactly two writers — enrollInCourse in
         * course-actions.ts and autoEnrollPaidUser in _ac_enrollment.ts — and
         * both write `status: "active"`. Nothing anywhere updates that field
         * afterwards, and `certificateIssuedAt` appears in this codebase only
         * on the line above: no writer, no other reader. So this branch
         * returned nothing, for everybody, always, and the Academy tab of
         * /dashboard/certificates read "No Academy certificates yet" for a
         * learner who had finished every course on the platform.
         *
         * It is the same defect as the WAVE branch directly below, whose own
         * comment records four field names none of which matched its writer.
         * That half was found and fixed; this half, ten lines above it, was
         * left.
         *
         * WHERE A COMPLETION ACTUALLY LIVES
         * ---------------------------------
         * Two places, and both are read here.
         *
         *   COLLECTIONS.CERTIFICATES   rows the platform ISSUED. This is the
         *                              store /api/academy/dashboard counts as
         *                              `certificatesEarned` and
         *                              /api/academy/verify/{id} verifies, both
         *                              through isIssuedCertificate — the same
         *                              predicate used here, because
         *                              uploadCertificateAction writes
         *                              user-attached files into this collection
         *                              too.
         *
         *   user_progress/{uid}/courses   the learner's own progress record.
         *                              lib/academy-certificate.ts states
         *                              plainly that nothing currently writes an
         *                              issued row for an academy COURSE, and
         *                              deliberately leaves WHEN to persist one
         *                              as a product decision. So today every
         *                              real academy certificate exists only
         *                              here — and /academy/certificate/{courseId}
         *                              renders it, and
         *                              /api/academy/certificate/{courseId}
         *                              prints it as a PDF, both derived from
         *                              this record.
         *
         * Deriving the LIST the same way those two screens derive the
         * CERTIFICATE persists nothing and decides nothing; it makes the page
         * whose job is to list them list the ones that exist. An issued row
         * wins over a derived one for the same course, because it carries a
         * real file to download.
         *
         * hasEarnedAcademyCertificate is the shared 100% bar, and
         * academyCertificateNumber is the stable per-learner number the page,
         * the PDF and the LinkedIn entry already agree on — so the id shown
         * here is the credential number rather than a database row id.
         */
        const [issuedSnap, progressSnap] = await Promise.all([
            db.collection(COLLECTIONS.CERTIFICATES).where("userId", "==", userId).get(),
            db.collection(`user_progress/${userId}/courses`).get(),
        ]);

        /** One certificate per course, issued rows taking precedence. */
        const academyByCourse = new Map<string, Certificate>();

        for (const doc of issuedSnap.docs) {
            const d = doc.data();
            // Uploaded files live in this collection as well, and are not
            // credentials this platform vouches for.
            if (!isIssuedCertificate(d)) continue;

            const courseId = String(d.courseId ?? "");
            if (!courseId) continue;

            const issued = completionDateOf(d.issuedAt ?? d.completionDate ?? d.createdAt);
            academyByCourse.set(courseId, {
                id: d.certificateNumber || doc.id,
                courseName: d.courseTitle || d.courseName || "Academy Course",
                courseId,
                // Only when the row genuinely carries no date, for the same
                // reason the WAVE branch below does it: defaulting to "now"
                // makes every certificate look freshly issued.
                issuedAt: issued?.toISOString() ?? new Date(0).toISOString(),
                certificateUrl: d.certificateUrl || undefined,
                grade: d.grade || (d.finalScore !== undefined ? `${d.finalScore}%` : undefined),
                viewUrl: `/academy/certificate/${courseId}`,
                source: "academy",
            });
        }

        const earned = progressSnap.docs.filter(
            (doc) => !academyByCourse.has(doc.id) && hasEarnedAcademyCertificate(doc.data()),
        );
        const earnedCourses = await Promise.all(
            earned.map((doc) => db.collection(COLLECTIONS.ACADEMY_COURSES).doc(doc.id).get()),
        );

        earned.forEach((progressDoc, idx) => {
            const courseDoc = earnedCourses[idx];
            // A progress row whose course has been deleted names nothing.
            if (!courseDoc.exists) return;

            const courseId = progressDoc.id;
            const completedAt = completionDateOf(progressDoc.data()?.completedAt);
            academyByCourse.set(courseId, {
                id: academyCertificateNumber(userId, courseId, completedAt),
                courseName: courseDoc.data()?.title || "Academy Course",
                courseId,
                issuedAt: completedAt?.toISOString() ?? new Date(0).toISOString(),
                // The PDF is generated on request rather than stored.
                certificateUrl: `/api/academy/certificate/${courseId}`,
                viewUrl: `/academy/certificate/${courseId}`,
                source: "academy",
            });
        });

        certificates.push(...academyByCourse.values());

        /**
         * 2. WAVE program certificates
         *
         * FOUR FIELD NAMES, NONE OF THEM MATCHING THE WRITER
         * --------------------------------------------------
         * This queried `userId` and read `type`, `issuedAt` and `certificateUrl`.
         * _wv_certificates.ts writes `memberId`, `certificateType`, `issuedDate`
         * and a `verificationUrl`. Every single field disagreed, so:
         *
         *   - the query matched nothing, and this branch returned no rows at all;
         *   - had it matched, `courseName` would have read "WAVE – undefined";
         *   - and `issuedAt` would have fallen through to `new Date()`, dating
         *     every certificate today.
         *
         * The writer now stores both spellings, so new rows are found either way.
         * Existing rows carry only the original names — hence the `in` over both
         * fields here, and the fallbacks below. Neither half is dropped, because
         * the member's own certificates page reads the writer's names and the rows
         * predate the fix.
         */
        const [waveByUserId, waveByMemberId] = await Promise.all([
            db.collection(COLLECTIONS.WAVE_CERTIFICATES).where("userId", "==", userId).get(),
            db.collection(COLLECTIONS.WAVE_CERTIFICATES).where("memberId", "==", userId).get(),
        ]);

        const seenWaveIds = new Set<string>();
        const waveDocs = [...waveByUserId.docs, ...waveByMemberId.docs].filter((doc) => {
            if (seenWaveIds.has(doc.id)) return false;
            seenWaveIds.add(doc.id);
            return true;
        });

        for (const doc of waveDocs) {
            const d = doc.data();
            const kind = d.certificateType ?? d.type ?? "";
            const issued = d.issuedDate ?? d.issuedAt ?? d.createdAt ?? null;

            certificates.push({
                id: doc.id,
                courseName: d.programName
                    || (kind === "completion" ? "WAVE Export Programme" : kind ? `WAVE – ${kind}` : "WAVE Programme"),
                courseId: "wave",
                issuedAt:
                    issued?.toDate?.()?.toISOString()
                    ?? (typeof issued === "string" ? issued : null)
                    ?? (issued instanceof Date ? issued.toISOString() : null)
                    // Only when the row genuinely carries no date. Defaulting to
                    // "now" silently made every certificate look freshly issued.
                    ?? new Date(0).toISOString(),
                certificateUrl: d.pdfUrl || d.certificateUrl || d.verificationUrl || undefined,
                grade: d.grade || undefined,
                source: "wave",
            });
        }

        // Sort by most recent first
        certificates.sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime());

        // Apply cursor-based pagination (cursor = issuedAt of last item)
        let paginated = certificates;
        if (cursorParam) {
            const cursorTime = new Date(cursorParam).getTime();
            const idx = certificates.findIndex(c => new Date(c.issuedAt).getTime() < cursorTime);
            paginated = idx >= 0 ? certificates.slice(idx, idx + limit + 1) : [];
        } else {
            paginated = certificates.slice(0, limit + 1);
        }

        const hasMore = paginated.length > limit;
        const page = hasMore ? paginated.slice(0, limit) : paginated;
        const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].issuedAt : null;

        return NextResponse.json({
            success: true,
            data: { certificates: page },
            meta: { cursor: nextCursor, hasMore },
        });
    } catch (error) {
        logger.error("GET /api/academy/certificates error:", error);
        return NextResponse.json(
            { success: false, data: null, error: "Failed to load certificates", meta: { cursor: null, hasMore: false } },
            { status: 500 }
        );
    }
}
