"use server";

import { hashData } from "@/lib/security";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { supabaseDb as db } from "@/lib/supabase-db";
// Use Admin DB
// import { uploadFileToStorage } from "@/lib/storage-admin";

import { COLLECTIONS } from "@/lib/types/firestore";
import type { SellerVerification } from "@/lib/types/marketplace";
import { serializeDoc, toMillis } from "@/lib/firestore-serialize";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { SellerVerificationSchema } from "@/lib/validations/marketplace";
import { withSafeAction, ActionResponse } from "@/lib/safe-action";
import { claimStatusTransition } from "@/lib/status-transition";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { createAdminAuditLog } from "@/lib/audit-log";

/**
 * The seller categories, as a value rather than a type.
 *
 * `category: "wholesale" | "retail"` is TypeScript on a server action, and a
 * server action's parameter types are erased at the wire — see the runtime
 * validation in _escrow_lifecycle.ts for the same reasoning.
 */
const SELLER_CATEGORIES = ["wholesale", "retail"] as const;

/**
 * Live roles, not the session's copy.
 *
 * Two of the three admin gates in this file read `session.user.roles` — the JWT
 * — so a demoted admin kept their powers until the token expired. The third,
 * in _updateSellerCategoryAction, already re-read the user document. One
 * behaviour now, and it is the safe one.
 */
async function callerHasPermission(
    userId: string,
    permission: Parameters<typeof hasAdminPermission>[1],
): Promise<boolean> {
    const doc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    return hasAdminPermission(doc.data()?.roles ?? [], permission);
}

// ============================================================================
// SELLER VERIFICATION
// ============================================================================

export interface SellerVerificationFormData { phoneNumber: string;
    nin?: string;
    bvn?: string;
    cac?: string;
    accountNumber: string;
    bankName: string;
    accountName: string;
    bankCode: string;
    street: string;
    city: string;
    state: string;
    lga: string;
    country: string; }


export type SellerVerificationState = 
    | { success: true; error: null; data: unknown; meta?: unknown }
    | { success: false; error: string; data: null; meta?: unknown };


/**
 * Submit seller verification application
 */
async function _submitSellerVerificationAction(
    prevState: unknown,
    formData: FormData
): Promise<ActionResponse<null>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        // Check if already has a pending or approved verification
        const existingDocs = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
            .where("userId", "==", userId)
            .get();

        if (!existingDocs.empty) { 
            const hasActive = existingDocs.docs.some(doc => {
                const existing = doc.data() as SellerVerification;
                return existing.status === "pending" || existing.status === "approved";
            });
            if (hasActive) { 
                return { success: false as const, error: "You already have a verification application. Please check your status.", data: null };
            }
        }

        // Create verification document
        const verificationId = `seller_${userId}_${Date.now()}`;
        const verificationRef = db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(verificationId);

        // DISEASE 6 FIX: Field name correction.
        // Form sends "phone" (not "phoneNumber") and "address" (not "street").
        // The SellerVerification type uses phoneNumber internally, but the FormData key is "phone".
        const verificationData: SellerVerification = { 
            id: verificationId,
            userId,
            status: "pending",
            phoneNumber: (formData.get("phoneNumber") || formData.get("phone")) as string,
            phoneVerified: false,
            nin: (formData.get("nin") as string) || undefined,
            bvn: (formData.get("bvn") as string) || undefined,
            cac: (formData.get("cac") as string) || undefined,
            bankAccount: {
                accountNumber: formData.get("accountNumber") as string,
                bankName: formData.get("bankName") as string,
                accountName: formData.get("accountName") as string,
                bankCode: formData.get("bankCode") as string 
            },
            address: { 
                // Form sends "address" (flat) or "street" — accept both
                street: (formData.get("street") || formData.get("address")) as string,
                city: formData.get("city") as string,
                state: formData.get("state") as string,
                lga: formData.get("lga") as string,
                country: (formData.get("country") as string) || "Nigeria" 
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            _version: 0 
        };

        // Validate payload using Zod schema (H-05)
        const validation = SellerVerificationSchema.safeParse({
            phoneNumber: verificationData.phoneNumber,
            nin: verificationData.nin,
            bvn: verificationData.bvn,
            cac: verificationData.cac,
            bankAccount: verificationData.bankAccount,
            address: verificationData.address,
        });

        if (!validation.success) {
            return {
                success: false as const,
                error: validation.error.issues.map(i => i.message).join(", "),
                data: null
            };
        }

        // Atomic update of verification doc and user record
        await db.runTransaction(async (transaction) => { 
            transaction.set(verificationRef, verificationData);

            // Update user record
            const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
            
            const address = verificationData.address;
            const bankAccount = verificationData.bankAccount;
            const cac = verificationData.cac;

            transaction.update(userRef, {
                sellerVerificationStatus: "pending",
                sellerVerificationId: verificationId,
                
                // Concurrently replicate onboarding details directly to the parent user
                    // The applicant typed these. Nobody checked them.
                //
                // `ninVerified`/`bvnVerified`/`cacVerified` were set to true right
                // here, from the presence of the field. admin/users renders each as
                // a green "Verified" badge, so the reviewer deciding whether to
                // approve THIS application was told the identity had already been
                // checked — because the applicant had filled the box in. Nothing in
                // the codebase ever verified an identity document, so the badge was
                // never earned by anyone.
                //
                // The numbers are still stored, now hashed, matching kyc.ts and
                // wave/_actions.ts which both write hashData(bvn). The reviewable
                // copy is untouched in the verification record, so admin review is
                // unaffected — this replica exists for the user list, and it was the
                // only place a readable BVN sat in the users table. That is the
                // table that spent 52 days in a public repository.
                ...(verificationData.nin ? { nin: hashData(verificationData.nin) } : {}),
                ...(verificationData.bvn ? { bvn: hashData(verificationData.bvn) } : {}),
                ...(cac ? { cacNumber: cac } : {}),
                ...(bankAccount?.accountNumber ? {
                    bankDetails: {
                        accountNumber: bankAccount.accountNumber,
                        bankName: bankAccount.bankName || "",
                        accountName: bankAccount.accountName || "",
                        bankCode: bankAccount.bankCode || ""
                    }
                } : {}),
                ...(address?.street ? {
                    address: {
                        street: address.street,
                        city: address.city || "",
                        state: address.state || "",
                        lga: address.lga || "",
                        country: address.country || "Nigeria"
                    },
                    residentialAddress: address.street,
                    stateOfOrigin: address.state,
                    lga: address.lga
                } : {}),

                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) 
            });
        });

        try { 
            await invalidateUserCache(userId);
        } catch (err) { 
            logger.error("Failed to invalidate cache after Seller Verification:", { userId, error: err });
        }

        return { error: null, success: true as const, data: null };
    } catch (error) { 
        logger.error("Seller verification error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to submit verification", data: null };
    }
}

export const submitSellerVerificationAction = withSafeAction("submitSellerVerificationAction", _submitSellerVerificationAction);


/**
 * Get seller verification status
 */
/**
 * Get seller verification status
 */
async function _getSellerVerificationAction(): Promise<ActionResponse<{ verification: SellerVerification | null }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;
        const userDocRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userDocRef.get();
        const userData = userDoc.data();
        let verificationId = userData?.serviceRegistrations?.marketplace?.verificationId || userData?.sellerVerificationId;

        let verDoc: any = null;
        let foundByQuery = false;

        if (verificationId) {
            const docSnap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(verificationId).get();
            if (docSnap.exists) {
                verDoc = docSnap;
            }
        }

        if (!verDoc) {
            const snapshot = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
                .where("userId", "==", userId)
                .get();

            if (!snapshot.empty) {
                const sortedDocs = snapshot.docs.sort((a, b) => { 
                    const aTime = toMillis(a.data().createdAt);
                    const bTime = toMillis(b.data().createdAt);
                    return bTime - aTime;
                });
                verDoc = sortedDocs[0];
                verificationId = verDoc.id;
                foundByQuery = true;
            }
        }

        if (!verDoc) { 
            return { error: null, success: true as const, data: { verification: null } };
        }

        const verData = verDoc.data()!;
        const verification = serializeDoc<SellerVerification>(verDoc.id, verData);

        // Self-healing: backfill missing links
        const batch = db.batch();
        let needsCommit = false;

        if (foundByQuery || !userData?.serviceRegistrations?.marketplace?.verificationId) {
            batch.update(userDocRef, {
                "serviceRegistrations.marketplace.verificationId": verificationId,
                sellerVerificationId: verificationId,
                _version: FieldValue.increment(1)
            });
            needsCommit = true;
        }

        if (!verData.userId) {
            batch.update(verDoc.ref, {
                userId: session.user.id
            });
            needsCommit = true;
        }

        if (needsCommit) {
            await batch.commit();
        }

        return { error: null, success: true as const, data: { verification } };
    } catch (error) { 
        logger.error("Get seller verification error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Fetch failed", data: null };
    }
}

export const getSellerVerificationAction = withSafeAction("getSellerVerificationAction", _getSellerVerificationAction);


// ============================================================================
// USER RESUBMIT — Seller Verification
// ============================================================================

/**
 * Resubmit verification after rejection
 */
async function _resubmitSellerVerificationAction(data: unknown): Promise<ActionResponse<{ verificationId: string }>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        // Validate payload using Zod schema
        const validation = SellerVerificationSchema.safeParse(data);
        if (!validation.success) {
            return {
                success: false as const,
                error: validation.error.issues.map(i => i.message).join(", "),
                data: null
            };
        }
        const validatedData = validation.data;

        const userId = session.user.id;
        const userDocRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userDocRef.get();
        const userData = userDoc.data();
        let verificationId = userData?.serviceRegistrations?.marketplace?.verificationId || userData?.sellerVerificationId;

        let docRef: any = null;
        let existing: any = null;

        if (verificationId) {
            const directDoc = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(verificationId).get();
            if (directDoc.exists) {
                docRef = directDoc.ref;
                existing = directDoc.data();
            }
        }

        if (!docRef) {
            // Find the most recent rejected verification for this user
            const snapshot = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
                .where("userId", "==", userId)
                .get();

            if (!snapshot.empty) {
                const sortedDocs = snapshot.docs.sort((a, b) => {
                    const aTime = toMillis(a.data().createdAt);
                    const bTime = toMillis(b.data().createdAt);
                    return bTime - aTime;
                });
                docRef = sortedDocs[0].ref;
                existing = sortedDocs[0].data();
                verificationId = docRef.id;
            }
        }

        if (!docRef) {
            return { success: false as const, error: "No verification record found to resubmit.", data: null };
        }

        /**
         * The record must be the caller's.
         *
         * The query branch below filters on userId, but the branch above it does
         * not: it takes `verificationId` from the CALLER'S OWN user document and
         * loads whatever it points at. The update that follows then writes
         * `userId` onto that record — adopting it — along with this caller's
         * bank details and address, and the claim moves its status.
         *
         * A user cannot set that pointer directly, so this needs the link to be
         * wrong to begin with; getSellerVerificationAction's self-healing branch
         * and the legacy onboarding importer both write it. It costs one read to
         * refuse instead of adopt.
         */
        if (existing?.userId && existing.userId !== userId) {
            logger.warn(
                `[resubmitSellerVerification] ${userId} is linked to verification ${docRef.id}, ` +
                `which belongs to ${existing.userId}. Refusing.`
            );
            return { success: false as const, error: "No verification record found to resubmit.", data: null };
        }

        // Claimed, not checked then written.
        //
        // `existing.status !== "rejected"` was read outside the transaction, and
        // runTransaction takes no lock in this adapter — so two resubmissions
        // both passed and both wrote, and a resubmission racing an admin's
        // approval could move an APPROVED verification back to "pending".
        const resubmitClaim = await claimStatusTransition({
            collection: COLLECTIONS.SELLER_VERIFICATIONS,
            id: docRef.id,
            from: "rejected",
            to: "pending",
            patch: { resubmittedAt: new Date().toISOString() },
        });

        if (!resubmitClaim.claimed) {
            return {
                success: false as const,
                error: `Can only resubmit rejected verifications (Current: ${resubmitClaim.status ?? "unknown"})`,
                data: null,
            };
        }

        await db.runTransaction(async (transaction) => {
            transaction.update(docRef, {
                ...validatedData,
                userId, // Ensure userId is populated
                // The rejection, kept rather than erased.
                //
                // This wrote `rejectionReason: null` and overwrote the submitted
                // fields in place, so the record of WHY the application was
                // rejected — and what it said when it was — was destroyed by the
                // resubmission. An admin reviewing the new version had nothing to
                // compare it against and no note of their own earlier decision.
                //
                // `status` is not written here: claimStatusTransition above
                // already moved it, and writing it again would let this update
                // undo a decision made in between.
                rejectionReason: null,
                previousRejection: {
                    reason: existing?.rejectionReason ?? null,
                    rejectedAt: existing?.reviewedAt ?? existing?.updatedAt ?? null,
                    rejectedBy: existing?.reviewedBy ?? null,
                },
                resubmissionCount: (Number(existing?.resubmissionCount) || 0) + 1,
                submittedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            // Update user record
            const address = validatedData.address;
            const bankAccount = validatedData.bankAccount;
            const cac = validatedData.cac;

            transaction.update(userDocRef, {
                sellerVerificationStatus: "pending",
                sellerVerificationId: docRef.id,
                "serviceRegistrations.marketplace.status": "pending",
                "serviceRegistrations.marketplace.verificationId": docRef.id,
                "serviceRegistrations.marketplace.resubmittedAt": FieldValue.serverTimestamp(),
                
                // Concurrently replicate onboarding details directly to the parent user
                    // The applicant typed these. Nobody checked them.
                //
                // `ninVerified`/`bvnVerified`/`cacVerified` were set to true right
                // here, from the presence of the field. admin/users renders each as
                // a green "Verified" badge, so the reviewer deciding whether to
                // approve THIS application was told the identity had already been
                // checked — because the applicant had filled the box in. Nothing in
                // the codebase ever verified an identity document, so the badge was
                // never earned by anyone.
                //
                // The numbers are still stored, now hashed, matching kyc.ts and
                // wave/_actions.ts which both write hashData(bvn). The reviewable
                // copy is untouched in the verification record, so admin review is
                // unaffected — this replica exists for the user list, and it was the
                // only place a readable BVN sat in the users table. That is the
                // table that spent 52 days in a public repository.
                ...(validatedData.nin ? { nin: hashData(validatedData.nin) } : {}),
                ...(validatedData.bvn ? { bvn: hashData(validatedData.bvn) } : {}),
                ...(cac ? { cacNumber: cac } : {}),
                ...(bankAccount?.accountNumber ? {
                    bankDetails: {
                        accountNumber: bankAccount.accountNumber,
                        bankName: bankAccount.bankName || "",
                        accountName: bankAccount.accountName || "",
                        bankCode: bankAccount.bankCode || ""
                    }
                } : {}),
                ...(address?.street ? {
                    address: {
                        street: address.street,
                        city: address.city || "",
                        state: address.state || "",
                        lga: address.lga || "",
                        country: address.country || "Nigeria"
                    },
                    residentialAddress: address.street,
                    stateOfOrigin: address.state,
                    lga: address.lga
                } : {}),

                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) 
            });
        });

        return { error: null, success: true as const, data: { verificationId: docRef.id } };
    } catch (error: any) { 
        logger.error("Resubmit verification error:", error);
        return { success: false as const, error: error instanceof Error ? error.message : "Resubmission failed", data: null };
    }
}

export const resubmitSellerVerificationAction = withSafeAction("resubmitSellerVerificationAction", _resubmitSellerVerificationAction);


// ============================================================================
// VERIFIED BADGE — Admin Actions
// ============================================================================

/**
 * Grant or revoke the verified badge for a seller.
 *
 * THE FIELD THE APPLICATION ACTUALLY READS
 * ----------------------------------------
 * These two actions wrote `isSellerVerified` and `sellerBadge`. Nothing in the
 * codebase reads either one — a grep for both names returns only the two writes
 * below. The badge the storefront, the seller profile page, the admin table and
 * every product card display is `isVerifiedBadge`, written by
 * admin/_marketplace.ts's toggleVerifiedBadgeAction onto BOTH the seller's
 * verification record and their user document, and read from the user document
 * by lib/seller-trust.ts.
 *
 * So granting through this path changed nothing a buyer could see, and — the
 * half that matters — REVOKING THROUGH THIS PATH DID NOT REVOKE: `isVerifiedBadge`
 * stayed true and the seller kept the trust mark an admin had just taken away.
 * Two badge subsystems, one of them inert. Same shape as the seller badge
 * finding in lib/seller-trust.ts, which these two escaped because nothing calls
 * them.
 *
 * They now write the real field, on both records, exactly as the live path does.
 *
 * NOTHING CALLS EITHER OF THESE. No page and no route; the admin seller screen
 * uses toggleVerifiedBadgeAction. `index.ts` re-exports this module, so they are
 * registered server actions rather than dead code — which is why they are
 * corrected here rather than deleted. Removing a "use server" export is the
 * owner's call, not a side effect of a bug fix.
 */
async function setSellerBadge(
    userId: string,
    granted: boolean,
): Promise<ActionResponse<{ success: boolean }>> {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
    const actorId = sessionResult.session.user.id;

    // The permission the live badge path requires, from the shared matrix —
    // not a fourth hand-written list of role strings.
    if (!(await callerHasPermission(actorId, "marketplace:approve_sellers"))) {
        return { success: false as const, error: "Unauthorized: Permission required - marketplace:approve_sellers", data: null };
    }

    const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
        return { success: false as const, error: "Seller not found", data: null };
    }

    await userRef.update({
        isVerifiedBadge: granted,
        updatedAt: FieldValue.serverTimestamp(),
    });

    // Keep the verification record in step, as toggleVerifiedBadgeAction does.
    // The admin seller table reads the badge from THAT document, so updating
    // only the user left the two disagreeing.
    const verifications = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
        .where("userId", "==", userId)
        .get();

    if (!verifications.empty) {
        const newest = verifications.docs.sort(
            (a, b) => toMillis(b.data().createdAt) - toMillis(a.data().createdAt),
        )[0];
        await newest.ref.update({
            isVerifiedBadge: granted,
            badgeGrantedBy: actorId,
            badgeGrantedAt: granted ? FieldValue.serverTimestamp() : null,
            updatedAt: FieldValue.serverTimestamp(),
        });
    }

    // Neither action recorded anything. Granting and revoking a trust mark is
    // exactly what the audit log is for, and the live path already logs it.
    await createAdminAuditLog({
        action: granted ? "seller_badge_grant" : "seller_badge_revoke",
        userId: actorId,
        targetId: userId,
        targetType: "user",
    });

    return { error: null, success: true as const, data: { success: true } };
}

/**
 * Admin action to grant verified badge
 */
async function _grantSellerVerifiedBadgeAction(userId: string): Promise<ActionResponse<{ success: boolean }>> {
    try {
        return await setSellerBadge(userId, true);
    } catch (error: any) {
        logger.error("Grant badge error:", error);
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to grant badge", data: null };
    }
}

export const grantSellerVerifiedBadgeAction = withSafeAction("grantSellerVerifiedBadgeAction", _grantSellerVerifiedBadgeAction);


/**
 * Admin action to revoke verified badge
 */
async function _revokeSellerVerifiedBadgeAction(userId: string): Promise<ActionResponse<{ success: boolean }>> {
    try {
        return await setSellerBadge(userId, false);
    } catch (error: any) {
        logger.error("Revoke badge error:", error);
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to revoke badge", data: null };
    }
}

export const revokeSellerVerifiedBadgeAction = withSafeAction("revokeSellerVerifiedBadgeAction", _revokeSellerVerifiedBadgeAction);


// ============================================================================
// SELLER CATEGORY — Update action for admin
// ============================================================================

/**
 * Update the seller category (wholesale/retail) for an existing approved seller.
 * Admin or the seller themselves can update this.
 */
async function _updateSellerCategoryAction(
    sellerId: string,
    category: "wholesale" | "retail"
): Promise<ActionResponse<{ message: string }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const actorId = sessionResult.session.user.id;

        /**
         * The category is checked at RUNTIME.
         *
         * The union in the signature is TypeScript and is gone at the wire, and
         * this value is written to three places: the seller's user document, their
         * verification record, and EVERY ONE of their products. _mp_products.ts
         * reads it back as the product's sellerCategory and the buyer catalogue
         * filters on it, so an unrecognised string removes the seller's whole
         * catalogue from both the wholesale and the retail view at once — and
         * nothing here would have refused it.
         */
        if (!(SELLER_CATEGORIES as readonly string[]).includes(String(category))) {
            return {
                success: false as const,
                error: `Invalid seller category. Expected one of: ${SELLER_CATEGORIES.join(", ")}`,
                data: null,
            };
        }

        // Allow: the seller themselves, or an admin with the marketplace
        // seller permission — from the shared matrix, not a role list written
        // out by hand for the third time in this file.
        if (actorId !== sellerId) {
            if (!(await callerHasPermission(actorId, "marketplace:approve_sellers"))) {
                return { success: false as const, error: "Unauthorized", data: null };
            }
        }

        const now = FieldValue.serverTimestamp();

        // Perform updates in a single transaction for atomicity
        await db.runTransaction(async (transaction) => { 
            // 1. Update User Document
            const userRef = db.collection(COLLECTIONS.USERS).doc(sellerId);
            transaction.update(userRef, {
                sellerCategory: category,
                updatedAt: now,
                _version: FieldValue.increment(1) 
            });

            // 2. Update Verification Document
            const verSnap = await transaction.get(db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
                .where("userId", "==", sellerId));
            if (!verSnap.empty) { 
                const sortedDocs = verSnap.docs.sort((a, b) => {
                    const aData = a.data();
                    const bData = b.data();
                    const aTime = toMillis(aData.createdAt);
                    const bTime = toMillis(bData.createdAt);
                    return bTime - aTime;
                });
                transaction.update(sortedDocs[0].ref, { 
                    sellerCategory: category, 
                    updatedAt: now,
                    _version: FieldValue.increment(1) 
                });
            }

            // 3. Denormalize onto all products
            const productsSnap = await transaction.get(db.collection(COLLECTIONS.PRODUCTS)
                .where("sellerId", "==", sellerId));
            if (!productsSnap.empty) { 
                productsSnap.docs.forEach((doc) => {
                    transaction.update(doc.ref, { 
                        sellerCategory: category, 
                        updatedAt: now,
                        _version: FieldValue.increment(1) 
                    });
                });
            }
        });

        return { error: null, success: true as const, data: { message: "Category updated" } };
    } catch (error) { 
        logger.error("updateSellerCategoryAction error:", {
            userId: sessionResult?.session?.user?.id,
            sellerId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to update seller category", data: null };
    }
}

export const updateSellerCategoryAction = withSafeAction("updateSellerCategoryAction", _updateSellerCategoryAction);
