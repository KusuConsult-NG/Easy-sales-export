"use server";

import { ZodError } from "zod";

import { db, adminAuth } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import crypto from 'crypto';
import { FieldValue, Timestamp, FieldPath } from "firebase-admin/firestore";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logAuditAction } from "./audit";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";
import { createNotificationAction } from "@/app/actions/notifications";
import {
    WaveApplicationReviewSchema,
    WithdrawalProcessingSchema,
    UserVerificationToggleSchema,
    LandListingVerificationSchema,
    LoanApplicationReviewSchema,
    ExportOnboardingReviewSchema,
    UserKycVerificationSchema
} from "@/lib/schemas";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { requireAdmin } from "@/lib/require-admin";
import { atomicUpdateUser } from "@/lib/services/userService";

/**
 * Admin Server Actions
 * 
 * Handles admin-only operations for WAVE applications, withdrawal processing,
 * and user management.
 */

type ActionState =
    | { error: string; success: false }
    | { error: null; success: true; message: string };

// ============================================
// Approve/Reject WAVE Application
// ============================================

export async function approveWaveApplicationAction(
    applicationId: string
): Promise<ActionState> {
    try {
        // Live role re-validation — bypasses stale JWT
        const adminCheck = await requireAdmin();
        if ("error" in adminCheck) return { error: adminCheck.error, success: false };

        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "wave:approve_applications")) {
            return { error: "Unauthorized: Permission required - wave:approve_applications", success: false };
        }

        const valid = WaveApplicationReviewSchema.safeParse({ applicationId, status: "approved" });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false };
        }

        // Get application first to identify user
        const appRef = db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();

        if (!appDoc.exists) {
            return { error: "Application not found", success: false };
        }

        const appData = appDoc.data()!;
        const userId = appData.userId;
        const userEmail = appData.userEmail; // Ensure we have this from submission

        if (!userId) {
            return { error: "Application missing user ID", success: false };
        }

        // 1. Update Application Status
        await appRef.update({
            status: "approved",
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            approvedBy: session.user.id,
            approvalTimestamp: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // 2. Verify User & Assign Role (WAVE Participant)
        // We auto-verify them because the WAVE application is the verification process
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            isVerified: true,
            verifiedBy: session.user.id,
            verifiedAt: FieldValue.serverTimestamp(),
            roles: FieldValue.arrayUnion("wave_participant"),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // 3. Create/Update Wave Member Record (Enrolled)
        await db.collection(COLLECTIONS.WAVE_MEMBERS).doc(userId).set({
            active: true,
            enrolledAt: FieldValue.serverTimestamp(),
            applicationId: applicationId,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // 4. CLEAR CACHE - User now has Wave access
        try {
            const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
            await invalidateServiceCache(userId, 'wave');
            logger.info(`[Wave Approval] Cache cleared for user: ${userId}`);
        } catch (cacheError) {
            logger.error('[Wave Approval] Cache clear error:', cacheError);
        }

        // 4. Send Approval Email
        if (userEmail && process.env.RESEND_API_KEY) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);

                const { data, error } = await resend.emails.send({
                    from: "WAVE Program <noreply@easysalesexport.com>",
                    to: userEmail,
                    subject: "Welcome to WAVE - Application Approved!",
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #059669;">Congratulations!</h2>
                            <p>We are thrilled to inform you that your application for the <strong>Women Agro-Value Expansion (WAVE)</strong> program has been approved.</p>
                            
                            <div style="background: #ecfdf5; padding: 16px; border-radius: 8px; margin: 20px 0; border: 1px solid #a7f3d0;">
                                <p style="margin: 0; color: #065f46;"><strong>Status:</strong> Approved</p>
                                <p style="margin: 5px 0 0; color: #065f46;"><strong>Role:</strong> WAVE Participant</p>
                            </div>

                            <p>You now have full access to:</p>
                            <ul>
                                <li>Exclusive WAVE training resources and guides</li>
                                <li>Cooperative funding opportunities</li>
                                <li>Marketplace features</li>
                            </ul>

                            <p><strong>Next Steps:</strong></p>
                            <p>Log in to your dashboard to start exploring the resources available to you.</p>

                            <div style="text-align: center; margin-top: 30px;">
                                <a href="https://easysalesexport.com/wave/dashboard" style="background-color: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Go to WAVE Dashboard</a>
                            </div>
                        </div>
                    `
                });
                if (error) {
                    logger.error("Resend API Error (WAVE approval email):", error);
                }
            } catch (emailError) {
                logger.error("Failed to send WAVE approval email:", emailError);
                // Don't block success on email failure
            }
        }

        // Log audit
        await logAuditAction("wave_approve", applicationId, "application", {
            adminId: session.user.id,
            userId: userId,
        });

        return {
            error: null,
            success: true,
            message: "WAVE application approved and user verified successfully",
        };
    } catch (error: any) {
        logger.error("Approve WAVE application error:", error);
        return { error: "Failed to approve application", success: false };
    }
}

export async function rejectWaveApplicationAction(
    applicationId: string,
    reason: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "wave:approve_applications")) {
            return { error: "Unauthorized: Permission required - wave:approve_applications", success: false };
        }

        const valid = WaveApplicationReviewSchema.safeParse({ applicationId, status: "rejected", reason });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false };
        }

        await db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId).update({
            status: "rejected",
            rejectionReason: reason,
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            rejectedBy: session.user.id,
            rejectedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Get application first to identify user
        const appRef = db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();
        const appData = appDoc.data();
        const userId = appData?.userId;

        if (userId) {
            // Update User Profile (Mark as rejected)
            await db.collection(COLLECTIONS.USERS).doc(userId).update({
                "serviceRegistrations.wave.status": "rejected",
                "serviceRegistrations.wave.rejectedAt": FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            // CLEAR CACHE
            try {
                const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
                await invalidateServiceCache(userId, 'wave');
                logger.info(`[Wave Rejection] Cache cleared for user: ${userId}`);
            } catch (cacheError) {
                logger.error('[Wave Rejection] Cache clear error:', cacheError);
            }
        }

        // Send Rejection Email
        if (process.env.RESEND_API_KEY && appData?.userEmail) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);

                const { data, error } = await resend.emails.send({
                    from: "WAVE Program <noreply@easysalesexport.com>",
                    to: appData.userEmail,
                    subject: "WAVE Application Update",
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #dc2626;">WAVE Application Update</h2>
                            <p>Thank you for your interest in the Women Agro-Value Expansion (WAVE) program.</p>
                            
                            <div style="background: #fef2f2; padding: 16px; border-radius: 8px; margin: 20px 0;">
                                <p>Unfortunately, we are unable to approve your application at this time.</p>
                                <p><strong>Reason provided:</strong></p>
                                <p style="font-style: italic;">"${reason}"</p>
                            </div>

                            <p><strong>What You Can Do:</strong></p>
                            <ul>
                                <li>Review the feedback provided</li>
                                <li>Address the concerns mentioned</li>
                                <li>Re-apply when you have made the necessary adjustments</li>
                            </ul>

                            <p>If you have any questions or need clarification, please contact our support team.</p>
                        </div>
                    `
                });
                if (error) {
                    logger.error("Resend API Error (WAVE rejection email):", error);
                }
            } catch (emailError) {
                logger.error("Failed to send WAVE rejection email:", emailError);
            }
        }

        // Log audit
        await logAuditAction("wave_reject", applicationId, "application", {
            reason,
            adminId: session.user.id,
        });

        return {
            error: null,
            success: true,
            message: "WAVE application rejected",
        };
    } catch (error: any) {
        logger.error("Reject WAVE application error:", error);
        return { error: "Failed to reject application", success: false };
    }
}

// ============================================
// Process Withdrawal Request
// ============================================

export async function processWithdrawalAction(
    withdrawalId: string,
    action: "approve" | "reject",
    reasoning?: string
): Promise<ActionState> {
    try {
        // Live role re-validation — bypasses stale JWT
        const adminCheck = await requireAdmin();
        if ("error" in adminCheck) return { error: adminCheck.error, success: false };

        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "finance:process_withdrawals")) {
            return { error: "Unauthorized: Permission required - finance:process_withdrawals", success: false };
        }

        const valid = WithdrawalProcessingSchema.safeParse({ withdrawalId, action, reasoning });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false };
        }

        // Try standard withdrawals first, then cooperative_withdrawals
        let withdrawalRef = db.collection(COLLECTIONS.WITHDRAWALS).doc(withdrawalId);
        let withdrawalDoc = await withdrawalRef.get();

        if (!withdrawalDoc.exists) {
            withdrawalRef = db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).doc(withdrawalId);
            withdrawalDoc = await withdrawalRef.get();
        }

        if (!withdrawalDoc.exists) {
            return { error: "Withdrawal request not found", success: false };
        }

        const withdrawalData = withdrawalDoc.data()!;

        if (action === "approve") {
            // ══════════════════════════════════════════════
            // PAYOUT — Trigger Paystack Transfer immediately
            // ══════════════════════════════════════════════
            let payoutSuccess = false;
            let payoutError: string | undefined;
            let transferCode: string | undefined;

            try {
                const { paystackPayout } = await import("@/lib/paystack-transfer");

                // Get user bank details
                const userDoc = await db.collection(COLLECTIONS.USERS).doc(withdrawalData.userId).get();
                const userData = userDoc.data();

                if (userData?.bankAccountNumber && userData?.bankCode) {
                    const payoutResult = await paystackPayout(
                        {
                            accountNumber: userData.bankAccountNumber,
                            bankCode: userData.bankCode,
                            accountName: userData.bankAccountName || userData.name,
                        },
                        withdrawalData.amount,
                        `Withdrawal payout - ${withdrawalId}`
                    );
                    payoutSuccess = payoutResult.success;
                    payoutError = payoutResult.error;
                    transferCode = payoutResult.transferCode;
                } else {
                    payoutError = "User bank details not configured";
                }
            } catch (payoutErr: any) {
                payoutError = payoutErr.message;
                logger.error(`Payout error for withdrawal ${withdrawalId}:`, payoutErr);
            }

            await withdrawalRef.update({
                status: payoutSuccess ? "completed" : "approved_pending_payout",
                processedBy: session.user.id,
                processedAt: FieldValue.serverTimestamp(),
                adminNotes: reasoning || "",
                updatedAt: FieldValue.serverTimestamp(),
                ...(transferCode ? { paystackTransferCode: transferCode } : {}),
                ...(payoutError && !payoutSuccess ? { payoutError, pendingManualPayout: true } : {}),
            });
        } else {
            // Rejection — just update status
            await withdrawalRef.update({
                status: "rejected",
                processedBy: session.user.id,
                processedAt: FieldValue.serverTimestamp(),
                adminNotes: reasoning || "",
                updatedAt: FieldValue.serverTimestamp(),
            });
        }

        // Create notification for user
        await createNotificationAction({
            userId: withdrawalData.userId,
            type: action === "approve" ? "success" : "warning",
            title: action === "approve" ? "Withdrawal Approved" : "Withdrawal Rejected",
            message: action === "approve"
                ? `Your withdrawal request of ₦${withdrawalData.amount.toLocaleString()} has been approved and is being processed.`
                : `Your withdrawal request of ₦${withdrawalData.amount.toLocaleString()} was rejected. ${reasoning || ''}`,
            link: "/cooperatives",
            linkText: "View Dashboard",
        });

        // Log audit
        await logAuditAction(
            action === "approve" ? "withdrawal_approve" : "withdrawal_reject",
            withdrawalId,
            "withdrawal",
            { notes: reasoning, adminId: session.user.id }
        );

        return {
            error: null,
            success: true,
            message: `Withdrawal ${action === "approve" ? "approved and payout initiated" : "rejected"} successfully`,
        };
    } catch (error: any) {
        logger.error("Process withdrawal error:", error);
        return { error: "Failed to process withdrawal", success: false };
    }
}

// ============================================
// User Verification Toggle
// ============================================

export async function toggleUserVerificationAction(
    userId: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return { error: "Unauthorized: Permission required - users:update", success: false };
        }

        const valid = UserVerificationToggleSchema.safeParse({ userId });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false };
        }

        // Get current user doc
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return { error: "User not found", success: false };
        }

        const currentData = userDoc.data()!;
        const newVerificationStatus = !currentData.isVerified;

        await userRef.update({
            isVerified: newVerificationStatus,
            verifiedBy: session.user.id,
            verifiedAt: newVerificationStatus ? FieldValue.serverTimestamp() : null,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // CLEAR CACHE - User verification status changed
        try {
            const { invalidateUserCache } = await import('@/lib/cache-invalidation');
            await invalidateUserCache(userId);
            logger.info(`[User Verification] Cache cleared for user: ${userId}`);
        } catch (cacheError) {
            logger.error('[User Verification] Cache clear error:', cacheError);
        }

        // Log audit
        await logAuditAction(
            newVerificationStatus ? "user_verify" : "user_unverify",
            userId,
            "user",
            { adminId: session.user.id }
        );

        return {
            error: null,
            success: true,
            message: `User ${newVerificationStatus ? "verified" : "unverified"} successfully`,
        };
    } catch (error: any) {
        logger.error("Toggle user verification error:", error);
        return { error: "Failed to update verification status", success: false };
    }
}

// ============================================
// User KYC Verification Toggle
// ============================================

export async function toggleUserKycVerificationAction(
    userId: string,
    field: 'bvn' | 'nin' | 'tin' | 'cac',
    currentStatus: boolean
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        // Assuming "users:update" is sufficient for KYC. Could create a stricter role if needed.
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return { error: "Unauthorized: Permission required - users:update", success: false };
        }

        const valid = UserKycVerificationSchema.safeParse({ userId, field, currentStatus });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return { error: "User not found", success: false };
        }

        const newVerificationStatus = !currentStatus;

        // Map to both nested kyc.* paths (new) and top-level fields (legacy compatibility)
        const nestedFieldMap: Record<string, string> = {
            bvn: 'kyc.bvnVerified',
            nin: 'kyc.ninVerified',
            tin: 'tinVerified',
            cac: 'cacVerified',
        };
        const legacyFieldMap: Record<string, string> = {
            bvn: 'bvnVerified',
            nin: 'ninVerified',
            tin: 'tinVerified',
            cac: 'cacVerified',
        };
        const nestedField = nestedFieldMap[field];
        const legacyField = legacyFieldMap[field];
        const statusField = field === 'bvn' ? 'kyc.bvnStatus' : field === 'nin' ? 'kyc.ninStatus' : null;

        const updatePayload: Record<string, any> = {
            [nestedField]: newVerificationStatus,
            [legacyField]: newVerificationStatus,
            updatedAt: FieldValue.serverTimestamp(),
        };
        if (statusField) {
            updatePayload[statusField] = newVerificationStatus ? 'verified' : 'unverified';
        }
        // Also update overall kyc.status when BVN or NIN changes
        if (field === 'bvn' || field === 'nin') {
            const snap = await userRef.get();
            const otherVerified = snap.data()?.kyc?.[field === 'bvn' ? 'ninVerified' : 'bvnVerified'] ?? false;
            updatePayload['kyc.status'] = (newVerificationStatus && otherVerified) ? 'verified' : 'pending';
            updatePayload['kycVerified'] = newVerificationStatus && otherVerified;
        }

        await atomicUpdateUser(userId, updatePayload);

        // CLEAR CACHE
        try {
            const { invalidateUserCache } = await import('@/lib/cache-invalidation');
            await invalidateUserCache(userId);
            logger.info(`[User KYC Verification] Cache cleared for user: ${userId}`);
        } catch (cacheError) {
            logger.error('[User KYC Verification] Cache clear error:', cacheError);
        }

        // Log audit
        await logAuditAction(
            newVerificationStatus ? `user_kyc_verify_${field}` : `user_kyc_unverify_${field}`,
            userId,
            "user",
            { adminId: session.user.id }
        );

        return {
            error: null,
            success: true,
            message: `${field.toUpperCase()} ${newVerificationStatus ? "verified" : "unverified"} successfully`,
        };
    } catch (error: any) {
        logger.error(`Toggle user KYC verification error (${field}):`, error);
        return { error: `Failed to update ${field.toUpperCase()} verification status`, success: false };
    }
}

// ============================================
// Get WAVE Applications (Admin)
// ============================================

export async function getWaveApplicationsAction(
    statusFilter?: "pending" | "approved" | "rejected",
    limit = 50,
    lastCreatedAt?: Date | string
): Promise<{
    error: string | null;
    success: boolean;
    data?: any[];
    hasMore?: boolean; // simple indicator
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "wave:approve_applications")) {
            return { error: "Unauthorized: Permission required - wave:approve_applications", success: false };
        }

        let query = db.collection(COLLECTIONS.WAVE_APPLICATIONS)
            .orderBy("createdAt", "desc")
            .limit(limit);

        if (statusFilter) {
            query = db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where("status", "==", statusFilter)
                .limit(limit);
        }

        // Apply Cursor if provided
        if (lastCreatedAt) {
            const cursorDate = typeof lastCreatedAt === 'string' ? new Date(lastCreatedAt) : lastCreatedAt;
            query = query.startAfter(Timestamp.fromDate(cursorDate));
        }

        const snapshot = await query.get();
        const applications = serializeDocs(snapshot.docs)
            .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        return {
            error: null,
            success: true,
            data: applications,
            hasMore: applications.length === limit
        };
    } catch (error: any) {
        logger.error("Get WAVE applications error:", error);
        return { error: "Failed to fetch applications", success: false };
    }
}

// ============================================
// Get Pending Withdrawals (Admin)
// ============================================

export async function getPendingWithdrawalsAction(
    limit = 50,
    lastCreatedAt?: Date | string,
    statusFilter: "pending" | "completed" | "rejected" | "approved_pending_payout" | "all" = "pending"
): Promise<{
    error: string | null;
    success: boolean;
    data?: any[];
    hasMore?: boolean;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "finance:read")) {
            return { error: "Unauthorized: Permission required - finance:read", success: false };
        }

        // Helper to build a query per collection
        const buildQuery = (collectionName: string) => {
            return statusFilter === "all"
                ? db.collection(collectionName).orderBy("createdAt", "desc").limit(limit)
                : db.collection(collectionName)
                    .where("status", "==", statusFilter)
                    .orderBy("createdAt", "desc")
                    .limit(limit);
        };

        // Query both standard withdrawals AND cooperative_withdrawals
        const [stdSnap, coopSnap] = await Promise.all([
            buildQuery(COLLECTIONS.WITHDRAWALS).get(),
            buildQuery(COLLECTIONS.COOPERATIVE_WITHDRAWALS).get(),
        ]);

        const toRecord = (doc: FirebaseFirestore.QueryDocumentSnapshot, source: string) =>
            ({ ...serializeDoc(doc.id, doc.data()), source });

        const all = [
            ...stdSnap.docs.map(d => toRecord(d, "withdrawal")),
            ...coopSnap.docs.map(d => toRecord(d, "cooperative_withdrawal")),
        ].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, limit);

        return {
            error: null,
            success: true,
            data: all,
            hasMore: all.length === limit,
        };
    } catch (error: any) {
        logger.error("Get withdrawals error:", error);
        return { error: "Failed to fetch withdrawals", success: false };
    }
}


// ============================================
// Land Verification (Admin)
// ============================================

export async function getPendingLandListings(limit = 50): Promise<{
    error: string | null;
    success: boolean;
    listings?: any[];
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "land:verify_listings")) {
            return { error: "Unauthorized: Permission required - land:verify_listings", success: false };
        }

        // Pending lists are usually small, but let's cap it anyway
        const snapshot = await db.collection(COLLECTIONS.LAND_LISTINGS)
            .where("verificationStatus", "==", "pending")
            .orderBy("createdAt", "desc")
            .limit(limit)
            .get();

        const listings = snapshot.docs.map(doc => serializeDoc(doc.id, doc.data()));

        return {
            error: null,
            success: true,
            listings,
        };
    } catch (error: any) {
        logger.error("Get pending land listings error:", error);
        return { error: "Failed to fetch land listings", success: false };
    }
}

export async function verifyLandListing(
    listingId: string,
    decision: "approved" | "rejected",
    reason: string
): Promise<ActionState> {
    try {
        // Live role re-validation — bypasses stale JWT
        const adminCheck = await requireAdmin();
        if ("error" in adminCheck) return { error: adminCheck.error, success: false };

        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "land:verify_listings")) {
            return { error: "Unauthorized: Permission required - land:verify_listings", success: false };
        }

        const valid = LandListingVerificationSchema.safeParse({ listingId, decision, reason });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false };
        }

        // Update listing status
        const listingRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(listingId);
        const listingDoc = await listingRef.get();
        const ownerId = listingDoc.exists ? listingDoc.data()?.ownerId : null;

        await listingRef.update({
            verificationStatus: decision,
            verified: decision === "approved",
            verifiedBy: session.user.id,
            verifiedAt: FieldValue.serverTimestamp(),
            rejectionReason: decision === "rejected" ? reason : null,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // CLEAR CACHE - Owner's Farm Nation status changed
        if (ownerId && decision === "approved") {
            try {
                const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
                await invalidateServiceCache(ownerId, 'farmNation');
                logger.info(`[Land Verification] Cache cleared for user: ${ownerId}`);
            } catch (cacheError) {
                logger.error('[Land Verification] Cache clear error:', cacheError);
            }
        }

        // Use listing data for email (listingDoc already fetched above)
        if (listingDoc.exists) {
            const listingData = listingDoc.data()!;

            // Send email notification via Resend
            if (process.env.RESEND_API_KEY) {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);

                const emailSubject = decision === "approved"
                    ? "Land Listing Approved"
                    : "Land Listing Requires Updates";

                const emailContent = decision === "approved"
                    ? `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #10b981;">Land Listing Approved!</h2>
                            <p>Great news! Your land listing has been approved and is now live on Easy Sales Export.</p>
                            <p><strong>Listing:</strong> ${listingData.title}</p>
                            <p><strong>Location:</strong> ${listingData.location?.lga}, ${listingData.location?.state}</p>
                            <p>Your listing is now visible to potential buyers. You'll receive notifications when buyers express interest.</p>
                        </div>
                    `
                    : `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #ef4444;">Land Listing Requires Updates</h2>
                            <p>Your land listing was reviewed but requires some updates before it can be published.</p>
                            <p><strong>Listing:</strong> ${listingData.title}</p>
                            <p><strong>Reason:</strong></p>
                            <p style="background: #fef2f2; padding: 12px; border-left: 4px solid #ef4444;">${reason}</p>
                            <p>Please update your listing and resubmit for review.</p>
                        </div>
                    `;

                // Security: Don't send if email is missing
                if (!listingData.ownerEmail) {
                    logger.error(`Missing ownerEmail forland listing ${listingId}`);
                } else {
                    try {
                        const { error } = await resend.emails.send({
                            from: "Easy Sales Export <noreply@easysalesexport.com>",
                            to: listingData.ownerEmail,
                            subject: emailSubject,
                            html: emailContent,
                        });
                        if (error) {
                            logger.error(`Resend API Error (Land listing ${decision} email):`, error);
                        }
                    } catch (emailError) {
                        logger.error(`Failed to send land listing ${decision} email:`, emailError);
                    }
                }
            }
        }

        // Log audit
        await logAuditAction(
            decision === "approved" ? "land_approve" : "land_reject",
            listingId,
            "land_listing",
            { adminId: session.user.id, reason: decision === "rejected" ? reason : null }
        );

        return {
            error: null,
            success: true,
            message: `Land listing ${decision} successfully`,
        };
    } catch (error: any) {
        logger.error("Verify land listing error:", error);
        return { error: "Failed to verify land listing", success: false };
    }
}

// ============================================
// Loan Application Management (Admin)
// ============================================

export async function getPendingLoanApplications(): Promise<{
    error: string | null;
    success: boolean;
    applications?: any[];
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "cooperatives:approve_loans")) {
            return { error: "Unauthorized: Permission required - cooperatives:approve_loans", success: false };
        }

        const snapshot = await db.collection(COLLECTIONS.LOAN_APPLICATIONS)
            .where("status", "==", "pending")
            .orderBy("appliedAt", "desc")
            .get();

        const applications = serializeDocs(snapshot.docs);

        return {
            error: null,
            success: true,
            applications,
        };
    } catch (error: any) {
        logger.error("Get pending loan applications error:", error);
        return { error: "Failed to fetch loan applications", success: false };
    }
}

// ============================================
// Export Window Management (Admin)
// ============================================

export async function getAllExportRequestsAction(
    statusFilter?: "pending" | "in_transit" | "delivered" | "completed" | "all",
    limit = 50,
    lastDocId?: string
): Promise<{
    error: string | null;
    success: boolean;
    exports?: any[];
    hasMore?: boolean;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "finance:read")) {
            return { error: "Unauthorized: Permission required - finance:read", success: false };
        }

        let query: any = db.collection(COLLECTIONS.EXPORT_WINDOWS);

        if (statusFilter && statusFilter !== "all") {
            query = query.where("status", "==", statusFilter)
                         .limit(limit);
        } else {
            query = query.orderBy("createdAt", "desc")
                         .limit(limit);
        }

        if (lastDocId) {
            const cursorDoc = await db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(lastDocId).get();
            if (cursorDoc.exists) {
                query = query.startAfter(cursorDoc);
            }
        }

        const snapshot = await query.get();
        const rawDocs = snapshot.docs;
        
        let exportsList = [];
        try {
            exportsList = rawDocs.map((doc: any) => {
                const data = doc.data();
                
                // Safe mapping for Split-Schema (Private Requests vs Crowdfunded Opportunities)
                const isCrowdfunded = !!data.targetVolume;
                let calculatedAmount = Number(data.amount);
                if (isNaN(calculatedAmount) || calculatedAmount === 0) {
                    if (isCrowdfunded) {
                        calculatedAmount = Number(data.targetVolume) * Number(data.slotPrice || 1);
                    }
                }
                
                const quantityStr = isCrowdfunded 
                    ? `${data.targetVolume}kg` 
                    : String(data.quantity || "0");
                    
                const itemTitle = data.title || (isCrowdfunded ? `${data.commodity} Export Goal` : "Private Request");
                const itemOrderId = data.orderId || (isCrowdfunded ? `PUBLIC-${doc.id.substring(0, 6)}` : "");

                return {
                    id: doc.id,
                    orderId: itemOrderId,
                    title: itemTitle,
                    commodity: data.commodity || "other",
                    quantity: quantityStr,
                    amount: calculatedAmount || 0,
                    status: data.status || "pending",
                    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
                    deliveryDate: data.deliveryDate?.toDate ? data.deliveryDate.toDate().toISOString() : null,
                    type: isCrowdfunded ? "crowdfunded" : "private"
                };
            }).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        } catch (serializeErr: any) {
            const msg = typeof serializeErr === 'string' ? serializeErr : (serializeErr?.message || "Unknown serialize error");
            console.error("CRASH DURING SERIALIZE:", msg);
            return { error: "Failed to serialize export records", success: false };
        }

        return {
            error: null,
            success: true,
            exports: exportsList,
            hasMore: exportsList.length === limit
        };
    } catch (error: any) {
        // Enforce pure string error to prevent React Flight serialization crash
        const errMsg = typeof error === 'string' ? error : (error?.message || "Failed to fetch export requests");
        console.error("Get all export requests RAW error:", errMsg);
        return { error: errMsg, success: false };
    }
}

export async function approveLoanApplication(
    applicationId: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "cooperatives:approve_loans")) {
            return { error: "Unauthorized: Permission required - cooperatives:approve_loans", success: false };
        }

        const valid = LoanApplicationReviewSchema.safeParse({ applicationId, status: "approved" });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false };
        }

        // Get loan data for validation
        const loanRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(applicationId);
        const loanDoc = await loanRef.get();

        if (!loanDoc.exists) {
            return { error: "Loan application not found", success: false };
        }

        const loanData = loanDoc.data()!;

        // Validate tier eligibility
        const tierMultiplier = loanData.tier === "Premium" ? 5 : 2.5;
        const maxLoanAmount = loanData.contributionAmount * tierMultiplier;

        if (loanData.amount > maxLoanAmount) {
            return {
                error: `Loan amount exceeds maximum for ${loanData.tier} tier (₦${maxLoanAmount.toLocaleString()})`,
                success: false,
            };
        }

        // 🔒 SECURITY FIX: Maker-Checker for High Value Loans (> 1M)
        const MAKER_CHECKER_THRESHOLD = 1000000;

        if (loanData.amount >= MAKER_CHECKER_THRESHOLD) {
            const approvalChain = loanData.approvalChain || {};

            // Check if this is the First or Second approval
            if (!approvalChain.firstApprover) {
                // First Approval (Maker)
                await loanRef.update({
                    approvalChain: {
                        firstApprover: session.user.id,
                        firstApprovalAt: FieldValue.serverTimestamp(),
                        firstApproverName: session.user.name || session.user.email
                    },
                    status: "partially_approved", // Intermediate status
                    updatedAt: FieldValue.serverTimestamp(),
                });

                await logAuditAction(
                    "loan_partially_approved",
                    applicationId,
                    "application",
                    { adminId: session.user.id, amount: loanData.amount, role: "Maker" }
                );

                return {
                    success: true,
                    message: "First approval recorded. A second admin is required to finalize.",
                    error: null
                };
            } else {
                // Second Approval (Checker)
                if (approvalChain.firstApprover === session.user.id) {
                    return {
                        error: "Security Violation: You cannot verify your own approval. Another admin is required.",
                        success: false
                    };
                }

                // Record Second Approver and Proceed to Final Approval
                await loanRef.update({
                    "approvalChain.secondApprover": session.user.id,
                    "approvalChain.secondApprovalAt": FieldValue.serverTimestamp(),
                    "approvalChain.secondApproverName": session.user.name || session.user.email,
                });

                // Fall through to standard approval logic below...
            }
        }

        // Standard Approval Logic (Final)
        await loanRef.update({
            status: "approved",
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // ══════════════════════════════════════════════════
        // LOAN DISBURSEMENT — Trigger Paystack Transfer now
        // ══════════════════════════════════════════════════
        let disbursementTransferCode: string | undefined;
        let disbursementError: string | undefined;
        try {
            const { paystackPayout } = await import("@/lib/paystack-transfer");

            // Get borrower's bank details
            const borrowerDoc = await db.collection(COLLECTIONS.USERS).doc(loanData.userId).get();
            const borrowerData = borrowerDoc.data();

            if (borrowerData?.bankAccountNumber && borrowerData?.bankCode) {
                const disbResult = await paystackPayout(
                    {
                        accountNumber: borrowerData.bankAccountNumber,
                        bankCode: borrowerData.bankCode,
                        accountName: borrowerData.bankAccountName || borrowerData.name,
                    },
                    loanData.amount,
                    `Cooperative loan disbursement - ${applicationId}`
                );

                if (disbResult.success) {
                    disbursementTransferCode = disbResult.transferCode;
                    await loanRef.update({
                        disbursed: true,
                        disbursedAt: FieldValue.serverTimestamp(),
                        disbursementTransferCode: disbResult.transferCode,
                        status: "disbursed",
                    });
                    logger.info(`Loan ${applicationId} disbursed: ₦${loanData.amount} to ${loanData.userId}`);
                } else {
                    disbursementError = disbResult.error;
                    await loanRef.update({
                        disbursed: false,
                        disbursementError: disbResult.error,
                        pendingManualDisbursement: true,
                    });
                    logger.error(`Loan disbursement FAILED for ${applicationId}: ${disbResult.error}`);
                }
            } else {
                disbursementError = "Borrower bank details not configured";
                await loanRef.update({
                    pendingManualDisbursement: true,
                    disbursementNote: disbursementError,
                });
            }
        } catch (disbErr: any) {
            disbursementError = disbErr.message;
            logger.error(`Loan disbursement error for ${applicationId}:`, disbErr);
            await loanRef.update({ pendingManualDisbursement: true });
        }

        // CLEAR CACHE - User's cooperative status changed
        try {
            const { invalidateCooperativeCache } = await import('@/lib/cache-invalidation');
            await invalidateCooperativeCache(loanData.userId);
            logger.info(`[Loan Approval] Cache cleared for user: ${loanData.userId}`);
        } catch (cacheError) {
            logger.error('[Loan Approval] Cache clear error:', cacheError);
        }

        // Send approval email
        if (process.env.RESEND_API_KEY) {
            const { Resend } = await import("resend");
            const resend = new Resend(process.env.RESEND_API_KEY);

            // Security: Don't send if email is missing
            if (!loanData.userEmail) {
                logger.error(`Missing userEmail for loan application ${applicationId}`);
            } else {
                try {
                    const { error } = await resend.emails.send({
                        from: "Easy Sales Export <noreply@easysalesexport.com>",
                        to: loanData.userEmail,
                        subject: "Loan Application Approved!",
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                                <h2 style="color: #10b981;">Congratulations! Your Loan is Approved</h2>
                                <p>Great news! Your loan application has been approved by our admin team.</p>
                            
                            <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; margin: 20px 0;">
                                <h3 style="color: #059669; margin-top: 0;">Loan Details:</h3>
                                <p><strong>Amount:</strong> ₦${loanData.amount.toLocaleString()}</p>
                                <p><strong>Duration:</strong> ${loanData.durationMonths} months</p>
                                <p><strong>Interest Rate:</strong> ${loanData.interestRate}% per month</p>
                                <p><strong>Monthly Payment:</strong> ₦${Math.round(loanData.monthlyPayment).toLocaleString()}</p>
                                <p><strong>Total Repayment:</strong> ₦${Math.round(loanData.totalRepayment).toLocaleString()}</p>
                            </div>
    
                            <p><strong>Next Steps:</strong></p>
                            <ul>
                                <li>${disbursementTransferCode ? 'Your funds have been transferred to your bank account.' : 'Funds will be disbursed to your account shortly.'}</li>
                                <li>Your first repayment is due 30 days from disbursement</li>
                                <li>You can track your repayment schedule in your dashboard</li>
                            </ul>
    
                                <p>Thank you for being a valued member of our cooperative!</p>
                            </div>
                        `,
                    });
                    if (error) {
                        logger.error(`Resend API Error (Loan approval email):`, error);
                    }
                } catch (emailError) {
                    logger.error("Failed to send loan approval email:", emailError);
                }
            }
        }

        // Create notification for user
        await createNotificationAction({
            userId: loanData.userId,
            type: "success",
            title: "Loan Approved!",
            message: disbursementTransferCode
                ? `Your loan of ₦${loanData.amount.toLocaleString()} has been approved and disbursed to your bank account!`
                : `Your loan application for ₦${loanData.amount.toLocaleString()} has been approved. Disbursement will follow shortly.`,
            link: "/loans",
            linkText: "View Loans",
        });

        // Log audit
        await logAuditAction(
            "loan_approved",
            applicationId,
            "application",
            { adminId: session.user.id, amount: loanData.amount, role: "Checker/Final", disbursed: !!disbursementTransferCode }
        );

        return {
            error: null,
            success: true,
            message: disbursementTransferCode
                ? "Loan approved and disbursed successfully"
                : `Loan approved. ${disbursementError ? `Disbursement pending: ${disbursementError}` : "Disbursement pending."}`,
        };
    } catch (error: any) {
        logger.error("Approve loan application error:", error);
        return { error: "Failed to approve loan application", success: false };
    }
}

export async function rejectLoanApplication(
    applicationId: string,
    reason: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "finance:read")) {
            return { error: "Unauthorized: Permission required - finance:read", success: false };
        }

        const valid = LoanApplicationReviewSchema.safeParse({ applicationId, status: "rejected", reason });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false };
        }

        // Get loan data for email
        const loanRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(applicationId);
        const loanDoc = await loanRef.get();

        if (!loanDoc.exists) {
            return { error: "Loan application not found", success: false };
        }

        const loanData = loanDoc.data()!;

        // Update loan status
        await loanRef.update({
            status: "rejected",
            rejectionReason: reason,
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Send rejection email
        if (process.env.RESEND_API_KEY) {
            const { Resend } = await import("resend");
            const resend = new Resend(process.env.RESEND_API_KEY);

            // Security: Don't send if email is missing
            if (!loanData.userEmail) {
                logger.error(`Missing userEmail for loan rejection ${applicationId}`);
            } else {
                try {
                    const { error } = await resend.emails.send({
                        from: "Easy Sales Export <noreply@easysalesexport.com>",
                        to: loanData.userEmail,
                        subject: "Loan Application Update",
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                                <h2 style="color: #dc2626;">Loan Application Update</h2>
                                <p>Thank you for applying for a loan with Easy Sales Export.</p>
                                
                                <div style="background: #fef2f2; padding: 16px; border-radius: 8px; margin: 20px 0;">
                                    <p>Unfortunately, we are unable to approve your loan application at this time.</p>
                                    <p><strong>Reason:</strong> ${reason}</p>
                                </div>
    
                                <p><strong>What You Can Do:</strong></p>
                                <ul>
                                    <li>Review the rejection reason carefully</li>
                                    <li>Address the issues mentioned</li>
                                    <li>Consider increasing your cooperative contributions for a higher tier</li>
                                    <li>Reapply after making the necessary adjustments</li>
                                </ul>
    
                                <p>If you have any questions or need clarification, please don't hesitate to contact our support team.</p>
                                
                                <p>We look forward to supporting your financial growth in the future.</p>
                            </div>
                        `,
                    });
                    if (error) {
                        logger.error(`Resend API Error (Loan rejection email):`, error);
                    }
                } catch (emailError) {
                    logger.error("Failed to send loan rejection email:", emailError);
                }
            }
        }

        // Create notification for user
        await createNotificationAction({
            userId: loanData.userId,
            type: "warning",
            title: "Loan Application Declined",
            message: `Your loan application for ₦${loanData.amount.toLocaleString()} was not approved. Reason: ${reason}`,
            link: "/loans",
            linkText: "View Details",
        });

        // Log audit
        await logAuditAction(
            "loan_rejected",
            applicationId,
            "application",
            { adminId: session.user.id, reason }
        );

        return {
            error: null,
            success: true,
            message: "Loan application rejected",
        };
    } catch (error: any) {
        logger.error("Reject loan application error:", error);
        return { error: "Failed to reject loan application", success: false };
    }
}

// ============================================
// Rate Limit Management (Admin)
// ============================================

/**
 * Unlock a rate-limited user account
 * Allows admins to manually reset login attempt counters
 */
export async function unlockUserAccount(email: string): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:read")) {
            return { error: "Unauthorized: Permission required - users:read", success: false };
        }

        if (!email || !email.includes("@")) {
            return { error: "Invalid email address", success: false };
        }

        // Reset rate limit
        const { resetLoginAttempts } = await import("@/lib/rate-limit");
        await resetLoginAttempts(email);

        // Log audit
        await logAuditAction(
            "user_verify", // Reusing existing action type as closest match
            email,
            "user",
            { adminId: session.user.id, action: "account_unlock", email }
        );

        return {
            error: null,
            success: true,
            message: `Account unlocked: ${email}`,
        };
    } catch (error: any) {
        logger.error("Unlock account error:", error);
        return { error: "Failed to unlock account", success: false };
    }
}
// ============================================
// User Management (Admin)
// ============================================

// ============================================
// User Management (Admin)
// ============================================

interface GetUsersOptions {
    limit?: number;
    page?: number;      // 0-indexed page number for offset pagination
    role?: string;
    status?: "verified" | "unverified" | "all";
    search?: string;
    lastDocId?: string; // kept for backwards-compat but now treated as page number string
    state?: string;     // filter by address.state
    lga?: string;       // filter by address.lga
    fromDate?: string;  // ISO date string – createdAt >= fromDate
    toDate?: string;    // ISO date string – createdAt <= toDate
}

export async function getUsersAction(options: GetUsersOptions = {}): Promise<{
    error: string | null;
    success: boolean;
    users?: any[];
    lastDocId?: string;
    hasMore?: boolean;
    totalCount?: number;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:read")) {
            const roles = session?.user?.roles ?? [];
            logger.warn(`[getUsersAction] Permission denied. Session roles: ${roles.join(", ") || "none (session may be stale — user must re-login)"}`);
            return {
                error: `Unauthorized: your session does not have the 'users:read' permission. Current roles: [${roles.join(", ") || "none"}]. Please sign out and sign back in to refresh your session.`,
                success: false,
            };
        }

        const pageSize = options.search ? 2000 : (options.limit || 50);
        const page = options.page ?? 0; // page offset (0-indexed)

        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.USERS);

        // Apply filters
        // *** IMPORTANT: We deliberately avoid orderBy('createdAt') because Firestore
        // silently excludes any document where that field is null/missing.
        // All sorting is done in-memory after fetching. ***
        if (options.search) {
            const search = options.search.trim();
            // Email exact match
            if (search.includes("@")) {
                query = query.where("email", "==", search.toLowerCase());
            }
            // Phone exact match
            else if (/^[\d+]+$/.test(search) && search.length > 5) {
                query = query.where("phone", "==", search);
            }
            // Name searches are handled client-side below
        }

        // Basic filtering (Role/Status/State/LGA) - Only apply if NOT doing a direct search
        if (!options.search) {
            if (options.role && options.role !== "all") {
                query = query.where("roles", "array-contains", options.role);
            }

            // IMPORTANT: Do NOT filter isVerified via Firestore query — 34k+ legacy users
            // have `verified: true` but NOT `isVerified`. A Firestore where("isVerified","==",true)
            // query would silently exclude them all.
            // Instead, status filtering is applied IN-MEMORY after the mapping step uses
            // the defensive chain: `data.isVerified ?? data.verified ?? false`

            // Location filters
            if (options.state && options.state !== "all") {
                query = query.where("address.state", "==", options.state);
            }
            if (options.lga && options.lga !== "all") {
                query = query.where("address.lga", "==", options.lga);
            }
        }

        // ---------------------------------------------------------
        // EXACT DATABASE COUNT (Satisfies Data Consistency Audit)
        // ---------------------------------------------------------
        let countQuery: FirebaseFirestore.Query = db.collection(COLLECTIONS.USERS);
        if (!options.search) {
            if (options.role && options.role !== "all") {
                countQuery = countQuery.where("roles", "array-contains", options.role);
            }
            if (options.state && options.state !== "all") {
                countQuery = countQuery.where("address.state", "==", options.state);
            }
            if (options.lga && options.lga !== "all") {
                countQuery = countQuery.where("address.lga", "==", options.lga);
            }
        }
        
        // For search (email/phone), count directly against the filter
        if (options.search) {
            const search = options.search.trim();
            if (search.includes("@")) {
                countQuery = countQuery.where("email", "==", search.toLowerCase());
            } else if (/^[\d+]+$/.test(search) && search.length > 5) {
                countQuery = countQuery.where("phone", "==", search);
            }
        }

        const countSnap = await countQuery.count().get();
        const absoluteDbCount = countSnap.data().count;

        // Fetch a large batch — no orderBy (avoids missing-field exclusion).
        // We page in-memory after sort.
        // INCREASED LIMIT: Expanded to 5000 to improve search coverage across legacy data without crashing memory
        const FETCH_LIMIT = 5000;
        query = query.limit(FETCH_LIMIT);

        const snapshot = await query.get();

        const users = snapshot.docs.map(doc => {
            const data = doc.data();
            // Defensive name derivation — supports all schema generations:
            // 1. New schema: firstName + lastName stored separately (onboarding post-April 2026)
            // 2. Legacy schema: fullName stored as single string
            // 3. Auth-only schema: name stored from Firebase Auth display name
            const derivedName = data.firstName
                ? [data.firstName, data.otherName, data.lastName].filter(Boolean).join(" ").trim()
                : (data.fullName || data.name || data.displayName || data.email || "Unknown");
            return {
                id: doc.id,
                name: derivedName,
                firstName: data.firstName,
                lastName: data.lastName,
                otherName: data.otherName,
                email: data.email,
                phone: data.phone,
                role: data.roles?.[0] || "general_user",
                roles: data.roles || [],
                isVerified: data.isVerified ?? data.verified ?? false,
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(0),
                verifiedAt: data.verifiedAt?.toDate ? data.verifiedAt.toDate() : undefined,
                // Location
                address: data.address,
                state: data.address?.state || data.stateOfOrigin || "",
                lga: data.address?.lga || data.lga || "",
                // KYC fields — prefer nested kyc.* (written by live QoreID actions),
                // fall back to legacy top-level fields for existing records
                bvn: data.kyc?.bvn || data.bvn,
                bvnVerified: data.kyc?.bvnVerified ?? data.bvnVerified ?? false,
                bvnStatus: data.kyc?.bvnStatus || (data.bvnVerified ? 'verified' : undefined),
                nin: data.kyc?.nin || data.nin,
                ninVerified: data.kyc?.ninVerified ?? data.ninVerified ?? false,
                ninStatus: data.kyc?.ninStatus || (data.ninVerified ? 'verified' : undefined),
                kycStatus: data.kyc?.status || data.kycStatus || 'pending',
                taxId: data.taxId,
                tinVerified: data.tinVerified,
                cacNumber: data.cacNumber,
                cacVerified: data.cacVerified,
                idType: data.kyc?.idType || data.idType,
                // Other
                bankDetails: data.bankDetails,
                metadata: data.metadata,
                accountType: data.marketplaceAccountType || data.serviceRegistrations?.marketplace?.accountType || data.accountType
            };
        });

        // Client-side search + date range filtering
        let filteredUsers = users;
        if (options.search) {
            const searchLower = options.search.toLowerCase();
            filteredUsers = filteredUsers.filter(user =>
                user.name?.toLowerCase()?.includes(searchLower) ||
                user.email?.toLowerCase()?.includes(searchLower) ||
                (user.phone && user.phone.includes(searchLower)) ||
                (user.state && user.state?.toLowerCase()?.includes(searchLower)) ||
                (user.lga && user.lga?.toLowerCase()?.includes(searchLower))
            );
        }
        // In-memory status filter — using the defensive chain already computed in mapping:
        // `data.isVerified ?? data.verified ?? false`
        // This ensures legacy users (verified:true, no isVerified) are included correctly.
        if (options.status === "verified") {
            filteredUsers = filteredUsers.filter(u => u.isVerified === true);
        } else if (options.status === "unverified") {
            filteredUsers = filteredUsers.filter(u => !u.isVerified);
        }
        if (options.fromDate) {
            const from = new Date(options.fromDate);
            from.setHours(0, 0, 0, 0);
            filteredUsers = filteredUsers.filter(u => new Date(u.createdAt) >= from);
        }
        if (options.toDate) {
            const to = new Date(options.toDate);
            to.setHours(23, 59, 59, 999);
            filteredUsers = filteredUsers.filter(u => new Date(u.createdAt) <= to);
        }

        // Sort in-memory by createdAt descending (avoids composite index requirement)
        filteredUsers.sort((a, b) => {
            const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
            const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
            return bTime - aTime;
        });

        // Page-offset slice: each page returns exactly pageSize items
        const offset = page * pageSize;
        const pagedUsers = filteredUsers.slice(offset, offset + pageSize);
        
        // Determine total count explicitly ensuring DB truth overrides in-memory unless heavily filtered manually
        const hasManualFilters = options.status !== "all" || options.fromDate || options.toDate || (options.search && !options.search.includes("@") && !/^[\d+]+$/.test(options.search));
        
        const totalAfterFilter = filteredUsers.length;
        const trueTotalCount = hasManualFilters ? totalAfterFilter : absoluteDbCount;
        
        const hasMore = offset + pageSize < totalAfterFilter;

        return {
            error: null,
            success: true,
            users: pagedUsers,
            // nextPage is used by callers for the NEXT request's `page` param
            lastDocId: hasMore ? String(page + 1) : undefined,
            hasMore,
            totalCount: trueTotalCount,
        };
    } catch (error: any) {
        logger.error("Get users error:", error);
        return { error: "Failed to fetch users: " + error.message, success: false };
    }
}


// Update User Roles Action
export async function updateUserRolesAction(
    userId: string,
    roles: string[]
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:assign_roles")) {
            return { error: "Unauthorized: Permission required - users:assign_roles", success: false };
        }

        // Validate inputs
        const { UpdateUserRolesSchema } = await import("@/lib/schemas");
        const valid = UpdateUserRolesSchema.safeParse({ userId, roles });

        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false };
        }

        // Prevent admin from removing their own admin role
        if (userId === session.user.id && !roles.includes("admin")) {
            return { error: "Cannot remove your own admin privileges", success: false };
        }

        // ── Write serviceRegistrations for module roles ────────────────────────
        // Without this, manually-added users fail the stale-JWT fallback in
        // checkModuleAccess (Layer 2 checks serviceRegistrations[module].status).
        // They would only gain access after logout/re-login (JWT refresh).
        const serviceUpdates: Record<string, any> = {};
        const MODULE_ROLE_REGS = [
            { roles: ["wave_participant"],             key: "serviceRegistrations.wave",         status: "approved" },
            { roles: ["cooperative_member"],           key: "serviceRegistrations.cooperatives",  status: "approved" },
            { roles: ["export_participant"],           key: "serviceRegistrations.export",        status: "approved" },
            { roles: ["academy_participant"],          key: "serviceRegistrations.academy",       status: "active"   },
            { roles: ["farmer", "land_owner", "investor"], key: "serviceRegistrations.farmNation", status: "approved" },
            { roles: ["buyer", "seller"],              key: "serviceRegistrations.marketplace",   status: "approved" },
        ];
        for (const mapping of MODULE_ROLE_REGS) {
            if (mapping.roles.some(r => roles.includes(r))) {
                serviceUpdates[`${mapping.key}.status`] = mapping.status;
                serviceUpdates[`${mapping.key}.enrolledAt`] = FieldValue.serverTimestamp();
                serviceUpdates[`${mapping.key}.enrolledBy`] = session.user.id;
                serviceUpdates[`${mapping.key}.note`] = "Manual admin role assignment";
            }
        }

        await atomicUpdateUser(userId, {
            roles: roles,
            updatedBy: session.user.id,
            ...serviceUpdates,
        });

        await logAuditAction("user_role_change", userId, "user", {
            roles,
            adminId: session.user.id,
            serviceRegistrationsUpdated: Object.keys(serviceUpdates).length > 0,
        });

        return { success: true, error: null, message: "User roles updated" };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

// ============================================
// Seller Verification (Marketplace)
// ============================================

export async function approveSellerVerificationAction(
    verificationId: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "marketplace:approve_sellers")) {
            // Fallback for super_admin if specific role missing, or strict check
            if (!session?.user?.roles?.includes("super_admin") && !session?.user?.roles?.includes("admin")) {
                return { error: "Unauthorized: Permission required - users:verify_sellers", success: false };
            }
        }

        // 1. Get Verification Doc
        const verificationRef = db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(verificationId);
        const verificationDoc = await verificationRef.get();

        if (!verificationDoc.exists) {
            return { error: "Verification request not found", success: false };
        }

        const verificationData = verificationDoc.data()!;
        const userId = verificationData.userId;

        if (!userId) {
            return { error: "Invalid verification request: Missing User ID", success: false };
        }

        // 2. Update Verification Status
        await verificationRef.update({
            status: "approved",
            verifiedBy: session.user.id,
            verifiedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // 3. Update User Profile (Verify & Add Role)
        await atomicUpdateUser(userId, {
            isVerified: true,
            sellerVerificationStatus: "approved",
            sellerVerificationId: verificationId,
            verifiedBy: session.user.id, // Track who verified the user
            verifiedAt: FieldValue.serverTimestamp(),
            roles: FieldValue.arrayUnion("seller"),
            // SYNC serviceRegistrations so module access check (Layer 2) gates work immediately
            "serviceRegistrations.marketplace.status": "active",
            "serviceRegistrations.marketplace.accountType": verificationData.accountType || "seller",
            "serviceRegistrations.marketplace.approvedAt": FieldValue.serverTimestamp(),
            "serviceRegistrations.marketplace.approvedBy": session.user.id,
            // SYNC CONTACT INFO: Update phone with verified number to prevent data drift
            phone: verificationData.phoneNumber,
        });

        // CLEAR CACHE - User now has seller role and verification
        try {
            const { invalidateSellerCache } = await import('@/lib/cache-invalidation');
            await invalidateSellerCache(userId);
            logger.info(`[Seller Approval] Cache cleared for user: ${userId}`);
        } catch (cacheError) {
            logger.error('[Seller Approval] Cache clear error:', cacheError);
        }

        // 4. Send Approval Email
        if (process.env.RESEND_API_KEY) {
            // Get user email - fetch user doc to be safe
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
            const userData = userDoc.data();
            const userEmail = userData?.email;

            if (userEmail) {
                try {
                    const { Resend } = await import("resend");
                    const resend = new Resend(process.env.RESEND_API_KEY);

                    const { error } = await resend.emails.send({
                        from: "Easy Sales Export <noreply@easysalesexport.com>",
                        to: userEmail,
                        subject: "Seller Account Approved!",
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                                <h2 style="color: #059669;">You are now a Seller!</h2>
                                <p>Congratulations! Your seller verification has been approved.</p>
                                
                                <div style="background: #ecfdf5; padding: 16px; border-radius: 8px; margin: 20px 0; border: 1px solid #a7f3d0;">
                                    <p style="margin: 0; color: #065f46;"><strong>Status:</strong> Approved</p>
                                    <p style="margin: 5px 0 0; color: #065f46;"><strong>Role:</strong> Seller</p>
                                </div>

                                <p>You can now:</p>
                                <ul>
                                    <li>List products on the marketplace</li>
                                    <li>Manage your orders</li>
                                    <li>Access seller analytics</li>
                                </ul>

                                <div style="text-align: center; margin-top: 30px;">
                                    <a href="https://easysalesexport.com/marketplace/seller/dashboard" style="background-color: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Go to Seller Dashboard</a>
                                </div>
                            </div>
                        `
                    });
                    if (error) {
                        logger.error("Resend API Error (Seller approval email):", error);
                    }
                } catch (emailError) {
                    logger.error("Failed to send seller approval email:", emailError);
                }
            }
        }

        // Log audit
        await logAuditAction("seller_approve", verificationId, "seller_verification", {
            adminId: session.user.id,
            userId: userId,
        });

        return {
            error: null,
            success: true,
            message: "Seller verified successfully",
        };
    } catch (error: any) {
        logger.error("Approve seller verification error:", error);
        return { error: "Failed to verify seller", success: false };
    }
}

// ============================================
// Export Onboarding Approval
// ============================================

export async function approveExportOnboardingAction(
    applicationId: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        // Use general user update permission or create a new one. Using users:update for now.
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            if (!session?.user?.roles?.includes("super_admin") && !session?.user?.roles?.includes("admin")) {
                return { error: "Unauthorized: Permission required - users:update", success: false };
            }
        }

        // 1. Get Application Doc
        const appRef = db.collection(COLLECTIONS.EXPORT_APPLICATIONS).where("applicationId", "==", applicationId).limit(1);
        const appSnapshot = await appRef.get();

        if (appSnapshot.empty) {
            return { error: "Application not found", success: false };
        }

        const appDoc = appSnapshot.docs[0];
        const appData = appDoc.data();
        const userId = appData.userId;

        if (!userId) {
            return { error: "Invalid application: Missing User ID", success: false };
        }

        // 2. Update Application Status
        await appDoc.ref.update({
            status: "approved",
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // 3. Update User Profile (Verify, Add Role, Activate Service)
        await atomicUpdateUser(userId, {
            isVerified: true,
            "services.export.status": "active",
            "services.export.approvedAt": FieldValue.serverTimestamp(),
            verifiedBy: session.user.id,
            verifiedAt: FieldValue.serverTimestamp(),
            roles: FieldValue.arrayUnion("export_participant"),
        });

        // CLEAR CACHE - User now has Export access
        try {
            const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
            await invalidateServiceCache(userId, 'export');
            logger.info(`[Export Approval] Cache cleared for user: ${userId}`);
        } catch (cacheError) {
            logger.error('[Export Approval] Cache clear error:', cacheError);
        }

        // 4. Send Approval Email
        if (process.env.RESEND_API_KEY && appData.userEmail) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);

                const { error } = await resend.emails.send({
                    from: "Easy Sales Export <noreply@easysalesexport.com>",
                    to: appData.userEmail,
                    subject: "Export Account Approved!",
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #059669;">Welcome to Export Services!</h2>
                            <p>Your export onboarding application has been approved.</p>
                            
                            <div style="background: #ecfdf5; padding: 16px; border-radius: 8px; margin: 20px 0; border: 1px solid #a7f3d0;">
                                <p style="margin: 0; color: #065f46;"><strong>Status:</strong> Approved</p>
                                <p style="margin: 5px 0 0; color: #065f46;"><strong>Service:</strong> Export Management</p>
                            </div>

                            <p>You can now start creating export windows and managing your commodities.</p>

                            <div style="text-align: center; margin-top: 30px;">
                                <a href="https://easysalesexport.com/export/dashboard" style="background-color: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Go to Export Dashboard</a>
                            </div>
                        </div>
                    `
                });
                if (error) {
                    logger.error("Resend API Error (Export approval email):", error);
                }
            } catch (emailError) {
                logger.error("Failed to send export approval email:", emailError);
            }
        }

        // Log audit
        await logAuditAction("export_approve", applicationId, "export_onboarding_applications", {
            adminId: session.user.id,
            userId: userId,
        });

            return {
            error: null,
            success: true,
            message: "Export application approved successfully",
        };
    } catch (error: any) {
        logger.error("Approve export application error:", error);
        return { error: "Failed to approve export application", success: false };
    }
}

/**
 * Request revision / correction from an export applicant.
 * Sets status to "revision_required" and stores the admin's note.
 */
export async function requestExportApplicationRevisionAction(
    applicationId: string,
    revisionNote: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            if (!session?.user?.roles?.includes("super_admin") && !session?.user?.roles?.includes("admin")) {
                return { error: "Unauthorized: admin or users:update role required", success: false };
            }
        }

        if (!revisionNote?.trim()) {
            return { error: "Revision note is required", success: false };
        }

        // Find the application — may be passed either as the Firestore doc ID or applicationId field
        let appDocRef: FirebaseFirestore.DocumentReference;
        let appData: FirebaseFirestore.DocumentData;

        // First try exact doc ID
        const directDoc = await db.collection(COLLECTIONS.EXPORT_APPLICATIONS).doc(applicationId).get();
        if (directDoc.exists) {
            appDocRef = directDoc.ref;
            appData = directDoc.data()!;
        } else {
            // Fallback: query by applicationId field
            const snap = await db.collection(COLLECTIONS.EXPORT_APPLICATIONS)
                .where("applicationId", "==", applicationId)
                .limit(1)
                .get();
            if (snap.empty) {
                return { error: "Application not found", success: false };
            }
            appDocRef = snap.docs[0].ref;
            appData = snap.docs[0].data();
        }

        const userId = appData.userId;
        if (!userId) {
            return { error: "Invalid application: Missing User ID", success: false };
        }

        // Update application status
        await appDocRef.update({
            status: "revision_required",
            revisionNote: revisionNote.trim(),
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Send email notification to applicant
        if (process.env.RESEND_API_KEY && appData.userEmail) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);
                await resend.emails.send({
                    from: "Easy Sales Export <noreply@easysalesexport.com>",
                    to: appData.userEmail,
                    subject: "Action Required: Correction Needed on Your Export Application",
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #ea580c;">Action Required: Correction Needed</h2>
                            <p>Dear ${appData.profile?.fullName || appData.userEmail},</p>
                            <p>Your Export Services application has been reviewed and requires some corrections before it can proceed.</p>
                            
                            <div style="background: #fff7ed; padding: 16px; border-radius: 8px; margin: 20px 0; border: 1px solid #ffedd5;">
                                <p style="margin: 0; color: #9a3412; font-weight: bold;">Correction Required:</p>
                                <p style="margin: 10px 0 0; color: #7c2d12; font-style: italic;">&ldquo;${revisionNote.trim()}&rdquo;</p>
                            </div>

                            <p>Please log in to your dashboard, update the indicated information, and re-submit your application.</p>

                            <div style="text-align: center; margin-top: 30px;">
                                <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://easysalesexport.com'}/export"
                                   style="background-color: #ea580c; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: bold;">
                                    Update My Application
                                </a>
                            </div>
                            <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">Easy Sales Export Team</p>
                        </div>
                    `,
                });
            } catch (emailErr) {
                logger.error("[Export Revision] Email send failed:", emailErr);
            }
        }

        logger.info(`[Export Revision] Application ${applicationId} marked revision_required by admin ${session.user.id}`);
        return { error: null, success: true, message: "Revision note sent to applicant" };
    } catch (error: any) {
        logger.error("Request export revision error:", error);
        return { error: "Failed to send revision request", success: false };
    }
}
export async function getStandardExportApplicationsAction(options: {
    limit?: number;
    search?: string;
    status?: "pending_review" | "approved" | "rejected" | "revision_required" | "pending" | "all";
    lastDocId?: string;
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
        let q: any = db.collection(COLLECTIONS.EXPORT_APPLICATIONS);
        
        if (options.status && options.status !== "all") {
            // Cannot use orderBy without a composite index when using 'where'
            q = q.where("status", "==", options.status)
                 .limit(fetchLimit);
        } else {
            q = q.orderBy("createdAt", "desc")
                 .limit(fetchLimit);
        }

        if (options.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.EXPORT_APPLICATIONS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                q = q.startAfter(lastDoc);
            }
        }

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
            const kyc = (app.kyc || {}) as any;
            const profile = (app.profile || {}) as any;
            const kycName = kyc?.kycData?.firstName ? `${kyc.kycData.firstName} ${kyc.kycData.lastName || ''}`.trim() : null;
            const userName = uData.name || uData.firstName ? `${uData.firstName} ${uData.lastName || ''}`.trim() : (profile?.fullName || kycName || "Unknown User");
            
            // Normalize status to map perfectly to UI rules
            let status = app.status || "pending";
            if (status === "pending_review") status = "pending";

            // Merge USERS profile + profile sub-object as fallbacks so admin modal
            // shows all personal fields regardless of which path data came through
            const mergedData = {
                ...app,
                phone:              app.phone              || profile?.phone              || uData.phone       || uData.phoneNumber || null,
                gender:             app.gender             || profile?.gender             || uData.gender      || null,
                dateOfBirth:        app.dateOfBirth        || profile?.dateOfBirth        || uData.dob         || null,
                occupation:         app.occupation         || profile?.occupation         || uData.occupation  || null,
                stateOfOrigin:      app.stateOfOrigin      || profile?.stateOfOrigin      || (typeof uData.address === 'object' ? uData.address?.state  : uData.stateOfOrigin)  || null,
                lga:                app.lga                || profile?.lga                || (typeof uData.address === 'object' ? uData.address?.lga    : uData.lga)            || null,
                residentialAddress: app.residentialAddress || profile?.residentialAddress || (typeof uData.address === 'object' ? uData.address?.street : uData.address)        || null,
                firstName:          profile?.firstName      || app.firstName              || uData.firstName   || null,
                lastName:           profile?.lastName       || app.lastName               || uData.lastName    || null,
                email:              app.userEmail           || app.email                  || uData.email        || null,
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
                status: status,
                data: mergedData
            };
        });

        // Client-side search application if specified
        let finalForms = standardForms;
        if (options.search) {
            const s = options.search.toLowerCase();
            finalForms = standardForms.filter((f: any) => 
                f.user.name?.toLowerCase().includes(s) || 
                f.user.email?.toLowerCase().includes(s) || 
                f.user.phone?.includes(s)
            );
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
        logger.error("Get standard export apps error:", error);
        return { success: false, error: "Failed to fetch normalized applications" };
    }
}

export async function rejectExportApplicationAction(

    applicationId: string,
    reason: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        // Use general user update permission or create a new one. Using users:update for now.
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            if (!session?.user?.roles?.includes("super_admin") && !session?.user?.roles?.includes("admin")) {
                return { error: "Unauthorized: Permission required - users:update", success: false };
            }
        }

        const valid = ExportOnboardingReviewSchema.safeParse({ applicationId, status: "rejected", reason });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false };
        }

        // 1. Get Application Doc
        const appRef = db.collection(COLLECTIONS.EXPORT_APPLICATIONS).where("applicationId", "==", applicationId).limit(1);
        const appSnapshot = await appRef.get();

        if (appSnapshot.empty) {
            return { error: "Application not found", success: false };
        }

        const appDoc = appSnapshot.docs[0];
        const appData = appDoc.data();
        const userId = appData.userId;

        if (!userId) {
            return { error: "Invalid application: Missing User ID", success: false };
        }

        // 2. Update Application Status
        await appDoc.ref.update({
            status: "rejected",
            rejectionReason: reason,
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // 3. Update User Profile (Mark as rejected)
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            "serviceRegistrations.export.status": "rejected",
            "serviceRegistrations.export.rejectedAt": FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // CLEAR CACHE
        try {
            const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
            await invalidateServiceCache(userId, 'export');
            logger.info(`[Export Rejection] Cache cleared for user: ${userId}`);
        } catch (cacheError) {
            logger.error('[Export Rejection] Cache clear error:', cacheError);
        }

        // 4. Send Rejection Email
        if (process.env.RESEND_API_KEY && appData.userEmail) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);

                const { error } = await resend.emails.send({
                    from: "Easy Sales Export <noreply@easysalesexport.com>",
                    to: appData.userEmail,
                    subject: "Export Application Update",
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #ea580c;">Export Application Update</h2>
                            <p>Your recent application for Export Services has been reviewed.</p>
                            
                            <div style="background: #fff7ed; padding: 16px; border-radius: 8px; margin: 20px 0; border: 1px solid #ffedd5;">
                                <p style="margin: 0; color: #9a3412;"><strong>Status:</strong> Action Required</p>
                                <p style="margin: 10px 0 0; color: #9a3412;"><strong>Reason provided:</strong></p>
                                <p style="margin: 5px 0 0; color: #7c2d12; font-style: italic;">"${reason}"</p>
                            </div>

                            <p>To proceed, please log in to your dashboard and re-submit your application with the requested updates or corrections.</p>

                            <div style="text-align: center; margin-top: 30px;">
                                <a href="https://easysalesexport.com/export/onboarding/rejected" style="background-color: #ea580c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">View Details</a>
                            </div>
                        </div>
                    `
                });
                if (error) {
                    logger.error("Resend API Error (Export rejection email):", error);
                }
            } catch (emailError) {
                logger.error("Failed to send export rejection email:", emailError);
            }
        }

        // Log audit
        await logAuditAction("export_reject", applicationId, "export_onboarding_applications", {
            adminId: session.user.id,
            userId: userId,
            reason: reason
        });

        return {
            error: null,
            success: true,
            message: "Export application rejected successfully",
        };
    } catch (error: any) {
        logger.error("Reject export application error:", error);
        return { error: "Failed to reject export application", success: false };
    }
}
// ============================================
// Academy Application Management (Admin)
// ============================================

export async function getAcademyApplicationsAction(
    statusFilter?: "pending" | "under_review" | "approved" | "rejected"
): Promise<{
    error: string | null;
    success: boolean;
    data?: any[];
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "academy:approve_applications")) {
            // Fallback for now/testing or add permission
            if ((!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin"))) {
                return { error: "Unauthorized: Permission required - academy:approve_applications", success: false };
            }
        }

        // NOTE: Compound queries (where + orderBy on different fields) require
        // a composite Firestore index. To avoid that dependency, we:
        // - Use only orderBy for the unfiltered case (single-field index exists)
        // - Use only where for the filtered case, then sort in memory
        let snapshot;
        if (statusFilter) {
            // Single-field filter only — avoids composite index requirement
            const filteredQuery = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .where("status", "==", statusFilter)
                .limit(500);
            snapshot = await filteredQuery.get();
        } else {
            // IMPORTANT: No orderBy here — Firestore silently excludes docs where
            // 'submittedAt' is null/missing. We sort in-memory below instead.
            const allQuery = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .limit(500);
            snapshot = await allQuery.get();
        }

        const applications = snapshot.docs.map(doc => {
            const data = doc.data();
            const submittedRaw = data.submittedAt;
            const reviewedRaw = data.reviewedAt;
            return {
                id: doc.id,
                ...data,
                // Serialize as ISO string — Timestamps are not serializable across Server Action boundaries
                submittedAt: submittedRaw?.toDate
                    ? submittedRaw.toDate().toISOString()
                    : submittedRaw instanceof Date
                        ? submittedRaw.toISOString()
                        : new Date(0).toISOString(),
                reviewedAt: reviewedRaw?.toDate
                    ? reviewedRaw.toDate().toISOString()
                    : reviewedRaw instanceof Date
                        ? reviewedRaw.toISOString()
                        : null,
            };
        });

        // Sort in memory by submittedAt descending
        applications.sort((a, b) =>
            new Date(b.submittedAt as string).getTime() - new Date(a.submittedAt as string).getTime()
        );

        return {
            error: null,
            success: true,
            data: applications,
        };
    } catch (error: any) {
        logger.error("Get Academy applications error:", error);
        return { error: "Failed to fetch applications", success: false };
    }
}

export async function approveAcademyApplicationAction(
    applicationId: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { error: "Unauthorized", success: false };
        }

        // Get application first
        const appRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();

        if (!appDoc.exists) {
            return { error: "Application not found", success: false };
        }

        const appData = appDoc.data()!;
        const userId = appData.userId;
        const userEmail = appData.personalInfo?.email;

        if (!userId) {
            return { error: "Application missing user ID", success: false };
        }

        // 1. Update Application Status
        await appRef.update({
            status: "approved",
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // 2. Update User Service Registration & Role
        await db.collection(COLLECTIONS.USERS).doc(userId).set({
            serviceRegistrations: {
                academy: {
                    status: "approved",
                    approvedAt: FieldValue.serverTimestamp(),
                }
            },
            roles: FieldValue.arrayUnion("academy_participant"),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // 3. Clear Cache
        try {
            const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
            await invalidateServiceCache(userId, 'academy');
        } catch (cacheError) {
            logger.error('[Academy Approval] Cache clear error:', cacheError);
        }

        // 4. Send Approval Email
        if (userEmail && process.env.RESEND_API_KEY) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);
                const { error } = await resend.emails.send({
                    from: "Easy Sales Export Academy <noreply@easysalesexport.com>",
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
        await logAuditAction("academy_approve", applicationId, "application", {
            adminId: session.user.id,
            userId: userId,
        });

        return {
            error: null,
            success: true,
            message: "Academy application approved successfully",
        };
    } catch (error: any) {
        logger.error("Approve Academy application error:", error);
        return { error: "Failed to approve application", success: false };
    }
}

export async function rejectAcademyApplicationAction(
    applicationId: string,
    reason: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { error: "Unauthorized", success: false };
        }

        await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId).update({
            status: "rejected",
            rejectionReason: reason,
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        const appDoc = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId).get();
        if (appDoc.exists) {
            const userId = appDoc.data()?.userId;
            if (userId) {
                await db.collection(COLLECTIONS.USERS).doc(userId).set({
                    serviceRegistrations: {
                        academy: {
                            status: "rejected",
                        }
                    },
                    updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });
            }
        }

        await logAuditAction("academy_reject", applicationId, "application", {
            reason,
            adminId: session.user.id,
        });

        return {
            error: null,
            success: true,
            message: "Academy application rejected",
        };
    } catch (error: any) {
        logger.error("Reject Academy application error:", error);
        return { error: "Failed to reject application", success: false };
    }
}

// ============================================
// Mark Academy Application Under Review
// ============================================

export async function markAcademyApplicationUnderReviewAction(
    applicationId: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { error: "Unauthorized", success: false };
        }

        await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId).update({
            status: "under_review",
            reviewedBy: session.user.id,
            reviewStartedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        await logAuditAction("academy_under_review", applicationId, "application", {
            adminId: session.user.id,
        });

        return {
            error: null,
            success: true,
            message: "Application marked as under review",
        };
    } catch (error: any) {
        logger.error("Mark Academy application under review error:", error);
        return { error: "Failed to update application status", success: false };
    }
}

// ============================================
// Platform Settings (Admin)
// ============================================

export async function savePlatformSettingsAction(
    settings: {
        platformName: string;
        supportEmail: string;
        contactPhone: string;
        defaultCurrency: string;
        maintenanceMode: boolean;
    }
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "config:update")) {
            return { error: "Unauthorized: Admin access required", success: false };
        }

        await db.collection(COLLECTIONS.PLATFORM_SETTINGS).doc("general").set({
            ...settings,
            updatedBy: session!.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        await logAuditAction("export_create", "general", "export", {
            adminId: session!.user.id,
            changes: settings,
        });

        return { error: null, success: true, message: "Platform settings saved successfully" };
    } catch (error: any) {
        logger.error("Save platform settings error:", error);
        return { error: "Failed to save settings", success: false };
    }
}

export async function getPlatformSettingsAction(): Promise<{
    platformName: string;
    supportEmail: string;
    contactPhone: string;
    defaultCurrency: string;
    maintenanceMode: boolean;
}> {
    try {
        const doc = await db.collection(COLLECTIONS.PLATFORM_SETTINGS).doc("general").get();
        if (!doc.exists) {
            return {
                platformName: "Easy Sales Export",
                supportEmail: "support@easysalesexport.com",
                contactPhone: "+234 000 000 0000",
                defaultCurrency: "NGN",
                maintenanceMode: false,
            };
        }
        return doc.data() as any;
    } catch (error: any) {
        logger.error("Get platform settings error:", error);
        return {
            platformName: "Easy Sales Export",
            supportEmail: "support@easysalesexport.com",
            contactPhone: "+234 000 000 0000",
            defaultCurrency: "NGN",
            maintenanceMode: false,
        };
    }
}

// ============================================
// Admin Edit Application with Audit Trail
// ============================================

export interface EditableApplicationFields {
    firstName?: string;
    lastName?: string;
    middleName?: string;   // legacy field — keep for backward compat
    otherName?: string;    // new standard field — replaces middleName
    surname?: string;
    otherNames?: string;
    fullName?: string;
    businessName?: string;
    phone?: string;
    email?: string;
    stateOfOrigin?: string;
    lga?: string;
    stateOfResidence?: string;
    lgaOfResidence?: string;
    residentialAddress?: string;
    occupation?: string;
    membershipTier?: string;
    "nextOfKin.name"?: string;
    "nextOfKin.phone"?: string;
    "nextOfKin.address"?: string;
    // Land listing editable fields
    title?: string;
    "location.state"?: string;
    "location.lga"?: string;
}

const ALLOWED_EDIT_FIELDS: (keyof EditableApplicationFields)[] = [
    "firstName", "lastName",
    "middleName",   // legacy — kept for backward compat
    "otherName",    // new KYC standard field
    "surname", "otherNames", "fullName", "businessName",
    "phone", "email",
    "stateOfOrigin", "lga", "stateOfResidence", "lgaOfResidence", "residentialAddress", "occupation",
    "membershipTier", "nextOfKin.name", "nextOfKin.phone", "nextOfKin.address",
    // Land listing fields
    "title", "location.state", "location.lga",
];

export async function editApplicationAction(params: {
    collection: string;
    docId: string;
    fields: Partial<EditableApplicationFields>;
    editNote?: string;
}): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            if (!session?.user?.roles?.includes("super_admin") && !session?.user?.roles?.includes("admin")) {
                return { error: "Unauthorized: admin or users:update role required", success: false };
            }
        }

        const { collection: collectionName, docId, fields, editNote } = params;

        // Validate the collection is one we allow editing
        const ALLOWED_COLLECTIONS = [
            COLLECTIONS.COOPERATIVE_MEMBERS,
            COLLECTIONS.WAVE_APPLICATIONS,
            COLLECTIONS.SELLER_VERIFICATIONS,
            COLLECTIONS.EXPORT_APPLICATIONS,
            COLLECTIONS.ACADEMY_APPLICATIONS,
            COLLECTIONS.USERS,
            COLLECTIONS.LAND_LISTINGS,
        ];
        if (!ALLOWED_COLLECTIONS.includes(collectionName as any)) {
            return { error: `Collection '${collectionName}' is not editable via this action`, success: false };
        }

        // Sanitize fields: only allow whitelisted keys
        const sanitized: Record<string, any> = {};
        for (const key of Object.keys(fields) as (keyof EditableApplicationFields)[]) {
            if (ALLOWED_EDIT_FIELDS.includes(key) && fields[key] !== undefined) {
                sanitized[key] = (fields[key] as string).trim();
            }
        }

        if (Object.keys(sanitized).length === 0) {
            return { error: "No valid fields to update", success: false };
        }

        // Fetch current doc to capture "before" snapshot for audit
        const docRef = db.collection(collectionName).doc(docId);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            return { error: `Document ${docId} not found in ${collectionName}`, success: false };
        }

        const before: Record<string, any> = {};
        const docData = docSnap.data()!;
        for (const key of Object.keys(sanitized)) {
            // Handle dot-notation keys like "nextOfKin.name"
            if (key.includes(".")) {
                const [parent, child] = key.split(".");
                before[key] = docData[parent]?.[child] ?? null;
            } else {
                before[key] = docData[key] ?? null;
            }
        }

        // Apply update
        await docRef.update({
            ...sanitized,
            lastEditedBy: session.user.id,
            lastEditedAt: FieldValue.serverTimestamp(),
        });

        // Write full audit trail
        await logAuditAction(
            "admin_edit_application",
            docId,
            collectionName,
            {
                adminId: session.user.id,
                adminName: session.user.name || session.user.email,
                before,
                after: sanitized,
                editNote: editNote || null,
            }
        );

        return {
            success: true,
            error: null,
            message: "Application updated successfully",
        };
    } catch (error: any) {
        logger.error("Edit application error:", error);
        return { error: "Failed to update application: " + error.message, success: false };
    }
}

// ============================================
// Toggle Verified Badge on a Seller
// ============================================

/**
 * Grants or revokes the Verified Badge on a seller_verifications document.
 * Only approved sellers should receive the badge; the UI can enforce this but
 * the action itself only requires admin permission.
 */
export async function toggleVerifiedBadgeAction(
    verificationId: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return { error: "Unauthorized: Permission required - users:update", success: false };
        }

        const ref = db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(verificationId);
        const snap = await ref.get();
        if (!snap.exists) {
            return { error: "Seller verification record not found", success: false };
        }

        const data = snap.data()!;
        const newBadgeState = !data.isVerifiedBadge;

        await ref.update({
            isVerifiedBadge: newBadgeState,
            badgeGrantedBy: session.user.id,
            badgeGrantedAt: newBadgeState ? FieldValue.serverTimestamp() : null,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Also sync badge onto the user's profile document for storefronts to read
        if (data.userId) {
            await db.collection(COLLECTIONS.USERS).doc(data.userId).update({
                isVerifiedBadge: newBadgeState,
                updatedAt: FieldValue.serverTimestamp(),
            });
        }

        // Optional email notification to seller
        if (newBadgeState && data.email && process.env.RESEND_API_KEY) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);
                const { error } = await resend.emails.send({
                    from: "Easy Sales Export <noreply@easysalesexport.com>",
                    to: data.email,
                    subject: "🏅 You've earned a Verified Badge!",
                    html: `
                        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
                          <div style="background:#16a34a;padding:20px 28px">
                            <h1 style="color:#fff;margin:0;font-size:20px">Easy Sales Export</h1>
                          </div>
                          <div style="padding:28px">
                            <h2 style="color:#111827">Congratulations, ${data.businessName || data.userName}!</h2>
                            <p style="color:#374151">Your seller account has been awarded the <strong>Verified Badge</strong> on Easy Sales Export. This badge signals trust and credibility to buyers across our marketplace.</p>
                            <p style="color:#374151">The badge will now appear on your storefront and product listings.</p>
                            <p style="color:#9ca3af;font-size:12px;margin-top:24px">Easy Sales Export · easysalesexport.com</p>
                          </div>
                        </div>`,
                });
                if (error) {
                    logger.error("[toggleVerifiedBadgeAction] Resend API Error:", error);
                }
            } catch (emailErr: unknown) {
                logger.warn("[toggleVerifiedBadgeAction] Email failed (non-fatal):", { error: String(emailErr) });
            }
        }

        // Audit log
        await logAuditAction(
            newBadgeState ? "seller_badge_grant" : "seller_badge_revoke",
            verificationId,
            "seller_verification",
            { adminId: session.user.id }
        );

        return {
            error: null,
            success: true,
            message: newBadgeState
                ? "Verified Badge granted and seller notified"
                : "Verified Badge revoked",
        };
    } catch (error: any) {
        logger.error("toggleVerifiedBadgeAction error:", error);
        return { error: "Failed to update badge: " + error.message, success: false };
    }
}

// ============================================
// Manual Academy Enrollment (Admin)
// ============================================

export async function manualAcademyEnrollmentAction(
    userId: string,
    plan: "foundation" | "standard" | "elite"
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        
        // Check if admin has user update permissions (or a specific academy permission)
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return { error: "Unauthorized: Permission required - users:update", success: false };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return { error: "User not found", success: false };
        }

        await userRef.update({
            "serviceRegistrations.academy.status": "active",
            "serviceRegistrations.academy.plan": plan,
            "serviceRegistrations.academy.enrolledAt": FieldValue.serverTimestamp(),
            // Ensure they have the academy role
            roles: FieldValue.arrayUnion("academy_participant"),
            updatedAt: FieldValue.serverTimestamp(),
        });

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
        await logAuditAction(
            "academy_manual_enroll",
            userId,
            "user",
            { adminId: session.user.id, plan }
        );

        return {
            error: null,
            success: true,
            message: `User successfully enrolled in Academy (${plan} package)`,
        };
    } catch (error: any) {
        logger.error("Manual academy enrollment error:", error);
        return { error: "Failed to enroll user: " + error.message, success: false };
    }
}

// ============================================
// Import Legacy Cooperative Member
// ============================================

import { z } from "zod";
import { strictEmailSchema } from "@/lib/schemas";
const InviteLegacyMemberSchema = z.object({
    email: strictEmailSchema,
    firstName: z.string().min(1, "First name is optional but recommended for personalization").optional(),
});

export async function inviteLegacyMemberAction(
    data: z.infer<typeof InviteLegacyMemberSchema>
): Promise<{ error: string | null; success: boolean }> {
    try {
        const adminCheck = await requireAdmin();
        if ("error" in adminCheck) return { error: adminCheck.error, success: false };

        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        if (!session?.user || !hasAdminPermission(session.user.roles, "users:create")) {
             if (!hasAdminPermission(session.user.roles, "cooperatives:approve_members")) {
                return { error: "Unauthorized: Permission required - cooperatives:approve_members", success: false };
             }
        }

        const valid = InviteLegacyMemberSchema.safeParse(data);
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false };
        }

        const { email, firstName } = valid.data;

        // 1. Check if user is already a fully onboarded cooperative member
        let existingUid: string | null = null;
        try {
            const existing = await adminAuth.getUserByEmail(email);
            existingUid = existing.uid;
        } catch (err: any) {
            // User doesn't exist in Auth, which is fine. They will create an account during onboarding.
        }

        if (existingUid) {
            const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(existingUid);
            const memberDoc = await memberRef.get();
            if (memberDoc.exists && memberDoc.data()?.onboardingCompleted === true) {
                return { error: "User is already a fully onboarded cooperative member.", success: false };
            }
        }

        // 2. Map existing active tokens for this email to revoked
        const invitesQuery = await db.collection(COLLECTIONS.COOPERATIVES_INVITES)
            .where("email", "==", email)
            .where("status", "==", "pending")
            .get();

        const batch = db.batch();
        invitesQuery.docs.forEach(doc => {
            batch.update(doc.ref, { status: "revoked", updatedAt: FieldValue.serverTimestamp() });
        });

        // 3. Generate secure token
        const token = crypto.randomBytes(32).toString('hex');
        const now = FieldValue.serverTimestamp();

        // 4. Validate and construct URL
        const inviteRef = db.collection(COLLECTIONS.COOPERATIVES_INVITES).doc(token);
        batch.set(inviteRef, {
            email,
            token,
            status: "pending",
            invitedBy: session.user.id,
            createdAt: now,
            updatedAt: now,
        });

        // 5. Commit Firestore
        await batch.commit();

        // 6. Send Email
        const onboardingLink = `https://www.easysalesexport.com/cooperatives/onboarding?token=${token}`;

        if (process.env.RESEND_API_KEY) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);

                const { error: emailError } = await resend.emails.send({
                    from: "Easy Sales Cooperative <noreply@easysalesexport.com>",
                    to: email,
                    subject: "You're Invited to the Cooperative!",
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                            <h2 style="color: #6366f1;">Welcome to the Cooperative!</h2>
                            <p>Hello ${firstName || "Member"},</p>
                            <p>You have been invited to formally complete your cooperative onboarding on the Easy Sales Export platform. Because you're an existing member, <strong>your registration fee has already been waived</strong> when you use this direct link.</p>
                            
                            <div style="background: #eef2ff; padding: 16px; border-radius: 8px; margin: 20px 0; border: 1px solid #c7d2fe;">
                                <p style="margin: 0; color: #4338ca;">Click the button below to join:</p>
                            </div>

                            <div style="text-align: center; margin-top: 30px;">
                                <a href="${onboardingLink}" style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Complete Onboarding</a>
                            </div>

                            <p style="margin-top: 30px; font-size: 12px; color: #6b7280;">If the button doesn't work, copy and paste this link into your browser:<br/>${onboardingLink}</p>
                        </div>
                    `
                });

                if (emailError) {
                    logger.error("Resend API Error (Coop Invite):", emailError);
                    return { error: "Invite created but failed to send email. Link: " + onboardingLink, success: true }; // Partial success
                }
            } catch (err: any) {
                logger.error("Resend Error (Coop Invite):", err);
                return { error: "Invite created but failed to send email.", success: true };
            }
        } else {
             logger.warn("RESEND_API_KEY is not set. Assuming development mode. Invite created silently.");
        }

        // 7. Audit Log
        await logAuditAction("legacy_member_invited", token, "cooperative_member", {
            adminId: session.user.id,
            email: email
        });

        return { error: null, success: true };
    } catch (error: any) {
        logger.error("Failed to send cooperative invite:", error);
        return { error: error.message || "Failed to invite member", success: false };
    }
}

export async function getStandardSellerVerificationsAction(
    statusFilter?: "pending" | "approved" | "rejected" | "suspended" | "all",
    cursorId?: string,
    limitCount: number = 50
): Promise<{ success: boolean; data?: any[]; error?: string; meta?: any }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, error: "Not authenticated" };

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists || (!userDoc.data()?.roles?.includes("admin") && !userDoc.data()?.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        let cursorSnap = null;
        if (cursorId) {
            cursorSnap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(cursorId).get();
        }

        let q = db.collection(COLLECTIONS.SELLER_VERIFICATIONS).orderBy("createdAt", "desc");
        
        if (statusFilter && statusFilter !== "all") {
            q = q.where("status", "==", statusFilter);
        }

        if (cursorSnap && cursorSnap.exists) {
            q = q.startAfter(cursorSnap);
        }
        
        q = q.limit(limitCount);

        const snapshot = await q.get();
        const applications = serializeDocs(snapshot.docs);
        const nextCursorId = snapshot.docs.length === limitCount ? snapshot.docs[snapshot.docs.length - 1].id : undefined;


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
            const userName = uData.name || uData.firstName ? `${uData.firstName} ${uData.lastName || ''}`.trim() : (app.userName || app.businessName || "Unknown User");
            
            return {
                id: app.id,
                user: {
                    id: app.userId,
                    name: userName,
                    email: uData.email || app.userEmail || app.email || "Unknown",
                    phone: uData.phone || app.phone || app.phoneNumber || "Unknown",
                    dob: uData.dob || app.dateOfBirth || "Unknown",
                    address: typeof uData.address === 'object' ? uData.address?.street : (uData.address || app.residentialAddress || "Unknown"),
                    state: typeof uData.address === 'object' ? uData.address?.state : (uData.stateOfOrigin || app.stateOfOrigin || "Unknown"),
                    lga: typeof uData.address === 'object' ? uData.address?.lga : (uData.lga || app.lga || "Unknown"),
                },
                status: app.status || "pending",
                data: app
            };
        });

        return { success: true, data: standardForms, error: undefined, meta: { lastDocId: nextCursorId } };
    } catch (error) {
        logger.error("Get standard seller verifications error:", error);
        return { success: false, error: "Failed to fetch normalized applications", meta: null };
    }
}


export async function getMarketplaceUsersAction(options: {
    limit?: number;
    search?: string;
    roleFilter?: "all" | "buyer_only" | "seller_only" | "both";
    lastDocId?: string;
} = {}) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists || (!userDoc.data()?.roles?.includes("admin") && !userDoc.data()?.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        const fetchLimit = options.search ? 2000 : (options.limit || 50);
        let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.USERS);

        // We paginate by document ID to handle the custom array-contains checks later if needed.
        if (options.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.USERS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                q = q.orderBy("__name__").startAfter(lastDoc);
            } else {
                q = q.orderBy("__name__");
            }
        } else {
            q = q.orderBy("__name__");
        }

        q = q.limit(fetchLimit);

        const snapshot = await q.get();

        // Marketplace filter
        let users = snapshot.docs.map(doc => {
            const data = doc.data();
            const hasSellerRole = (data.roles || []).includes("seller");
            
            // In ESE, all registered users are buyers. Only those with the seller role are sellers.
            // If they have the seller role, they are inherently both a buyer and a seller.
            let buyerRole = "buyer_only";
            if (hasSellerRole) buyerRole = "both";

            return {
                id: doc.id,
                name: data.fullName || data.name || "Unknown",
                email: data.email,
                phone: data.phone || "",
                roles: data.roles || [],
                buyerRole,
                status: data.status || "active",
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt || null
            };
        }).filter(Boolean) as any[];

        if (options.roleFilter && options.roleFilter !== "all") {
            users = users.filter((u: any) => {
                if (options.roleFilter === "seller_only") {
                    return u.buyerRole === "seller_only" || u.buyerRole === "both";
                }
                if (options.roleFilter === "buyer_only") {
                    return u.buyerRole === "buyer_only";
                }
                return u.buyerRole === options.roleFilter;
            });
        }

        if (options.search) {
            const s = options.search.toLowerCase();
            users = users.filter((u: any) => 
                u.name?.toLowerCase().includes(s) || 
                u.email?.toLowerCase().includes(s)
            );
        }

        // Sort latest (mocking it via UI, since we're walking cursors)
        users.sort((a, b) => {
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateB - dateA;
        });

        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        return { 
            success: true, 
            data: users,
            lastDocId: nextCursor,
            hasMore: !!nextCursor,
        };

    } catch (error: any) {
        logger.error("Failed to fetch marketplace buyers:", error);
        return { success: false, error: "Internal server error" };
    }
}
