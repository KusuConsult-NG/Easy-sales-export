import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";

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

        // Get course progress
        const progressRef = collection(db, "course_progress");
        const progressQuery = query(progressRef, where("userId", "==", userId));
        const progressSnapshot = await getDocs(progressQuery);

        const courses = progressSnapshot.docs.map(doc => ({
            ...doc.data(),
            enrolledAt: doc.data().enrolledAt?.toDate?.() || new Date(),
            lastAccessedAt: doc.data().lastAccessedAt?.toDate?.() || new Date(),
            completedAt: doc.data().completedAt?.toDate?.() || null,
        }));

        // Get certificates
        const certificatesRef = collection(db, "certificates");
        const certQuery = query(certificatesRef, where("userId", "==", userId));
        const certSnapshot = await getDocs(certQuery);

        const certificates = certSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            completionDate: doc.data().completionDate?.toDate?.() || new Date(),
        }));

        // Calculate stats
        const stats = {
            totalCourses: courses.length,
            inProgress: courses.filter(c => !c.completedAt).length,
            completed: courses.filter(c => c.completedAt).length,
            certificatesEarned: certificates.length,
            totalHours: 0, // TODO: Calculate from actual course durations
            learningStreak: 0, // TODO: Calculate from activity logs
        };

        return NextResponse.json({
            success: true,
            courses,
            certificates,
            stats
        });
    } catch (error) {
        console.error("Failed to fetch dashboard data:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
