"use server";

import { ZodError } from "zod";
import { withFlexibleSafeAction, ActionResponse, type ActionState } from "@/lib/safe-action";
import { updateTag } from 'next/cache';
import { invalidateAdminGlobalStats, invalidateServiceCache } from "@/lib/cache-invalidation";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { FieldPath } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createAdminAuditLog } from "@/lib/audit-log";
import { serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { LandListingVerificationSchema } from "@/lib/schemas";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { requireAdmin } from "@/lib/require-admin";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import { canSendEmail } from "@/lib/email-notifications";
import {
    APPROVABLE_FROM_STATUSES,
    REJECTABLE_FROM_STATUSES,
    AWAITING_REVIEW_STATUSES,
} from "@/lib/land-listing-status";

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

        /**
         * Queried on `status`, not on `verificationStatus`.
         *
         * WHAT THIS QUEUE USED TO MISS
         * ----------------------------
         * It asked for `verificationStatus == "pending"`, and that field is a
         * derived duplicate of `status` that four writers spelled four ways:
         *
         *   create-listing    the string "pending"          — matched
         *   _fn_listings      the string "pending_review"   — never matched, so a
         *                     listing whose owner added the missing documents
         *                     after a rejection dropped out of the review queue
         *                     for good
         *   land-listings,    an OBJECT — a value no string comparison matches,
         *   approve/reject    so any listing ever decided through those paths
         *                     could not come back into this queue
         *
         * `status` is the authoritative field. AWAITING_REVIEW_STATUSES is what
         * _fna_verifications.ts — the other admin review queue — already counts,
         * so the two now return the same listings instead of two different
         * subsets of the same collection.
         */
        const snapshot = await db.collection(COLLECTIONS.LAND_LISTINGS)
            .where("status", "in", [...AWAITING_REVIEW_STATUSES])
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
        const adminCheck = await requireAdmin("land:verify_listings");
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

        /**
         * The FIFTH blind land status write, and the most exposed of the five.
         *
         * The others at least checked that the listing existed and returned an
         * error if it did not. This one read the document only to pick up
         * `ownerId` for the cache invalidation below, ignored `exists`
         * completely, and then wrote the status unconditionally — so calling it
         * with a nonexistent id reported "Land listing approved successfully"
         * and, on the JSONB-backed collections, created the row.
         *
         * With the write unconditional it also overwrote whatever state the
         * listing was in. Farm Nation holds a buyer's money against
         * `pending_escrow`; approving from there put the parcel back on the
         * public market with the escrow still open, and rejecting from there took
         * it off the market with the buyer's money still held and nothing in the
         * flow to release it.
         *
         * Everything this wrote is preserved — this file already had the shape
         * the other four are now converted to: the `verificationStatus` string
         * plus the top-level decision fields. What changes is that the check and
         * the write are one operation.
         */
        const transition = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id: listingId,
            fromAny: decision === "approved"
                ? [...APPROVABLE_FROM_STATUSES]
                : [...REJECTABLE_FROM_STATUSES],
            to: decision === "approved" ? "verified" : "rejected",
            patch: {
                verificationStatus: decision,
                verified: decision === "approved",
                verifiedBy: session.user.id,
                verifiedAt: FieldValue.serverTimestamp(),
                rejectionReason: decision === "rejected" ? reason : null,
                updatedAt: FieldValue.serverTimestamp(),
            },
            recordPreviousAs: decision === "approved"
                ? "statusBeforeVerification"
                : "statusBeforeRejection",
        });

        if (!transition.claimed) {
            logger.warn(
                `[verifyLandListing] Refused: listing ${listingId} is '${transition.status}', ` +
                `which is not a ${decision === "approved" ? "approvable" : "rejectable"} state.`
            );
            return {
                success: false as const,
                error: transition.status === null
                    ? (transition.exists
                        ? "This land listing has no status recorded, so a decision cannot be made on it."
                        : "Land listing not found")
                    : `This listing is '${transition.status}' and cannot be ${decision} from that ` +
                      `state. A listing with a purchase in progress must be resolved first.`,
            };
        }

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
            //
            // #308 This already logged the missing-ADDRESS case ("Missing
            // ownerEmail for land listing") — the one place among the ten that
            // did — and was silent on the missing-KEY case, which is the other
            // half. canSendEmail covers both, so the inner check below is a
            // second, narrower statement of the same thing rather than the only
            // one; it is kept because its message names the listing id.
            if (canSendEmail("land listing decision email", listingData.ownerEmail)) {
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
                            from: process.env.EMAIL_FROM || "Easy Sales Export <info@easysalesexport.com>",
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

        // Clear cache
        try {
            await invalidateAdminGlobalStats();
            updateTag("land-listings");
        } catch (cacheError) {
            logger.error('[Land Verification Stats] Cache clear error:', cacheError);
        }

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

export const getPendingLandListings = withFlexibleSafeAction("getPendingLandListings", _getPendingLandListings);

export const verifyLandListing = withFlexibleSafeAction("verifyLandListing", _verifyLandListing);
