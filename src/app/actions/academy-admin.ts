"use server";

import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { FieldValue, FieldPath } from "firebase-admin/firestore";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { createAdminAuditLog } from "@/lib/audit-log-admin";
import { logAuditAction } from "@/lib/audit";
import { hasAdminPermission, isAdmin } from "@/lib/admin-permissions";
import { serializeDocs } from "@/lib/firestore-serialize";
import { paginatedOk, paginatedErr, nextCursor as computeNextCursor } from "@/lib/admin-action-response";
import { ActionResponse, withFlexibleSafeAction } from "@/lib/safe-action";

/**
 * Academy Admin Actions - Application Approval/Rejection
 */


/**
 * Approve Academy Learner Application
 */
async function _approveAcademyApplicationAction(
    applicationId: string
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" , data: null };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update") &&
            !session.user.roles?.includes("academy_admin")) {
            return { error: "Unauthorized: Permission required - users:update", success: false as const , data: null };
        }

        // 1. Get Application
        const appRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();

        if (!appDoc.exists) {
            return { error: "Application not found", success: false as const , data: null };
        }

        const appData = appDoc.data()!;
        const userId = appData.userId;

        if (!userId) {
            return { error: "Application missing user ID", success: false as const , data: null };
        }

        // Perform atomic updates in a transaction
        await db.runTransaction(async (transaction) => {
            // 1. Get Application (re-read in transaction for safety)
            const appSnap = await transaction.get(appRef);
            if (!appSnap.exists) throw new Error("Application not found");

            // 2. Update Application Status
            transaction.update(appRef, {
                status: "approved",
                reviewedBy: session.user.id,
                reviewedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1),
            });

            // 3. Update User Profile (Verify, Add Role, Activate Service)
            const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
            transaction.set(userRef, {
                isVerified: true,
                verifiedBy: session.user.id,
                verifiedAt: FieldValue.serverTimestamp(),
                roles: FieldValue.arrayUnion("academy_participant"),
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });

            // Atomic sync for nested serviceRegistrations
            transaction.update(userRef, {
                "serviceRegistrations.academy.status": "approved",
                "serviceRegistrations.academy.applicationId": applicationId,
                "serviceRegistrations.academy.approvedAt": FieldValue.serverTimestamp(),
            });
        });

        // 4. CLEAR CACHE - User now has Academy access (Post-Commit Side Effect)
        try {
            const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
            await invalidateServiceCache(userId, 'academy');
        } catch (cacheError) {
            logger.error('[Academy Approval] Cache clear error:', cacheError);
        }

        // 5. Send Approval Email (Post-Commit Side Effect)
        if (process.env.RESEND_API_KEY && appData.personalInfo?.email) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);

                const { data, error } = await resend.emails.send({
                    from: "Easy Sales Export Academy <noreply@easysalesexport.com>",
                    to: appData.personalInfo.email,
                    subject: "Welcome to Academy - Application Approved!",
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #059669;">Welcome to Easy Sales Export Academy!</h2>
                            <p>We are thrilled to inform you that your Academy learner application has been approved.</p>
                            <div style="background: #ecfdf5; padding: 16px; border-radius: 8px; margin: 20px 0; border: 1px solid #a7f3d0;">
                                <p style="margin: 0; color: #065f46;"><strong>Status:</strong> Approved</p>
                                <p style="margin: 5px 0 0; color: #065f46;"><strong>Role:</strong> Academy Participant</p>
                            </div>

                            <p>You now have full access to:</p>
                            <ul>
                                <li>All Academy courses and learning paths</li>
                                <li>Video lessons and training materials</li>
                                <li>Live sessions and webinars</li>
                                <li>Certificates upon course completion</li>
                            </ul>

                            <p><strong>Next Steps:</strong></p>
                            <p>Log in to your dashboard and start exploring our courses!</p>

                            <div style="text-align: center; margin-top: 30px;">
                                <a href="https://easysalesexport.com/academy" style="background-color: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Go to Academy</a>
                            </div>
                        </div>
                    `
                });
                if (error) {
                    logger.error("Resend API Error (Academy approval email):", error);
                }
            } catch (emailError) {
                logger.error("Failed to send Academy approval email:", emailError);
                // Don't block success on email failure
            }
        }

        // 6. Log Audit
        await createAdminAuditLog({
            action: "academy_approve",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "academy_application",
            details: `Approved Academy application for ${appData.personalInfo?.fullName || 'Unknown'}`,
        });

        return { success: true, error: null, data: null };
    } catch (error: any) {
        logger.error("Approve Academy application error:", error);
        return { success: false, error: "Failed to approve application", data: null };
    }
}
export const approveAcademyApplicationAction = withFlexibleSafeAction("approveAcademyApplicationAction", _approveAcademyApplicationAction);

/**
 * Reject Academy Learner Application
 */
async function _rejectAcademyApplicationAction(
    applicationId: string,
    reason: string
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update") &&
            !session.user.roles?.includes("academy_admin")) {
            return { error: "Unauthorized: Permission required - users:update", success: false as const , data: null };
        }

        // 1. Get Application
        const appRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();

        if (!appDoc.exists) {
            return { error: "Application not found", success: false as const , data: null };
        }

        const appData = appDoc.data()!;
        const userId = appData.userId;

        // Perform atomic rejection in a transaction
        await db.runTransaction(async (transaction) => {
            // 1. Get Application (re-read in transaction)
            const appSnap = await transaction.get(appRef);
            if (!appSnap.exists) throw new Error("Application not found");

            // 2. Update Application Status
            transaction.update(appRef, {
                status: "rejected",
                rejectionReason: reason,
                reviewedBy: session.user.id,
                reviewedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1),
            });

            if (userId) {
                // 3. Update User Profile (Mark as rejected)
                const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
                transaction.update(userRef, {
                    "serviceRegistrations.academy.status": "rejected",
                    "serviceRegistrations.academy.rejectedAt": FieldValue.serverTimestamp(),
                });
            }
        });

        // CLEAR CACHE (Post-Commit Side Effect)
        if (userId) {
            try {
                const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
                await invalidateServiceCache(userId, 'academy');
            } catch (cacheError) {
                logger.error('[Academy Rejection] Cache clear error:', cacheError);
            }
        }

        // 3. Send Rejection Email
        if (process.env.RESEND_API_KEY && appData.personalInfo?.email) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);

                const { data, error } = await resend.emails.send({
                    from: "Easy Sales Export Academy <noreply@easysalesexport.com>",
                    to: appData.personalInfo.email,
                    subject: "Academy Application Update",
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #dc2626;">Academy Application Update</h2>
                            <p>Thank you for your interest in the Easy Sales Export Academy.</p>
                            <div style="background: #fef2f2; padding: 16px; border-radius: 8px; margin: 20px 0;">
                                <p>Unfortunately, we are unable to approve your application at this time.</p>
                                <p><strong>Reason:</strong> ${reason}</p>
                            </div>

                            <p><strong>What You Can Do:</strong></p>
                            <ul>
                                <li>Review the feedback provided</li>
                                <li>Address the concerns mentioned</li>
                                <li>Re-apply after making necessary improvements</li>
                            </ul>

                            <p>If you have any questions, please contact our support team.</p>
                        </div>
                    `
                });
                if (error) {
                    logger.error("Resend API Error (Academy rejection email):", error);
                }
            } catch (emailError) {
                logger.error("Failed to send Academy rejection email:", emailError);
            }
        }

        // 4. Log Audit
        await createAdminAuditLog({
            action: "academy_reject",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "academy_application",
            details: `Rejected Academy application: ${reason}`,
        });

        return { success: true, error: null, data: null };
    } catch (error: any) {
        logger.error("Reject Academy application error:", error);
        return { success: false, error: "Failed to reject application", data: null };
    }
}
export const rejectAcademyApplicationAction = withFlexibleSafeAction("rejectAcademyApplicationAction", _rejectAcademyApplicationAction);

/**
 * Update Academy Application Payment Status (Admin)
 */
async function _updateAcademyApplicationPaymentAction(
    applicationId: string,
    paymentStatus: "pending" | "completed" | "paid",
    paymentAmount: number,
    plan: string
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update") &&
            !session.user.roles?.includes("academy_admin")) {
            return { success: false, error: "Unauthorized: Permission required", data: null };
        }

        const appRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();

        if (!appDoc.exists) {
            return { error: "Application not found", success: false as const , data: null };
        }

        const appData = appDoc.data()!;

        // Perform atomic update in a transaction
        await db.runTransaction(async (transaction) => {
            const appSnap = await transaction.get(appRef);
            if (!appSnap.exists) throw new Error("Application not found");

            transaction.update(appRef, {
                paymentStatus,
                paymentAmount,
                plan,
                paymentVerifiedAt: paymentStatus === "completed" || paymentStatus === "paid" ? FieldValue.serverTimestamp() : null,
                paymentVerifiedBy: paymentStatus === "completed" || paymentStatus === "paid" ? session.user.id : null,
                _version: FieldValue.increment(1),
            });

            if (appData.userId) {
                const userRef = db.collection(COLLECTIONS.USERS).doc(appData.userId);
                transaction.update(userRef, {
                    "serviceRegistrations.academy.paymentStatus": paymentStatus,
                    "serviceRegistrations.academy.plan": plan
                });
            }
        });

        await createAdminAuditLog({
            action: "academy_update_payment",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "academy_application",
            details: `Updated Academy application payment: ${paymentStatus}, amount: ₦${paymentAmount}, plan: ${plan}`,
        });

        return { success: true, error: null, data: null };
    } catch (error: any) {
        logger.error("Update Academy application payment error:", error);
        return { success: false, error: "Failed to update payment status", data: null };
    }
}
export const updateAcademyApplicationPaymentAction = withFlexibleSafeAction("updateAcademyApplicationPaymentAction", _updateAcademyApplicationPaymentAction);

/**
 * Get Pending Academy Applications (Admin)
 */
async function _getPendingAcademyApplicationsAction(): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update") &&
            !session.user.roles?.includes("academy_admin")) {
            return { error: "Unauthorized: Permission required - users:update", success: false as const , data: null };
        }

        const snapshot = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
            .where("status", "==", "pending")
            .get();

        const applications = serializeDocs(snapshot.docs);

        // Standard Hydration Pattern
        const userIds = [...new Set(applications.map(app => app.userId).filter(Boolean))];
        const userMap = new Map<string, any>();
        const userPromises = [];
        for (let i = 0; i < userIds.length; i += 30) {
            const chunk = userIds.slice(i, i + 30);
            if (chunk.length > 0) {
                userPromises.push(db.collection(COLLECTIONS.USERS).where(FieldPath.documentId(), "in", chunk).get());
            }
        }
        const userSnapsArray = await Promise.all(userPromises);
        userSnapsArray.forEach(snap => snap.docs.forEach(d => userMap.set(d.id, d.data())));

        const enrichedApps = applications.map(app => {
            const uData = userMap.get(app.userId as string) || {};
            const pi = (app.personalInfo || {}) as any;
            
            // Canonical bankDetails injection
            const bankDetails = uData.bankDetails || {
                bankName: uData.bankName || uData.bankAccount?.bankName || "N/A",
                accountNumber: uData.bankAccountNumber || uData.bankAccount?.accountNumber || "N/A",
                accountName: uData.bankAccountName || uData.bankAccount?.accountName || uData.fullName || (uData.firstName && uData.lastName ? `${uData.firstName} ${uData.lastName}` : "N/A"),
                bankCode: uData.bankCode || uData.bankAccount?.bankCode || "N/A"
            };

            return {
                ...app,
                userProfile: {
                    name: uData.firstName ? `${uData.firstName} ${uData.lastName || ''}`.trim() : (uData.name || pi.fullName || "Unknown"),
                    email: uData.email || pi.email || "N/A",
                    phone: uData.phone || uData.phoneNumber || pi.phone || "N/A"
                },
                bankDetails
            };
        });

        // Ensure sorting is consistent after serialization
        enrichedApps.sort((a: any, b: any) =>
            new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
        );

        return { success: true, error: null, data: enrichedApps };
    } catch (error: any) {
        logger.error("Get pending Academy applications error:", error);
        return { success: false, error: "Failed to fetch applications", data: null };
    }
}
export const getPendingAcademyApplicationsAction = withFlexibleSafeAction("getPendingAcademyApplicationsAction", _getPendingAcademyApplicationsAction);


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

        let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.ACADEMY_ENROLLMENTS);
        const fetchLimit = options?.search ? 1000 : (options?.limit || 50);
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
        userSnapsArray.forEach(snap => snap.docs.forEach(d => userMap.set(d.id, d.data())));

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
                ].filter(Boolean).join(" ").toLowerCase();
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

async function _getAcademyInstructorsAction(): Promise<ActionResponse<any[]>> {
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

        const instructorsSnap = await db.collection(COLLECTIONS.USERS)
            .where("roles", "array-contains", "academy_instructor")
            .get();

        const instructors = serializeDocs(instructorsSnap.docs);

        return { success: true, error: null, data: instructors };
    } catch (error) {
        logger.error("Get academy instructors error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, error: "Failed to fetch instructors", data: null };
    }
}
export const getAcademyInstructorsAction = withFlexibleSafeAction("getAcademyInstructorsAction", _getAcademyInstructorsAction);

async function _getAcademyCoursesAction(options?: {
    limit?: number;
    search?: string;
}): Promise<ActionResponse<{ courses: any[] }>> {
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

        let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.ACADEMY_COURSES);
        const fetchLimit = options?.search ? 1000 : (options?.limit || 50);
        q = q.orderBy("createdAt", "desc").limit(fetchLimit);

        const snapshot = await q.get();
        let courses = serializeDocs(snapshot.docs);

        if (options?.search) {
            const s = options.search.toLowerCase().trim();
            courses = courses.filter((c: any) => {
                const searchString = [
                    c.id,
                    c.title,
                    c.instructorName,
                    c.category,
                    c.level
                ].filter(Boolean).join(" ").toLowerCase();
                return searchString.includes(s);
            });
        }

        return { success: true, error: null, data: { courses } };
    } catch (error) {
        logger.error("Get academy courses error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, error: "Failed to fetch courses", data: null };
    }
}
export const getAcademyCoursesAction = withFlexibleSafeAction("getAcademyCoursesAction", _getAcademyCoursesAction);

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

        const [coursesSnap, studentsSnap, enrollmentsSnap, registrationSnap] = await Promise.all([
            db.collection(COLLECTIONS.ACADEMY_COURSES).count().get(),
            db.collection(COLLECTIONS.USERS).where("roles", "array-contains", "academy_student").count().get(),
            db.collection(COLLECTIONS.ACADEMY_ENROLLMENTS).count().get(),
            db.collection(COLLECTIONS.PROCESSED_PAYMENTS).where("type", "==", "academy_registration").get(),
        ]);

        const totalCourses = coursesSnap.data().count;
        const totalStudents = studentsSnap.data().count;
        const totalEnrollments = enrollmentsSnap.data().count;

        const registrationStats: Record<string, { count: number, revenue: number }> = {
            foundation: { count: 0, revenue: 0 },
            standard: { count: 0, revenue: 0 },
            elite: { count: 0, revenue: 0 },
        };

        registrationSnap.docs.forEach(doc => {
            const data = doc.data();
            const plan = (data.plan || "foundation").toLowerCase();
            const amount = Number(data.amount) || 0;
            if (registrationStats[plan]) {
                registrationStats[plan].count++;
                registrationStats[plan].revenue += amount;
            }
        });

        const activeEnrollmentsSnap = await db.collection(COLLECTIONS.ACADEMY_ENROLLMENTS)
            .where("status", "==", "active").count().get();
        const activeEnrollments = activeEnrollmentsSnap.data().count;

        const completedCoursesSnap = await db.collection(COLLECTIONS.ACADEMY_ENROLLMENTS)
            .where("status", "==", "completed").count().get();
        const completedCourses = completedCoursesSnap.data().count;

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

        const totalRegistrationRevenue = Object.values(registrationStats).reduce((acc, curr) => acc + curr.revenue, 0);
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

async function _getAcademyApplicationStatsAction(): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        // Ensure user has admin permissions
        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized", data: null };
        }

        const [pendingSnap, underReviewSnap, approvedSnap, rejectedSnap] = await Promise.all([
            db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).where("status", "==", "pending").count().get(),
            db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).where("status", "==", "under_review").count().get(),
            db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).where("status", "==", "approved").count().get(),
            db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).where("status", "==", "rejected").count().get(),
        ]);

        const pending = pendingSnap.data().count;
        const under_review = underReviewSnap.data().count;
        const approved = approvedSnap.data().count;
        const rejected = rejectedSnap.data().count;
        const totalApplications = pending + under_review + approved + rejected;

        return {
            success: true,
            error: null,
            data: {
                stats: {
                    totalApplications,
                    pending,
                    under_review,
                    approved,
                    rejected
                }
            }
        };
    } catch (error: any) {
        logger.error("Get Academy application stats error:", error);
        return { success: false, error: "Failed to fetch application statistics", data: null };
    }
}
export const getAcademyApplicationStatsAction = withFlexibleSafeAction("getAcademyApplicationStatsAction", _getAcademyApplicationStatsAction);

async function _upsertAcademyCourseAction(
    courseId: string | "new",
    courseData: any
): Promise<ActionResponse<null>> {
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
        const { courseSchema } = await import("@/lib/schemas");
        const validated = courseSchema.safeParse(courseData);
        if (!validated.success) {
            return { success: false, error: validated.error.issues[0].message, data: null };
        }

        const cleanData = {
            ...validated.data,
            updatedAt: FieldValue.serverTimestamp(),
            _version: FieldValue.increment(1),
        };

        if (courseId === "new") {
            const newRef = db.collection(COLLECTIONS.ACADEMY_COURSES).doc();
            await newRef.set({
                ...cleanData,
                createdAt: FieldValue.serverTimestamp(),
                studentsCount: 0,
                rating: 0,
                status: "draft",
                _version: 0,
            });
            courseId = newRef.id;
        } else {
            await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).update(cleanData);
        }

        await logAuditAction({
            userId: session.user.id,
            action: courseId === "new" ? "CREATE_COURSE" : "UPDATE_COURSE",
            resourceId: courseId,
            resourceType: "academy_course",
            metadata: { title: courseData.title },
        });

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error("Upsert academy course error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, error: "Failed to save course", data: null };
    }
}
export const upsertAcademyCourseAction = withFlexibleSafeAction("upsertAcademyCourseAction", _upsertAcademyCourseAction);

async function _getStandardAcademyApplicationsAction(options: {
    limit?: number;
    search?: string;
    status?: "pending" | "approved" | "rejected" | "under_review" | "all";
    lastDocId?: string;
    sortOrder?: "asc" | "desc";
    dateFrom?: string; // YYYY-MM-DD
    dateTo?: string;   // YYYY-MM-DD
} = {}): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, error: "Not authenticated", data: null };

        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized", data: null };
        }

        const fetchLimit = options.search ? 2000 : (options.limit || 50);
        const orderDirection = options.sortOrder || "desc";
        
        // 1. Query dedicated collection
        let q: any = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).orderBy("submittedAt", orderDirection);
        
        if (options.status && options.status !== "all") {
            q = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .where("status", "==", options.status)
                .orderBy("submittedAt", orderDirection);
        }

        // Apply server-side date range filtering
        if (options.dateFrom) {
            const fromTs = new Date(options.dateFrom);
            q = q.where("submittedAt", ">=", fromTs);
        }
        if (options.dateTo) {
            const toTs = new Date(options.dateTo + "T23:59:59");
            q = q.where("submittedAt", "<=", toTs);
        }

        if (options.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                q = q.startAfter(lastDoc);
            }
        }
        q = q.limit(fetchLimit);

        const snapshot = await q.get();
        const applications = serializeDocs(snapshot.docs);

        // 2. Hydrate User Data (Standard Hydration Pattern)
        const userIds = [...new Set(applications.map(app => app.userId).filter(Boolean))];
        const userMap = new Map<string, any>();
        const userPromises = [];
        
        for (let i = 0; i < userIds.length; i += 30) {
            const chunk = userIds.slice(i, i + 30);
            if (chunk.length > 0) {
                userPromises.push(db.collection(COLLECTIONS.USERS).where(FieldPath.documentId(), "in", chunk).get());
            }
        }
        
        const userSnapsArray = await Promise.all(userPromises);
        userSnapsArray.forEach(snap => snap.docs.forEach(d => userMap.set(d.id, d.data())));

        // 3. Normalize and Merge Data
        const standardForms = applications.map((app: any) => {
            const uData = (userMap.get(app.userId as string) || {}) as any;
            const pi = (app.personalInfo || {}) as any;
            
            // Priority: USERS doc > personalInfo object > fallback
            const userName = uData.firstName
                ? `${uData.firstName} ${uData.lastName || ''}`.trim()
                : (uData.name || uData.fullName || pi.fullName || (pi.firstName ? `${pi.firstName} ${pi.lastName || ''}`.trim() : "Unknown User"));

            const mergedData = {
                ...uData,
                ...app,
                // Flatten fields for UI consistency
                phone: app.phone || pi.phone || uData.phone || uData.phoneNumber || null,
                email: app.email || pi.email || uData.email || null,
                gender: app.gender || pi.gender || uData.gender || null,
                dateOfBirth: app.dateOfBirth || pi.dateOfBirth || uData.dob || null,
                occupation: app.occupation || pi.occupation || uData.occupation || null,
                stateOfOrigin: app.stateOfOrigin || pi.stateOfOrigin || (typeof uData.address === 'object' ? uData.address?.state : uData.stateOfOrigin) || null,
                lga: app.lga || pi.lga || (typeof uData.address === 'object' ? uData.address?.lga : uData.lga) || null,
                residentialAddress: app.residentialAddress || pi.residentialAddress || (typeof uData.address === 'object' ? uData.address?.street : uData.address) || null,
                fullName: userName
            };

            // Canonical bankDetails injection
            const bankDetails = uData.bankDetails || {
                bankName: uData.bankName || "N/A",
                accountNumber: uData.bankAccountNumber || "N/A",
                accountName: uData.bankAccountName || "N/A",
                bankCode: uData.bankCode || "N/A"
            };

            return {
                id: app.id,
                userId: app.userId,
                user: {
                    id: app.userId,
                    name: userName,
                    email: mergedData.email || "Unknown",
                    phone: mergedData.phone || "Unknown",
                    dob: mergedData.dateOfBirth || "Unknown",
                    address: mergedData.residentialAddress || "Unknown",
                    state: mergedData.stateOfOrigin || "Unknown",
                    lga: mergedData.lga || "Unknown",
                    bankDetails
                },
                status: app.status || "pending",
                data: mergedData,
                submittedAt: app.submittedAt
            };
        });

        // 4. Client-side Search
        let finalForms = standardForms;
        if (options.search) {
            const s = options.search.toLowerCase().trim();
            finalForms = standardForms.filter((f: any) => {
                const searchString = [
                    f.id,
                    f.userId,
                    f.user?.name,
                    f.user?.email,
                    f.user?.phone,
                    f.data?.firstName,
                    f.data?.lastName,
                    f.data?.fullName,
                    f.data?.stateOfOrigin,
                    f.data?.phone
                ].filter(Boolean).join(" ").toLowerCase();
                return searchString.includes(s);
            });
        }

        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        await createAdminAuditLog({
            action: "data_access",
            userId: session.user.id,
            targetType: "academy_applications",
            targetId: "list",
            details: `Accessed Academy applications list (limit: ${fetchLimit}, status: ${options.status || 'all'})`,
            metadata: { options }
        });

        return { 
            success: true,
            error: null, 
            data: finalForms,
            meta: {
                totalFetched: finalForms.length,
                hasMore: !!nextCursor,
                lastDocId: nextCursor || null
            }
        };
    } catch (error: any) {
        logger.error("Get standard academy apps error:", {
            error: error instanceof Error ? error.message : String(error),
            code: error?.code
        });
        
        if (error?.code === 9 || error?.message?.includes("FAILED_PRECONDITION")) {
            return { 
                success: false, 
                error: "Failed to fetch applications: Missing Firestore Index. Please check server logs for the creation link.", 
                data: null 
            };
        }

        return { success: false, error: "Failed to fetch applications", data: null };
    }
}
export const getStandardAcademyApplicationsAction = withFlexibleSafeAction("getStandardAcademyApplicationsAction", _getStandardAcademyApplicationsAction);

/**
 * Log Academy Export Action
 */
async function _logAcademyExportAction(details: any): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        await createAdminAuditLog({
            action: "data_export",
            userId: session.user.id,
            targetId: "academy_applications",
            targetType: "export",
            details: `Exported ${details.count} academy applications. Filters: ${JSON.stringify(details.filters)}`,
            metadata: details
        });

        return { success: true, error: null, data: null };
    } catch (error: any) {
        logger.error("Error logging export:", error);
        return { success: false, error: "An unexpected error occurred", data: null };
    }
}
export const logAcademyExportAction = withFlexibleSafeAction("logAcademyExportAction", _logAcademyExportAction);
