export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { recordAdminAction } from "@/lib/audit-log";

/**
 * API Route: Create Quiz (Admin)
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

        // Admin role check (includes super_admin)
        if (!hasAdminPermission(session.user.roles, "academy:manage_quizzes")) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        const quizData = await request.json();

        // Validate required fields.
        //
        // `quizData.questions.length` was read without checking that `questions`
        // exists, so a body missing that key threw a TypeError, was swallowed by
        // the catch below, and came back as a 500 "Internal server error"
        // instead of the 400 this branch is written to return.
        if (!quizData?.title || !quizData?.courseId || !Array.isArray(quizData.questions) || quizData.questions.length === 0) {
            return NextResponse.json(
                { success: false, message: "Missing required fields" },
                { status: 400 }
            );
        }

        // Create quiz document (Admin SDK)
        const quizRef = db.collection(COLLECTIONS.QUIZZES).doc();
        await quizRef.set({
            ...quizData,
            createdBy: session.user.id,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        await recordAdminAction({
            action: 'quiz_created',
            userId: session.user.id,
            targetId: quizRef.id,
            targetType: 'academy_quiz',
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
