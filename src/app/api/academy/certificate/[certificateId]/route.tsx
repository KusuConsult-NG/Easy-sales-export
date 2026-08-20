
import { NextRequest, NextResponse } from "next/server";
import { renderToStream } from "@react-pdf/renderer";
import { CertificateDocument } from "@/components/pdf/CertificateDocument";
import { db } from "@/lib/firebase-admin"; // Use Admin SDK for security
import { COLLECTIONS } from "@/lib/types/firestore";
import { requireSession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import {
    academyCertificateNumber,
    completionDateOf,
    hasEarnedAcademyCertificate,
} from "@/lib/academy-certificate";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ certificateId: string }> }
) {
    const { certificateId } = await params;

    try {
        // 1. Fetch Certificate/Course Data (Mocking specific logic for MVP if DB schema is complex, but let's try real fetch)
        // In a real app, we'd look up the 'enrollment' or 'progress' valid for this user/course.
        // For "High Fidelity" MVP, we will rely on the Course ID being passed and fetching generic course info + user info from session if needed,
        // BUT better: We should have a 'certificates' collection. 
        // IF NOT: We reconstruct it from Course + User.

        // Let's assume the ID passed is the COURSE ID for now (as per the Page implementation).
        const courseId = certificateId;

        // Fetch course — must use ACADEMY_COURSES collection, not COURSES
        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();
        if (!courseDoc.exists) {
            return NextResponse.json({ error: "Course not found" }, { status: 404 });
        }
        const courseData = courseDoc.data();


        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json({ error: "Authentication required" }, { status: 401 });
        }

        // Use name from session to prevent spoofing
        const studentName = session.user.name || "Valued Student";

        // The course has to have been FINISHED.
        //
        // This route checked that the course exists and that somebody is signed
        // in, and then rendered a completion certificate. Any signed-in user
        // could GET /api/academy/certificate/{anyCourseId} and download a
        // certificate for a course they had never opened, let alone completed.
        //
        // The certificate PAGE does gate on it — it refuses to render below
        // `progress.overallProgress !== 100` — but that is a client-side check
        // on a different surface. This route is reachable on its own, and it is
        // the one that produces the PDF a third party is shown.
        //
        // The same bar as the page, from one place, so the download cannot
        // disagree with the screen that offered it.
        const progressDoc = await db
            .doc(`user_progress/${session.user.id}/courses/${courseId}`)
            .get();
        const progressData = progressDoc.exists ? progressDoc.data() : null;

        if (!hasEarnedAcademyCertificate(progressData)) {
            return NextResponse.json(
                { error: "Course not completed — no certificate is available for it" },
                { status: 403 }
            );
        }

        // The completion date, from the record rather than from the URL.
        //
        // `searchParams.get("date")` put the date printed on the certificate in
        // the hands of whoever requested it — the same spoofing the studentName
        // above was fixed for, on the field beside it.
        const completedAt = completionDateOf(progressData?.completedAt);
        const date = (completedAt ?? new Date()).toISOString().split('T')[0];

        // Construct base URL for fetching assets (like logo.jpg) in the PDF renderer
        const protocol = req.headers.get("x-forwarded-proto") || "http";
        const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
        const baseUrl = `${protocol}://${host}`;

        // 2. Generate PDF Stream
        const stream = await renderToStream(
            <CertificateDocument
                studentName={studentName}
                courseTitle={courseData?.title || "Export Mastery Course"}
                completionDate={date}
                // The same number the page and the LinkedIn entry show.
                //
                // This was `CRT-{6 of courseId}-{last digits of Date.now()}`,
                // which changed on every download — so the PDF a learner saved
                // carried a different number from the page they saved it from,
                // and from the one they had already added to LinkedIn.
                certificateId={academyCertificateNumber(session.user.id, courseId, completedAt)}
                instructor={courseData?.instructor || "Easy Sales Academy"}
                baseUrl={baseUrl}
            />
        );

        // 3. Return stream
        return new NextResponse(stream as unknown as BodyInit, {
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="Certificate-${courseId}.pdf"`,
            },
        });

    } catch (error) {
        logger.error("Certificate Generation Error:", error);
        return NextResponse.json({ error: "Failed to generate certificate" }, { status: 500 });
    }
}
