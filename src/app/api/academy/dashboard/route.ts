export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isIssuedCertificate } from "@/lib/certificate-kind";
import { autoEnrollPaidUser } from "@/app/actions/academy";
import { isPaidAcademyPlan } from "@/lib/academy-plan";

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

        // Auto-enroll if the user has an active paid plan.
        // The fourth copy of this list lived here. See isPaidAcademyPlan: none
        // of the copies trimmed, while the access rule they gate does, so a
        // plan stored as " Elite " unlocked the whole catalogue and was
        // auto-enrolled in nothing.
        const userPlan = (session.user as any)?.serviceRegistrations?.academy?.plan;
        if (isPaidAcademyPlan(userPlan)) {
            await autoEnrollPaidUser(userId, userPlan);
        }

        // 1. Fetch all courses in academy_courses to map details
        const coursesSnapshot = await db.collection(COLLECTIONS.ACADEMY_COURSES).get();
        const coursesMap = new Map();
        coursesSnapshot.forEach(doc => {
            coursesMap.set(doc.id, doc.data());
        });

        // 2. Fetch user details for streak/metadata
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data() || {};

        // 3. Fetch detailed progress documents from the user's subcollection
        const progressSnapshot = await db.collection(`user_progress/${userId}/courses`).get();

        const courses = progressSnapshot.docs.map(doc => {
            const progressData = doc.data();
            const courseId = doc.id;
            const courseData = coursesMap.get(courseId) || {};
            
            // Calculate total lessons dynamically from modules
            const totalLessons = (courseData.modules || []).reduce(
                (sum: number, mod: any) => sum + (mod.lessons || []).length, 
                0
            );

            return {
                ...progressData,
                courseId,
                courseTitle: courseData.title || progressData.courseTitle || "Course",
                totalLessons,
                completedLessons: progressData.completedLessons || [],
                completionPercentage: progressData.overallProgress || 0,
                enrolledAt: progressData.enrolledAt?.toDate?.() || progressData.startedAt?.toDate?.() || new Date(),
                lastAccessedAt: progressData.lastAccessedAt?.toDate?.() || new Date(),
                completedAt: progressData.completedAt?.toDate?.() || null,
            };
        });

        // Calculate total modules count across all active courses
        let totalModules = 0;
        courses.forEach(c => {
            const courseData = coursesMap.get(c.courseId);
            if (courseData) {
                totalModules += (courseData.modules || []).length;
            }
        });

        // Get certificates (Admin SDK)
        const certSnapshot = await db.collection(COLLECTIONS.CERTIFICATES)
            .where("userId", "==", userId)
            .get();

        // Only credentials the platform issued. This counted every row for the
        // user, and uploadCertificateAction writes user-attached files into the
        // same collection — so uploading PDFs inflated `certificatesEarned`.
        const certificates = certSnapshot.docs
            .filter(doc => isIssuedCertificate(doc.data()))
            .map(doc => ({
                id: doc.id,
                ...doc.data(),
                completionDate: doc.data().completionDate?.toDate?.() || new Date(),
            }));

        const stats = {
            totalCourses: courses.length,
            totalModules,
            inProgress: courses.filter(c => !c.completedAt && (c.completionPercentage || 0) > 0).length,
            completed: courses.filter(c => c.completedAt).length,
            certificatesEarned: certificates.length,
            learningStreak: userData.learningStreak || 0,
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
