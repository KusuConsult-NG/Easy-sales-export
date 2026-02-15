import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, setDoc, collection } from "firebase/firestore";

/**
 * API Route: Create Quiz (Admin)
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

        // Admin role check
        if (!session.user.roles?.includes("admin")) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        const quizData = await request.json();

        // Validate required fields
        if (!quizData.title || !quizData.courseId || quizData.questions.length === 0) {
            return NextResponse.json(
                { success: false, message: "Missing required fields" },
                { status: 400 }
            );
        }

        // Create quiz document
        const quizRef = doc(collection(db, "quizzes"));
        await setDoc(quizRef, {
            ...quizData,
            createdBy: session.user.id,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        return NextResponse.json({
            success: true,
            message: "Quiz created successfully",
            quizId: quizRef.id
        });
    } catch (error) {
        logger.error("Failed to create quiz:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
