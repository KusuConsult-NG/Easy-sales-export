"use server";

import { ZodError } from "zod";
import { withFlexibleSafeAction, ActionResponse, type ActionState } from "@/lib/safe-action";
import { revalidateTag } from 'next/cache';
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
            status: decision === "approved" ? "verified" : "rejected",
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
            revalidateTag("land-listings", "page");
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
