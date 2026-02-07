import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, setDoc, getDoc, updateDoc, collection } from "firebase/firestore";

/**
 * API Route: Generate Certificate on Course Completion
 */
export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const { courseId, quizScore } = await request.json();

        if (!courseId) {
            return NextResponse.json(
                { success: false, message: "Course ID is required" },
                { status: 400 }
            );
        }

        const userId = session.user.id;

        // Get user details
        const userRef = doc(db, "users", userId);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
            return NextResponse.json(
                { success: false, message: "User not found" },
                { status: 404 }
            );
        }

        // Get course progress
        const progressRef = doc(db, "course_progress", `${userId}_${courseId}`);
        const progressDoc = await getDoc(progressRef);

        if (!progressDoc.exists()) {
            return NextResponse.json(
                { success: false, message: "Course progress not found" },
                { status: 404 }
            );
        }

        const progressData = progressDoc.data();

        // Validate course completion
        if (progressData.completionPercentage < 100 || !progressData.completed) {
            return NextResponse.json(
                { success: false, message: "Course not yet completed" },
                { status: 400 }
            );
        }

        // Check if certificate already exists
        if (progressData.certificateId) {
            return NextResponse.json({
                success: true,
                message: "Certificate already exists",
                certificateId: progressData.certificateId
            });
        }

        // TODO: Get course details for course title
        const courseTitle = "Sample Course Title"; // Replace with actual course fetch

        // Create certificate
        const certificateRef = doc(collection(db, "certificates"));
        const certificateData = {
            userId,
            userName: userDoc.data().name || userDoc.data().email,
            courseId,
            courseTitle,
            completionDate: progressData.completedAt || new Date(),
            grade: quizScore || progressData.quizScores?.[0]?.bestScore,
            issuedAt: new Date(),
            qrCodeUrl: "", // Generated on certificate page
            pdfUrl: "", // Generated on certificate page
        };

        await setDoc(certificateRef, certificateData);

        // Update course progress with certificate ID
        await updateDoc(progressRef, {
            certificateId: certificateRef.id,
            updatedAt: new Date(),
        });

        return NextResponse.json({
            success: true,
            message: "Certificate generated successfully",
            certificateId: certificateRef.id
        });
    } catch (error) {
        console.error("Failed to generate certificate:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
