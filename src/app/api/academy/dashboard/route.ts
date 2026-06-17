export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { autoEnrollPaidUser } from "@/app/actions/academy";

/**
 * API Route: Get Student Dashboard Data
 */
export async function GET(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const userId = session.user.id;

        // Auto-enroll if the user has an active paid plan
        const userPlan = (session.user as any)?.serviceRegistrations?.academy?.plan || "free";
        const isPaid = ["elite", "standard", "foundation", "advanced"].includes(userPlan.toLowerCase());
        if (isPaid) {
            await autoEnrollPaidUser(userId, userPlan);
        }

        // Get course progress (Admin SDK)
        const progressSnapshot = await db.collection(COLLECTIONS.COURSE_PROGRESS)
            .where("userId", "==", userId)
            .get();

        const courses = progressSnapshot.docs.map(doc => ({
            ...doc.data(),
            enrolledAt: doc.data().enrolledAt?.toDate?.() || new Date(),
            lastAccessedAt: doc.data().lastAccessedAt?.toDate?.() || new Date(),
            completedAt: doc.data().completedAt?.toDate?.() || null,
        } as any));

        // Get certificates (Admin SDK)
        const certSnapshot = await db.collection(COLLECTIONS.CERTIFICATES)
            .where("userId", "==", userId)
            .get();

        const certificates = certSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            completionDate: doc.data().completionDate?.toDate?.() || new Date(),
        }));

        const stats = {
            totalCourses: courses.length,
            inProgress: courses.filter(c => !c.completedAt && (c.progressPercent || c.completionPercentage || 0) > 0).length,
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
