export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";

/**
 * GET /api/academy/certificates
 * Returns all Academy-earned certificates for the logged-in user.
 *
 * Reads from:
 *   - course_enrollments (status=completed, certificateIssuedAt set)
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
            grade?: string;
            source: "academy" | "wave";
        };

        const certificates: Certificate[] = [];

        /**
         * 1. Academy course completions
         *
         *   #425 THIS ASKED FOR A STATUS NOTHING WRITES, SO THE ACADEMY HALF OF
         *   EVERY LEARNER'S CERTIFICATE LIST WAS EMPTY.
         *
         *   It queried course_enrollments for `status == "completed"`. Both
         *   writers of that collection — enrollInCourse and autoEnrollPaidUser —
         *   write `status: 'active'`, and NOTHING anywhere moves it on. Checked
         *   for every write shape across src.
         *
         *   Completion is not stored there at all. completeCourse writes it to
         *   course_progress/{userId}_{courseId} as `completed: true` with a
         *   `completedAt`, and generateCourseCertificate reads that same
         *   document. So a learner could finish a course, be issued a
         *   certificate, and open a certificates page that said they had none.
         *
         *   This is the SAME DEFECT the WAVE half of this file already carries a
         *   note about — a query whose field names no writer produces. That one
         *   was found and fixed; this one, thirty lines above it, was not.
         *   #420's class: a reader keyed on a state nothing writes.
         *
         *   Read from where completion is written. The enrolment rows are still
         *   consulted below for any that DO carry the old shape — legacy,
         *   imported, or written by something added later — so nothing a learner
         *   already has is dropped.
         */
        const progressSnap = await db
            .collection(COLLECTIONS.COURSE_PROGRESS)
            .where("userId", "==", userId)
            .where("completed", "==", true)
            .get();

        /** Course titles, for rows that do not carry one. */
        const titleFor = new Map<string, string>();
        const courseIds = [...new Set(
            progressSnap.docs.map((d) => String(d.data()?.courseId ?? "")).filter(Boolean),
        )];
        await Promise.all(courseIds.map(async (id) => {
            try {
                const c = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(id).get();
                const t = c.exists ? c.data()?.title : null;
                if (t) titleFor.set(id, String(t));
            } catch {
                // A title we cannot read is not a reason to hide a certificate
                // the learner earned. It falls back to the generic name below.
            }
        }));

        const seenCourseIds = new Set<string>();

        for (const doc of progressSnap.docs) {
            const d = doc.data();
            const courseId = String(d.courseId ?? "");
            seenCourseIds.add(courseId);
            certificates.push({
                id: doc.id,
                courseName: d.courseName || d.courseTitle || titleFor.get(courseId) || "Academy Course",
                courseId,
                issuedAt:
                    d.certificateIssuedAt?.toDate?.()?.toISOString() ??
                    d.completedAt?.toDate?.()?.toISOString() ??
                    // Never "now": that dated every certificate today, which is
                    // the fault the WAVE branch below records having had.
                    new Date(0).toISOString(),
                certificateUrl: d.certificateUrl || undefined,
                grade: d.finalScore !== undefined ? `${d.finalScore}%` : d.grade || undefined,
                source: "academy",
            });
        }

        // And any enrolment row that really does carry the completed shape.
        // Nothing writes it today; a row that has it is not discarded.
        const enrollSnap = await db
            .collection(COLLECTIONS.COURSE_ENROLLMENTS)
            .where("userId", "==", userId)
            .where("status", "==", "completed")
            .get();

        for (const doc of enrollSnap.docs) {
            const d = doc.data();
            // Not a second entry for a course the progress row already covered.
            if (seenCourseIds.has(String(d.courseId ?? ""))) continue;
            if (d.certificateIssuedAt || d.completedAt) {
                certificates.push({
                    id: doc.id,
                    courseName: d.courseName || d.courseTitle || "Academy Course",
                    courseId: d.courseId || "",
                    issuedAt:
                        d.certificateIssuedAt?.toDate?.()?.toISOString() ??
                        d.completedAt?.toDate?.()?.toISOString() ??
                        new Date(0).toISOString(),
                    certificateUrl: d.certificateUrl || undefined,
                    grade: d.finalScore !== undefined ? `${d.finalScore}%` : d.grade || undefined,
                    source: "academy",
                });
            }
        }

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
