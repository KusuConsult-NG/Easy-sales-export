"use server";

import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";
import { withFlexibleSafeAction, ActionResponse, type ActionState } from "@/lib/safe-action";
import { revalidatePath, updateTag } from 'next/cache';
import { invalidateAdminGlobalStats, invalidateServiceCache } from "@/lib/cache-invalidation";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { FieldPath } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createAdminAuditLog } from "@/lib/audit-log";
import { serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { moduleGrantRole } from "@/lib/module-grant-roles";

// ============================================
// Academy Application Management (Admin)
// ============================================

async function _getAcademyApplicationsAction(options: {
    limit?: number;
    search?: string;
    statusFilter?: "pending" | "under_review" | "approved" | "rejected" | "all";
    lastDocId?: string;
    sortBy?: "createdAt" | "gender";
    sortOrder?: "asc" | "desc";
    dateFrom?: string;
    dateTo?: string;
} = {}): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "academy:approve_applications")) {
            const roles = session.user.roles || [];
            const hasAcademyAccess = roles.some(r => r === "admin" || r === "super_admin" || r === "academy_admin");
            if (!hasAcademyAccess) {
                return { error: "Unauthorized: Permission required", success: false as const, data: null };
            }
        }

        const useMemoryPagination = !!options.search || !!options.dateFrom || !!options.dateTo || options.sortBy === "gender";
        const fetchLimit = useMemoryPagination ? 5000 : (options.limit || 50);

        let q: any = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS);

        if (options.statusFilter && options.statusFilter !== "all") {
            q = q.where("status", "==", options.statusFilter);
        }

        if (options.dateFrom) {
            q = q.where("createdAt", ">=", dateRangeStart(options.dateFrom));
        }
        if (options.dateTo) {
            q = q.where("createdAt", "<=", dateRangeEnd(options.dateTo));
        }

        const orderDirection = options.sortOrder || "desc";
        q = q.orderBy("createdAt", orderDirection).limit(fetchLimit + 1);

        if (options.lastDocId && !useMemoryPagination) {
            const lastDoc = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                q = q.startAfter(lastDoc);
            }
        }

        const snapshot = await q.get();
        let rawApplications = serializeDocs(snapshot.docs);
        
        const hasMore = rawApplications.length > fetchLimit;
        if (!useMemoryPagination) {
            rawApplications = rawApplications.slice(0, fetchLimit);
        }
        const nextCursor = rawApplications.length > 0 ? rawApplications[rawApplications.length - 1].id as string : undefined;

        // --- HYDRATION START ---
        const userIds = [...new Set(rawApplications.map((app: any) => app.userId).filter(Boolean))];
        const userMap = new Map<string, any>();
        const userPromises = [];
        for (let i = 0; i < userIds.length; i += 30) {
            const chunk = userIds.slice(i, i + 30);
            if (chunk.length > 0) {
                userPromises.push(db.collection(COLLECTIONS.USERS).where(FieldPath.documentId(), "in", chunk).get());
            }
        }
        const userSnapsArray = await Promise.all(userPromises);
        userSnapsArray.forEach(snap => snap.docs.forEach((d: any) => userMap.set(d.id, serializeValue(d.data()))));
        // --- HYDRATION END ---

        let applications = rawApplications.map((app: any) => {
            const uData = (userMap.get(app.userId as string) || {}) as any;
            const submittedRaw = app.submittedAt;
            const reviewedRaw = app.reviewedAt;

            // Canonical bankDetails
            const bankDetails = uData.bankDetails || {
                bankName: app.bankName || uData.bankName || uData.bankAccount?.bankName || "",
                accountNumber: app.accountNumber || uData.bankAccountNumber || uData.bankAccount?.accountNumber || "",
                accountName: app.accountName || uData.bankAccountName || uData.bankAccount?.accountName || uData.fullName || (uData.firstName && uData.lastName ? `${uData.firstName} ${uData.lastName}` : ""),
                bankCode: app.bankCode || uData.bankCode || uData.bankAccount?.bankCode || ""
            };

            const userName = uData.name || uData.fullName || app.personalInfo?.fullName || "Unknown Student";
            const gender = app.gender || app.personalInfo?.gender || uData.gender || app.profile?.gender || "";

            return {
                id: app.id,
                ...app,
                user: {
                    id: app.userId,
                    name: userName,
                    email: uData.email || app.personalInfo?.email || "Unknown",
                    phone: uData.phone || app.personalInfo?.phone || "Unknown",
                    gender,
                    bankDetails
                },
                // Serialize timestamps
                submittedAt: submittedRaw?.toDate
                    ? (submittedRaw.toDate() as Date).toISOString()
                    : submittedRaw instanceof Date
                        ? submittedRaw.toISOString()
                        : typeof submittedRaw === 'string' ? submittedRaw : new Date(0).toISOString(),
                reviewedAt: reviewedRaw?.toDate
                    ? (reviewedRaw.toDate() as Date).toISOString()
                    : reviewedRaw instanceof Date
                        ? reviewedRaw.toISOString()
                        : typeof reviewedRaw === 'string' ? reviewedRaw : null,
            };
        });

        // Sort in memory
        if (options.sortBy === "gender") {
            const order = options.sortOrder || "desc";
            applications.sort((a, b) => {
                const ga = (a.user?.gender || "").toLowerCase();
                const gb = (b.user?.gender || "").toLowerCase();
                if (ga === gb) {
                    return new Date(b.submittedAt as string).getTime() - new Date(a.submittedAt as string).getTime();
                }
                return order === "asc" ? ga.localeCompare(gb) : gb.localeCompare(ga);
            });
        } else {
            const order = options.sortOrder || "desc";
            applications.sort((a, b) => {
                const t1 = new Date(a.submittedAt as string).getTime();
                const t2 = new Date(b.submittedAt as string).getTime();
                return order === "asc" ? t1 - t2 : t2 - t1;
            });
        }

        // ALWAYS apply date filters in memory as a definitive backstop.
        if (options.dateFrom) {
            const from = dateRangeStart(options.dateFrom);
            applications = applications.filter((app: any) => new Date(app.createdAt) >= from);
        }
        if (options.dateTo) {
            const to = dateRangeEnd(options.dateTo);
            applications = applications.filter((app: any) => new Date(app.createdAt) <= to);
        }

        if (options.search) {
            const s = options.search.toLowerCase().trim();
            applications = applications.filter((app: any) => {
                const searchString = [
                    app.user?.name,
                    app.user?.email,
                    app.user?.phone,
                    app.personalInfo?.fullName
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(s);
            });
        }

        const limit = options.limit || 50;
        let page = 0;
        const pageOption = (options as any).page;
        if (pageOption !== undefined) {
            page = Number(pageOption);
        } else if (options.lastDocId && /^\d+$/.test(options.lastDocId)) {
            page = Number(options.lastDocId);
        }

        const offset = page * limit;
        const paged = useMemoryPagination ? applications.slice(offset, offset + limit) : applications;
        const _hasMore = useMemoryPagination 
            ? (offset + limit < applications.length)
            : hasMore;

        const _nextCursor = useMemoryPagination 
            ? (_hasMore ? String(page + 1) : undefined)
            : nextCursor;

        return {
            error: null,
            success: true as const,
            data: paged,
            lastDocId: _nextCursor,
            hasMore: _hasMore,
            meta: {
                totalFetched: applications.length,
                hasMore: _hasMore
            }
        };
    } catch (error: any) {
        logger.error("Get Academy applications error:", error);
        return { error: "Failed to fetch applications", success: false as const, data: null };
    }
}

async function _approveAcademyApplicationAction(
    applicationId: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        const roles = session.user.roles || [];
        const hasAcademyAccess = roles.some(r => r === "admin" || r === "super_admin" || r === "academy_admin");
        if (!session?.user || !hasAcademyAccess) {
            return { error: "Unauthorized", success: false as const };
        }

        // Get application first
        const appRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();

        if (!appDoc.exists) {
            return { error: "Application not found", success: false as const };
        }

        const appData = appDoc.data()!;
        const userId = appData.userId;
        const userEmail = appData.personalInfo?.email;

        if (!userId) {
            return { error: "Application missing user ID", success: false as const };
        }

        // 1. Update Application Status
        await appRef.update({
            status: "approved",
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // 2. Update User Service Registration & Role
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            "serviceRegistrations.academy.status": "approved",
            "serviceRegistrations.academy.paymentStatus": "completed",
            "serviceRegistrations.academy.approvedAt": FieldValue.serverTimestamp(),
            roles: FieldValue.arrayUnion("academy_participant"),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // 3. Clear Cache
        try {
            await invalidateServiceCache(userId, 'academy');
            await invalidateAdminGlobalStats();
        } catch (cacheError) {
            logger.error('[Academy Approval] Cache clear error:', cacheError);
        }

        // 4. Send Approval Email
        if (userEmail && process.env.RESEND_API_KEY) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);
                const { error } = await resend.emails.send({
                    from: process.env.EMAIL_FROM || "Easy Sales Export Academy <info@easysalesexport.com>",
                    to: userEmail,
                    subject: "🎓 Academy Application Approved!",
                    html: `
                        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                            <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:32px;border-radius:12px 12px 0 0;text-align:center;">
                                <h1 style="color:white;margin:0;font-size:24px;">Welcome to the Academy!</h1>
                            </div>
                            <div style="padding:32px;background:#fff;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
                                <h2 style="color:#7c3aed;">Application Approved ✅</h2>
                                <p>Congratulations! Your application to the Easy Sales Export Academy has been <strong>approved</strong>.</p>
                                <p>You now have full access to Academy training resources, live sessions, and certification programs.</p>
                                <div style="text-align:center;margin:24px 0;">
                                    <a href="${process.env.NEXTAUTH_URL || 'https://easysalesexport.com'}/academy/dashboard"
                                       style="background:#7c3aed;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">
                                        Go to Academy Dashboard
                                    </a>
                                </div>
                                <p style="color:#6b7280;font-size:14px;">Easy Sales Export Academy Team</p>
                            </div>
                        </div>
                    `
                });
                if (error) {
                    logger.error("Resend API Error (Academy approval email):", error);
                }
            } catch (emailError) {
                logger.error("Failed to send Academy approval email:", emailError);
            }
        }

        // 5. Audit
        await createAdminAuditLog({
            action: "academy_approve",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "application",
            metadata: { userId: userId },
        });

        // Revalidate
        revalidatePath("/academy", "page");
        revalidatePath("/dashboard", "page");
        updateTag(`user-status-${userId}`);

        return {
            error: null,
            success: true as const,
            message: "Academy application approved successfully",
        };
    } catch (error: any) {
        logger.error("Approve Academy application error:", error);
        return { error: "Failed to approve application", success: false as const };
    }
}

async function _rejectAcademyApplicationAction(
    applicationId: string,
    reason: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        const roles = session.user.roles || [];
        const hasAcademyAccess = roles.some(r => r === "admin" || r === "super_admin" || r === "academy_admin");
        if (!session?.user || !hasAcademyAccess) {
            return { error: "Unauthorized", success: false as const };
        }

        let userId: string | undefined;

        // Perform updates in a single transaction for atomicity
        await db.runTransaction(async (transaction) => {
            const appDocRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId);
            const appDoc = await transaction.get(appDocRef);
            if (!appDoc.exists) throw new Error("Application not found");

            const appData = appDoc.data();
            userId = appData?.userId;

            // 1. Update application status
            transaction.update(appDocRef, {
                status: "rejected",
                rejectionReason: reason,
                reviewedBy: session.user.id,
                reviewedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            // 2. Update user status
            if (userId) {
                const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
                transaction.update(userRef, {
                    "serviceRegistrations.academy.status": "rejected",
                    // The role goes too, or the rejection revokes nothing —
                    // checkModuleAccess grants Academy from the JWT role alone.
                    // See lib/module-grant-roles.ts.
                    roles: FieldValue.arrayRemove(moduleGrantRole("academy")),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }
        });

        await createAdminAuditLog({
            action: "academy_reject",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "application",
            metadata: { reason },
        });

        // Revalidate
        revalidatePath("/academy", "page");
        revalidatePath("/dashboard", "page");
        if (userId) updateTag(`user-status-${userId}`);

        // Clear cache
        try {
            if (userId) {
                const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
                await invalidateServiceCache(userId, 'academy');
            }
            await invalidateAdminGlobalStats();
        } catch (cacheError) {
            logger.error('[Academy Rejection Cache] Cache clear error:', cacheError);
        }

        return {
            error: null,
            success: true as const,
            message: "Academy application rejected",
        };
    } catch (error: any) {
        logger.error("Reject Academy application error:", error);
        return { error: "Failed to reject application", success: false as const };
    }
}

// ============================================
// Mark Academy Application Under Review
// ============================================

async function _markAcademyApplicationUnderReviewAction(
    applicationId: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        const roles = session.user.roles || [];
        const hasAcademyAccess = roles.some(r => r === "admin" || r === "super_admin" || r === "academy_admin");
        if (!session?.user || !hasAcademyAccess) {
            return { error: "Unauthorized", success: false as const };
        }

        await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId).update({
            status: "under_review",
            reviewedBy: session.user.id,
            reviewStartedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        await createAdminAuditLog({
            action: "academy_under_review",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "application",
        });

        return {
            error: null,
            success: true as const,
            message: "Application marked as under review",
        };
    } catch (error: any) {
        logger.error("Mark Academy application under review error:", error);
        return { error: "Failed to update application status", success: false as const };
    }
}

// ============================================
// Manual Academy Enrollment (Admin)
// ============================================

async function _manualAcademyEnrollmentAction(
    userId: string,
    plan: "foundation" | "standard" | "elite"
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        // Check if admin has user update permissions (or a specific academy permission)
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return { error: "Unauthorized: Permission required - users:update", success: false as const };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return { error: "User not found", success: false as const };
        }

        await userRef.update({
            "serviceRegistrations.academy.status": "active",
            "serviceRegistrations.academy.plan": plan,
            "serviceRegistrations.academy.paymentStatus": "completed",
            "serviceRegistrations.academy.enrolledAt": FieldValue.serverTimestamp(),
            // Ensure they have the academy role
            roles: FieldValue.arrayUnion("academy_participant"),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // ── Write/Update Application for Admin Dashboard ────────────────────────
        // Find existing applications for this user and update them, or create a mock one
        try {
            const appsQuery = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .where("userId", "==", userId)
                .get();

            if (!appsQuery.empty) {
                // Update all existing applications
                const promises = appsQuery.docs.map(doc => {
                    return db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(doc.id).update({
                        status: "approved",
                        plan: plan,
                        paymentStatus: "completed",
                        reviewedAt: FieldValue.serverTimestamp(),
                        reviewedBy: session.user.id
                    });
                });
                await Promise.all(promises);
                logger.info(`[Academy Manual Enrollment] Updated ${promises.length} existing applications to ${plan}`);
            } else {
                // Create mock application if none exists
                const mockAppRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(`manual_${userId}`);
                await mockAppRef.set({
                    applicationId: `manual_${userId}`,
                    userId: userId,
                    status: "approved",
                    plan: plan,
                    paymentStatus: "completed",
                    source: "manual_enrollment",
                    submittedAt: FieldValue.serverTimestamp(),
                    reviewedAt: FieldValue.serverTimestamp(),
                    reviewedBy: session.user.id
                }, { merge: true });
                logger.info(`[Academy Manual Enrollment] Created mock application for ${userId} with plan ${plan}`);
            }
        } catch (e) {
            logger.error("[Academy Manual Enrollment] Failed to create or update application:", e);
        }

        // CLEAR CACHE
        try {
            const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
            await invalidateServiceCache(userId, 'academy');
            logger.info(`[Academy Manual Enrollment] Cache cleared for user: ${userId}`);
        } catch (cacheError) {
            logger.error('[Academy Manual Enrollment] Cache clear error:', cacheError);
        }

        // Send Email Notification
        try {
            const userData = userDoc.data();
            const userEmail = userData?.email || userData?.emailAddress;
            const userName = userData?.name || userData?.fullName || userData?.displayName || "Student";
            if (userEmail) {
                const { sendAcademyEnrollmentEmail } = await import('@/lib/email-notifications');
                await sendAcademyEnrollmentEmail(userEmail, userName, plan);
                logger.info(`[Academy Manual Enrollment] Email sent to: ${userEmail}`);
            } else {
                logger.warn(`[Academy Manual Enrollment] Skip email: No email address for user: ${userId}`);
            }
        } catch (emailError: any) {
            logger.error(`[Academy Manual Enrollment] Failed to send email:`, emailError);
            // Non-blocking error
        }

        // Log audit
        await createAdminAuditLog({
            action: "academy_manual_enroll",
            userId: session.user.id,
            targetId: userId,
            targetType: "user",
            metadata: { plan },
        });

        return {
            error: null,
            success: true as const,
            message: `User successfully enrolled in Academy (${plan} package)`,
        };
    } catch (error: any) {
        logger.error("Manual academy enrollment error:", error);
        return { error: "Failed to enroll user: " + error.message, success: false as const };
    }
}

export const getAcademyApplicationsAction = withFlexibleSafeAction("getAcademyApplicationsAction", _getAcademyApplicationsAction);

export const approveAcademyApplicationAction = withFlexibleSafeAction("approveAcademyApplicationAction", _approveAcademyApplicationAction);

export const rejectAcademyApplicationAction = withFlexibleSafeAction("rejectAcademyApplicationAction", _rejectAcademyApplicationAction);

export const markAcademyApplicationUnderReviewAction = withFlexibleSafeAction("markAcademyApplicationUnderReviewAction", _markAcademyApplicationUnderReviewAction);

export const manualAcademyEnrollmentAction = withFlexibleSafeAction("manualAcademyEnrollmentAction", _manualAcademyEnrollmentAction);
