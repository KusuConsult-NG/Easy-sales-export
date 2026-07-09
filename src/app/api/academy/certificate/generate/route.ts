export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";

/**
 * API Route: Generate Certificate on Course Completion
 */
export async function POST(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
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

        // Get user details (Admin SDK)
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        if (!userDoc.exists) {
            return NextResponse.json(
                { success: false, message: "User not found" },
                { status: 404 }
            );
        }

        // Get course progress (Admin SDK)
        const progressRef = db.collection(COLLECTIONS.COURSE_PROGRESS).doc(`${userId}_${courseId}`);
        const progressDoc = await progressRef.get();

        if (!progressDoc.exists) {
            return NextResponse.json(
                { success: false, message: "Course progress not found" },
                { status: 404 }
            );
        }

        const progressData = progressDoc.data();
        if (!progressData) {
            return NextResponse.json(
                { success: false, message: "Course progress data is corrupted" },
                { status: 500 }
            );
        }

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

        // Get course details (Admin SDK)
        // ✅ FIX: Query from active 'ACADEMY_COURSES' collection instead of legacy 'COURSES'.
        // Previously, the query failed silently, causing all certificates to be printed
        // with the generic title "Course Completion" instead of the actual course name.
        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();
        const courseData = courseDoc.data();
        const courseTitle = courseDoc.exists && courseData ? courseData.title : "Course Completion";

        // Create certificate (Admin SDK)
        const certificateRef = db.collection(COLLECTIONS.CERTIFICATES).doc();
        const userData = userDoc.data();
        if (!userData) {
            return NextResponse.json(
                { success: false, message: "User data is corrupted" },
                { status: 500 }
            );
        }

        const certificateData = {
            userId,
            userName: userData.name || userData.email,
            courseId,
            courseTitle,
            completionDate: progressData.completedAt || FieldValue.serverTimestamp(),
            grade: quizScore || progressData.quizScores?.[0]?.bestScore,
            issuedAt: FieldValue.serverTimestamp(),
            qrCodeUrl: "",
            pdfUrl: "",
        };

        await certificateRef.set(certificateData);

        // Update course progress with certificate ID
        await progressRef.update({
            certificateId: certificateRef.id,
            updatedAt: FieldValue.serverTimestamp(),
        });

        return NextResponse.json({
            success: true,
            message: "Certificate generated successfully",
            certificateId: certificateRef.id
        });
    } catch (error) {
        logger.error("Failed to generate certificate:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
