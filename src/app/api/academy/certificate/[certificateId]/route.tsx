
import { NextRequest, NextResponse } from "next/server";
import { renderToStream } from "@react-pdf/renderer";
import { CertificateDocument } from "@/components/pdf/CertificateDocument";
import { db } from "@/lib/firebase-admin"; // Use Admin SDK for security
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";

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

        // Fetch course
        const courseDoc = await db.collection("courses").doc(courseId).get();
        if (!courseDoc.exists) {
            return NextResponse.json({ error: "Course not found" }, { status: 404 });
        }
        const courseData = courseDoc.data();


        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Authentication required" }, { status: 401 });
        }

        // Use name from session to prevent spoofing
        const studentName = session.user.name || "Valued Student";
        const { searchParams } = new URL(req.url);
        const date = searchParams.get("date") || new Date().toISOString().split('T')[0];

        // 2. Generate PDF Stream
        const stream = await renderToStream(
            <CertificateDocument
                studentName={studentName}
                courseTitle={courseData?.title || "Export Mastery Course"}
                completionDate={date}
                certificateId={`CRT-${courseId.substring(0, 6).toUpperCase()}-${Date.now().toString().substring(9)}`
                }
                instructor={courseData?.instructor || "Easy Sales Academy"}
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
