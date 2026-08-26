"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { createAdminAuditLog } from "@/lib/audit-log";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { ActionResponse, withFlexibleSafeAction } from "@/lib/safe-action";
import { normaliseAcademyPlan } from "@/lib/academy-plan";
import { moduleGrantRole } from "@/lib/module-grant-roles";
import { canSendEmail } from "@/lib/email-notifications";

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

            // 2. Read User Profile (read before any writes)
            const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
            const userDoc = await transaction.get(userRef);

            // 3. Update Application Status
            transaction.update(appRef, {
                status: "approved",
                reviewedBy: session.user.id,
                reviewedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1),
            });

            // 4. Update User Profile (Verify, Add Role, Activate Service)
            if (!userDoc.exists) {
                const pi = appData.personalInfo || {};
                transaction.set(userRef, {
                    uid: userId,
                    email: pi.email || appData.email || "",
                    fullName: pi.fullName || (pi.firstName ? `${pi.firstName} ${pi.lastName || ''}`.trim() : "Learner"),
                    createdAt: FieldValue.serverTimestamp(),
                    roles: ["academy_participant"],
                    isVerified: true,
                });
            }

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
        if (canSendEmail("academy decision email", appData.personalInfo?.email)) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);

                const { data, error } = await resend.emails.send({
                    from: process.env.EMAIL_FROM || "Easy Sales Export Academy <info@easysalesexport.com>",
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
                    // The role goes too, or the rejection revokes nothing —
                    // checkModuleAccess grants Academy from the JWT role alone.
                    // See lib/module-grant-roles.ts.
                    roles: FieldValue.arrayRemove(moduleGrantRole("academy")),
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
        if (canSendEmail("academy decision email", appData.personalInfo?.email)) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);

                const { data, error } = await resend.emails.send({
                    from: process.env.EMAIL_FROM || "Easy Sales Export Academy <info@easysalesexport.com>",
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

        // The plan is an ACCESS KEY, so it is normalised before it is stored.
        //
        // `plan` arrives here as an unvalidated string and is written straight
        // into `serviceRegistrations.academy.plan`, which is the single field
        // checkCourseAccess reads to decide which course tiers a learner may
        // enrol in. A value that is not one of the three plans — "Elite" with a
        // capital, "elite " with a trailing space, or the form's "registration"
        // option — falls through checkCourseAccess to its default deny, so an
        // admin recording a payment could silently revoke every paid course.
        //
        // null is the honest value for "registered, no tier": registration
        // itself is free, and checkCourseAccess treats an absent plan exactly as
        // it treated "registration", so nothing changes behaviourally.
        const normalisedPlan = normaliseAcademyPlan(plan);

        // Perform atomic update in a transaction
        await db.runTransaction(async (transaction) => {
            const appSnap = await transaction.get(appRef);
            if (!appSnap.exists) throw new Error("Application not found");

            transaction.update(appRef, {
                paymentStatus,
                paymentAmount,
                plan: normalisedPlan,
                paymentVerifiedAt: paymentStatus === "completed" || paymentStatus === "paid" ? FieldValue.serverTimestamp() : null,
                paymentVerifiedBy: paymentStatus === "completed" || paymentStatus === "paid" ? session.user.id : null,
                _version: FieldValue.increment(1),
            });

            if (appData.userId) {
                const userRef = db.collection(COLLECTIONS.USERS).doc(appData.userId);
                transaction.update(userRef, {
                    "serviceRegistrations.academy.paymentStatus": paymentStatus,
                    "serviceRegistrations.academy.plan": normalisedPlan
                });
            }
        });

        await createAdminAuditLog({
            action: "academy_update_payment",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "academy_application",
            details: `Updated Academy application payment: ${paymentStatus}, amount: ₦${paymentAmount}, plan: ${normalisedPlan ?? "none"}`,
        });

        return { success: true, error: null, data: null };
    } catch (error: any) {
        logger.error("Update Academy application payment error:", error);
        return { success: false, error: "Failed to update payment status", data: null };
    }
}

export const updateAcademyApplicationPaymentAction = withFlexibleSafeAction("updateAcademyApplicationPaymentAction", _updateAcademyApplicationPaymentAction);
