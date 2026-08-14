"use server";

import { userMetricsService } from "@/services";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { FieldPath } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { isAdmin } from "@/lib/admin-permissions";
import { serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { ActionResponse, withFlexibleSafeAction } from "@/lib/safe-action";

async function _getAcademyEnrollmentsAction(options?: {
    limit?: number;
    search?: string;
}): Promise<ActionResponse<{ enrollments: any[] }>> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated", data: null };
        }

        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized", data: null };
        }

        let q: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.ACADEMY_ENROLLMENTS);
        const fetchLimit = options?.search ? 5000 : (options?.limit || 50);
        q = q.orderBy("enrolledAt", "desc").limit(fetchLimit);

        const snapshot = await q.get();
        let enrollments = serializeDocs(snapshot.docs);

        // Standard Hydration Pattern
        const userIds = [...new Set(enrollments.map(e => e.userId).filter(Boolean))];
        const userMap = new Map<string, any>();
        const userPromises = [];
        for (let i = 0; i < userIds.length; i += 30) {
            const chunk = userIds.slice(i, i + 30);
            if (chunk.length > 0) {
                userPromises.push(db.collection(COLLECTIONS.USERS).where(FieldPath.documentId(), "in", chunk).get());
            }
        }
        const userSnapsArray = await Promise.all(userPromises);
        userSnapsArray.forEach(snap => snap.docs.forEach(d => userMap.set(d.id, serializeValue(d.data()))));

        enrollments = enrollments.map(e => {
            const uData = userMap.get(e.userId as string) || {};
            
            // Canonical bankDetails injection
            const bankDetails = uData.bankDetails || {
                bankName: uData.bankName || uData.bankAccount?.bankName || "N/A",
                accountNumber: uData.bankAccountNumber || uData.bankAccount?.accountNumber || "N/A",
                accountName: uData.bankAccountName || uData.bankAccount?.accountName || uData.fullName || (uData.firstName && uData.lastName ? `${uData.firstName} ${uData.lastName}` : "N/A"),
                bankCode: uData.bankCode || uData.bankAccount?.bankCode || "N/A"
            };

            return {
                ...e,
                bankDetails,
                userProfile: {
                    name: uData.firstName ? `${uData.firstName} ${uData.lastName || ''}`.trim() : (uData.name || e.studentName || "Unknown"),
                    email: uData.email || e.studentEmail || "N/A",
                    phone: uData.phone || uData.phoneNumber || "N/A"
                }
            };
        });

        if (options?.search) {
            const s = options.search.toLowerCase().trim();
            enrollments = enrollments.filter((e: any) => {
                const searchString = [
                    e.id,
                    e.courseTitle,
                    e.studentName,
                    e.studentEmail,
                    e.status,
                    e.userProfile?.name,
                    e.userProfile?.email
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(s);
            });
        }

        return { success: true, error: null, data: { enrollments } };
    } catch (error) {
        logger.error("Get academy enrollments error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, error: "Failed to fetch enrollments", data: null };
    }
}

export const getAcademyEnrollmentsAction = withFlexibleSafeAction("getAcademyEnrollmentsAction", _getAcademyEnrollmentsAction);


async function _getAcademyStatsAction(): Promise<ActionResponse<any>> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated", data: null };
        }

        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized", data: null };
        }

        const { getCached, setCache } = await import("@/lib/redis");
        const cacheKey = "admin:academy-stats:global";

        try {
            const cached = await getCached<any>(cacheKey);
            if (cached) return cached;
        } catch (e) {}

        const metrics = await userMetricsService.getAcademyMetrics();

        const {
            totalCourses,
            totalStudents,
            totalEnrollments,
            activeEnrollments,
            completedCourses,
            totalRegistrationRevenue,
            registrationStats
        } = metrics;

        const courseRevenueSnap = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
            .where("type", "==", "academy_course_purchase")
            .where("status", "==", "completed")
            .get();

        let totalCourseRevenue = 0;
        let monthlyRevenue = 0;
        let previousMonthRevenue = 0;

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

        courseRevenueSnap.docs.forEach(doc => {
            const p = doc.data();
            const amount = Number(p.amount) || 0;
            totalCourseRevenue += amount;

            const date = p.createdAt?.toDate ? p.createdAt.toDate() : new Date(p.createdAt);
            if (date >= thirtyDaysAgo) {
                monthlyRevenue += amount;
            } else if (date >= sixtyDaysAgo && date < thirtyDaysAgo) {
                previousMonthRevenue += amount;
            }
        });


        const totalRevenue = totalCourseRevenue + totalRegistrationRevenue;

        const revenueGrowth = previousMonthRevenue > 0
            ? ((monthlyRevenue - previousMonthRevenue) / previousMonthRevenue) * 100
            : 0;

        const payload: ActionResponse<any> = {
            success: true,
            error: null,
            data: {
                stats: {
                    totalCourses,
                    totalStudents,
                    totalEnrollments,
                    activeEnrollments,
                    completedCourses,
                    totalRevenue,
                    totalCourseRevenue,
                    totalRegistrationRevenue,
                    registrationStats,
                    monthlyRevenue,
                    revenueGrowth,
                    courseRatings: 0
                }
            }
        };

        try {
            await setCache(cacheKey, payload, 300);
        } catch (e) {}

        return payload;
    } catch (error) {
        logger.error("Get academy stats error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, error: "Failed to fetch academy statistics", data: null };
    }
}

export const getAcademyStatsAction = withFlexibleSafeAction("getAcademyStatsAction", _getAcademyStatsAction);
