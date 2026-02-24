import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { logger } from "@/lib/logger";

/**
 * GET /api/academy/certificates
 * Returns all Academy-earned certificates for the logged-in user.
 * Reads from:
 *   - course_enrollments (status=completed, certificateIssuedAt set)
 *   - wave_certificates (if user earned a WAVE cert)
 */
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        const userId = session.user.id;
        const certificates: Array<{
            id: string;
            courseName: string;
            courseId: string;
            issuedAt: string;
            certificateUrl?: string;
            grade?: string;
            source: "academy" | "wave";
        }> = [];

        // 1. Academy course completions
        const enrollSnap = await db.collection("course_enrollments")
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
                    issuedAt: (d.certificateIssuedAt || d.completedAt)?.toDate?.()?.toISOString() ?? new Date().toISOString(),
                    certificateUrl: d.certificateUrl || undefined,
                    grade: d.grade || d.finalScore ? `${d.finalScore ?? ""}%` : undefined,
                    source: "academy",
                });
            }
        }

        // 2. WAVE program certificates
        const waveSnap = await db.collection("wave_certificates")
            .where("userId", "==", userId)
            .get();

        for (const doc of waveSnap.docs) {
            const d = doc.data();
            certificates.push({
                id: doc.id,
                courseName: d.type === "completion" ? "WAVE Export Programme" : `WAVE – ${d.type}`,
                courseId: "wave",
                issuedAt: d.issuedAt?.toDate?.()?.toISOString() ?? d.issuedAt ?? new Date().toISOString(),
                certificateUrl: d.pdfUrl || d.certificateUrl || undefined,
                grade: d.grade || undefined,
                source: "wave",
            });
        }

        // Sort by most recent first
        certificates.sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime());

        return NextResponse.json({ success: true, certificates });
    } catch (error) {
        logger.error("GET /api/academy/certificates error:", error);
        return NextResponse.json({ success: false, error: "Failed to load certificates" }, { status: 500 });
    }
}
