"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { auth } from "@/lib/auth";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logAuditAction } from "./audit";
import { createNotificationAction } from "@/app/actions/notifications";
import {
    WaveApplicationReviewSchema,
    WithdrawalProcessingSchema,
    UserVerificationToggleSchema,
    LandListingVerificationSchema,
    LoanApplicationReviewSchema
} from "@/lib/schemas";
import { hasAdminPermission } from "@/lib/admin-permissions";

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
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "wave:approve_applications")) {
            return { error: "Unauthorized: Permission required - wave:approve_applications", success: false };
        }

        const valid = WaveApplicationReviewSchema.safeParse({ applicationId, status: "approved" });
        if (!valid.success) {
            return { error: (valid.error as any).errors[0].message, success: false };
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
        await db.collection("wave_members").doc(userId).set({
            active: true,
            enrolledAt: FieldValue.serverTimestamp(),
            applicationId: applicationId,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // 4. CLEAR CACHE - User now has Wave access
        try {
            const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
            await invalidateServiceCache(userId, 'wave');
            console.log(`[Wave Approval] Cache cleared for user: ${userId}`);
        } catch (cacheError) {
            logger.error('[Wave Approval] Cache clear error:', cacheError);
        }

        // 4. Send Approval Email
        if (userEmail && process.env.RESEND_API_KEY) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);

                await resend.emails.send({
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
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "wave:approve_applications")) {
            return { error: "Unauthorized: Permission required - wave:approve_applications", success: false };
        }

        const valid = WaveApplicationReviewSchema.safeParse({ applicationId, status: "rejected", reason });
        if (!valid.success) {
            return { error: (valid.error as any).errors[0].message, success: false };
        }

        await db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId).update({
            status: "rejected",
            rejectionReason: reason,
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

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
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "finance:process_withdrawals")) {
            return { error: "Unauthorized: Permission required - finance:process_withdrawals", success: false };
        }

        const valid = WithdrawalProcessingSchema.safeParse({ withdrawalId, action, reasoning });
        if (!valid.success) {
            return { error: (valid.error as any).errors[0].message, success: false };
        }

        const withdrawalRef = db.collection(COLLECTIONS.WITHDRAWALS).doc(withdrawalId);
        const withdrawalDoc = await withdrawalRef.get();

        if (!withdrawalDoc.exists) {
            return { error: "Withdrawal request not found", success: false };
        }

        const withdrawalData = withdrawalDoc.data()!;

        await withdrawalRef.update({
            status: action === "approve" ? "completed" : "rejected",
            processedBy: session.user.id,
            processedAt: FieldValue.serverTimestamp(),
            adminNotes: reasoning || "",
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Create notification for user
        await createNotificationAction({
            userId: withdrawalData.userId,
            type: action === "approve" ? "success" : "warning",
            title: action === "approve" ? "Withdrawal Approved" : "Withdrawal Rejected",
            message: action === "approve"
                ? `Your withdrawal request of ₦${withdrawalData.amount.toLocaleString()} has been approved.`
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
            message: `Withdrawal ${action === "approve" ? "approved" : "rejected"} successfully`,
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
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return { error: "Unauthorized: Permission required - users:update", success: false };
        }

        const valid = UserVerificationToggleSchema.safeParse({ userId });
        if (!valid.success) {
            return { error: (valid.error as any).errors[0].message, success: false };
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
            console.log(`[User Verification] Cache cleared for user: ${userId}`);
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
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "wave:approve_applications")) {
            return { error: "Unauthorized: Permission required - wave:approve_applications", success: false };
        }

        let query = db.collection(COLLECTIONS.WAVE_APPLICATIONS)
            .orderBy("createdAt", "desc")
            .limit(limit);

        if (statusFilter) {
            query = db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where("status", "==", statusFilter)
                .orderBy("createdAt", "desc")
                .limit(limit);
        }

        // Apply Cursor if provided
        if (lastCreatedAt) {
            const cursorDate = typeof lastCreatedAt === 'string' ? new Date(lastCreatedAt) : lastCreatedAt;
            query = query.startAfter(Timestamp.fromDate(cursorDate));
        }

        const snapshot = await query.get();
        const applications = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate() || new Date(),
            reviewedAt: doc.data().reviewedAt?.toDate(),
        }));

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
    lastCreatedAt?: Date | string
): Promise<{
    error: string | null;
    success: boolean;
    data?: any[];
    hasMore?: boolean;
}> {
    try {
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "finance:read")) {
            return { error: "Unauthorized: Permission required - finance:read", success: false };
        }

        let query = db.collection(COLLECTIONS.WITHDRAWALS)
            .where("status", "==", "pending")
            .orderBy("createdAt", "desc")
            .limit(limit);

        if (lastCreatedAt) {
            const cursorDate = typeof lastCreatedAt === 'string' ? new Date(lastCreatedAt) : lastCreatedAt;
            query = query.startAfter(Timestamp.fromDate(cursorDate));
        }

        const snapshot = await query.get();

        const withdrawals = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate() || new Date(),
        }));

        return {
            error: null,
            success: true,
            data: withdrawals,
            hasMore: withdrawals.length === limit
        };
    } catch (error: any) {
        logger.error("Get pending withdrawals error:", error);
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
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "land:verify_listings")) {
            return { error: "Unauthorized: Permission required - land:verify_listings", success: false };
        }

        // Pending lists are usually small, but let's cap it anyway
        const snapshot = await db.collection("land_listings")
            .where("verificationStatus", "==", "pending")
            .orderBy("createdAt", "desc")
            .limit(limit)
            .get();

        const listings = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate() || new Date(),
        }));

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
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "land:verify_listings")) {
            return { error: "Unauthorized: Permission required - land:verify_listings", success: false };
        }

        const valid = LandListingVerificationSchema.safeParse({ listingId, decision, reason });
        if (!valid.success) {
            return { error: (valid.error as any).errors[0].message, success: false };
        }

        // Update listing status
        const listingRef = db.collection("land_listings").doc(listingId);
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
                console.log(`[Land Verification] Cache cleared for user: ${ownerId}`);
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
                    await resend.emails.send({
                        from: "Easy Sales Export <noreply@easysalesexport.com>",
                        to: listingData.ownerEmail,
                        subject: emailSubject,
                        html: emailContent,
                    });
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
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "cooperatives:approve_loans")) {
            return { error: "Unauthorized: Permission required - cooperatives:approve_loans", success: false };
        }

        const snapshot = await db.collection("loan_applications")
            .where("status", "==", "pending")
            .orderBy("appliedAt", "desc")
            .get();

        const applications = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                appliedAt: data.appliedAt?.toDate() || new Date(),
            };
        });

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
    lastCreatedAt?: Date | string
): Promise<{
    error: string | null;
    success: boolean;
    exports?: any[];
    hasMore?: boolean;
}> {
    try {
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "cooperatives:approve_loans")) {
            return { error: "Unauthorized: Permission required - cooperatives:approve_loans", success: false };
        }

        let query = db.collection(COLLECTIONS.EXPORT_WINDOWS)
            .orderBy("createdAt", "desc")
            .limit(limit);

        if (statusFilter && statusFilter !== "all") {
            query = db.collection(COLLECTIONS.EXPORT_WINDOWS)
                .where("status", "==", statusFilter)
                .orderBy("createdAt", "desc")
                .limit(limit);
        }

        if (lastCreatedAt) {
            const cursorDate = typeof lastCreatedAt === 'string' ? new Date(lastCreatedAt) : lastCreatedAt;
            query = query.startAfter(Timestamp.fromDate(cursorDate));
        }

        const snapshot = await query.get();
        const exports = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            orderDate: doc.data().orderDate?.toDate() || new Date(),
            deliveryDate: doc.data().deliveryDate?.toDate(),
            escrowReleaseDate: doc.data().escrowReleaseDate?.toDate(),
            createdAt: doc.data().createdAt?.toDate() || new Date(),
            updatedAt: doc.data().updatedAt?.toDate() || new Date(),
        }));

        return {
            error: null,
            success: true,
            exports,
            hasMore: exports.length === limit
        };
    } catch (error: any) {
        logger.error("Get all export requests error:", error);
        return { error: "Failed to fetch export requests", success: false };
    }
}

export async function approveLoanApplication(
    applicationId: string
): Promise<ActionState> {
    try {
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "cooperatives:approve_loans")) {
            return { error: "Unauthorized: Permission required - cooperatives:approve_loans", success: false };
        }

        const valid = LoanApplicationReviewSchema.safeParse({ applicationId, status: "approved" });
        if (!valid.success) {
            return { error: (valid.error as any).errors[0].message, success: false };
        }

        // Get loan data for validation
        const loanRef = db.collection("loan_applications").doc(applicationId);
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

        // CLEAR CACHE - User's cooperative status changed
        try {
            const { invalidateCooperativeCache } = await import('@/lib/cache-invalidation');
            await invalidateCooperativeCache(loanData.userId);
            console.log(`[Loan Approval] Cache cleared for user: ${loanData.userId}`);
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
                await resend.emails.send({
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
                            <li>Funds will be disbursed to your account within 2-3 business days</li>
                            <li>Your first repayment is due 30 days from disbursement</li>
                            <li>You can track your repayment schedule in your dashboard</li>
                        </ul>

                            <p>Thank you for being a valued member of our cooperative!</p>
                        </div>
                    `,
                });
            }
        }

        // Create notification for user
        await createNotificationAction({
            userId: loanData.userId,
            type: "success",
            title: "Loan Approved!",
            message: `Your loan application for ₦${loanData.amount.toLocaleString()} has been approved. Disbursement within 2-3 days.`,
            link: "/loans",
            linkText: "View Loans",
        });

        // Log audit
        await logAuditAction(
            "loan_approved",
            applicationId,
            "application",
            { adminId: session.user.id, amount: loanData.amount, role: "Checker/Final" }
        );

        return {
            error: null,
            success: true,
            message: "Loan application approved successfully",
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
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "finance:read")) {
            return { error: "Unauthorized: Permission required - finance:read", success: false };
        }

        const valid = LoanApplicationReviewSchema.safeParse({ applicationId, status: "rejected", reason });
        if (!valid.success) {
            return { error: (valid.error as any).errors[0].message, success: false };
        }

        // Get loan data for email
        const loanRef = db.collection("loan_applications").doc(applicationId);
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
                await resend.emails.send({
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
        const session = await auth();
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
    role?: string;
    status?: "verified" | "unverified" | "all";
    search?: string;
    lastDocId?: string;
}

export async function getUsersAction(options: GetUsersOptions = {}): Promise<{
    error: string | null;
    success: boolean;
    users?: any[];
    lastDocId?: string;
    hasMore?: boolean;
}> {
    try {
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:read")) {
            return { error: "Unauthorized: Permission required - users:read", success: false };
        }

        const pageSize = options.limit || 20;
        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.USERS);

        // Apply filters
        // Prioritize exact match for Search if it looks like an email or phone
        if (options.search) {
            const search = options.search.trim();
            // Email exact match
            if (search.includes("@")) {
                query = query.where("email", "==", search);
            }
            // Phone exact match (if it looks like a phone number, e.g. starts with + or 0 and has digits)
            else if (/^[\d+]+$/.test(search) && search.length > 5) {
                query = query.where("phone", "==", search);
            }
            // For names, we still have to rely on the fallback filtering for now, 
            // but we can at least try to search by 'fullName' if we had a dedicated index, 
            // or just let the client-side filter handle the 'fuzzy' name part on the fetched page (limited).
            // NOTE: This limits 'Name' search to the first pageSize results if we don't have an external search engine.
        }

        // Basic filtering (Role/Status) - Only apply if NOT doing a direct search (to avoid index issues)
        // OR apply them if possible. verifying indexes might be tricky.
        // Let's keep it simple: unique search wins.
        if (!options.search) {
            if (options.role && options.role !== "all") {
                query = query.where("roles", "array-contains", options.role);
            }

            if (options.status === "verified") {
                query = query.where("verified", "==", true);
            } else if (options.status === "unverified") {
                query = query.where("verified", "==", false);
            }

            // Sorting only if not searching (Firestore limitation on mixing inequality/sort with different fields sometimes)
            query = query.orderBy("createdAt", "desc");
        }

        // Pagination
        if (options.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.USERS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        query = query.limit(pageSize);

        const snapshot = await query.get();

        // Manual search filtering (if needed, though inefficient for large datasets without 3rd party search)
        // For this implementation, we will assume search happens on the filtered set or rely on precise filters.
        // If 'search' is provided, we might need a specific index or external service.
        // For now, let's process the snapshot.

        const users = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                name: data.fullName || "Unknown",
                email: data.email,
                phone: data.phone,
                role: data.roles?.[0] || "general_user", // Basic display of primary role
                roles: data.roles || [], // Full roles array
                isVerified: data.verified ?? false,
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
                verifiedAt: data.verifiedAt?.toDate ? data.verifiedAt.toDate() : undefined,
                // Add extra fields for detail view
                bankDetails: data.bankDetails,
                address: data.address,
                metadata: data.metadata,
                accountType: data.accountType
            };
        });

        // Simple client-side search filter on the fetched page (not ideal but works for small pages)
        // Or if the user really wants search, we should note the limitation.
        let filteredUsers = users;
        if (options.search) {
            const searchLower = options.search.toLowerCase();
            filteredUsers = users.filter(user =>
                user.name.toLowerCase().includes(searchLower) ||
                user.email.toLowerCase().includes(searchLower) ||
                (user.phone && user.phone.includes(searchLower))
            );
        }

        const lastVisible = snapshot.docs[snapshot.docs.length - 1];

        return {
            error: null,
            success: true,
            users: filteredUsers,
            lastDocId: lastVisible ? lastVisible.id : undefined,
            hasMore: snapshot.docs.length === pageSize
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
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:assign_roles")) {
            return { error: "Unauthorized: Permission required - users:assign_roles", success: false };
        }

        // Validate inputs
        const { UpdateUserRolesSchema } = await import("@/lib/schemas");
        const valid = UpdateUserRolesSchema.safeParse({ userId, roles });

        if (!valid.success) {
            return { error: (valid.error as any).errors[0].message, success: false };
        }

        // Prevent admin from removing their own admin role
        if (userId === session.user.id && !roles.includes("admin")) {
            return { error: "Cannot remove your own admin privileges", success: false };
        }

        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            roles: roles,
            updatedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp()
        });

        await logAuditAction("user_role_update", userId, "user", {
            roles,
            adminId: session.user.id
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
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "marketplace:approve_sellers")) {
            // Fallback for super_admin if specific role missing, or strict check
            if (!session?.user?.roles.includes("super_admin") && !session?.user?.roles.includes("admin")) {
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
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            isVerified: true,
            sellerVerificationStatus: "approved",
            sellerVerificationId: verificationId,
            verifiedBy: session.user.id, // Track who verified the user
            verifiedAt: FieldValue.serverTimestamp(),
            roles: FieldValue.arrayUnion("seller"),
            // SYNC CONTACT INFO: Update phone with verified number to prevent data drift
            phone: verificationData.phoneNumber,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // CLEAR CACHE - User now has seller role and verification
        try {
            const { invalidateSellerCache } = await import('@/lib/cache-invalidation');
            await invalidateSellerCache(userId);
            console.log(`[Seller Approval] Cache cleared for user: ${userId}`);
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

                    await resend.emails.send({
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
        const session = await auth();
        // Use general user update permission or create a new one. Using users:update for now.
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            if (!session?.user?.roles.includes("super_admin") && !session?.user?.roles.includes("admin")) {
                return { error: "Unauthorized: Permission required - users:update", success: false };
            }
        }

        // 1. Get Application Doc
        const appRef = db.collection("export_onboarding").where("applicationId", "==", applicationId).limit(1);
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
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            isVerified: true,
            "services.export.status": "active",
            "services.export.approvedAt": FieldValue.serverTimestamp(),
            verifiedBy: session.user.id,
            verifiedAt: FieldValue.serverTimestamp(),
            roles: FieldValue.arrayUnion("export_participant"),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // CLEAR CACHE - User now has Export access
        try {
            const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
            await invalidateServiceCache(userId, 'export');
            console.log(`[Export Approval] Cache cleared for user: ${userId}`);
        } catch (cacheError) {
            logger.error('[Export Approval] Cache clear error:', cacheError);
        }

        // 4. Send Approval Email
        if (process.env.RESEND_API_KEY && appData.userEmail) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);

                await resend.emails.send({
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
            } catch (emailError) {
                logger.error("Failed to send export approval email:", emailError);
            }
        }

        // Log audit
        await logAuditAction("export_approve", applicationId, "export_onboarding", {
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
// ============================================
// Academy Application Management (Admin)
// ============================================

export async function getAcademyApplicationsAction(
    statusFilter?: "pending" | "approved" | "rejected"
): Promise<{
    error: string | null;
    success: boolean;
    data?: any[];
}> {
    try {
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "academy:approve_applications")) {
            // Fallback for now/testing or add permission
            if (!session?.user?.roles?.includes("admin")) {
                return { error: "Unauthorized: Permission required - academy:approve_applications", success: false };
            }
        }

        let query = db.collection("ACADEMY_APPLICATIONS")
            .orderBy("submittedAt", "desc");

        if (statusFilter) {
            query = db.collection("ACADEMY_APPLICATIONS")
                .where("status", "==", statusFilter)
                .orderBy("submittedAt", "desc");
        }

        const snapshot = await query.get();
        const applications = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            submittedAt: doc.data().submittedAt?.toDate() || new Date(),
            reviewedAt: doc.data().reviewedAt?.toDate(),
        }));

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
        const session = await auth();
        if (!session?.user || !session.user.roles?.includes("admin")) {
            return { error: "Unauthorized", success: false };
        }

        // Get application first
        const appRef = db.collection("ACADEMY_APPLICATIONS").doc(applicationId);
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

        // 4. Send Email (Optional/TODO)

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
        const session = await auth();
        if (!session?.user || !session.user.roles?.includes("admin")) {
            return { error: "Unauthorized", success: false };
        }

        await db.collection("ACADEMY_APPLICATIONS").doc(applicationId).update({
            status: "rejected",
            rejectionReason: reason,
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        const appDoc = await db.collection("ACADEMY_APPLICATIONS").doc(applicationId).get();
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
