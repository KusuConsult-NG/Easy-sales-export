"use server";

import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { invalidateUserCache, invalidateAdminGlobalStats } from "@/lib/cache-invalidation";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import { APPROVABLE_FROM_STATUSES } from "@/lib/land-listing-status";
import type { Property } from "@/lib/types/farm-nation-actions";

async function _approveFarmNationSellerAction(userId: string): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        // This is the admin review gate for a Farm Nation seller, and it had no
        // admin check. Only requireSession() stood in front of it, so any
        // authenticated user could call it with their own id and approve
        // themselves — or with anybody's id.
        //
        // WHAT IT IS, STATED PRECISELY
        //
        // Not a role escalation. _submitFarmNationOnboardingAction already grants
        // `farmer` to whoever completes onboarding — `roles:
        // FieldValue.arrayUnion(...roles)` — so the role below is self-grantable
        // by design and calling this adds nothing there.
        //
        // What onboarding deliberately does NOT do is set the status: it leaves
        // `serviceRegistrations.farmNation.status` at "pending". This action is
        // what moves it to "approved", and module-access-check.ts Layer 2 gates
        // access on exactly `serviceRegistrations[module].status === "approved"`.
        // So self-approval buys the Farm Nation module past the human review that
        // "pending" exists to require.
        //
        // Guarded with this file's own idiom, three functions below at
        // _verifyPropertyAction — which is the third admin action here and was
        // already guarded. One of three checked and two not is the shape this
        // audit keeps finding.
        const { hasAdminPermission } = await import("@/lib/admin-permissions");
        if (!hasAdminPermission(session?.user?.roles, "farm_nation:verify_applications")) {
            return { success: false as const, error: "Unauthorized", data: null, meta: null };
        }

        // Fetch application outside transaction
        const appQuery = db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
            .where("userId", "==", userId);
        const appSnap = await appQuery.get();

        // ── SYNC AUTHORITATIVE RECORD & USER IN A TRANSACTION ──────
        await db.runTransaction(async (transaction) => {
            const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
            const userDoc = await transaction.get(userRef);

            if (!userDoc.exists) {
                const appData = !appSnap.empty ? appSnap.docs[0].data() : {};
                const profile = appData.profile || {};
                transaction.set(userRef, {
                    uid: userId,
                    email: profile.email || appData.userEmail || "",
                    fullName: profile.firstName ? `${profile.firstName} ${profile.lastName || ''}`.trim() : "Farmer",
                    createdAt: FieldValue.serverTimestamp(),
                    roles: ["farmer"],
                    isVerified: true,
                });
            }

            // Update user
            transaction.update(userRef, { 
                "serviceRegistrations.farmNation.status": "approved",
                "serviceRegistrations.farmNation.paymentStatus": "completed",
                "serviceRegistrations.farmNation.approvedAt": FieldValue.serverTimestamp(),
                "serviceRegistrations.farmNation.approvedBy": session.user.id,
                roles: FieldValue.arrayUnion("farmer")
            });

            // Update application
            if (!appSnap.empty) {
                const docs = [...appSnap.docs];
                docs.sort((a, b) => {
                    const aVal = a.data().submittedAt;
                    const bVal = b.data().submittedAt;
                    const aTime = aVal?.toDate ? aVal.toDate().getTime() : (aVal ? new Date(aVal).getTime() : 0);
                    const bTime = bVal?.toDate ? bVal.toDate().getTime() : (bVal ? new Date(bVal).getTime() : 0);
                    return bTime - aTime;
                });
                transaction.update(docs[0].ref, {
                    status: "approved",
                    approvedAt: FieldValue.serverTimestamp(),
                    approvedBy: session.user.id,
                    updatedAt: FieldValue.serverTimestamp()
                });
            }
        });

        try {
            await invalidateUserCache(userId);
            await invalidateAdminGlobalStats();
        } catch (err) {
            logger.error("Failed to invalidate cache after Farm Nation approval:", err);
        }

        return { error: null, success: true as const, data: null, meta: null };
    } catch (error: any) { 
        logger.error("Approve seller error:", error);
        return { success: false as const, data: null, error: error.message, meta: null };
    }
}


export async function approveFarmNationSellerAction(...args: Parameters<typeof _approveFarmNationSellerAction>) {
    return withFlexibleSafeAction("approveFarmNationSellerAction", _approveFarmNationSellerAction)(...args);
}


async function _rejectFarmNationSellerAction(userId: string, reason: string): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        // The other half, and the clearer of the two: unguarded, this let any
        // authenticated user set ANOTHER user's farmNation status to "rejected"
        // and strip their `farmer` role with FieldValue.arrayRemove.
        //
        // Unlike approval there is no self-service path that grants this, so it
        // is not something a caller could do to themselves by other means. It
        // revoked a working seller's module access and role on the say-so of
        // anybody with an account, and the record would name the caller as
        // `rejectedBy` — an audit trail agreeing with an action nobody was
        // entitled to take.
        const { hasAdminPermission } = await import("@/lib/admin-permissions");
        if (!hasAdminPermission(session?.user?.roles, "farm_nation:verify_applications")) {
            return { success: false as const, error: "Unauthorized", data: null, meta: null };
        }

        // Fetch application outside transaction
        const appQuery = db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
            .where("userId", "==", userId);
        const appSnap = await appQuery.get();

        // ── SYNC AUTHORITATIVE RECORD & USER IN A TRANSACTION ──────
        await db.runTransaction(async (transaction) => {
            const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
            const userDoc = await transaction.get(userRef);

            if (!userDoc.exists) throw new Error("User not found");

            transaction.update(userRef, { 
                "serviceRegistrations.farmNation.status": "rejected",
                "serviceRegistrations.farmNation.rejectionReason": reason,
                "serviceRegistrations.farmNation.rejectedAt": FieldValue.serverTimestamp(),
                "serviceRegistrations.farmNation.rejectedBy": session.user.id,
                roles: FieldValue.arrayRemove("farmer") 
            });

            if (!appSnap.empty) {
                const docs = [...appSnap.docs];
                docs.sort((a, b) => {
                    const aVal = a.data().submittedAt;
                    const bVal = b.data().submittedAt;
                    const aTime = aVal?.toDate ? aVal.toDate().getTime() : (aVal ? new Date(aVal).getTime() : 0);
                    const bTime = bVal?.toDate ? bVal.toDate().getTime() : (bVal ? new Date(bVal).getTime() : 0);
                    return bTime - aTime;
                });
                transaction.update(docs[0].ref, {
                    status: "rejected",
                    rejectionReason: reason,
                    rejectedAt: FieldValue.serverTimestamp(),
                    rejectedBy: session.user.id,
                    updatedAt: FieldValue.serverTimestamp()
                });
            }
        });

        try {
            await invalidateUserCache(userId);
            await invalidateAdminGlobalStats();
        } catch (err) {
            logger.error("Failed to invalidate cache after Farm Nation rejection:", err);
        }

        return { error: null, success: true as const, data: null, meta: null };
    } catch (error: any) { 
        logger.error("Reject Farm Nation seller error:", error);
        return { success: false as const, data: null, error: error.message, meta: null };
    }
}


export async function rejectFarmNationSellerAction(...args: Parameters<typeof _rejectFarmNationSellerAction>) {
    return withFlexibleSafeAction("rejectFarmNationSellerAction", _rejectFarmNationSellerAction)(...args);
}


/**
 * Verify Property (Admin Only)
 * Toggles the verified status of a property
 */
/**
 * Verify Property (Admin Only)
 * Toggles the verified status of a property
 */
async function _verifyPropertyAction(propertyId: string, verified: boolean): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        // Check admin role
        const { hasAdminPermission } = await import("@/lib/admin-permissions");
        if (!hasAdminPermission(session?.user?.roles, "land:verify_listings")) { 
            return { success: false as const, error: "Unauthorized", data: null, meta: null };
        }

        const propertyRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(propertyId);
        const propertyDoc = await propertyRef.get();

        if (!propertyDoc.exists) return { success: false as const, error: "Property not found", data: null, meta: null };

        const property = propertyDoc.data() as Property;

        // 🔒 SECURITY FIX: Require Documents for Verification
        if (verified) { 
            // Must have at least C of O OR Survey Plan
            if (!property.documents?.cOfO && !property.documents?.surveyPlan) {
                return { success: false as const, error: "Cannot verify property without documents (C of O or Survey Plan required).", data: null, meta: null };
            }
        }

        /**
         * Which statuses this may act on, and why it writes "verified".
         *
         * FOUR DEFECTS WERE HERE
         * ----------------------
         * 1. It wrote `status: "available"`. That is a for-sale status, but it was
         *    NOT in PUBLIC_LAND_STATUSES, so verifying a property through this
         *    action made it invisible to /api/farm-nation/listings and /land —
         *    the opposite of what "verify" means to whoever clicked it. The other
         *    admin path, /api/admin/farm-nation/approve-land, writes "verified".
         *    Two admin routes for one decision, producing different visibility.
         *
         *    PUBLIC_LAND_STATUSES now derives from PURCHASABLE_STATUSES so all
         *    three spellings are honoured, but this writes the canonical
         *    "verified" so both admin paths agree.
         *
         * 2. No status guard, and the trailing comment admitted the author was
         *    unsure ("Keep existing if un-verifying, or reset?"). The code did not
         *    do what the comment mused about: it overwrote unconditionally. On a
         *    listing in pending_escrow that discarded the escrow's state while a
         *    buyer's money was held — the same defect as approve-land,
         *    reject-land and dispatch-inspector.
         *
         * 3. The guard's list was hand-written here, as it was at four other
         *    decision paths, and the five disagreed. This one was the most
         *    permissive; approve-land's was the least, and omitted the very
         *    status farm-nation creates. The set is now shared — see
         *    APPROVABLE_FROM_STATUSES.
         *
         * 4. `update()` is a blind write even with the guard above it: the status
         *    was read, checked, and then written in a separate call, so a purchase
         *    that moved the listing into escrow in between was overwritten anyway.
         *    The check has to be part of the write, which is what
         *    claimStatusTransitionFromAny does.
         */
        if (verified) {
            const transition = await claimStatusTransitionFromAny({
                collection: COLLECTIONS.LAND_LISTINGS,
                id: propertyId,
                fromAny: [...APPROVABLE_FROM_STATUSES],
                // "verified" — the canonical public spelling, matching approve-land.
                to: "verified",
                patch: {
                    verified: true,
                    verifiedAt: FieldValue.serverTimestamp(),
                    verifiedBy: session.user.id,
                    // The string shape, as everywhere else. See
                    // land-listing-status.ts for the four values this field held.
                    verificationStatus: "approved",
                    rejectionReason: null,
                    updatedAt: FieldValue.serverTimestamp(),
                },
                recordPreviousAs: "statusBeforeVerification",
            });

            if (!transition.claimed) {
                return {
                    success: false as const,
                    error: transition.status === null
                        ? (transition.exists
                            ? "This property has no status recorded, so its verification cannot be changed."
                            : "Property not found")
                        : `This property is '${transition.status}' and its verification cannot be ` +
                          `changed from that state. A listing with a purchase in progress must be ` +
                          `resolved first.`,
                    data: null,
                    meta: null,
                };
            }
        } else {
            // Un-verifying leaves the status alone rather than guessing, which is
            // what the old comment wanted and the old code did not do. No status
            // write means no transition to claim — but the guard still applies,
            // so a listing with money against it is not quietly un-verified
            // either.
            if (!APPROVABLE_FROM_STATUSES.includes(String(property.status))) {
                return {
                    success: false as const,
                    error:
                        `This property is '${property.status}' and its verification cannot be changed ` +
                        `from that state. A listing with a purchase in progress must be resolved first.`,
                    data: null,
                    meta: null,
                };
            }

            await propertyRef.update({
                verified: false,
                verifiedAt: null,
                verifiedBy: null,
                verificationStatus: "pending",
                updatedAt: FieldValue.serverTimestamp(),
            });
        }

        // 📜 Audit Log
        const { logAuditAction } = await import("@/lib/audit-log");
        await logAuditAction({
            userId: session.user.id,
            action: verified ? "VERIFY_PROPERTY" : "UNVERIFY_PROPERTY",
            details: `${verified ? "Verified" : "Unverified"} property ${propertyId}`,
            metadata: { propertyId, verified }
        });

        return { success: true as const, data: null, meta: null, error: null };
    } catch (error: any) { 
        logger.error("Verify property error:", error);
        return { success: false as const, data: null, error: error.message, meta: null };
    }
}


export const verifyPropertyAction = withFlexibleSafeAction("verifyPropertyAction", _verifyPropertyAction);
