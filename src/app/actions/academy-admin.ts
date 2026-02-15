"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue } from "firebase-admin/firestore";
import { auth } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit-log";
import { hasAdminPermission } from "@/lib/admin-permissions";

/**
 * Academy Admin Actions - Application Approval/Rejection
 */

type ActionState =
    | { error: string; success: false }
    | { error: null; success: true; message: string };

/**
 * Approve Academy Learner Application
 */
export async function approveAcademyApplicationAction(
    applicationId: string
): Promise<ActionState> {
    try {
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return { error: "Unauthorized: Permission required - users:update", success: false };
        }

        // 1. Get Application
        const appRef = db.collection("ACADEMY_APPLICATIONS").doc(applicationId);
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

        // 3. Update User Profile (Verify, Add Role, Activate Service)
        await db.collection("users").doc(userId).set({
            isVerified: true,
            verifiedBy: session.user.id,
            verifiedAt: FieldValue.serverTimestamp(),
            roles: FieldValue.arrayUnion("academy_participant"),
            serviceRegistrations: {
                academy: {
                    status: "approved",
                    applicationId: applicationId,
                    approvedAt: FieldValue.serverTimestamp(),
                }
            },
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // 4. CLEAR CACHE - User now has Academy access
        try {
            const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
            await invalidateServiceCache(userId, 'academy');
            console.log(`[Academy Approval] Cache cleared for user: ${userId}`);
        } catch (cacheError) {
            logger.error('[Academy Approval] Cache clear error:', cacheError);
        }

        // 5. Send Approval Email
        if (process.env.RESEND_API_KEY && appData.personalInfo?.email) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);

                await resend.emails.send({
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
            } catch (emailError) {
                logger.error("Failed to send Academy approval email:", emailError);
                // Don't block success on email failure
            }
        }

        // 6. Log Audit
        await createAuditLog({
            action: "academy_approve",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "academy_application",
            details: `Approved Academy application for ${appData.personalInfo?.fullName || 'Unknown'}`,
        });

        return {
            error: null,
            success: true,
            message: "Academy application approved successfully"
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
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return { error: "Unauthorized: Permission required - users:update", success: false };
        }

        // 1. Get Application
        const appRef = db.collection("ACADEMY_APPLICATIONS").doc(applicationId);
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

        // 3. Send Rejection Email
        if (process.env.RESEND_API_KEY && appData.personalInfo?.email) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);

                await resend.emails.send({
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
            } catch (emailError) {
                logger.error("Failed to send Academy rejection email:", emailError);
            }
        }

        // 4. Log Audit
        await createAuditLog({
            action: "academy_reject",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "academy_application",
            details: `Rejected Academy application: ${reason}`,
        });

        return {
            error: null,
            success: true,
            message: "Academy application rejected"
        };
    } catch (error: any) {
        logger.error("Reject Academy application error:", error);
        return { error: "Failed to reject application", success: false };
    }
}

/**
 * Get Pending Academy Applications (Admin)
 */
export async function getPendingAcademyApplicationsAction(): Promise<{
    error: string | null;
    success: boolean;
    data?: any[];
}> {
    try {
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return { error: "Unauthorized: Permission required - users:update", success: false };
        }

        const snapshot = await db.collection("ACADEMY_APPLICATIONS")
            .where("status", "==", "pending")
            .orderBy("submittedAt", "desc")
            .get();

        const applications = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            submittedAt: doc.data().submittedAt?.toDate() || new Date(),
        }));

        return {
            error: null,
            success: true,
            data: applications,
        };
    } catch (error: any) {
        logger.error("Get pending Academy applications error:", error);
        return { error: "Failed to fetch applications", success: false };
    }
}
