export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
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
        const session = await auth();
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

        // 1. Academy course completions
        const enrollSnap = await db
            .collection(COLLECTIONS.COURSE_ENROLLMENTS)
            .where("userId", "==", userId)
            .where("status", "==", "completed")
            .get();

        for (const doc of enrollSnap.docs) {
            const d = doc.data();
            if (d.certificateIssuedAt || d.completedAt) {
                certificates.push({
                    id: doc.id,
                    courseName: d.courseName || d.courseTitle || "Academy Course",
                    courseId: d.courseId || "",
                    issuedAt:
                        d.certificateIssuedAt?.toDate?.()?.toISOString() ??
                        d.completedAt?.toDate?.()?.toISOString() ??
                        new Date().toISOString(),
                    certificateUrl: d.certificateUrl || undefined,
                    grade: d.finalScore !== undefined ? `${d.finalScore}%` : d.grade || undefined,
                    source: "academy",
                });
            }
        }

        // 2. WAVE program certificates
        const waveSnap = await db.collection(COLLECTIONS.WAVE_CERTIFICATES).where("userId", "==", userId).get();

        for (const doc of waveSnap.docs) {
            const d = doc.data();
            certificates.push({
                id: doc.id,
                courseName: d.type === "completion" ? "WAVE Export Programme" : `WAVE – ${d.type}`,
                courseId: "wave",
                issuedAt:
                    d.issuedAt?.toDate?.()?.toISOString() ??
                    (typeof d.issuedAt === "string" ? d.issuedAt : new Date().toISOString()),
                certificateUrl: d.pdfUrl || d.certificateUrl || undefined,
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
