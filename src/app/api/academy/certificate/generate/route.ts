export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { ACADEMY_CERTIFICATE } from "@/lib/certificate-kind";
import { courseGradeFromQuizScores } from "@/lib/academy-grading";
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

        // `quizScore` was destructured here and written onto the certificate —
        // #321. It is gone: the grade is computed from the progress record
        // below, and this endpoint now takes nothing from the caller but which
        // course they are claiming.
        const { courseId } = await request.json();

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
        //
        // A DETERMINISTIC ID, NOT AN AUTO ONE — #321.
        //
        // The duplicate check above reads progressData.certificateId and the
        // write that sets it happens after this one, with nothing in between
        // holding a lock — supabaseDb.runTransaction does not take one either.
        // Two concurrent POSTs both saw no certificateId and both minted a row,
        // so one completion produced two certificates with two different
        // numbers, and the progress record pointed at whichever landed last.
        // The other became an orphan that /api/academy/verify would still
        // resolve. #249–#251's lockless-claim shape, on a credential.
        //
        // One learner completing one course is one certificate, which the
        // certificateId check already assumes. Keying the document on that pair
        // makes the second write idempotent instead of duplicating: no lock
        // needed, and nothing is deleted to achieve it.
        const certificateRef = db.collection(COLLECTIONS.CERTIFICATES).doc(`${userId}_${courseId}`);
        const userData = userDoc.data();
        if (!userData) {
            return NextResponse.json(
                { success: false, message: "User data is corrupted" },
                { status: 500 }
            );
        }

        const certificateData = {
            // Distinguishes this from a file the user attached to their own
            // profile. Both live in this collection; only this kind may be
            // publicly verified or counted as earned. See lib/certificate-kind.
            recordType: ACADEMY_CERTIFICATE,
            userId,
            userName: userData.name || userData.email,
            courseId,
            courseTitle,
            completionDate: progressData.completedAt || FieldValue.serverTimestamp(),
            // Was `quizScore || progressData.quizScores?.[0]?.bestScore` —
            // #321. The first half was the caller's own figure; the second
            // indexed the quizScores map at a key no module has and then read a
            // property off a number, so it was always undefined. The grade is
            // now computed from the recorded per-module scores, in the module
            // that decides what a score means. See lib/academy-grading.ts.
            grade: courseGradeFromQuizScores(progressData.quizScores),
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
