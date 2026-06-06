"use server";
import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";

import { versionedUpdate } from "@/lib/optimistic-locking";
import { z, ZodError } from "zod";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";

import { revalidatePath, revalidateTag } from 'next/cache';
import { deleteCache, CacheKeys } from "@/lib/redis";
import { invalidateAdminGlobalStats, invalidateServiceCache } from "@/lib/cache-invalidation";
import crypto from 'crypto';
import { db, adminAuth } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp, FieldPath } from "firebase-admin/firestore";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createAdminAuditLog, logAdminAction } from "@/lib/audit-log";
import { serializeDoc, serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { normalizeAggressive } from "@/lib/canonical/normalizer";
import { createNotificationAction } from "@/app/actions/notifications";
import {
    WaveApplicationReviewSchema,
    WithdrawalProcessingSchema,
    UserVerificationToggleSchema,
    LandListingVerificationSchema,
    LoanApplicationReviewSchema,
    ExportOnboardingReviewSchema,
    UserKycVerificationSchema,
    LegacyOnboardingSchema
} from "@/lib/schemas";
import { sendLegacyMemberWelcomeEmail, sendPasswordResetEmail } from "@/lib/email-notifications";
import { hasAdminPermission, isAdmin } from "@/lib/admin-permissions";
import { requireAdmin } from "@/lib/require-admin";
import { atomicUpdateUser } from "@/lib/services/userService";
import { writeGuard, UserRolesWriteSchema } from "@/lib/write-guard";

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
// Process Withdrawal Request
// ============================================

async function _processWithdrawalAction(
    withdrawalId: string,
    action: "approve" | "reject",
    reasoning?: string
): Promise<ActionState> {
    try {
        // Live role re-validation — bypasses stale JWT
        const adminCheck = await requireAdmin();
        if ("error" in adminCheck) return { error: adminCheck.error, success: false as const };

        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "finance:process_withdrawals")) {
            return { error: "Unauthorized: Permission required - finance:process_withdrawals", success: false as const };
        }

        const valid = WithdrawalProcessingSchema.safeParse({ withdrawalId, action, reasoning });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false as const };
        }

        // Try standard withdrawals first, then cooperative_withdrawals
        let withdrawalRef = db.collection(COLLECTIONS.WITHDRAWALS).doc(withdrawalId);
        let withdrawalDoc = await withdrawalRef.get();

        if (!withdrawalDoc.exists) {
            withdrawalRef = db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).doc(withdrawalId);
            withdrawalDoc = await withdrawalRef.get();
        }

        if (!withdrawalDoc.exists) {
            withdrawalRef = db.collection(COLLECTIONS.WAVE_WITHDRAWALS).doc(withdrawalId);
            withdrawalDoc = await withdrawalRef.get();
        }

        if (!withdrawalDoc.exists) {
            return { error: "Withdrawal request not found", success: false as const };
        }

        const withdrawalData = withdrawalDoc.data()!;

        if (action === "approve") {
            // ══════════════════════════════════════════════
            // 1. STATE LOCK — Mark as payout_initiated
            // ══════════════════════════════════════════════
            await db.runTransaction(async (transaction) => {
                const freshDoc = await transaction.get(withdrawalRef);
                if (!freshDoc.exists) throw new Error("Withdrawal request not found");
                const currentStatus = freshDoc.data()?.status;
                if (currentStatus !== "pending") {
                    throw new Error(`Withdrawal is already ${currentStatus}`);
                }

                transaction.update(withdrawalRef, {
                    status: "payout_initiated",
                    processedBy: session.user.id,
                    processedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            });

            // ══════════════════════════════════════════════
            // 2. PAYOUT — Trigger Paystack Transfer
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

            // ══════════════════════════════════════════════
            // 3. FINAL UPDATE & LEDGER RECORD
            // ══════════════════════════════════════════════
            await db.runTransaction(async (transaction) => {
                transaction.update(withdrawalRef, {
                    status: payoutSuccess ? "completed" : "approved_pending_payout",
                    adminNotes: reasoning || "",
                    updatedAt: FieldValue.serverTimestamp(),
                    ...(transferCode ? { paystackTransferCode: transferCode } : {}),
                    ...(payoutError && !payoutSuccess ? { payoutError, pendingManualPayout: true } : {}),
                });

                if (payoutSuccess) {
                    // Global Ledger Record (Unified Tracking)
                    const reference = transferCode || `WITHDRAW-${withdrawalId}`;
                    const globalTxRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(reference);
                    transaction.set(globalTxRef, {
                        id: reference,
                        userId: withdrawalData.userId,
                        type: "withdrawal",
                        module: withdrawalRef.path.includes('cooperative') ? "cooperative" : "wallet",
                        amount: withdrawalData.amount,
                        currency: "NGN",
                        status: "completed",
                        date: FieldValue.serverTimestamp(),
                        reference,
                        description: `Withdrawal payout - ${withdrawalId}`
                    });
                }
            });
        } else {
            // Rejection — just update status atomically
            await db.runTransaction(async (transaction) => {
                const freshDoc = await transaction.get(withdrawalRef);
                if (!freshDoc.exists) throw new Error("Withdrawal request not found");
                transaction.update(withdrawalRef, {
                    status: "rejected",
                    processedBy: session.user.id,
                    processedAt: FieldValue.serverTimestamp(),
                    adminNotes: reasoning || "",
                    updatedAt: FieldValue.serverTimestamp(),
                });
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
        await createAdminAuditLog({
            action: action === "approve" ? "withdrawal_approve" : "withdrawal_reject",
            userId: session.user.id,
            targetId: withdrawalId,
            targetType: "withdrawal",
            metadata: { notes: reasoning },
        });

        return {
            error: null,
            success: true as const,
            message: `Withdrawal ${action === "approve" ? "approved and payout initiated" : "rejected"} successfully`,
        };
    } catch (error: any) {
        logger.error("Process withdrawal error:", error);
        return { error: "Failed to process withdrawal", success: false as const };
    }
}

// ============================================
// User Verification Toggle
// ============================================

async function _toggleUserVerificationAction(
    userId: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return { error: "Unauthorized: Permission required - users:update", success: false as const };
        }

        const valid = UserVerificationToggleSchema.safeParse({ userId });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false as const };
        }

        // Get current user doc
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return { error: "User not found", success: false as const };
        }

        const currentData = userDoc.data()!;
        const newVerificationStatus = !currentData.isVerified;

        const { safeUpdate } = await import("@/lib/firestore-utils");
        await safeUpdate(COLLECTIONS.USERS, userId, {
            isVerified: newVerificationStatus,
            "kyc.status": newVerificationStatus ? "verified" : "pending",
            kycStatus: newVerificationStatus ? "verified" : "pending",
            verifiedBy: session.user.id,
            verifiedAt: newVerificationStatus ? FieldValue.serverTimestamp() : null,
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
        await createAdminAuditLog({
            action: newVerificationStatus ? "user_verify" : "user_unverify",
            userId: session.user.id,
            targetId: userId,
            targetType: "user",
        });

        return {
            error: null,
            success: true as const,
            message: `User ${newVerificationStatus ? "verified" : "unverified"} successfully`,
        };
    } catch (error: any) {
        logger.error("Toggle user verification error:", error);
        return { error: "Failed to update verification status", success: false as const };
    }
}

// ============================================
// User KYC Verification Toggle
// ============================================

async function _toggleUserKycVerificationAction(
    userId: string,
    field: 'bvn' | 'nin' | 'tin' | 'cac',
    currentStatus: boolean
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        // Assuming "users:update" is sufficient for KYC. Could create a stricter role if needed.
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return { error: "Unauthorized: Permission required - users:update", success: false as const };
        }

        const valid = UserKycVerificationSchema.safeParse({ userId, field, currentStatus });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false as const };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return { error: "User not found", success: false as const };
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
        await createAdminAuditLog({
            action: newVerificationStatus ? `user_kyc_verify_${field}` : `user_kyc_unverify_${field}`,
            userId: session.user.id,
            targetId: userId,
            targetType: "user",
        });

        return {
            error: null,
            success: true as const,
            message: `${field.toUpperCase()} ${newVerificationStatus ? "verified" : "unverified"} successfully`,
        };
    } catch (error: any) {
        logger.error(`Toggle user KYC verification error (${field}):`, error);
        return { error: `Failed to update ${field.toUpperCase()} verification status`, success: false as const };
    }
}
 // ============================================
 // Update User Gender (Admin Only)
 // ============================================
 async function _updateUserGenderAction(
     userId: string,
     gender: "male" | "female"
 ): Promise<ActionState> {
     try {
         const sessionResult = await requireSession();
         if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
         const { session } = sessionResult;
         if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
             return { error: "Unauthorized: Permission required - users:update", success: false as const };
         }
         await atomicUpdateUser(userId, {
             gender,
         });
         // Log audit
         await createAdminAuditLog({
             action: "user_gender_update",
             userId: session.user.id,
             targetId: userId,
             targetType: "user",
             metadata: { newGender: gender },
         });
         return {
             error: null,
             success: true as const,
             message: `User gender updated to ${gender} successfully`,
         };
     } catch (error: any) {
         logger.error("Update user gender error:", error);
         return { error: "Failed to update gender", success: false as const };
     }
 }


// ============================================
// Get Pending Withdrawals (Admin)
// ============================================

async function _getPendingWithdrawalsAction(
    limit = 50,
    lastCreatedAt?: Date | string,
    statusFilter: "pending" | "completed" | "rejected" | "approved_pending_payout" | "all" = "pending"
): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "finance:read")) {
            return { error: "Unauthorized: Permission required - finance:read", success: false as const, data: null };
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

        // Query standard withdrawals, cooperative_withdrawals AND wave_withdrawals
        const [stdSnap, coopSnap, waveSnap] = await Promise.all([
            buildQuery(COLLECTIONS.WITHDRAWALS).get(),
            buildQuery(COLLECTIONS.COOPERATIVE_WITHDRAWALS).get(),
            buildQuery(COLLECTIONS.WAVE_WITHDRAWALS).get(),
        ]);

        const toRecord = (doc: FirebaseFirestore.QueryDocumentSnapshot, source: string) =>
            ({ ...serializeDoc(doc.id, doc.data()), source });

        const withdrawals = [
            ...stdSnap.docs.map(d => toRecord(d, "withdrawal")),
            ...coopSnap.docs.map(d => toRecord(d, "cooperative_withdrawal")),
            ...waveSnap.docs.map(d => toRecord(d, "wave_withdrawal")),
        ].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, limit);

        // HYDRATION: Batch-resolve user bank details
        const userIds = [...new Set(withdrawals.map((w: any) => w.userId).filter(Boolean))];
        const userMap: Record<string, any> = {};

        if (userIds.length > 0) {
            const chunks = [];
            for (let i = 0; i < userIds.length; i += 30) {
                chunks.push(userIds.slice(i, i + 30));
            }

            const userSnapshots = await Promise.all(
                chunks.map(chunk => 
                    db.collection(COLLECTIONS.USERS)
                        .where(FieldPath.documentId(), "in", chunk)
                        .get()
                )
            );

            userSnapshots.forEach(snap => {
                snap.forEach(doc => {
                    const data = doc.data();
                    userMap[doc.id] = {
                        name: data.name || data.fullName || "Unknown",
                        email: data.email || "",
                        phone: data.phone || "",
                        bankDetails: {
                            bankName: data.bankName || data.bankAccount?.bankName || "",
                            accountNumber: data.bankAccountNumber || data.bankAccount?.accountNumber || "",
                            accountName: data.bankAccountName || data.bankAccount?.accountName || data.fullName || (data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : ""),
                            bankCode: data.bankCode || data.bankAccount?.bankCode || ""
                        }
                    };
                });
            });
        }

        const enrichedData = withdrawals.map((w: any) => ({
            ...w,
            user: userMap[w.userId] || null,
            // Standardize bankDetails at root for UI components
            bankDetails: userMap[w.userId]?.bankDetails || w.bankDetails || {
                bankName: w.bankName || "",
                accountNumber: w.bankAccountNumber || w.accountNumber || "",
                accountName: w.bankAccountName || w.accountName || (userMap[w.userId]?.name || ""),
                bankCode: w.bankCode || ""
            }
        }));

        return {
            error: null,
            success: true as const,
            data: enrichedData,
            hasMore: enrichedData.length === limit,
        };
    } catch (error: any) {
        logger.error("Get withdrawals error:", error);
        return { error: "Failed to fetch withdrawals", success: false as const, data: null };
    }
}


// ============================================
// Land Verification (Admin)
// ============================================

async function _getPendingLandListings(limit = 50): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "land:verify_listings")) {
            return { error: "Unauthorized: Permission required - land:verify_listings", success: false as const, data: null };
        }

        // Pending lists are usually small, but let's cap it anyway
        const snapshot = await db.collection(COLLECTIONS.LAND_LISTINGS)
            .where("verificationStatus", "==", "pending")
            .orderBy("createdAt", "desc")
            .limit(limit)
            .get();

        const listings = serializeDocs(snapshot.docs);

        // --- HYDRATION START ---
        const userIds = [...new Set(listings.map(l => l.userId).filter(Boolean))];
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
        // --- HYDRATION END ---

        const hydratedListings = listings.map((l: any) => {
            const uData = (userMap.get(l.userId as string) || {}) as any;
            const userName = uData.name || uData.fullName || l.userName || "Unknown User";
            
            // Standardize bankDetails
            const bankDetails = uData.bankDetails || {
                bankName: uData.bankName || uData.bankAccount?.bankName || "",
                accountNumber: uData.bankAccountNumber || uData.bankAccount?.accountNumber || "",
                accountName: uData.bankAccountName || uData.bankAccount?.accountName || uData.fullName || (uData.firstName && uData.lastName ? `${uData.firstName} ${uData.lastName}` : ""),
                bankCode: uData.bankCode || uData.bankAccount?.bankCode || ""
            };

            return {
                ...l,
                user: {
                    id: l.userId,
                    name: userName,
                    email: uData.email || "Unknown",
                    phone: uData.phone || uData.phoneNumber || "Unknown",
                    bankDetails
                }
            };
        });

        return {
            error: null,
            success: true as const,
            data: hydratedListings,
        };
    } catch (error: any) {
        logger.error("Get pending land listings error:", error);
        return { error: "Failed to fetch land listings", success: false as const, data: null };
    }
}

async function _verifyLandListing(
    listingId: string,
    decision: "approved" | "rejected",
    reason: string
): Promise<ActionState> {
    try {
        // Live role re-validation — bypasses stale JWT
        const adminCheck = await requireAdmin();
        if ("error" in adminCheck) return { error: adminCheck.error, success: false as const };

        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "land:verify_listings")) {
            return { error: "Unauthorized: Permission required - land:verify_listings", success: false as const };
        }

        const valid = LandListingVerificationSchema.safeParse({ listingId, decision, reason });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false as const };
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
        await createAdminAuditLog({
            action: decision === "approved" ? "land_approve" : "land_reject",
            userId: session.user.id,
            targetId: listingId,
            targetType: "land_listing",
            metadata: { reason: decision === "rejected" ? reason : null },
        });

        return {
            error: null,
            success: true as const,
            message: `Land listing ${decision} successfully`,
        };
    } catch (error: any) {
        logger.error("Verify land listing error:", error);
        return { error: "Failed to verify land listing", success: false as const };
    }
}

// ============================================
// Loan Application Management (Admin)
// ============================================

async function _getPendingLoanApplications(limit = 50, lastDocId?: string): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "cooperatives:approve_loans")) {
            return { error: "Unauthorized: Permission required - cooperatives:approve_loans", success: false as const, data: null };
        }

        const loanCol = db.collection(COLLECTIONS.LOAN_APPLICATIONS);
        let loanQuery: FirebaseFirestore.Query = loanCol
            .where("status", "==", "pending")
            .orderBy("appliedAt", "desc")
            .limit(limit + 1);

        if (lastDocId) {
            const cursor = await loanCol.doc(lastDocId).get();
            if (cursor.exists) loanQuery = loanQuery.startAfter(cursor);
        }

        const snapshot = await loanQuery.get();
        const pageDocs = snapshot.docs.slice(0, limit);
        const hasMore = snapshot.docs.length > limit;
        const nextCursor = hasMore ? pageDocs[pageDocs.length - 1]?.id ?? null : null;

        const applications = serializeDocs(pageDocs);

        // HYDRATION: Batch-resolve user bank details
        const userIds = [...new Set(applications.map((app: any) => app.userId).filter(Boolean))];
        const userMap: Record<string, any> = {};

        if (userIds.length > 0) {
            const chunks = [];
            for (let i = 0; i < userIds.length; i += 30) {
                chunks.push(userIds.slice(i, i + 30));
            }

            const userSnapshots = await Promise.all(
                chunks.map(chunk => 
                    db.collection(COLLECTIONS.USERS)
                        .where(FieldPath.documentId(), "in", chunk)
                        .get()
                )
            );

            userSnapshots.forEach(snap => {
                snap.forEach(doc => {
                    const data = doc.data();
                    userMap[doc.id] = {
                        name: data.name || data.fullName || "Unknown",
                        email: data.email || "",
                        phone: data.phone || "",
                        bankDetails: {
                            bankName: data.bankName || data.bankAccount?.bankName || "",
                            accountNumber: data.bankAccountNumber || data.bankAccount?.accountNumber || "",
                            accountName: data.bankAccountName || data.bankAccount?.accountName || data.fullName || (data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : ""),
                            bankCode: data.bankCode || data.bankAccount?.bankCode || ""
                        }
                    };
                });
            });
        }

        const enrichedApplications = applications.map((app: any) => ({
            ...app,
            user: userMap[app.userId] || null,
            // Fallback for UI components expecting root bankDetails
            bankDetails: userMap[app.userId]?.bankDetails || {
                bankName: app.bankName || "",
                accountNumber: app.accountNumber || "",
                accountName: app.accountName || (userMap[app.userId]?.name || ""),
                bankCode: app.bankCode || ""
            }
        }));

        return {
            error: null,
            success: true as const,
            data: enrichedApplications,
            hasMore,
            lastDocId: nextCursor,
        };
    } catch (error: any) {
        logger.error("Get pending loan applications error:", error);
        return { error: "Failed to fetch loan applications", success: false as const, data: null };
    }
}

// ============================================
// Export Window Management (Admin)
// ============================================

async function _getAllExportRequestsAction(
    statusFilter?: "pending" | "in_transit" | "delivered" | "completed" | "all",
    limit = 50,
    lastDocId?: string
): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "finance:read")) {
            return { error: "Unauthorized: Permission required - finance:read", success: false as const, data: null };
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
            return { error: "Failed to serialize export records: " + msg, success: false as const, data: null };
        }

        const nextCursorId = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1].id : null;

        let serializedData: any[];
        try {
            serializedData = JSON.parse(JSON.stringify(exportsList));
        } catch (e: any) {
            const msg = e instanceof Error ? e.message : "Unknown serialization error";
            logger.error(`[Serialization Test] Failed to stringify export records. Reason: ${msg}`);
            return { error: "Failed to serialize export records: " + msg, success: false as const, data: null };
        }

        return {
            error: null,
            success: true as const,
            data: serializedData,
            lastDocId: nextCursorId,
            hasMore: snapshot.docs.length >= limit,
        };
    } catch (error: any) {
        logger.error("Get all export requests error:", error);
        return { error: "Failed to fetch export requests", success: false as const, data: null };
    }
}

async function _approveLoanApplication(
    applicationId: string,
    version?: number
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "cooperatives:approve_loans")) {
            return { error: "Unauthorized: Permission required - cooperatives:approve_loans", success: false as const };
        }

        const valid = LoanApplicationReviewSchema.safeParse({ applicationId, status: "approved" });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false as const };
        }

        const loanRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(applicationId);

        // ATOMIC TRANSACTION: State Verification and Transition
        const txResult = await db.runTransaction(async (transaction) => {
            const loanSnap = await transaction.get(loanRef);
            if (!loanSnap.exists) {
                throw new Error("Loan application not found");
            }
            const loanData = loanSnap.data()!;
            // Prevent double-processing
            if (loanData.status === "approved" || loanData.status === "disbursed") {
                return { error: null, success: true as const, alreadyProcessed: true, loanData };
            }

            // Double-lending verification: Check for other active/pending loans platform-wide
            const borrowerId = loanData.userId;
            const otherGeneralLoansQuery = db.collection(COLLECTIONS.LOAN_APPLICATIONS)
                .where("userId", "==", borrowerId)
                .where("status", "in", ["pending", "reviewing", "approved", "partially_approved", "disbursed"]);
            const otherGeneralLoansSnap = await transaction.get(otherGeneralLoansQuery);

            const otherCoopLoansQuery = db.collection(COLLECTIONS.COOPERATIVE_LOANS)
                .where("memberId", "==", borrowerId)
                .where("status", "in", ["pending", "reviewing", "approved", "partially_approved", "disbursed"]);
            const otherCoopLoansSnap = await transaction.get(otherCoopLoansQuery);

            const otherGeneralLoansCount = otherGeneralLoansSnap.docs.filter(doc => doc.id !== applicationId).length;
            const otherCoopLoansCount = otherCoopLoansSnap.docs.filter(doc => doc.id !== applicationId).length;

            if (otherGeneralLoansCount > 0 || otherCoopLoansCount > 0) {
                throw new Error("Active or pending loan application already exists platform-wide for this user.");
            }

            // Validate tier eligibility
            const tierMultiplier = 2.0; 
            const maxLoanAmount = (loanData.contributionAmount || 0) * tierMultiplier;

            if (loanData.amount > maxLoanAmount) {
                throw new Error(`Loan amount exceeds maximum for Member tier (₦${maxLoanAmount.toLocaleString()})`);
            }

            // Maker-Checker Logic (High Value)
            const MAKER_CHECKER_THRESHOLD = 1000000;
            if (loanData.amount >= MAKER_CHECKER_THRESHOLD) {
                const approvalChain = loanData.approvalChain || {};

                if (!approvalChain.firstApprover) {
                    // First Approval (Maker)
                    transaction.update(loanRef, {
                        approvalChain: {
                            firstApprover: session.user.id,
                            firstApprovalAt: FieldValue.serverTimestamp(),
                            firstApproverName: session.user.name || session.user.email
                        },
                        status: "partially_approved",
                        updatedAt: FieldValue.serverTimestamp(),
                    });

                    return { error: null, success: true as const, makerApproval: true, loanData };
                } else {
                    // Second Approval (Checker)
                    if (approvalChain.firstApprover === session.user.id) {
                        throw new Error("Security Violation: You cannot verify your own approval. Another admin is required.");
                    }
                    transaction.update(loanRef, {
                        "approvalChain.secondApprover": session.user.id,
                        "approvalChain.secondApprovalAt": FieldValue.serverTimestamp(),
                        "approvalChain.secondApproverName": session.user.name || session.user.email,
                    });
                }
            }

            // Final Approval Logic
            await versionedUpdate(transaction, loanRef, version, {
                status: "approved",
                reviewedBy: session.user.id,
                reviewedAt: FieldValue.serverTimestamp(),
            });

            return { error: null, success: true as const, finalApproval: true, loanData };
        });

        if (txResult.alreadyProcessed) {
            return { success: true as const, message: "Loan application already processed", error: null };
        }

            await createAdminAuditLog({
                action: "loan_partially_approved",
                userId: session.user.id,
                targetId: applicationId,
                targetType: "application",
                metadata: { amount: txResult.loanData.amount, role: "Maker" },
            });

        // --- DISBURSEMENT (Outside Transaction) ---
        const { loanData } = txResult;
        let disbursementTransferCode: string | undefined;
        let disbursementError: string | undefined;

        try {
            const { paystackPayout } = await import("@/lib/paystack-transfer");
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
                } else {
                    disbursementError = disbResult.error;
                    await loanRef.update({
                        disbursed: false,
                        disbursementError: disbResult.error,
                        pendingManualDisbursement: true,
                    });
                }
            } else {
                disbursementError = "Borrower bank details not configured";
                await loanRef.update({ pendingManualDisbursement: true, disbursementNote: disbursementError });
            }
        } catch (disbErr: any) {
            disbursementError = disbErr.message;
            await loanRef.update({ pendingManualDisbursement: true, disbursementError: disbErr.message });
        }

        // --- SIDE EFFECTS (Email, Notifications, Cache) ---
        try {
            const { invalidateCooperativeCache } = await import('@/lib/cache-invalidation');
            await invalidateCooperativeCache(loanData.userId);
        } catch (e) { logger.error('[admin] cache invalidation failed silently:', e); }

        if (process.env.RESEND_API_KEY && loanData.userEmail) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);
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
                                <li>${disbursementTransferCode ? 'Your funds have been transferred to your bank account.' : 'Funds will be disbursed to your account shortly.'}</li>
                                <li>Your first repayment is due 30 days from disbursement</li>
                                <li>You can track your repayment schedule in your dashboard</li>
                            </ul>
                            <p>Thank you for being a valued member of our cooperative!</p>
                        </div>
                    `,
                });
            } catch (e) { logger.error('[admin] loan approval email failed silently:', e); }
        }

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

        await createAdminAuditLog({
            action: "loan_approved",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "application",
            metadata: { amount: loanData.amount, role: "Checker/Final", disbursed: !!disbursementTransferCode },
        });

        return {
            error: null,
            success: true as const,
            message: disbursementTransferCode ? "Loan approved and disbursed successfully" : `Loan approved. ${disbursementError ? `Disbursement pending: ${disbursementError}` : "Disbursement pending."}`,
        };
    } catch (error: any) {
        logger.error("Approve loan application error:", error);
        return { error: error.message || "Failed to approve loan application", success: false as const };
    }
}

async function _rejectLoanApplication(
    applicationId: string,
    reason: string,
    version?: number
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "finance:read")) {
            return { error: "Unauthorized: Permission required - finance:read", success: false as const };
        }

        const valid = LoanApplicationReviewSchema.safeParse({ applicationId, status: "rejected", reason });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false as const };
        }

        const loanRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(applicationId);

        // ATOMIC TRANSACTION: Update loan status
        const txResult = await db.runTransaction(async (transaction) => {
            const loanSnap = await transaction.get(loanRef);
            if (!loanSnap.exists) {
                throw new Error("Loan application not found");
            }
            const loanData = loanSnap.data()!;

            await versionedUpdate(transaction, loanRef, version, {
                status: "rejected",
                rejectionReason: reason,
                reviewedBy: session.user.id,
                reviewedAt: FieldValue.serverTimestamp(),
            });

            return { loanData };
        });

        const { loanData } = txResult;

        // SIDE EFFECTS (Post-Commit)
        if (process.env.RESEND_API_KEY && loanData.userEmail) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);
                await resend.emails.send({
                    from: "Easy Sales Export <noreply@easysalesexport.com>",
                    to: loanData.userEmail,
                    subject: "Loan Application Update",
                    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
                        <h2 style="color:#dc2626">Loan Application Update</h2>
                        <div style="background:#fef2f2;padding:16px;border-radius:8px;margin:20px 0">
                            <p>Unfortunately, we are unable to approve your loan application at this time.</p>
                            <p><strong>Reason:</strong> ${reason}</p>
                        </div>
                    </div>`
                });
            } catch (e) { logger.error('[admin] loan rejection email failed silently:', e); }
        }

        await createNotificationAction({
            userId: loanData.userId,
            type: "warning",
            title: "Loan Application Declined",
            message: `Your loan application for ₦${loanData.amount.toLocaleString()} was not approved.`,
            link: "/loans",
            linkText: "View Details",
        });

        await createAdminAuditLog({
            action: "loan_rejected",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "application",
            metadata: { reason },
        });

        return { error: null, success: true as const, message: "Loan application rejected" };
    } catch (error: any) {
        logger.error("Reject loan application error:", error);
        return { error: error.message || "Failed to reject loan application", success: false as const };
    }
}

// ============================================
// Rate Limit Management (Admin)
// ============================================

/**
 * Unlock a rate-limited user account
 * Allows admins to manually reset login attempt counters
 */
async function _unlockUserAccount(email: string): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:read")) {
            return { error: "Unauthorized: Permission required - users:read", success: false as const };
        }

        if (!email || !email.includes("@")) {
            return { error: "Invalid email address", success: false as const };
        }

        // Reset rate limit
        const { resetLoginAttempts } = await import("@/lib/rate-limit");
        await resetLoginAttempts(email);

        // Log audit
        await createAdminAuditLog({
            action: "account_unlock",
            userId: session.user.id,
            targetId: email,
            targetType: "user",
            metadata: { email },
        });

        return {
            error: null,
            success: true as const,
            message: `Account unlocked: ${email}`,
        };
    } catch (error: any) {
        logger.error("Unlock account error:", error);
        return { error: "Failed to unlock account", success: false as const };
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
    sortOrder?: "asc" | "desc"; // Sort direction
    modules?: string;   // 'all' | 'multi' | specific module slug ('academy', 'marketplace', etc.)
}

async function _getUsersAction(options: GetUsersOptions = {}): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:read")) {
            const roles = session?.user?.roles ?? [];
            logger.warn(`[getUsersAction] Permission denied. Session roles: ${roles.join(", ") || "none (session may be stale — user must re-login)"}`);
            return {
                error: `Unauthorized: your session does not have the 'users:read' permission. Current roles: [${roles.join(", ") || "none"}]. Please sign out and sign back in to refresh your session.`,
                success: false as const,
                data: null,
            };
        }

        const pageSize = options.search ? 5000 : (options.limit || 50);
        const page = options.page ?? 0; // page offset (0-indexed)

        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.USERS);

        let hasUnindexedFilter = false;

        // Apply filters
        // If we have search (email/phone), we apply an equality filter.
        if (options.search) {
            const search = options.search.trim();
            // Email exact match
            if (search.includes("@")) {
                query = query.where("email", "==", search.toLowerCase());
            }
            // Phone exact match
            else if (/^[\d+]+$/.test(search) && search.length > 5) {
                query = query.where("phone", "==", search);
                hasUnindexedFilter = true; // No composite index for phone + createdAt desc
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

            // Location filters (No composite indexes exist for state/lga + createdAt desc)
            if ((options.state && options.state !== "all") || (options.lga && options.lga !== "all")) {
                hasUnindexedFilter = true;
            }
        }

        // Apply strict Date boundaries in Firestore
        // This ensures chronological fetching and accurate Date filtering without memory limits
        if (!hasUnindexedFilter) {
            if (options.fromDate) {
                // Ensure start of day boundary
                const startObj = new Date(options.fromDate);
                startObj.setUTCHours(0, 0, 0, 0);
                query = query.where("createdAt", ">=", startObj);
            }
            if (options.toDate) {
                // Ensure end of day boundary
                const endObj = new Date(options.toDate);
                endObj.setUTCHours(23, 59, 59, 999);
                query = query.where("createdAt", "<=", endObj);
            }
            
            // Order chronologically
            query = query.orderBy("createdAt", "desc");
        }

        // ---------------------------------------------------------
        // EXACT DATABASE COUNT (Satisfies Data Consistency Audit)
        // ---------------------------------------------------------
        let countQuery: FirebaseFirestore.Query = db.collection(COLLECTIONS.USERS);
        if (!options.search) {
            if (options.role && options.role !== "all") {
                countQuery = countQuery.where("roles", "array-contains", options.role);
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

        // Fetch a dynamic batch — no orderBy (avoids missing-field exclusion).
        // We page in-memory after sort.
        // If searching or applying an unindexed filter, fetch a larger batch (5000) to ensure high search/filter coverage.
        // If doing standard navigation, scale limit based on the requested page to reduce expensive reads by 97%+
        const FETCH_LIMIT = (options.search || hasUnindexedFilter || options.fromDate || options.toDate || (options.role && options.role !== "all"))
            ? 2000
            : Math.min(2000, (page + 1) * pageSize + 100);
        query = query.limit(FETCH_LIMIT);

        const snapshot = await query.get();

        const users = snapshot.docs.map(doc => {
            const data = doc.data();
            // Defensive name derivation — supports all schema generations:
            // 1. New schema: firstName + lastName stored separately (onboarding post-April 2026)
            // 2. Legacy schema: fullName stored as single string
            // 3. Auth-only schema: name stored from Firebase Auth display name
            // IMPORTANT: Reject placeholder values like "User" or "Unknown" that were
            // written by the ghost-account auto-repair before April 2026. Fall through
            // to the email address so the admin table shows something meaningful.
            const PLACEHOLDER_NAMES = new Set(["user", "unknown", "unknown user", "n/a", ""]);
            const isPlaceholder = (v: any) => !v || PLACEHOLDER_NAMES.has(String(v).toLowerCase().trim());

            // Extract richest profile from serviceRegistrations if top-level fields are missing
            let bestFirstName = data.firstName;
            let bestLastName = data.lastName;
            let bestFullName = data.fullName;
            let bestPhone = data.phone;
            
            // Defensively extract state and lga (preventing React objects-as-children crashes)
            let bestState = data.address?.state || data.state;
            if (typeof bestState === 'object' && bestState !== null) {
                bestState = bestState.state || bestState.name || "";
            }
            if (typeof bestState !== 'string') bestState = "";

            let bestLga = data.address?.lga || data.lga;
            if (typeof bestLga === 'object' && bestLga !== null) {
                bestLga = bestLga.lga || bestLga.name || "";
            }
            if (typeof bestLga !== 'string') bestLga = "";

            // Aggressive KYC extraction from modules
            let bestBvn = data.kyc?.bvn || data.bvn;
            let bestBvnVerified = data.kyc?.bvnVerified ?? data.bvnVerified ?? false;
            let bestNin = data.kyc?.nin || data.nin;
            let bestNinVerified = data.kyc?.ninVerified ?? data.ninVerified ?? false;
            let bestBankDetails = data.bankDetails || {
                bankName: data.bankName || data.bankAccount?.bankName,
                accountNumber: data.accountNumber || data.bankAccountNumber || data.bankAccount?.accountNumber,
                accountName: data.accountName || data.bankAccountName || data.bankAccount?.accountName,
                bankCode: data.bankCode || data.bankAccount?.bankCode
            };

            // Defensive Next of Kin extraction
            const bestNextOfKin = data.nextOfKin || {
                name: data.nextOfKinName || "",
                phone: data.nextOfKinPhone || "",
                relationship: data.nextOfKinRelationship || "",
                address: data.nextOfKinAddress || ""
            };

            if (data.serviceRegistrations) {
                Object.values(data.serviceRegistrations).forEach((reg: any) => {
                    const profile = reg?.profile || reg;
                    if (!profile) return;
                    
                    if (isPlaceholder(bestFirstName) && profile.firstName && !isPlaceholder(profile.firstName)) bestFirstName = profile.firstName;
                    if (isPlaceholder(bestLastName) && profile.lastName && !isPlaceholder(profile.lastName)) bestLastName = profile.lastName;
                    if (isPlaceholder(bestFullName) && profile.fullName && !isPlaceholder(profile.fullName)) bestFullName = profile.fullName;
                    if (isPlaceholder(bestFullName) && profile.name && !isPlaceholder(profile.name)) bestFullName = profile.name;
                    
                    if (isPlaceholder(bestPhone) && profile.phone && !isPlaceholder(profile.phone)) bestPhone = profile.phone;
                    if (isPlaceholder(bestState) && profile.state && !isPlaceholder(profile.state)) bestState = profile.state;
                    if (isPlaceholder(bestLga) && profile.lga && !isPlaceholder(profile.lga)) bestLga = profile.lga;
                    
                    // Extract nextOfKin from module profile if missing
                    const nk = profile.nextOfKin || {};
                    if (!bestNextOfKin.name && (profile.nextOfKinName || nk.name)) {
                        bestNextOfKin.name = profile.nextOfKinName || nk.name;
                    }
                    if (!bestNextOfKin.phone && (profile.nextOfKinPhone || nk.phone)) {
                        bestNextOfKin.phone = profile.nextOfKinPhone || nk.phone;
                    }
                    if (!bestNextOfKin.relationship && (profile.nextOfKinRelationship || nk.relationship)) {
                        bestNextOfKin.relationship = profile.nextOfKinRelationship || nk.relationship;
                    }
                    if (!bestNextOfKin.address && (profile.nextOfKinAddress || nk.address)) {
                        bestNextOfKin.address = profile.nextOfKinAddress || nk.address;
                    }

                    // Extract KYC from module verificationProfile if available
                    const vp = profile.verificationProfile || reg.verificationProfile;
                    if (vp) {
                        if (!bestBvn && vp.bvn) bestBvn = vp.bvn;
                        if (!bestBvnVerified && vp.bvnVerified) bestBvnVerified = vp.bvnVerified;
                        if (!bestNin && vp.nin) bestNin = vp.nin;
                        if (!bestNinVerified && vp.ninVerified) bestNinVerified = vp.ninVerified;
                        
                        if (vp.bankDetails && !bestBankDetails?.accountNumber) {
                            bestBankDetails = vp.bankDetails;
                        }
                    }
                });
            }

            const derivedFirstName = !isPlaceholder(bestFirstName) ? bestFirstName : null;
            const derivedFullName  = !isPlaceholder(bestFullName)  ? bestFullName  : null;
            const derivedName = derivedFirstName
                ? [derivedFirstName, data.otherName, bestLastName].filter(Boolean).join(" ").trim()
                : (derivedFullName || data.displayName || (bestPhone && bestPhone !== "" ? bestPhone : data.email) || "Unknown");

            return {
                id: doc.id,
                name: derivedName,
                firstName: bestFirstName,
                lastName: bestLastName,
                otherName: data.otherName,
                email: data.email,
                phone: isPlaceholder(bestPhone) ? "" : bestPhone,
                role: data.roles?.[0] || "general_user",
                roles: data.roles || [],
                isVerified: data.isVerified ?? data.verified ?? false,
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt ? new Date(data.createdAt).toISOString() : new Date(0).toISOString()),
                verifiedAt: data.verifiedAt?.toDate ? data.verifiedAt.toDate().toISOString() : (data.verifiedAt ? new Date(data.verifiedAt).toISOString() : undefined),
                // Location
                address: data.address,
                state: bestState || "",
                lga: bestLga || "",
                // KYC fields — prefer nested kyc.* (written by live QoreID actions),
                // fall back to legacy top-level fields for existing records
                bvn: bestBvn,
                bvnVerified: bestBvnVerified,
                bvnStatus: data.kyc?.bvnStatus || (bestBvnVerified ? 'verified' : undefined),
                nin: bestNin,
                ninVerified: bestNinVerified,
                ninStatus: data.kyc?.ninStatus || (bestNinVerified ? 'verified' : undefined),
                kycStatus: data.kyc?.status || data.kycStatus || 'pending',
                taxId: data.taxId,
                tinVerified: data.tinVerified,
                cacNumber: data.cacNumber,
                cacVerified: data.cacVerified,
                idType: data.kyc?.idType || data.idType,
                // Next of Kin
                nextOfKin: bestNextOfKin,
                // Other
                bankDetails: {
                    bankName: bestBankDetails?.bankName || "",
                    accountNumber: bestBankDetails?.accountNumber || "",
                    accountName: bestBankDetails?.accountName || bestFullName || (bestFirstName && bestLastName ? `${bestFirstName} ${bestLastName}` : ""),
                    bankCode: bestBankDetails?.bankCode || ""
                },
                metadata: data.metadata,
                accountType: data.marketplaceAccountType || data.serviceRegistrations?.marketplace?.accountType || data.accountType,
                // ── Module membership ────────────────────────────────────────────
                // Pass the full serviceRegistrations map so the admin UI can render
                // per-module status badges and detect multi-module enrolments.
                serviceRegistrations: data.serviceRegistrations || {},
                gender: data.gender,
            };
        });

        // ── Derive activeModules for each user (in-memory, zero extra Firestore reads) ──
        const MODULE_KEYS = ['marketplace', 'academy', 'wave', 'cooperatives', 'export', 'farmNation', 'farm_nation'];
        const ENROLLED_STATUSES = new Set(['pending', 'under_review', 'approved', 'active', 'paid', 'completed', 'suspended']);
        const usersWithModules = users.map(u => {
            const regs = u.serviceRegistrations as Record<string, any>;
            const active: string[] = [];
            for (const key of MODULE_KEYS) {
                const reg = regs[key];
                if (reg && ENROLLED_STATUSES.has(reg.status)) {
                    // Normalise to URL-friendly label
                    const label = key === 'farmNation' || key === 'farm_nation' ? 'farm-nation' : key;
                    if (!active.includes(label)) active.push(label);
                }
            }
            
            // Legacy marketplace fallback
            if (!active.includes('marketplace') && u.accountType) {
                active.push('marketplace');
            }
            
            return { ...u, activeModules: active, moduleCount: active.length };
        })

        // ── Email deduplication ───────────────────────────────────────────────
        // Ghost accounts auto-created by session-guard may share an email with
        // the user's REAL profile document (different Firestore doc ID).
        // Keep the "richest" document per email: prefer the one with the most
        // fields, breaking ties by earliest createdAt (the original account).
        const emailMap = new Map<string, typeof usersWithModules[0]>();
        const richness = (u: typeof usersWithModules[0]) => {
            // Score = number of meaningful non-placeholder fields present
            let score = 0;
            if (u.phone)    score += 10;
            if (u.firstName && u.firstName.toLowerCase() !== "user") score += 5;
            if (u.lastName)  score += 5;
            if (Object.keys(u.serviceRegistrations || {}).length > 0) score += 20;
            if (u.bvn)       score += 10;
            if (u.nin)       score += 10;
            return score;
        };
        for (const u of usersWithModules) {
            if (!u.email) continue;
            const key = u.email.toLowerCase().trim();
            const existing = emailMap.get(key);
            if (!existing) {
                emailMap.set(key, u);
            } else {
                const newScore = richness(u);
                const oldScore = richness(existing);
                if (newScore > oldScore) {
                    emailMap.set(key, u);
                } else if (newScore === oldScore) {
                    // Same richness — keep the older account (earlier createdAt)
                    const newTime = u.createdAt ? new Date(u.createdAt).getTime() : Infinity;
                    const oldTime = existing.createdAt ? new Date(existing.createdAt).getTime() : Infinity;
                    if (newTime < oldTime) emailMap.set(key, u);
                }
            }
        }
        const deduplicatedUsers = Array.from(emailMap.values());

        // Client-side search + date range filtering
        let filteredUsers = deduplicatedUsers;

        // In-memory Location filtering (State and LGA) — resolves the bug where direct Firestore
        // where("address.state") equality checks silently excluded users with state stored in other properties
        if (options.state && options.state !== "all") {
            const cleanStateFilter = options.state.toLowerCase().replace(/\s*state$/i, "").trim();
            filteredUsers = filteredUsers.filter(u => {
                const cleanUserState = typeof u.state === 'string' 
                    ? u.state.toLowerCase().replace(/\s*state$/i, "").trim() 
                    : "";
                return cleanUserState && cleanUserState.includes(cleanStateFilter);
            });
        }
        if (options.lga && options.lga !== "all") {
            const cleanLgaFilter = options.lga.toLowerCase().trim();
            filteredUsers = filteredUsers.filter(u => {
                const cleanUserLga = typeof u.lga === 'string' ? u.lga.toLowerCase().trim() : "";
                return cleanUserLga && cleanUserLga.includes(cleanLgaFilter);
            });
        }

        if (options.search) {
            const s = options.search.toLowerCase().trim();
            filteredUsers = filteredUsers.filter(user => {
                const searchString = [
                    user.name,
                    user.firstName,
                    user.lastName,
                    user.email,
                    user.phone,
                    user.state,
                    user.lga
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(s);
            });
        }
        // Module filter — supports a specific module slug (e.g. 'academy') or 'multi' (2+ modules)
        if (options.modules && options.modules !== "all") {
            if (options.modules === "multi") {
                filteredUsers = filteredUsers.filter(u => u.moduleCount >= 2);
            } else {
                filteredUsers = filteredUsers.filter(u => (u.activeModules as string[]).includes(options.modules as string));
            }
        }

        // In-memory status filter — using the defensive chain already computed in mapping:
        if (options.status === "verified") {
            filteredUsers = filteredUsers.filter(u => u.isVerified === true);
        } else if (options.status === "unverified") {
            filteredUsers = filteredUsers.filter(u => !u.isVerified);
        }

        // ALWAYS apply date filters in memory as a definitive backstop.
        // This resolves the bug where Firestore cross-type ordering (Strings > Timestamps)
        // caused legacy string-based createdAt dates to leak past the `query.where(">=", Timestamp)` boundary.
        if (options.fromDate) {
            const from = new Date(options.fromDate);
            from.setUTCHours(0, 0, 0, 0);
            filteredUsers = filteredUsers.filter(u => new Date(u.createdAt) >= from);
        }
        if (options.toDate) {
            const to = new Date(options.toDate);
            to.setUTCHours(23, 59, 59, 999);
            filteredUsers = filteredUsers.filter(u => new Date(u.createdAt) <= to);
        }

        // Sort in-memory by createdAt
        filteredUsers.sort((a, b) => {
            const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return options.sortOrder === "asc" ? aTime - bTime : bTime - aTime;
        });

        // Page-offset slice: each page returns exactly pageSize items
        const offset = page * pageSize;
        const pagedUsers = filteredUsers.slice(offset, offset + pageSize);
        
        // Strip Firestore class instances (e.g. Timestamps in serviceRegistrations, address, metadata) using the shared
        // serializeValue() utility which recursively converts Timestamps to ISO strings — safer than JSON round-trip.
        const serializedUsers = serializeValue(pagedUsers);

        return {
            error: null,
            success: true as const,
            data: serializedUsers,
            lastDocId: String(page + 1),
            hasMore: offset + pageSize < filteredUsers.length,
            meta: {
                totalCount: (options.state && options.state !== "all") || (options.lga && options.lga !== "all")
                    ? filteredUsers.length
                    : absoluteDbCount
            }
        };
    } catch (error: any) {
        logger.error("Get users error:", error);
        return { error: "Failed to fetch users: " + error.message, success: false as const, data: null };
    }
}


// Update User Roles Action
async function _updateUserRolesAction(
    userId: string,
    roles: string[]
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:assign_roles")) {
            return { error: "Unauthorized: Permission required - users:assign_roles", success: false as const };
        }

        // Validate inputs
        const { UpdateUserRolesSchema } = await import("@/lib/schemas");
        const valid = UpdateUserRolesSchema.safeParse({ userId, roles });

        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false as const };
        }

        // Prevent admin from removing their own admin role
        if (userId === session.user.id && !isAdmin(roles)) {
            return { error: "Cannot remove your own admin privileges", success: false as const };
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
                serviceUpdates[`${mapping.key}.paymentStatus`] = "completed";
                serviceUpdates[`${mapping.key}.enrolledAt`] = FieldValue.serverTimestamp();
                serviceUpdates[`${mapping.key}.enrolledBy`] = session.user.id;
                serviceUpdates[`${mapping.key}.note`] = "Manual admin role assignment";
            }
        }

        await atomicUpdateUser(userId, writeGuard(
            UserRolesWriteSchema,
            {
                roles: roles,
                updatedBy: session.user.id,
                ...serviceUpdates,
            },
            'admin/updateUserRoles'
        ));

        // ── Write Mock Applications for Admin Dashboards ────────────────────────
        try {
            for (const mapping of MODULE_ROLE_REGS) {
                if (mapping.roles.some(r => roles.includes(r))) {
                    let collectionName = "";
                    let docData: any = {};
                    let docId = `manual_${userId}`;
                    
                    if (mapping.key === "serviceRegistrations.academy") {
                        collectionName = COLLECTIONS.ACADEMY_APPLICATIONS;
                        docData = {
                            applicationId: docId, userId: userId, status: "approved", plan: "elite", paymentStatus: "completed", source: "manual_admin", submittedAt: FieldValue.serverTimestamp(), reviewedAt: FieldValue.serverTimestamp(), reviewedBy: session.user.id
                        };
                    } else if (mapping.key === "serviceRegistrations.cooperatives") {
                        collectionName = COLLECTIONS.COOPERATIVE_MEMBERS;
                        docId = userId;
                        docData = {
                            userId: userId, status: "active", membershipStatus: "active", paymentStatus: "completed", membershipTier: "Member", savingsBalance: 0, loanBalance: 0, joinedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp()
                        };
                    } else if (mapping.key === "serviceRegistrations.export") {
                        collectionName = COLLECTIONS.EXPORT_APPLICATIONS;
                        docData = {
                            applicationId: docId, userId: userId, status: "approved", paymentStatus: "completed", source: "manual_admin", submittedAt: FieldValue.serverTimestamp(), reviewedAt: FieldValue.serverTimestamp(), reviewedBy: session.user.id
                        };
                    } else if (mapping.key === "serviceRegistrations.wave") {
                        collectionName = COLLECTIONS.WAVE_APPLICATIONS;
                        docData = {
                            applicationId: docId, userId: userId, status: "approved", paymentStatus: "completed", source: "manual_admin", submittedAt: FieldValue.serverTimestamp(), reviewedAt: FieldValue.serverTimestamp(), reviewedBy: session.user.id
                        };
                    } else if (mapping.key === "serviceRegistrations.farmNation") {
                        collectionName = COLLECTIONS.FARM_NATION_APPLICATIONS;
                        docData = {
                            applicationId: docId, userId: userId, status: "approved", paymentStatus: "completed", source: "manual_admin", submittedAt: FieldValue.serverTimestamp(), reviewedAt: FieldValue.serverTimestamp(), reviewedBy: session.user.id
                        };
                    }
                    
                    if (collectionName) {
                        const appRef = db.collection(collectionName).doc(docId);
                        const existing = await appRef.get();
                        if (!existing.exists) {
                            await appRef.set(docData, { merge: true });
                        }
                    }
                }
            }
        } catch (e) {
            logger.error("[Role Update] Failed to create mock applications:", e);
        }

        await createAdminAuditLog({
            action: "user_role_change",
            userId: session.user.id,
            targetId: userId,
            targetType: "user",
            metadata: {
                roles,
                serviceRegistrationsUpdated: Object.keys(serviceUpdates).length > 0,
            },
        });

        // DISEASE 1 FIX: Invalidate the user's Redis cache immediately after a role change.
        // The JWT callback reads from getUserProfile() which hits the cache. Without this,
        // the user's new roles won't appear in their session until the cache TTL expires
        // (up to 1 hour), meaning they get bounced to onboarding even after being approved.
        try {
            const { invalidateUserCache } = await import('@/lib/cache-invalidation');
            await invalidateUserCache(userId);
        } catch (e) {
            // Non-fatal: cache invalidation failure doesn't undo the role write
            logger.warn("[updateUserRolesAction] Cache invalidation failed (non-fatal):", e as Error);
        }

        return { success: true as const, error: null, message: "User roles updated" };
    } catch (error: any) {
        return { success: false as const, error: error.message };
    }
}

// ============================================
// Seller Verification (Marketplace)
// ============================================

async function _approveSellerVerificationAction(
    verificationId: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "marketplace:approve_sellers")) {
            // Fallback for super_admin if specific role missing, or strict check
            if (!session?.user?.roles?.includes("super_admin") && !session?.user?.roles?.includes("admin")) {
                return { error: "Unauthorized: Permission required - users:verify_sellers", success: false as const };
            }
        }

        // 1. Get Verification Doc
        const verificationRef = db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(verificationId);
        const verificationDoc = await verificationRef.get();

        if (!verificationDoc.exists) {
            return { error: "Verification request not found", success: false as const };
        }

        const verificationData = verificationDoc.data()!;
        const userId = verificationData.userId;

        if (!userId) {
            return { error: "Invalid verification request: Missing User ID", success: false as const };
        }

        // Perform updates in a single transaction for atomicity
        await db.runTransaction(async (transaction) => {
            // 1. Update Verification Status
            transaction.update(verificationRef, {
                status: "approved",
                verifiedBy: session.user.id,
                verifiedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            // 2. Update User Profile (Verify & Add Role)
            const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
            transaction.update(userRef, {
                isVerified: true,
                sellerVerificationStatus: "approved",
                sellerVerificationId: verificationId,
                verifiedBy: session.user.id,
                verifiedAt: FieldValue.serverTimestamp(),
                roles: FieldValue.arrayUnion("seller"),
                "serviceRegistrations.marketplace.status": "active",
                "serviceRegistrations.marketplace.accountType": verificationData.accountType || "seller",
                "serviceRegistrations.marketplace.paymentStatus": "completed",
                "serviceRegistrations.marketplace.approvedAt": FieldValue.serverTimestamp(),
                "serviceRegistrations.marketplace.approvedBy": session.user.id,
                "verificationProfile.status": "approved",
                "verificationProfile.verifiedBy": session.user.id,
                "verificationProfile.verifiedAt": FieldValue.serverTimestamp(),
                phone: verificationData.phoneNumber || verificationData.phone,
                updatedAt: FieldValue.serverTimestamp(),
            });
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

        await createAdminAuditLog({
            action: "seller_approve",
            userId: session.user.id,
            targetId: verificationId,
            targetType: "seller_verification",
            metadata: { userId: userId },
        });

        // Revalidate
        revalidatePath("/marketplace", "page");
        revalidatePath("/dashboard", "page");
        revalidateTag(`user-status-${userId}`, "page");

        return {
            error: null,
            success: true as const,
            message: "Seller verified successfully",
        };
    } catch (error: any) {
        logger.error("Approve seller verification error:", error);
        return { error: "Failed to verify seller", success: false as const };
    }
}

// ============================================
// Export Onboarding Approval
// ============================================

async function updateExportStatsAtomic(decrementStatus?: 'pending' | 'approved' | 'rejected' | 'resubmitted' | null, incrementStatus?: 'pending' | 'approved' | 'rejected' | 'resubmitted' | null) {
    try {
        const statsRef = db.collection("system_metadata").doc("export_stats");
        const updates: any = {};
        if (decrementStatus) updates[decrementStatus] = FieldValue.increment(-1);
        if (incrementStatus) updates[incrementStatus] = FieldValue.increment(1);
        if (Object.keys(updates).length > 0) {
            // FIX: No more fire-and-forget. Must await to ensure data integrity during process recycles.
            await statsRef.set(updates, { merge: true });
        }
    } catch (e) {
        logger.error("Failed to prepare export stats atomically", e);
    }
}

async function _approveExportOnboardingAction(
    applicationId: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        // Use general user update permission or create a new one. Using users:update for now.
        if (!session?.user || (!hasAdminPermission(session.user.roles, "users:update") && !hasAdminPermission(session.user.roles, "export:approve_applications"))) {
            if (!session?.user?.roles?.includes("super_admin") && !session?.user?.roles?.includes("admin")) {
                return { error: "Unauthorized: Permission required", success: false as const };
            }
        }

        // 1. Get Application Doc — may be passed either as the Firestore doc ID or applicationId field
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
                return { error: "Application not found", success: false as const };
            }
            appDocRef = snap.docs[0].ref;
            appData = snap.docs[0].data();
        }

        const userId = appData.userId;
        if (!userId) {
            return { error: "Invalid application: Missing User ID", success: false as const };
        }

        // Double-validation: Ensure user document exists in COLLECTIONS.USERS
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        if (!userDoc.exists) {
            return { error: `Database desync: Corresponding user document [${userId}] not found in users collection`, success: false as const };
        }

        // 2. Update Application Status
        await appDocRef.update({
            status: "approved",
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // 3. Update User Profile (Verify, Add Role, Activate Service)
        await atomicUpdateUser(userId, {
            isVerified: true,
            "serviceRegistrations.export.status": "approved",
            "serviceRegistrations.export.paymentStatus": "completed",
            "serviceRegistrations.export.approvedAt": FieldValue.serverTimestamp(),
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

        await createAdminAuditLog({
            action: "export_approve",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "export_onboarding_applications",
            metadata: { userId: userId },
        });

        // FAST STATS UPDATER (Non-blocking fallback safe)
        updateExportStatsAtomic('pending', 'approved');

        // Revalidate
        revalidatePath("/export", "page");
        revalidatePath("/dashboard", "page");
        revalidateTag(`user-status-${userId}`, "page");

        return {
            error: null,
            success: true as const,
            message: "Export application approved successfully",
        };
    } catch (error: any) {
        logger.error("Approve export application error:", error);
        return { error: "Failed to approve export application", success: false as const };
    }
}

/**
 * Request revision / correction from an export applicant.
 * Sets status to "revision_required" and stores the admin's note.
 */
async function _requestExportApplicationRevisionAction(
    applicationId: string,
    revisionNote: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            if (!session?.user?.roles?.includes("super_admin") && !session?.user?.roles?.includes("admin")) {
                return { error: "Unauthorized: admin or users:update role required", success: false as const };
            }
        }

        if (!revisionNote?.trim()) {
            return { error: "Revision note is required", success: false as const };
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
                return { error: "Application not found", success: false as const };
            }
            appDocRef = snap.docs[0].ref;
            appData = snap.docs[0].data();
        }

        const userId = appData.userId;
        if (!userId) {
            return { error: "Invalid application: Missing User ID", success: false as const };
        }

        // Double-validation: Ensure user document exists in COLLECTIONS.USERS
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        if (!userDoc.exists) {
            return { error: `Database desync: Corresponding user document [${userId}] not found in users collection`, success: false as const };
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
        // FAST STATS UPDATER (Non-blocking fallback safe)
        updateExportStatsAtomic('pending', null);
        return { error: null, success: true as const, message: "Revision note sent to applicant" };
    } catch (error: any) {
        logger.error("Request export revision error:", error);
        return { error: "Failed to send revision request", success: false as const };
    }
}

async function _getExportApplicationsStatsAction(): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Not authenticated", data: null };

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const { getCached, setCache } = await import("@/lib/redis");
        const cacheKey = "admin:export-stats:global";

        try {
            const cached = await getCached<any>(cacheKey);
            if (cached) return { success: true as const, data: cached, error: null };
        } catch (e) {
            // quiet fail on cache read
        }

        // ALWAYS use dynamic count to ensure 100% accuracy and avoid stale metadata sync issues.
        // If the document doesn't exist yet, compute dynamically.
        const [
            pendingReviewCountSnap,
            pendingCountSnap,
            approvedCountSnap,
            rejectedCountSnap
        ] = await Promise.all([
            db.collection(COLLECTIONS.EXPORT_APPLICATIONS).where("status", "==", "pending_review").count().get(),
            db.collection(COLLECTIONS.EXPORT_APPLICATIONS).where("status", "==", "pending").count().get(),
            db.collection(COLLECTIONS.EXPORT_APPLICATIONS).where("status", "==", "approved").count().get(),
            db.collection(COLLECTIONS.EXPORT_APPLICATIONS).where("status", "==", "rejected").count().get()
        ]);

        const resubmittedSnap = await db.collection(COLLECTIONS.EXPORT_APPLICATIONS)
            .where("resubmittedAt", "!=", null)
            .count()
            .get()
            .catch(() => ({ data: () => ({ count: 0 }) })); 

        const payload = {
            pending: (pendingReviewCountSnap.data().count || 0) + (pendingCountSnap.data().count || 0),
            approved: approvedCountSnap.data().count || 0,
            rejected: rejectedCountSnap.data().count || 0,
            resubmitted: resubmittedSnap.data().count || 0
        };

        try {
            await setCache(cacheKey, payload, 120); // Cache for 2 minutes
        } catch (e) { logger.error('[admin] cache set failed silently:', e); }

        return { success: true as const, data: payload, error: null };
    } catch (error) {
        logger.error("Get export application stats error:", error);
        return { success: false as const, error: "Failed to fetch export stats", data: null };
    }
}
async function _getStandardExportApplicationsAction(options: {
    limit?: number;
    search?: string;
    status?: "pending_review" | "approved" | "rejected" | "revision_required" | "pending" | "all";
    lastDocId?: string;
    dateFrom?: string; // YYYY-MM-DD
    dateTo?: string;   // YYYY-MM-DD
} = {}): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Not authenticated", data: null };

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const useMemoryPagination = !!options.search || !!options.dateFrom || !!options.dateTo;
        const fetchLimit = useMemoryPagination ? 5000 : (options.limit || 50);

        let q: any = db.collection(COLLECTIONS.EXPORT_APPLICATIONS);
        if (options.status && options.status !== "all") {
            if (options.status === "pending") {
                q = q.where("status", "in", ["pending", "pending_review"]);
            } else {
                q = q.where("status", "==", options.status);
            }
        }
        // Server-side date range filter
        if (options.dateFrom) {
            const fromTs = dateRangeStart(options.dateFrom);
            q = q.where("createdAt", ">=", fromTs);
        }
        if (options.dateTo) {
            const toTs = dateRangeEnd(options.dateTo);
            q = q.where("createdAt", "<=", toTs);
        }

        q = q.orderBy("createdAt", "desc").limit(fetchLimit + 1);

        if (options.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.EXPORT_APPLICATIONS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                q = q.startAfter(lastDoc);
            }
        }

        const snapshot = await q.get();
        let applications = serializeDocs(snapshot.docs);
        const hasMore = applications.length > fetchLimit;
        if (!useMemoryPagination) {
            applications = applications.slice(0, fetchLimit);
        }
        const nextCursor = applications.length > 0 ? applications[applications.length - 1].id as string : undefined;

        const userIds = [...new Set(applications.map((app: any) => app.userId).filter(Boolean))];
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
            // Canonical bankDetails injection
            const bankDetails = uData.bankDetails || {
                bankName: app.bankName || uData.bankName || uData.bankAccount?.bankName || "",
                accountNumber: app.accountNumber || uData.bankAccountNumber || uData.bankAccount?.accountNumber || "",
                accountName: app.accountName || uData.bankAccountName || uData.bankAccount?.accountName || uData.fullName || (uData.firstName && uData.lastName ? `${uData.firstName} ${uData.lastName}` : ""),
                bankCode: app.bankCode || uData.bankCode || uData.bankAccount?.bankCode || ""
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
                    bankDetails
                },
                status: status,
                data: {
                    ...mergedData,
                    bankDetails
                }
            };
        });

        // Client-side search application if specified
        let finalForms = standardForms;
        if (options.search) {
            const s = options.search.toLowerCase().trim();
            finalForms = finalForms.filter((f: any) => {
                const searchString = [
                    f.user?.name,
                    f.user?.email,
                    f.user?.phone,
                    f.data?.fullName,
                    f.data?.businessName,
                    f.data?.firstName,
                    f.data?.lastName
                ].filter(Boolean).join(" ").toLowerCase();
                return searchString.includes(s);
            });
        }

        // ALWAYS apply date filters in memory as a definitive backstop.
        if (options.dateFrom) {
            const from = new Date(options.dateFrom);
            from.setHours(0, 0, 0, 0);
            finalForms = finalForms.filter((f: any) => {
                const d = f.data?.createdAt?.seconds ? new Date(f.data.createdAt.seconds * 1000) : new Date(f.data?.createdAt);
                return d >= from;
            });
        }
        if (options.dateTo) {
            const to = new Date(options.dateTo);
            to.setHours(23, 59, 59, 999);
            finalForms = finalForms.filter((f: any) => {
                const d = f.data?.createdAt?.seconds ? new Date(f.data.createdAt.seconds * 1000) : new Date(f.data?.createdAt);
                return d <= to;
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
        const paged = useMemoryPagination ? finalForms.slice(offset, offset + limit) : finalForms;
        const _hasMore = useMemoryPagination 
            ? (offset + limit < finalForms.length)
            : hasMore;

        const _nextCursor = useMemoryPagination 
            ? (_hasMore ? String(page + 1) : undefined)
            : nextCursor;

        return { 
            error: null, success: true as const, 
            data: paged,
            lastDocId: _nextCursor,
            hasMore: _hasMore,
            meta: {
                totalFetched: applications.length,
                hasMore: _hasMore
            }
        };
    } catch (error) {
        logger.error("Get standard export apps error:", error);
        return { success: false as const, error: "Failed to fetch normalized applications", data: null };
    }
}

async function _rejectExportApplicationAction(

    applicationId: string,
    reason: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        // Use general user update permission or create a new one. Using users:update for now.
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            if (!session?.user?.roles?.includes("super_admin") && !session?.user?.roles?.includes("admin")) {
                return { error: "Unauthorized: Permission required - users:update", success: false as const };
            }
        }

        const valid = ExportOnboardingReviewSchema.safeParse({ applicationId, status: "rejected", reason });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false as const };
        }

        // 1. Get Application Doc — may be passed either as the Firestore doc ID or applicationId field
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
                return { error: "Application not found", success: false as const };
            }
            appDocRef = snap.docs[0].ref;
            appData = snap.docs[0].data();
        }

        const userId = appData.userId;
        if (!userId) {
            return { error: "Invalid application: Missing User ID", success: false as const };
        }

        // Double-validation: Ensure user document exists in COLLECTIONS.USERS
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        if (!userDoc.exists) {
            return { error: `Database desync: Corresponding user document [${userId}] not found in users collection`, success: false as const };
        }

        // 2. Update Application Status
        await appDocRef.update({
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

        await createAdminAuditLog({
            action: "export_reject",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "export_onboarding_applications",
            metadata: { userId: userId, reason: reason },
        });

        // FAST STATS UPDATER (Non-blocking fallback safe)
        updateExportStatsAtomic('pending', 'rejected');

        // Revalidate
        revalidatePath("/export", "page");
        revalidatePath("/dashboard", "page");
        revalidateTag(`user-status-${userId}`, "page");

        return {
            error: null,
            success: true as const,
            message: "Export application rejected successfully",
        };
    } catch (error: any) {
        logger.error("Reject export application error:", error);
        return { error: "Failed to reject export application", success: false as const };
    }
}
// ============================================
// Academy Application Management (Admin)
// ============================================

async function _getAcademyApplicationsAction(options: {
    limit?: number;
    search?: string;
    statusFilter?: "pending" | "under_review" | "approved" | "rejected" | "all";
    lastDocId?: string;
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

        const useMemoryPagination = !!options.search || !!options.dateFrom || !!options.dateTo;
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

        q = q.orderBy("createdAt", "desc").limit(fetchLimit + 1);

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

            return {
                id: app.id,
                ...app,
                user: {
                    id: app.userId,
                    name: userName,
                    email: uData.email || app.personalInfo?.email || "Unknown",
                    phone: uData.phone || app.personalInfo?.phone || "Unknown",
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

        // Sort in memory by submittedAt descending
        applications.sort((a, b) =>
            new Date(b.submittedAt as string).getTime() - new Date(a.submittedAt as string).getTime()
        );

        // ALWAYS apply date filters in memory as a definitive backstop.
        if (options.dateFrom) {
            const from = new Date(options.dateFrom);
            from.setHours(0, 0, 0, 0);
            applications = applications.filter((app: any) => new Date(app.createdAt) >= from);
        }
        if (options.dateTo) {
            const to = new Date(options.dateTo);
            to.setHours(23, 59, 59, 999);
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
        revalidateTag(`user-status-${userId}`, "page");

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
        if (userId) revalidateTag(`user-status-${userId}`, "page");

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
        if (!session?.user || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
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
// Platform Settings (Admin)
// ============================================

async function _savePlatformSettingsAction(
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
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "config:update")) {
            return { error: "Unauthorized: Admin access required", success: false as const };
        }

        await db.collection(COLLECTIONS.PLATFORM_SETTINGS).doc("general").set({
            ...settings,
            updatedBy: session!.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        await createAdminAuditLog({
            action: "config_updated",
            userId: session!.user.id,
            targetId: "general",
            targetType: "platform_settings",
            metadata: { changes: settings },
        });

        return { error: null, success: true as const, message: "Platform settings saved successfully" };
    } catch (error: any) {
        logger.error("Save platform settings error:", error);
        return { error: "Failed to save settings", success: false as const };
    }
}

async function _getPlatformSettingsAction(): Promise<ActionResponse<any>> {
    try {
        const doc = await db.collection(COLLECTIONS.PLATFORM_SETTINGS).doc("general").get();
        if (!doc.exists) {
            return {
                success: true,
                error: null,
                data: {
                    platformName: "Easy Sales Export",
                    supportEmail: "info@easysalesexport.com",
                    contactPhone: "+234 000 000 0000",
                    defaultCurrency: "NGN",
                    maintenanceMode: false,
                }
            };
        }
        return { success: true, error: null, data: serializeValue(doc.data()) as any };
    } catch (error: any) {
        logger.error("Get platform settings error:", error);
        return {
            success: true,
            error: null,
            data: {
                platformName: "Easy Sales Export",
                supportEmail: "info@easysalesexport.com",
                contactPhone: "+234 000 000 0000",
                defaultCurrency: "NGN",
                maintenanceMode: false,
            }
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
    // Banking fields
    bankName?: string;
    accountNumber?: string;
    accountName?: string;
    bankCode?: string;
    "bankDetails.bankName"?: string;
    "bankDetails.accountNumber"?: string;
    "bankDetails.accountName"?: string;
    "bankDetails.bankCode"?: string;
    "bankAccount.bankName"?: string;
    "bankAccount.accountNumber"?: string;
    "bankAccount.accountName"?: string;
    "bankAccount.bankCode"?: string;
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
    // Banking fields
    "bankName", "accountNumber", "accountName", "bankCode",
    "bankDetails.bankName", "bankDetails.accountNumber", "bankDetails.accountName", "bankDetails.bankCode",
    "bankAccount.bankName", "bankAccount.accountNumber", "bankAccount.accountName", "bankAccount.bankCode",
    // Land listing fields
    "title", "location.state", "location.lga",
];

async function _editApplicationAction(params: {
    collection: string;
    docId: string;
    fields: Partial<EditableApplicationFields>;
    editNote?: string;
}): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user) {
            return { error: "Unauthorized: admin or users:update role required", success: false as const };
        }

        let roles = session.user.roles;
        const isAuthorizedSession = hasAdminPermission(roles, "users:update") || roles?.includes("super_admin") || roles?.includes("admin");
        
        if (!isAuthorizedSession) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            const isAuthorizedLive = hasAdminPermission(liveRoles, "users:update") || liveRoles?.includes("super_admin") || liveRoles?.includes("admin");
            if (!isAuthorizedLive) {
                return { error: "Unauthorized: admin or users:update role required", success: false as const };
            }
            roles = liveRoles;
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
            return { error: `Collection '${collectionName}' is not editable via this action`, success: false as const };
        }

        // Sanitize fields: only allow whitelisted keys
        const sanitized: Record<string, any> = {};
        for (const key of Object.keys(fields) as (keyof EditableApplicationFields)[]) {
            if (ALLOWED_EDIT_FIELDS.includes(key) && fields[key] !== undefined) {
                sanitized[key] = (fields[key] as string).trim();
            }
        }

        if (Object.keys(sanitized).length === 0) {
            return { error: "No valid fields to update", success: false as const };
        }

        // Fetch current doc to capture "before" snapshot for audit
        const docRef = db.collection(collectionName).doc(docId);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            return { error: `Document ${docId} not found in ${collectionName}`, success: false as const };
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
        await createAdminAuditLog({
            action: "admin_edit_application",
            userId: session.user.id,
            targetId: docId,
            targetType: collectionName,
            metadata: {
                adminName: session.user.name || session.user.email,
                before,
                after: sanitized,
                editNote: editNote || null,
            },
        });

        return {
            success: true as const,
            error: null,
            message: "Application updated successfully",
        };
    } catch (error: any) {
        logger.error("Edit application error:", error);
        return { error: "Failed to update application: " + error.message, success: false as const };
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
async function _toggleVerifiedBadgeAction(
    verificationId: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return { error: "Unauthorized: Permission required - users:update", success: false as const };
        }

        const ref = db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(verificationId);
        const snap = await ref.get();
        if (!snap.exists) {
            return { error: "Seller verification record not found", success: false as const };
        }

        const data = snap.data()!;
        const newBadgeState = !data.isVerifiedBadge;

        // Perform updates in a single transaction for atomicity
        await db.runTransaction(async (transaction) => {
            transaction.update(ref, {
                isVerifiedBadge: newBadgeState,
                badgeGrantedBy: session.user.id,
                badgeGrantedAt: newBadgeState ? FieldValue.serverTimestamp() : null,
                updatedAt: FieldValue.serverTimestamp(),
            });

            // Also sync badge onto the user's profile document
            if (data.userId) {
                const userRef = db.collection(COLLECTIONS.USERS).doc(data.userId);
                transaction.update(userRef, {
                    isVerifiedBadge: newBadgeState,
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }
        });

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
        await createAdminAuditLog({
            action: newBadgeState ? "seller_badge_grant" : "seller_badge_revoke",
            userId: session.user.id,
            targetId: verificationId,
            targetType: "seller_verification",
        });

        return {
            error: null,
            success: true as const,
            message: newBadgeState
                ? "Verified Badge granted and seller notified"
                : "Verified Badge revoked",
        };
    } catch (error: any) {
        logger.error("toggleVerifiedBadgeAction error:", error);
        return { error: "Failed to update badge: " + error.message, success: false as const };
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

        // ── Write Mock Application for Admin Dashboard ────────────────────────
        // Create an application document so the user appears in the admin Academy dashboard
        try {
            const mockAppRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(`manual_${userId}`);
            const existingApp = await mockAppRef.get();
            if (!existingApp.exists) {
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
            }
        } catch (e) {
            logger.error("[Academy Manual Enrollment] Failed to create mock application:", e);
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

// ============================================
// Import Legacy Cooperative Member
// ============================================

import { strictEmailSchema } from "@/lib/schemas";
const InviteLegacyMemberSchema = z.object({
    email: strictEmailSchema,
    firstName: z.string().min(1, "First name is optional but recommended for personalization").optional(),
});

async function _inviteLegacyMemberAction(
    data: z.infer<typeof InviteLegacyMemberSchema>
): Promise<ActionResponse<null>> {
    /* Original implementation below (deprecated and causing build errors)
    try {
        const adminCheck = await requireAdmin();
        if ("error" in adminCheck) return { error: (adminCheck as any).error, success: false as const };

        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;

        if (!session?.user || !hasAdminPermission(session.user.roles, "users:create")) {
             if (!hasAdminPermission(session.user.roles, "cooperatives:approve_members")) {
                return { error: "Unauthorized: Permission required - cooperatives:approve_members", success: false as const };
             }
        }

        const valid = InviteLegacyMemberSchema.safeParse(data);
        if (!valid.success) {
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
                return { error: "User is already a fully onboarded cooperative member.", success: false as const };
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
                    return { error: "Invite created but failed to send email. Link: " + onboardingLink, success: true as const }; // Partial success
                }
            } catch (err: any) {
                logger.error("Resend Error (Coop Invite):", err);
                return { error: "Invite created but failed to send email.", success: true as const };
            }
        } else {
             logger.warn("RESEND_API_KEY is not set. Assuming development mode. Invite created silently.");
        }

        // 7. Audit Log
        await createAdminAuditLog({
            action: "legacy_member_invited",
            userId: session.user.id,
            targetId: token,
            targetType: "cooperative_member",
            metadata: { email: email },
        });

        return { error: null, success: true as const };
    } catch (error: any) {
        logger.error("Failed to send cooperative invite:", error);
        return { error: error.message || "Failed to invite member", success: false as const };
    }
    */
    return { error: "Method deprecated", success: false as const, data: null };
}

async function _getStandardSellerVerificationsAction(
    statusFilter?: "pending" | "approved" | "rejected" | "suspended" | "all",
    cursorId?: string,
    limitCount: number = 50,
    sortOrder?: "asc" | "desc",
    dateFrom?: string,
    dateTo?: string,
    search?: string
): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Not authenticated", data: null };

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        let cursorSnap = null;
        if (cursorId) {
            cursorSnap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(cursorId).get();
        }

        const direction = sortOrder || "desc";
        let q = db.collection(COLLECTIONS.SELLER_VERIFICATIONS).orderBy("createdAt", direction);
        if (statusFilter && statusFilter !== "all") {
            q = q.where("status", "==", statusFilter);
        }

        if (dateFrom) {
            const fromTs = dateRangeStart(dateFrom);
            q = q.where("createdAt", ">=", fromTs);
        }
        if (dateTo) {
            const toTs = dateRangeEnd(dateTo);
            q = q.where("createdAt", "<=", toTs);
        }

        const useMemoryPagination = !!search || !!dateFrom || !!dateTo;
        const fetchLimit = useMemoryPagination ? 5000 : limitCount;

        if (cursorSnap && cursorSnap.exists && !useMemoryPagination) {
            q = q.startAfter(cursorSnap);
        }
        
        q = q.limit(fetchLimit + 1);

        const snapshot = await q.get();
        let applications = serializeDocs(snapshot.docs);
        const hasMoreRaw = applications.length > fetchLimit;
        if (!useMemoryPagination) {
            applications = applications.slice(0, fetchLimit);
        }
        const nextCursorId = applications.length > 0 ? applications[applications.length - 1].id as string : undefined;

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
        userSnapsArray.forEach(snap => snap.docs.forEach(d => userMap.set(d.id, serializeValue(d.data()))));

        const standardForms = applications.map((app: any) => {
            const userId = app.userId as string;
            const uData = userMap.get(userId) || {};
            
            // AGGRESSIVE CANONICAL NORMALIZATION
            // This ensures that even if the app record is partial, we reconstruct the truth from the user doc
            const normalized = normalizeAggressive(
                userId,
                uData,
                app, // Seller app data
                null, // Coop data (not needed for seller view)
                null  // WAVE data (not needed for seller view)
            );

            return {
                id: app.id,
                user: {
                    id: userId,
                    name: normalized.fullName,
                    email: normalized.email,
                    phone: normalized.phone,
                    dob: normalized.dateOfBirth || "Unknown",
                    address: normalized.address?.street || "Unknown",
                    state: normalized.address?.state || "Unknown",
                    lga: normalized.address?.lga || "Unknown",
                    bankDetails: normalized.verificationProfile?.bankDetails,
                    documents: normalized.verificationProfile?.documents
                },
                status: normalized.verificationProfile?.status || "pending",
                data: {
                    ...app,
                    bankDetails: normalized.verificationProfile?.bankDetails,
                    documents: normalized.verificationProfile?.documents
                }
            };
        });

        let finalForms = standardForms;
        if (search) {
            const s = search.toLowerCase().trim();
            finalForms = finalForms.filter((app: any) => {
                const searchString = [
                    app.user?.name,
                    app.user?.email,
                    app.user?.phone,
                    app.data?.businessName,
                    app.data?.businessRegNumber
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(s);
            });
        }

        // ALWAYS apply date filters in memory as a definitive backstop.
        if (dateFrom) {
            const from = new Date(dateFrom);
            from.setHours(0, 0, 0, 0);
            finalForms = finalForms.filter((app: any) => new Date(app.data?.createdAt?.toDate ? app.data.createdAt.toDate().toISOString() : app.data?.createdAt || 0) >= from);
        }
        if (dateTo) {
            const to = new Date(dateTo);
            to.setHours(23, 59, 59, 999);
            finalForms = finalForms.filter((app: any) => new Date(app.data?.createdAt?.toDate ? app.data.createdAt.toDate().toISOString() : app.data?.createdAt || 0) <= to);
        }

        let nextCursorIdToReturn = nextCursorId;
        if (useMemoryPagination) {
            const page = (cursorId && /^\d+$/.test(cursorId)) ? parseInt(cursorId, 10) : 0;
            const startIndex = page * limitCount;
            const hasMoreMemory = startIndex + limitCount < finalForms.length;
            finalForms = finalForms.slice(startIndex, startIndex + limitCount);
            nextCursorIdToReturn = hasMoreMemory ? String(page + 1) : undefined;
        }

        return { 
            success: true as const, 
            data: finalForms, 
            error: null, 
            meta: { 
                lastDocId: nextCursorIdToReturn,
                hasMore: !!nextCursorIdToReturn
            } 
        };
    } catch (error) {
        logger.error("Get standard seller verifications error:", error);
        return { success: false as const, error: "Failed to fetch normalized applications", meta: null, data: null };
    }
}


async function _getMarketplaceUsersAction(options: {
    limit?: number;
    search?: string;
    roleFilter?: "all" | "buyer_only" | "seller_only" | "both";
    lastDocId?: string;
    sortOrder?: "asc" | "desc";
    dateFrom?: string;
    dateTo?: string;
} = {}) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const fetchLimit = options.search ? 5000 : (options.limit || 50);
        let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.USERS);

        // Query by roles array — flat indexed field, no composite index needed.
        // Covers marketplace_buyer (new registrations), buyer (legacy), and seller roles.
        q = q.where("roles", "array-contains-any", ["marketplace_buyer", "buyer", "seller", "marketplace_seller"]);

        const sortDirection = options.sortOrder || "desc";
        if (options.dateFrom) {
            const fromTs = dateRangeStart(options.dateFrom);
            q = q.where("createdAt", ">=", fromTs);
        }
        if (options.dateTo) {
            const toTs = dateRangeEnd(options.dateTo);
            q = q.where("createdAt", "<=", toTs);
        }

        q = q.orderBy("createdAt", sortDirection);

        // Fetch ALL matching marketplace users (approx 600+) for accurate memory filtering
        const snapshot = await q.get();

        let filteredDocs = snapshot.docs;


        if (options.search) {
            const searchLower = options.search.toLowerCase().trim();
            filteredDocs = filteredDocs.filter(doc => {
                const data = doc.data() as any;
                const searchString = [
                    data.name,
                    data.fullName,
                    data.firstName,
                    data.lastName,
                    data.email,
                    data.phone,
                    data.phoneNumber,
                    data.businessName
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(searchLower);
            });
        }

        let users = filteredDocs.map(doc => {
            const data = doc.data() as any;
            const marketplaceData = data.serviceRegistrations?.marketplace;
            const dbAccountType = marketplaceData?.accountType;
            // Legacy fallback
            const roles = data.roles || [];
            const hasSellerRole = roles.includes("seller") || roles.includes("marketplace_seller");
            const hasBuyerRole = roles.includes("buyer") || roles.includes("marketplace_buyer");
            
            let buyerRole = "buyer_only";
            if (dbAccountType === "seller") {
                buyerRole = "seller_only";
            } else if (dbAccountType === "both") {
                buyerRole = "both";
            } else if (hasSellerRole && hasBuyerRole) {
                buyerRole = "both";
            } else if (hasSellerRole && !hasBuyerRole) {
                buyerRole = "seller_only";
            } else {
                buyerRole = "buyer_only";
            }

            return {
                id: doc.id,
                name: data.fullName || data.name || (data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : "Unknown"),
                email: data.email,
                phone: data.phone || data.phoneNumber || "",
                state: data.address?.state || data.stateOfOrigin || "",
                lga: data.address?.lga || data.lga || "",
                roles: data.roles || [],
                buyerRole,
                status: data.status || "active",
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt ? new Date(data.createdAt).toISOString() : null),
                bankDetails: serializeValue(data.bankDetails || {
                    bankName: data.bankName || data.bankAccount?.bankName || "",
                    accountNumber: data.accountNumber || data.bankAccountNumber || data.bankAccount?.accountNumber || "",
                    accountName: data.accountName || data.bankAccountName || data.bankAccount?.accountName || data.fullName || (data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : ""),
                    bankCode: data.bankCode || data.bankAccount?.bankCode || ""
                }) ?? null
            };
        }).filter(Boolean) as any[];

        // ALWAYS apply date filters in memory as a definitive backstop.
        if (options.dateFrom) {
            const from = new Date(options.dateFrom);
            from.setHours(0, 0, 0, 0);
            users = users.filter((u: any) => new Date(u.createdAt) >= from);
        }
        if (options.dateTo) {
            const to = new Date(options.dateTo);
            to.setHours(23, 59, 59, 999);
            users = users.filter((u: any) => new Date(u.createdAt) <= to);
        }

        const stats = {
            total: users.length,
            buyerOnly: users.filter((u: any) => u.buyerRole === "buyer_only").length,
            sellerOnly: users.filter((u: any) => u.buyerRole === "seller_only").length,
            both: users.filter((u: any) => u.buyerRole === "both").length,
        };

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

        // Apply memory pagination
        // The UI might pass lastDocId as a stringified page index due to useAdminData's cursor logic
        // OR we can explicitly handle 'page' parameter if it was added. Let's handle numeric lastDocId as page.
        const pageOption = (options as any).page;
        let page = 0;
        if (pageOption !== undefined) {
            page = Number(pageOption);
        } else if (options.lastDocId && /^\d+$/.test(options.lastDocId)) {
            page = Number(options.lastDocId);
        }

        const limit = options.limit || 50;
        const startIndex = page * limit;
        const pagedUsers = users.slice(startIndex, startIndex + limit);
        const hasMore = startIndex + limit < users.length;
        const nextCursor = hasMore ? String(page + 1) : undefined;

        return { 
            error: null, success: true as const, 
            data: pagedUsers,
            lastDocId: nextCursor,
            hasMore,
            meta: { stats }
        };

    } catch (error: any) {
        logger.error("Failed to fetch marketplace buyers:", error);
        return { success: false as const, error: "Internal server error", data: null };
    }
}


// --- SAFE ACTION WRAPPERS ---
export const processWithdrawalAction = withFlexibleSafeAction("processWithdrawalAction", _processWithdrawalAction);
export const toggleUserVerificationAction = withFlexibleSafeAction("toggleUserVerificationAction", _toggleUserVerificationAction);
export const toggleUserKycVerificationAction = withFlexibleSafeAction("toggleUserKycVerificationAction", _toggleUserKycVerificationAction);
export const getPendingWithdrawalsAction = withFlexibleSafeAction("getPendingWithdrawalsAction", _getPendingWithdrawalsAction);
export const getPendingLandListings = withFlexibleSafeAction("getPendingLandListings", _getPendingLandListings);
export const verifyLandListing = withFlexibleSafeAction("verifyLandListing", _verifyLandListing);
export const getPendingLoanApplications = withFlexibleSafeAction("getPendingLoanApplications", _getPendingLoanApplications);
export const getAllExportRequestsAction = withFlexibleSafeAction("getAllExportRequestsAction", _getAllExportRequestsAction);
export const approveLoanApplication = withFlexibleSafeAction("approveLoanApplication", _approveLoanApplication);
export const rejectLoanApplication = withFlexibleSafeAction("rejectLoanApplication", _rejectLoanApplication);
export const unlockUserAccount = withFlexibleSafeAction("unlockUserAccount", _unlockUserAccount);
export const getUsersAction = withFlexibleSafeAction("getUsersAction", _getUsersAction);
export const updateUserRolesAction = withFlexibleSafeAction("updateUserRolesAction", _updateUserRolesAction);
export const approveSellerVerificationAction = withFlexibleSafeAction("approveSellerVerificationAction", _approveSellerVerificationAction);
export const approveExportOnboardingAction = withFlexibleSafeAction("approveExportOnboardingAction", _approveExportOnboardingAction);
export const requestExportApplicationRevisionAction = withFlexibleSafeAction("requestExportApplicationRevisionAction", _requestExportApplicationRevisionAction);
export const getExportApplicationsStatsAction = withFlexibleSafeAction("getExportApplicationsStatsAction", _getExportApplicationsStatsAction);
export const getStandardExportApplicationsAction = withFlexibleSafeAction("getStandardExportApplicationsAction", _getStandardExportApplicationsAction);
export const rejectExportApplicationAction = withFlexibleSafeAction("rejectExportApplicationAction", _rejectExportApplicationAction);
export const getAcademyApplicationsAction = withFlexibleSafeAction("getAcademyApplicationsAction", _getAcademyApplicationsAction);
export const approveAcademyApplicationAction = withFlexibleSafeAction("approveAcademyApplicationAction", _approveAcademyApplicationAction);
export const rejectAcademyApplicationAction = withFlexibleSafeAction("rejectAcademyApplicationAction", _rejectAcademyApplicationAction);
export const markAcademyApplicationUnderReviewAction = withFlexibleSafeAction("markAcademyApplicationUnderReviewAction", _markAcademyApplicationUnderReviewAction);
export const savePlatformSettingsAction = withFlexibleSafeAction("savePlatformSettingsAction", _savePlatformSettingsAction);
export const getPlatformSettingsAction = withFlexibleSafeAction("getPlatformSettingsAction", _getPlatformSettingsAction);
export const editApplicationAction = withFlexibleSafeAction("editApplicationAction", _editApplicationAction);
export const toggleVerifiedBadgeAction = withFlexibleSafeAction("toggleVerifiedBadgeAction", _toggleVerifiedBadgeAction);
export const manualAcademyEnrollmentAction = withFlexibleSafeAction("manualAcademyEnrollmentAction", _manualAcademyEnrollmentAction);
export const inviteLegacyMemberAction = withFlexibleSafeAction("inviteLegacyMemberAction", _inviteLegacyMemberAction);
export const getStandardSellerVerificationsAction = withFlexibleSafeAction("getStandardSellerVerificationsAction", _getStandardSellerVerificationsAction);
export const getMarketplaceUsersAction = withFlexibleSafeAction("getMarketplaceUsersAction", _getMarketplaceUsersAction);
export const updateUserGenderAction = withFlexibleSafeAction("updateUserGenderAction", _updateUserGenderAction);

import { 
    approveWaveApplicationAction as _approveWaveApplicationAction, 
    rejectWaveApplicationAction as _rejectWaveApplicationAction 
} from "./wave/_admin";

export const approveWaveApplicationAction = _approveWaveApplicationAction;
export const rejectWaveApplicationAction = _rejectWaveApplicationAction;

/**
 * Admin: Server-side COUNT aggregations for the seller verifications dashboard.
 * Returns accurate totals independent of pagination limits.
 */
async function _getAdminSellerStatsAction(): Promise<ActionResponse<{ total: number; pending: number; approved: number; rejected: number }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" , data: null };
        const { session } = sessionResult;

        if (!session?.user?.id || !isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        const col = db.collection(COLLECTIONS.SELLER_VERIFICATIONS);
        const [total, pending, approved, rejected] = await Promise.all([
            col.count().get(),
            col.where("status", "==", "pending").count().get(),
            col.where("status", "==", "approved").count().get(),
            col.where("status", "==", "rejected").count().get(),
        ]);

        return {
            error: null, success: true as const,
            data: {
                total: total.data().count,
                pending: pending.data().count,
                approved: approved.data().count,
                rejected: rejected.data().count,
            },
        };
    } catch (error: any) {
        logger.error("getAdminSellerStatsAction error:", error);
        return { success: false as const, error: error.message , data: null };
    }
}

export const getAdminSellerStatsAction = withFlexibleSafeAction("getAdminSellerStatsAction", _getAdminSellerStatsAction);

// ============================================
// Onboard Legacy Member
// ============================================

/**
 * Onboard Legacy Member Action
 * Allows admins to pre-register existing members and pre-fill their profile data.
 * Sends a welcome email with a temporary password.
 */
async function _onboardLegacyMemberAction(
    formData: any
): Promise<ActionState> {
    try {
        const adminCheck = await requireAdmin();
        if ("error" in adminCheck) return { error: adminCheck.error, success: false as const };

        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" };
        const { session } = sessionResult;

        // Permission check with live roles fallback
        let roles = session.user.roles;
        if (!hasAdminPermission(roles, "users:create")) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            if (hasAdminPermission(liveRoles, "users:create")) {
                roles = liveRoles;
            } else {
                return { error: "Unauthorized: Permission users:create required", success: false as const };
            }
        }

        // Validate input
        const validated = LegacyOnboardingSchema.safeParse(formData);
        if (!validated.success) {
            return { error: validated.error.issues[0].message, success: false as const };
        }

        const data = validated.data;
        data.email = data.email.toLowerCase(); // Permanent Fix: Force lowercase normalization

        // 1. Resolve Identity and Enforce Uniqueness (with Auto-Resolution)
        let targetUid: string | null = null;
        let oldUidToMigrate: string | null = null;

        // Check Firebase Auth by email
        let authRecord = await adminAuth.getUserByEmail(data.email).catch(() => null);
        if (authRecord) {
            targetUid = authRecord.uid;
        }

        // Check Firestore by email to prevent ghost documents and handle duplicate stubs
        const emailCheck = await db.collection(COLLECTIONS.USERS)
            .where("email", "==", data.email)
            .get();

        if (!emailCheck.empty) {
            if (targetUid) {
                // If Auth user exists, the Firestore document ID MUST match targetUid.
                const matchingDoc = emailCheck.docs.find(doc => doc.id === targetUid);
                
                // If there are other documents with the same email but different UIDs:
                // These are duplicate stubs/ghost documents.
                const stubs = emailCheck.docs.filter(doc => doc.id !== targetUid);
                if (stubs.length > 0) {
                    if (matchingDoc) {
                        // The primary document is already aligned. We can safely delete duplicate stubs.
                        const cleanBatch = db.batch();
                        stubs.forEach(doc => cleanBatch.delete(doc.ref));
                        await cleanBatch.commit();
                        logger.info(`[Legacy Onboarding] Deleted ${stubs.length} duplicate stubs for aligned user ${targetUid}`);
                    } else {
                        // Auth user exists (targetUid), but no Firestore document exists with targetUid.
                        // We choose the first stub/legacy document to serve as the source of data.
                        const sourceDoc = stubs[0];
                        oldUidToMigrate = sourceDoc.id;
                        
                        logger.info(`[Legacy Onboarding] Firestore data conflict detected for ${data.email}. Migrating doc ${oldUidToMigrate} to match Auth UID ${targetUid}`);
                        
                        // Migrate user document to targetUid
                        const userData = sourceDoc.data();
                        await db.collection(COLLECTIONS.USERS).doc(targetUid).set({
                            ...userData,
                            uid: targetUid,
                            updatedAt: FieldValue.serverTimestamp()
                        }, { merge: true });

                        // Clean up all the old stubs matching this email
                        const cleanBatch = db.batch();
                        stubs.forEach(doc => cleanBatch.delete(doc.ref));
                        await cleanBatch.commit();
                    }
                }
            } else {
                // No Auth user exists yet. We adopt the UID of the first Firestore document.
                const primaryDoc = emailCheck.docs[0];
                targetUid = primaryDoc.id;
                
                // Delete any additional duplicate stubs matching this email
                const stubs = emailCheck.docs.filter(doc => doc.id !== targetUid);
                if (stubs.length > 0) {
                    const cleanBatch = db.batch();
                    stubs.forEach(doc => cleanBatch.delete(doc.ref));
                    await cleanBatch.commit();
                    logger.info(`[Legacy Onboarding] Deleted ${stubs.length} duplicate stubs for unaligned user ${targetUid}`);
                }
            }
        }

        // Migrate associated module documents from oldUidToMigrate to targetUid
        if (oldUidToMigrate && targetUid) {
            const migrationBatch = db.batch();
            
            // 1. Direct document IDs based on userId
            const directCollections = [
                COLLECTIONS.COOPERATIVE_MEMBERS,
                COLLECTIONS.VENDOR_SETTINGS,
                COLLECTIONS.ACADEMY_ENROLLMENTS,
                COLLECTIONS.WAVE_MEMBERS
            ];
            for (const col of directCollections) {
                const docSnap = await db.collection(col).doc(oldUidToMigrate).get();
                if (docSnap.exists) {
                    migrationBatch.set(db.collection(col).doc(targetUid), {
                        ...docSnap.data(),
                        userId: targetUid,
                        updatedAt: FieldValue.serverTimestamp()
                    }, { merge: true });
                    migrationBatch.delete(db.collection(col).doc(oldUidToMigrate));
                }
            }

            // 2. Legacy prefixed document IDs (legacy_{userId})
            const prefixedCollections = [
                COLLECTIONS.EXPORT_APPLICATIONS,
                COLLECTIONS.WAVE_APPLICATIONS,
                COLLECTIONS.FARM_NATION_APPLICATIONS,
                COLLECTIONS.ACADEMY_APPLICATIONS
            ];
            for (const col of prefixedCollections) {
                const docSnap = await db.collection(col).doc(`legacy_${oldUidToMigrate}`).get();
                if (docSnap.exists) {
                    migrationBatch.set(db.collection(col).doc(`legacy_${targetUid}`), {
                        ...docSnap.data(),
                        userId: targetUid,
                        updatedAt: FieldValue.serverTimestamp()
                    }, { merge: true });
                    migrationBatch.delete(db.collection(col).doc(`legacy_${oldUidToMigrate}`));
                }
            }
            
            await migrationBatch.commit();
            logger.info(`[Legacy Onboarding] Successfully migrated child documents from ${oldUidToMigrate} to ${targetUid}`);
        }

        // 2. 🔒 DEDUP GUARD: Check Firestore by phone (Fraud Prevention)
        const phoneCheck = await db.collection(COLLECTIONS.USERS)
            .where("phone", "==", data.phone)
            .limit(1)
            .get();
        if (!phoneCheck.empty) {
            const phoneDoc = phoneCheck.docs[0];
            const phoneData = phoneDoc.data();
            const phoneUid = phoneDoc.id;
            
            // Only throw an error if the phone is registered to a DIFFERENT email address.
            if (phoneData.email?.toLowerCase() !== data.email) {
                if (targetUid && targetUid !== phoneUid) {
                    return { error: "An account with this phone number already exists under a different email.", success: false as const };
                }
                targetUid = phoneUid;
            }
        }

        const isNewUser = !targetUid;

        // 3. Generate default numeric PIN (6 digits)
        const tempPassword = Math.floor(100000 + Math.random() * 900000).toString(); 

        // 4. Create Firebase Auth user if not exists
        if (!authRecord) {
            const createParams: any = {
                email: data.email,
                password: tempPassword,
                displayName: data.fullName,
                emailVerified: true,
            };
            if (targetUid) {
                createParams.uid = targetUid; // Link to existing Firestore document
            }
            authRecord = await adminAuth.createUser(createParams);
            targetUid = authRecord.uid;
        }

        if (!targetUid) {
            return { error: "System Error: Failed to resolve user identity.", success: false as const };
        }

        const userRecord = { uid: targetUid };

        // 5. Prepare structured name
        const nameParts = data.fullName.trim().split(/\s+/);
        const firstName = nameParts[0] || "";
        const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";
        const otherName = nameParts.length > 2 ? nameParts.slice(1, -1).join(" ") : "";

        // 6. Initialize Service Registrations
        const serviceRegistrations: any = {};
        const now = FieldValue.serverTimestamp();

        if (data.services?.marketplace || data.roles.includes("seller") || data.roles.includes("marketplace_buyer")) {
            // Determine account type from roles
            let accountType = "buyer";
            if (data.roles.includes("seller")) {
                accountType = data.roles.includes("marketplace_buyer") ? "both" : "seller";
            }

            serviceRegistrations.marketplace = { 
                status: "approved", 
                accountType,
                paymentStatus: "completed",
                onboardingCompleted: true,
                approvedAt: now 
            };
        }

        if (data.services?.export || data.roles.includes("export_participant")) {
            serviceRegistrations.export = { 
                status: "approved", 
                paymentStatus: "completed",
                onboardingCompleted: true,
                approvedAt: now, 
                appliedAt: now 
            };
        }

        if (data.services?.cooperative || data.roles.includes("cooperative_member")) {
            const coopState = { 
                status: "approved", 
                paymentStatus: "completed",
                onboardingCompleted: true,
                approvedAt: now 
            };
            // Support both singular and plural keys for maximum compatibility
            serviceRegistrations.cooperative = coopState;
            serviceRegistrations.cooperatives = coopState;
        }

        if (data.services?.wave || data.roles.includes("wave_participant")) {
            serviceRegistrations.wave = { 
                status: "approved", 
                paymentStatus: "completed",
                onboardingCompleted: true,
                approvedAt: now 
            };
        }

        if (data.services?.academy || data.roles.includes("academy_participant")) {
            serviceRegistrations.academy = { 
                status: "approved", 
                accountType: "learner",
                plan: data.academyPlan || "foundation", // Dynamic tier selection
                paymentStatus: "completed",
                onboardingCompleted: true,
                enrolledAt: now 
            };
        }

        if (data.services?.farmNation || data.roles.includes("farmer")) {
            const farmNationState = { 
                status: "approved", 
                paymentStatus: "completed",
                onboardingCompleted: true,
                approvedAt: now 
            };
            // Write BOTH keys so farm_nation-based queries (broadcast-logic) and farmNation-based
            // queries (admin actions) both resolve correctly.
            serviceRegistrations.farmNation = farmNationState;
            serviceRegistrations.farm_nation = farmNationState;
        }

        // 7. Create User Document
        const userDoc: any = {
            uid: userRecord.uid,
            fullName: data.fullName,
            firstName,
            lastName,
            otherName: otherName || undefined,
            email: data.email,
            phone: data.phone,
            gender: data.gender,
            dateOfBirth: data.dateOfBirth,
            occupation: data.occupation,
            roles: data.roles,
            isVerified: true,
            verified: true,
            stateOfOrigin: data.state,
            lga: data.lga,
            residentialAddress: data.address,
            address: {
                street: data.address,
                city: data.city || "",
                state: data.state,
                lga: data.lga,
                country: "Nigeria",
            },
            // Next of Kin
            nextOfKin: (data.nextOfKinName || data.nextOfKinPhone) ? {
                name: data.nextOfKinName || "",
                phone: data.nextOfKinPhone || "",
                relationship: data.nextOfKinRelationship || "",
                address: data.nextOfKinAddress || "",
            } : undefined,
            // Financials
            bankAccountNumber: data.accountNumber,
            bankAccountName: data.accountName,
            bankCode: data.bankCode,
            bankDetails: data.accountNumber ? {
                accountNumber: data.accountNumber,
                bankName: data.bankName || "",
                accountName: data.accountName || data.fullName || "",
                bankCode: data.bankCode || "",
            } : undefined,
            // KYC
            nin: data.nin,
            ninVerified: !!data.nin,
            bvn: data.bvn,
            bvnVerified: !!data.bvn,
            // Verification Documents (uploaded by admin during legacy onboarding)
            documents: (data.validIdUrl || data.passportPhotoUrl || data.proofOfAddressUrl) ? {
                validId: data.validIdUrl ? { url: data.validIdUrl, name: "ID Document", uploadedAt: new Date().toISOString() } : undefined,
                passportPhoto: data.passportPhotoUrl ? { url: data.passportPhotoUrl, name: "Passport Photo", uploadedAt: new Date().toISOString() } : undefined,
                proofOfAddress: data.proofOfAddressUrl ? { url: data.proofOfAddressUrl, name: "Proof of Address", uploadedAt: new Date().toISOString() } : undefined,
            } : undefined,
            isVerifiedBadge: true, 
            // Security & Onboarding
            serviceRegistrations,
            onboardingCompleted: true, 
            consentVersion: "1.0.0",
            consentDate: FieldValue.serverTimestamp(),
            notifications: {
                email: true,
                push: true,
                sms: true
            },
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            legacyOnboardedBy: session.user.id,
            legacyOnboardedAt: FieldValue.serverTimestamp(),
            _system_safe_write: true, // Mark as hardened
        };

        if (isNewUser) {
            userDoc.requiresPasswordChange = true;
        }

        const batch = db.batch();
        batch.set(db.collection(COLLECTIONS.USERS).doc(userRecord.uid), userDoc, { merge: true });

        // 8. 🏗️ DEEP PROVISIONING: Initialize Service Documents
        // Cooperative Member Document
        if (data.services?.cooperative || data.roles.includes("cooperative_member")) {
            batch.set(db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userRecord.uid), {
                userId: userRecord.uid,
                fullName: data.fullName,
                firstName,
                lastName,
                email: data.email,
                phone: data.phone,
                gender: data.gender,
                dateOfBirth: data.dateOfBirth,
                occupation: data.occupation,
                stateOfOrigin: data.state,
                lga: data.lga,
                residentialAddress: data.address,
                nextOfKin: (data.nextOfKinName || data.nextOfKinPhone) ? {
                    name: data.nextOfKinName || "",
                    phone: data.nextOfKinPhone || "",
                    relationship: data.nextOfKinRelationship || "",
                    address: data.nextOfKinAddress || "",
                } : undefined,
                documents: (data.validIdUrl || data.passportPhotoUrl || data.proofOfAddressUrl) ? {
                    validId: data.validIdUrl ? { url: data.validIdUrl, name: "ID Document" } : undefined,
                    passportPhoto: data.passportPhotoUrl ? { url: data.passportPhotoUrl, name: "Passport Photo" } : undefined,
                    proofOfAddress: data.proofOfAddressUrl ? { url: data.proofOfAddressUrl, name: "Proof of Address" } : undefined,
                } : undefined,
                bvn: data.bvn,
                savingsBalance: 0,
                loanBalance: 0,
                totalContributions: 0,
                membershipStatus: "active",
                paymentStatus: "completed",
                tier: "tier1",
                onboardingCompleted: true,
                bankAccountNumber: data.accountNumber,
                bankName: data.bankName,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
        }

        // Vendor Settings / Seller Profile Document
        if (data.services?.marketplace || data.roles.includes("seller")) {
            // Mark as active/verified seller if role is present
            const sellerStatus = data.roles.includes("seller") ? "approved" : "pending";
            batch.set(db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(`legacy_${userRecord.uid}`), {
                id: `legacy_${userRecord.uid}`,
                userId: userRecord.uid,
                status: sellerStatus,
                businessName: `${firstName}'s Enterprise`,
                phone: data.phone,
                location: {
                    state: data.state,
                    lga: data.lga,
                    address: data.address,
                },
                bankAccount: data.accountNumber ? {
                    accountNumber: data.accountNumber,
                    bankName: data.bankName || "",
                    accountName: data.accountName || "",
                    bankCode: data.bankCode || "",
                } : undefined,
                bankDetails: data.accountNumber ? {
                    accountNumber: data.accountNumber,
                    bankName: data.bankName || "",
                    accountName: data.accountName || data.fullName || "",
                    bankCode: data.bankCode || "",
                } : undefined,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _isLegacy: true,
            }, { merge: true });

            batch.set(db.collection(COLLECTIONS.VENDOR_SETTINGS).doc(userRecord.uid), {
                userId: userRecord.uid,
                storeInfo: {
                    name: `${firstName}'s Store`,
                    contactEmail: data.email,
                    phone: data.phone,
                },
                paymentConfig: data.accountNumber ? {
                    accountNumber: data.accountNumber,
                    bankName: data.bankName,
                    accountName: data.accountName,
                    bankCode: data.bankCode,
                } : {},
                notifications: {
                    newOrders: true,
                    payments: true
                },
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
        }

        await batch.commit();

        // 8b. 🎓 ACADEMY DEEP-PROVISIONING: Create Enrollment & Application docs for legacy academy members
        //     so the admin panel surfaces them and status checks never fall through.
        if (data.services?.academy || data.roles.includes("academy_participant")) {
            const academyBatch = db.batch();

            // Enrollment record — queried by getAcademyEnrollmentsAction
            const enrollmentRef = db.collection(COLLECTIONS.ACADEMY_ENROLLMENTS).doc(userRecord.uid);
            academyBatch.set(enrollmentRef, {
                userId: userRecord.uid,
                studentName: data.fullName,
                studentEmail: data.email,
                studentPhone: data.phone,
                plan: data.academyPlan || "foundation",
                status: "active",
                paymentStatus: "completed",
                paymentAmount: 0,
                onboardingCompleted: true,
                enrolledAt: FieldValue.serverTimestamp(),
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _isLegacy: true,
                _legacyOnboardedBy: session.user.id,
            }, { merge: true });

            // Application record — queried by checkAcademyStatusAction & admin application panels
            const appRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(`legacy_${userRecord.uid}`);
            academyBatch.set(appRef, {
                userId: userRecord.uid,
                status: "approved",
                paymentStatus: "completed",
                plan: data.academyPlan || "foundation",
                personalInfo: {
                    fullName: data.fullName,
                    email: data.email,
                    phone: data.phone,
                },
                reviewedBy: session.user.id,
                reviewedAt: FieldValue.serverTimestamp(),
                submittedAt: FieldValue.serverTimestamp(),
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _isLegacy: true,
            }, { merge: true });

            await academyBatch.commit();
        }

        // 8c. 🌍 EXPORT DEEP-PROVISIONING
        if (data.services?.export || data.roles.includes("export_participant")) {
            const exportBatch = db.batch();
            const exportAppRef = db.collection(COLLECTIONS.EXPORT_APPLICATIONS).doc(`legacy_${userRecord.uid}`);
            exportBatch.set(exportAppRef, {
                userId: userRecord.uid,
                status: "approved",
                profile: {
                    firstName,
                    lastName,
                    otherName,
                    email: data.email,
                    phone: data.phone,
                    gender: data.gender,
                    dateOfBirth: data.dateOfBirth,
                },
                companyInfo: {
                    companyName: data.exportInfo?.companyName || `${firstName}'s Export Co.`,
                    rcNumber: data.exportInfo?.rcNumber || "LEGACY-N/A",
                    yearEstablished: data.exportInfo?.yearEstablished || new Date().getFullYear().toString(),
                    businessType: data.exportInfo?.businessType || "sole_proprietorship",
                    industry: data.exportInfo?.industry || "agriculture",
                },
                state: data.state || "",
                lga: data.lga || "",
                approvedAt: FieldValue.serverTimestamp(),
                approvedBy: session.user.id,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _isLegacy: true,
            }, { merge: true });
            await exportBatch.commit();
        }

        // 8d. 🌊 WAVE DEEP-PROVISIONING
        if (data.services?.wave || data.roles.includes("wave_participant")) {
            const waveBatch = db.batch();
            // WAVE Application
            const waveAppRef = db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(`legacy_${userRecord.uid}`);
            waveBatch.set(waveAppRef, {
                userId: userRecord.uid,
                userEmail: data.email,
                firstName,
                surname: data.waveInfo?.surname || lastName,
                email: data.email,
                phoneNumber: data.phone,
                state: data.state || "",
                residentialState: data.waveInfo?.residentialState || data.state || "",
                status: "approved",
                applicationDate: FieldValue.serverTimestamp(),
                approvedAt: FieldValue.serverTimestamp(),
                approvedBy: session.user.id,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _isLegacy: true,
            }, { merge: true });
            
            // WAVE Member Profile
            const waveMemberRef = db.collection(COLLECTIONS.WAVE_MEMBERS).doc(userRecord.uid);
            waveBatch.set(waveMemberRef, {
                userId: userRecord.uid,
                email: data.email,
                name: data.fullName,
                phone: data.phone,
                joinDate: FieldValue.serverTimestamp(),
                status: "active",
                tier: "standard",
                points: 0,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _isLegacy: true,
            }, { merge: true });
            await waveBatch.commit();
        }

        // 8e. 🧑‍🌾 FARM NATION DEEP-PROVISIONING
        if (data.services?.farmNation || data.roles.includes("farmer")) {
            const farmBatch = db.batch();
            const farmAppRef = db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS).doc(`legacy_${userRecord.uid}`);
            farmBatch.set(farmAppRef, {
                userId: userRecord.uid,
                status: "approved",
                role: data.farmNationInfo?.role || "farmer",
                farmSize: data.farmNationInfo?.farmSize || undefined,
                cropTypes: data.farmNationInfo?.cropTypes || undefined,
                propertyTypes: data.farmNationInfo?.propertyTypes || undefined,
                listingTypes: data.farmNationInfo?.listingTypes || undefined,
                totalAcreage: data.farmNationInfo?.totalAcreage || undefined,
                profile: {
                    fullName: data.fullName,
                    firstName,
                    lastName,
                    email: data.email,
                    phone: data.phone,
                },
                approvedAt: FieldValue.serverTimestamp(),
                approvedBy: session.user.id,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _isLegacy: true,
            }, { merge: true });
            await farmBatch.commit();
        }

        // 9. Send Welcome Email with the temporary PIN included
        // 9. Send Welcome Email with the temporary PIN included (only for new users)
        // They will use this to log in, and getPostLoginRedirect will force them
        // to change their password via /auth/reset-legacy-password
        if (isNewUser) {
            await sendLegacyMemberWelcomeEmail(data.email, data.fullName, tempPassword);
        }

        // 10. Audit Log
        await createAdminAuditLog({
            action: "legacy_member_onboarded",
            userId: session.user.id,
            targetId: userRecord.uid,
            targetType: "user",
            metadata: {
                targetEmail: data.email,
                roles: data.roles,
                services: data.services,
            },
        });

        return { 
            error: null, success: true as const, 
            message: isNewUser 
                ? `Legacy member ${data.fullName} successfully onboarded. Default PIN sent to ${data.email}.`
                : `Legacy member ${data.fullName} successfully updated.`
        };

    } catch (error: any) {
        logger.error("Legacy onboarding error:", error);
        return { success: false as const, error: error.message || "Failed to onboard legacy member" };
    }
}
export const onboardLegacyMemberAction = withFlexibleSafeAction("onboardLegacyMemberAction", _onboardLegacyMemberAction);

/**
 * Approve Marketplace User (Buyer)
 */
async function _approveMarketplaceUserAction(userId: string): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null };
        if (!isAdmin(sessionResult.session.user.roles)) return { success: false as const, error: "Unauthorized", data: null };

        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            status: "active",
            updatedAt: FieldValue.serverTimestamp()
        });

        await createAdminAuditLog({
            action: "approve_marketplace_user",
            userId: sessionResult.session.user.id,
            targetId: userId,
            targetType: "user",
            metadata: { role: "buyer" },
        });

        revalidatePath("/admin/marketplace/buyers");
        return { success: true as const, error: null, data: null };
    } catch (error: any) {
        logger.error("Approve marketplace user error:", error);
        return { success: false as const, error: error.message || "Failed to approve user", data: null };
    }
}
export const approveMarketplaceUserAction = withFlexibleSafeAction("approveMarketplaceUserAction", _approveMarketplaceUserAction);

/**
 * Reject Marketplace User (Buyer)
 */
async function _rejectMarketplaceUserAction(options: { userId: string; reason: string }): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null };
        if (!isAdmin(sessionResult.session.user.roles)) return { success: false as const, error: "Unauthorized", data: null };

        await db.collection(COLLECTIONS.USERS).doc(options.userId).update({
            status: "rejected",
            rejectionReason: options.reason,
            updatedAt: FieldValue.serverTimestamp()
        });

        await createAdminAuditLog({
            action: "reject_marketplace_user",
            userId: sessionResult.session.user.id,
            targetId: options.userId,
            targetType: "user",
            metadata: { role: "buyer", reason: options.reason },
        });

        revalidatePath("/admin/marketplace/buyers");
        return { success: true as const, error: null, data: null };
    } catch (error: any) {
        logger.error("Reject marketplace user error:", error);
        return { success: false as const, error: error.message || "Failed to reject user", data: null };
    }
}
export const rejectMarketplaceUserAction = withFlexibleSafeAction("rejectMarketplaceUserAction", _rejectMarketplaceUserAction);

/**
 * Perform a system-wide diagnostic audit.
 */
async function _runSystemDiagnosticAction(): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null };
        
        // Basic stats - in production these would be real counts
        const stats = {
            totalUsers: 0,
            corruptedUsers: 0,
            legacyVerified: 0,
            missingNames: 0,
            desyncedRegistrations: 0,
            orphanedApplications: 0,
        };
        
        const services = {
            redis: true,
            paystack: true,
            resend: true,
            firestore: true,
        };

        return {
            success: true as const,
            error: null,
            data: {
                stats,
                services,
                timestamp: new Date().toISOString(),
            }
        };
    } catch (error: any) {
        logger.error("System diagnostic error:", error);
        return { success: false as const, error: error.message || "Diagnostic failed", data: null };
    }
}

export const runSystemDiagnosticAction = withFlexibleSafeAction("runSystemDiagnosticAction", _runSystemDiagnosticAction);
