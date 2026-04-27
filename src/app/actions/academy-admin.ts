"use server";

import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { FieldValue, FieldPath, AggregateField } from "firebase-admin/firestore";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { createAdminAuditLog } from "@/lib/audit-log-admin";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { serializeDocs } from "@/lib/firestore-serialize";

/**
 * Academy Admin Actions - Application Approval/Rejection
 */

type ActionState =
    | { error: string; success: false; data?: null; meta?: null }
    | { error: null; success: true; data: { message: string }; meta?: null };

/**
 * Approve Academy Learner Application
 */
export async function approveAcademyApplicationAction(
    applicationId: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return { error: "Unauthorized: Permission required - users:update", success: false };
        }

        // 1. Get Application
        const appRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();

        if (!appDoc.exists) {
            return { error: "Application not found", success: false };
        }

        const appData = appDoc.data()!;
        const userId = appData.userId;

        if (!userId) {
            return { error: "Application missing user ID", success: false };
        }

        // 2. Update Application Status
        await appRef.update({
            status: "approved",
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
        });

        // 3. Update User Profile (Verify, Add Role, Activate Service) - dot notation prevents cross-module data loss
        await db.collection(COLLECTIONS.USERS).doc(userId).set({
            isVerified: true,
            verifiedBy: session.user.id,
            verifiedAt: FieldValue.serverTimestamp(),
            roles: FieldValue.arrayUnion("academy_participant"),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        // Separate dot-notation update for nested serviceRegistrations to avoid overwriting other services
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            "serviceRegistrations.academy.status": "approved",
            "serviceRegistrations.academy.applicationId": applicationId,
            "serviceRegistrations.academy.approvedAt": FieldValue.serverTimestamp(),
        });

        // 4. CLEAR CACHE - User now has Academy access
        try {
            const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
            await invalidateServiceCache(userId, 'academy');
            logger.info(`[Academy Approval] Cache cleared for user: ${userId}`);
        } catch (cacheError) {
            logger.error('[Academy Approval] Cache clear error:', cacheError);
        }

        // 5. Send Approval Email
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

        return {
            error: null,
            success: true,
            data: { message: "Academy application approved successfully" }
        };
    } catch (error: any) {
        logger.error("Approve Academy application error:", error);
        return { error: "Failed to approve application", success: false };
    }
}

/**
 * Reject Academy Learner Application
 */
export async function rejectAcademyApplicationAction(
    applicationId: string,
    reason: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return { error: "Unauthorized: Permission required - users:update", success: false };
        }

        // 1. Get Application
        const appRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();

        if (!appDoc.exists) {
            return { error: "Application not found", success: false };
        }

        const appData = appDoc.data()!;

        // 2. Update Application Status
        await appRef.update({
            status: "rejected",
            rejectionReason: reason,
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
        });

        const userId = appData.userId;
        if (userId) {
            // 3. Update User Profile (Mark as rejected)
            await db.collection(COLLECTIONS.USERS).doc(userId).update({
                "serviceRegistrations.academy.status": "rejected",
                "serviceRegistrations.academy.rejectedAt": FieldValue.serverTimestamp(),
            });

            // CLEAR CACHE
            try {
                const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
                await invalidateServiceCache(userId, 'academy');
                logger.info(`[Academy Rejection] Cache cleared for user: ${userId}`);
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

        return {
            error: null,
            success: true,
            data: { message: "Academy application rejected" }
        };
    } catch (error: any) {
        logger.error("Reject Academy application error:", error);
        return { error: "Failed to reject application", success: false };
    }
}

/**
 * Update Academy Application Payment Status (Admin)
 */
export async function updateAcademyApplicationPaymentAction(
    applicationId: string,
    paymentStatus: "pending" | "completed" | "paid",
    paymentAmount: number,
    plan: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return { error: "Unauthorized: Permission required", success: false };
        }

        const appRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();

        if (!appDoc.exists) {
            return { error: "Application not found", success: false };
        }

        const appData = appDoc.data()!;

        await appRef.update({
            paymentStatus,
            paymentAmount,
            plan,
            paymentVerifiedAt: paymentStatus === "completed" || paymentStatus === "paid" ? FieldValue.serverTimestamp() : null,
            paymentVerifiedBy: paymentStatus === "completed" || paymentStatus === "paid" ? session.user.id : null,
        });

        if (appData.userId) {
            await db.collection(COLLECTIONS.USERS).doc(appData.userId).update({
                "serviceRegistrations.academy.paymentStatus": paymentStatus,
                "serviceRegistrations.academy.plan": plan
            });
        }

        await createAdminAuditLog({
            action: "academy_update_payment",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "academy_application",
            details: `Updated Academy application payment: ${paymentStatus}, amount: ₦${paymentAmount}, plan: ${plan}`,
        });

        return {
            error: null,
            success: true,
            data: { message: "Payment status updated successfully" }
        };
    } catch (error: any) {
        logger.error("Update Academy application payment error:", error);
        return { error: "Failed to update payment status", success: false };
    }
}

/**
 * Get Pending Academy Applications (Admin)
 */
export async function getPendingAcademyApplicationsAction(): Promise<{
    error?: string;
    success: boolean;
    data?: any;
    meta?: any;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return { error: "Unauthorized: Permission required - users:update", success: false };
        }

        const snapshot = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
            .where("status", "==", "pending")
            .get();

        const applications = snapshot.docs.map(doc => {
            const d = doc.data();
            const submittedAtDate: Date = d.submittedAt?.toDate?.() || new Date();
            return {
                id: doc.id,
                ...d,
                // Serialize all Timestamps to ISO strings for Client Component compatibility
                submittedAt: submittedAtDate.toISOString(),
                reviewedAt: d.reviewedAt?.toDate?.()?.toISOString() ?? null,
                createdAt: d.createdAt?.toDate?.()?.toISOString() ?? null,
                updatedAt: d.updatedAt?.toDate?.()?.toISOString() ?? null,
            };
        }).sort((a: any, b: any) =>
            new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
        );

        return {
            error: undefined,
            success: true,
            data: applications,
        };
    } catch (error: any) {
        logger.error("Get pending Academy applications error:", error);
        return { error: "Failed to fetch applications", success: false };
    }
}

/**
 * Get Academy global applications stats (Admin)
 */
export async function getAcademyStatsAction(): Promise<{
    success: boolean;
    data?: {
        stats: {
            totalApplications: number;
            pending: number;
            under_review: number;
            approved: number;
            rejected: number;
        }
    };
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return { error: "Unauthorized: Permission required", success: false };
        }

        const baseQuery = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS);
        
        const [
            totalSnap,
            pendingSnap,
            underReviewSnap,
            approvedSnap,
            rejectedSnap
        ] = await Promise.all([
            baseQuery.count().get(),
            baseQuery.where("status", "==", "pending").count().get(),
            baseQuery.where("status", "==", "under_review").count().get(),
            baseQuery.where("status", "==", "approved").count().get(),
            baseQuery.where("status", "==", "rejected").count().get()
        ]);

        return { 
            success: true, 
            data: { 
                stats: { 
                    totalApplications: totalSnap.data().count,
                    pending: pendingSnap.data().count,
                    under_review: underReviewSnap.data().count,
                    approved: approvedSnap.data().count,
                    rejected: rejectedSnap.data().count,
                } 
            } 
        };
    } catch (error: any) {
        logger.error("Get academy stats error:", error);
        return { success: false, error: "Failed to fetch academy stats" };
    }
}

export async function getStandardAcademyApplicationsAction(options: {
    limit?: number;
    search?: string;
    status?: "pending" | "approved" | "rejected" | "under_review" | "all";
    lastDocId?: string;
    sortOrder?: "asc" | "desc";
} = {}): Promise<{ success: boolean; data?: any[]; error?: string; meta?: any; lastDocId?: string; hasMore?: boolean }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, error: "Not authenticated" };

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists || (!userDoc.data()?.roles?.includes("admin") && !userDoc.data()?.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        const fetchLimit = options.search ? 2000 : (options.limit || 50);
        const orderDirection = options.sortOrder || "desc";
        // NOTE: academy_applications documents use 'submittedAt', not 'createdAt'.
        // orderBy('createdAt') would return 0 results because the field doesn't exist on most docs.
        let q: any = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).orderBy("submittedAt", orderDirection);
        
        if (options.status && options.status !== "all") {
            q = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .where("status", "==", options.status)
                .orderBy("submittedAt", orderDirection);
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

        const userIds = [...new Set(applications.map(app => app.userId).filter(Boolean))];
        const userMap = new Map<string, any>();
        
        for (let i = 0; i < userIds.length; i += 30) {
            const chunk = userIds.slice(i, i + 30);
            if (chunk.length > 0) {
                const userSnaps = await db.collection(COLLECTIONS.USERS).where(FieldPath.documentId(), "in", chunk).get();
                userSnaps.docs.forEach(d => userMap.set(d.id, d.data()));
            }
        }

        const standardForms = applications.map((app: any) => {
            const uData = (userMap.get(app.userId as string) || {}) as any;
            const pi = (app.personalInfo || {}) as any;
            const localName = pi.firstName ? `${pi.firstName} ${pi.lastName || ''}`.trim() : (pi.fullName || null);
            // Fix: check uData.firstName presence FIRST to avoid "undefined undefined" for legacy users
            const userName = uData.firstName
                ? `${uData.firstName} ${uData.lastName || ''}`.trim()
                : (uData.name || uData.fullName || localName || "Unknown User");

            // Merge app + personalInfo sub-object + USERS profile so every field is populated
            // regardless of which path the data came through (direct fields, nested personalInfo, or USERS doc).
            const mergedData = {
                ...app,
                // Flatten personalInfo fields to top-level for consistent access by admin UI
                phone:              app.phone              || pi.phone              || uData.phone       || uData.phoneNumber || null,
                gender:             app.gender             || pi.gender             || uData.gender      || null,
                dateOfBirth:        app.dateOfBirth        || pi.dateOfBirth        || uData.dob         || null,
                occupation:         app.occupation         || pi.occupation         || uData.occupation  || null,
                stateOfOrigin:      app.stateOfOrigin      || pi.stateOfOrigin      || (typeof uData.address === 'object' ? uData.address?.state  : uData.stateOfOrigin)  || null,
                lga:                app.lga                || pi.lga                || (typeof uData.address === 'object' ? uData.address?.lga    : uData.lga)            || null,
                residentialAddress: app.residentialAddress || pi.residentialAddress || (typeof uData.address === 'object' ? uData.address?.street : uData.address)        || null,
                firstName:          pi.firstName           || app.firstName         || uData.firstName   || null,
                lastName:           pi.lastName            || app.lastName          || uData.lastName    || null,
                fullName:           pi.fullName            || app.fullName          || `${uData.firstName || ''} ${uData.lastName || ''}`.trim() || null,
                email:              app.email              || pi.email              || uData.email        || null,
            };

            return {
                id: app.id,
                user: {
                    id: app.userId,
                    name: userName,
                    email: mergedData.email || "Unknown",
                    phone: mergedData.phone || "Unknown",
                    dob: mergedData.dateOfBirth || "Unknown",
                    address: mergedData.residentialAddress || "Unknown",
                    state: mergedData.stateOfOrigin || "Unknown",
                    lga: mergedData.lga || "Unknown",
                },
                status: app.status || "pending",
                data: mergedData
            };
        });

        // Client-side search application if specified
        let finalForms = standardForms;
        if (options.search) {
            const s = options.search.toLowerCase().trim();
            finalForms = standardForms.filter((f: any) => {
                const searchString = [
                    f.id,
                    f.user?.id,
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

        return { 
            success: true, 
            data: finalForms,
            lastDocId: nextCursor,
            hasMore: !!nextCursor,
            meta: {
                totalFetched: applications.length,
                hasMore: !!nextCursor
            }
        };
    } catch (error) {
        logger.error("Get standard academy apps error:", error);
        return { success: false, error: "Failed to fetch normalized applications" };
    }
}

/**
 * Log Academy Export Action
 */
export async function logAcademyExportAction(
    details: { count: number, filters: any }
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        
        await createAdminAuditLog({
            action: "data_export",
            userId: session.user.id,
            targetId: "academy_applications",
            targetType: "export",
            details: `Exported ${details.count} academy applications. Filters: ${JSON.stringify(details.filters)}`,
            metadata: details
        });

        return { error: null, success: true, data: { message: "Export logged." } };
    } catch (error: any) {
        logger.error("Error logging export:", error);
        return { error: "An unexpected error occurred", success: false };
    }
}
