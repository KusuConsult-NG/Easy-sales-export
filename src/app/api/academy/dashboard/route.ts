export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";

/**
 * API Route: Get Student Dashboard Data
 */
export async function GET(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const userId = session.user.id;

        // Get course progress (Admin SDK)
        const progressSnapshot = await db.collection("course_progress")
            .where("userId", "==", userId)
            .get();

        const courses = progressSnapshot.docs.map(doc => ({
            ...doc.data(),
            enrolledAt: doc.data().enrolledAt?.toDate?.() || new Date(),
            lastAccessedAt: doc.data().lastAccessedAt?.toDate?.() || new Date(),
            completedAt: doc.data().completedAt?.toDate?.() || null,
        }));

        // Get certificates (Admin SDK)
        const certSnapshot = await db.collection("certificates")
            .where("userId", "==", userId)
            .get();

        const certificates = certSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            completionDate: doc.data().completionDate?.toDate?.() || new Date(),
        }));

        const stats = {
            totalCourses: courses.length,
            inProgress: courses.filter(c => !c.completedAt).length,
            completed: courses.filter(c => c.completedAt).length,
            certificatesEarned: certificates.length,
        };

        return NextResponse.json({
            success: true,
            courses,
            certificates,
            stats
        });
    } catch (error) {
        logger.error("Failed to fetch dashboard data:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
