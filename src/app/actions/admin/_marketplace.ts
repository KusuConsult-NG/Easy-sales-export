"use server";

import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";
import { withFlexibleSafeAction, ActionResponse, type ActionState } from "@/lib/safe-action";
import { revalidatePath, revalidateTag } from 'next/cache';
import { invalidateAdminGlobalStats } from "@/lib/cache-invalidation";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { FieldPath } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createAdminAuditLog } from "@/lib/audit-log";
import { serializeDocs, serializeValue, toMillis } from "@/lib/firestore-serialize";
import { normalizeAggressive } from "@/lib/canonical/normalizer";
import { hasAdminPermission, isAdmin } from "@/lib/admin-permissions";
import { stripPii } from "@/lib/admin-pii";
import { safeToISOString } from "@/lib/date-utils";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import { normaliseSellerVerification } from "@/lib/seller-verification-shape";
import {
    PRODUCT_APPROVABLE_FROM,
    PRODUCT_REJECTABLE_FROM,
    normaliseProductStatus,
} from "@/lib/product-status";

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
                // "approved", not "active".
                //
                // Two approval implementations write this field:
                // /api/admin/marketplace/approve-seller writes "approved", and
                // this action wrote "active". Every reader tests for "approved"
                // — marketplace/seller/layout.tsx redirects to /onboarding when
                // `registration.status !== "approved"`, and
                // checkMarketplaceStatusAction re-queries the verification
                // record for the same reason.
                //
                // NOT a live lockout: the admin sellers page calls the API
                // route, so approvals made through the UI have always written
                // the value readers accept. This action is exported from the
                // admin barrel and reachable, and would have locked an approved
                // seller out of their own dashboard.
                "serviceRegistrations.marketplace.status": "approved",
                "serviceRegistrations.marketplace.accountType": verificationData.accountType || "seller",
                "serviceRegistrations.marketplace.paymentStatus": "completed",
                "serviceRegistrations.marketplace.approvedAt": FieldValue.serverTimestamp(),
                "serviceRegistrations.marketplace.approvedBy": session.user.id,
                "verificationProfile.status": "approved",
                "verificationProfile.verifiedBy": session.user.id,
                "verificationProfile.verifiedAt": FieldValue.serverTimestamp(),
                phone: verificationData.phoneNumber || verificationData.phone,
                updatedAt: FieldValue.serverTimestamp(),

                // Replicate bankAccount to user root bankDetails (DISEASE 6 / Save Bank Account Details fix)
                ...(verificationData.bankAccount?.accountNumber ? {
                    bankDetails: {
                        accountNumber: verificationData.bankAccount.accountNumber,
                        bankName: verificationData.bankAccount.bankName || "",
                        accountName: verificationData.bankAccount.accountName || "",
                        bankCode: verificationData.bankAccount.bankCode || ""
                    }
                } : {}),

                // Replicate location address to user root address object
                ...(verificationData.location?.address ? {
                    address: {
                        street: verificationData.location.address,
                        city: "",
                        state: verificationData.location.state || "",
                        lga: verificationData.location.lga || "",
                        country: "Nigeria"
                    },
                    residentialAddress: verificationData.location.address,
                    stateOfOrigin: verificationData.location.state,
                    lga: verificationData.location.lga
                } : {}),
            });
        });

        // CLEAR CACHE - User now has seller role and verification
        try {
            const { invalidateSellerCache } = await import('@/lib/cache-invalidation');
            await invalidateSellerCache(userId);
            await invalidateAdminGlobalStats();
            logger.info(`[Seller Approval] Cache cleared for user: ${userId} and global stats invalidated`);
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
                        from: process.env.EMAIL_FROM || "Easy Sales Export <info@easysalesexport.com>",
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
        try {
            revalidatePath("/marketplace", "page");
            revalidatePath("/dashboard", "page");
            revalidateTag(`user-status-${userId}`, "page");
        } catch (revalError) {
            logger.warn("Revalidation failed (expected in test/script environments):", revalError);
        }

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
        /**
         * The marketplace permission, not the global user one.
         *
         * This required "users:update", which only super_admin and admin hold.
         * marketplace_admin does not — and /admin/marketplace/sellers, the ONLY
         * screen with this button, is a route marketplace_admin is explicitly
         * allowed to reach (see canAccessAdminRoute). So the role whose job is
         * approving sellers could open the seller screen, approve an application
         * with "marketplace:approve_sellers" two functions up, and then get
         * "Unauthorized: Permission required - users:update" from the Grant Badge
         * button beside it, every time.
         *
         * "marketplace:approve_sellers" is held by super_admin, admin and
         * marketplace_admin — the same set as before plus the role that owns the
         * screen. Nobody else gains anything.
         */
        if (!session?.user || !hasAdminPermission(session.user.roles, "marketplace:approve_sellers")) {
            return { error: "Unauthorized: Permission required - marketplace:approve_sellers", success: false as const };
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
                    from: process.env.EMAIL_FROM || "Easy Sales Export <info@easysalesexport.com>",
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

        /**
         * isAdmin() is true for all TEN admin roles, and every row below carries
         * the applicant's bank details AND the URLs of their ID card and
         * business certificate. Approving, rejecting or suspending a seller —
         * the only things this screen does — requires
         * "marketplace:approve_sellers", which the action fifty lines above
         * already enforces: super_admin, admin and marketplace_admin.
         *
         * So an academy_admin or a support user could not decide a single
         * application and could read every seller's account number and download
         * their identity documents.
         */
        const maySeeVerificationPii = hasAdminPermission(session.user.roles, "marketplace:approve_sellers");

        let cursorSnap = null;
        if (cursorId) {
            cursorSnap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(cursorId).get();
        }

        const useMemoryPagination = !!search || !!dateFrom || !!dateTo;
        let applications: any[] = [];
        let nextCursorId: string | undefined = undefined;

        if (search) {
            const { searchUserIdsByQuery } = await import("@/lib/admin-search-helper");
            const matchingUserIds = await searchUserIdsByQuery(search);

            const capitalizedQ = search.trim()
                .split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ');
            const rawLowerQ = search.trim().toLowerCase();
            const rawUpperQ = search.trim().toUpperCase();

            const promises = [];
            
            if (matchingUserIds.length > 0) {
                promises.push(
                    db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
                        .where("userId", "in", matchingUserIds)
                        .get()
                );
            }

            // businessName in title case prefix
            promises.push(
                db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
                    .where("businessName", ">=", capitalizedQ)
                    .where("businessName", "<=", capitalizedQ + "\uf8ff")
                    .limit(50)
                    .get()
            );

            // businessName in lowercase prefix
            promises.push(
                db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
                    .where("businessName", ">=", rawLowerQ)
                    .where("businessName", "<=", rawLowerQ + "\uf8ff")
                    .limit(50)
                    .get()
            );

            // businessRegNumber prefix
            promises.push(
                db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
                    .where("businessRegNumber", ">=", rawUpperQ)
                    .where("businessRegNumber", "<=", rawUpperQ + "\uf8ff")
                    .limit(50)
                    .get()
            );

            const snaps = await Promise.all(promises);
            const seenIds = new Set<string>();
            const uniqueDocs: any[] = [];

            for (const snap of snaps) {
                for (const doc of snap.docs) {
                    if (!seenIds.has(doc.id)) {
                        seenIds.add(doc.id);
                        uniqueDocs.push(doc);
                    }
                }
            }

            applications = serializeDocs(uniqueDocs);

            // Filter by statusFilter
            if (statusFilter && statusFilter !== "all") {
                applications = applications.filter(app => app.status === statusFilter);
            }
        } else {
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

            const fetchLimit = useMemoryPagination ? 5000 : limitCount;

            if (cursorSnap && cursorSnap.exists && !useMemoryPagination) {
                q = q.startAfter(cursorSnap);
            }
            
            q = q.limit(fetchLimit + 1);

            const snapshot = await q.get();
            applications = serializeDocs(snapshot.docs);
            if (!useMemoryPagination) {
                applications = applications.slice(0, fetchLimit);
            }
            nextCursorId = applications.length > 0 ? applications[applications.length - 1].id as string : undefined;
        }

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

            // Typed as a Record: NormalisedSellerVerification carries an index
            // signature so unknown fields pass through, but TypeScript drops
            // index signatures across an object spread — without this the
            // downstream sort on `data.createdAt` stops compiling.
            const canonical: Record<string, any> = normaliseSellerVerification(app);

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
                    ...(maySeeVerificationPii ? {
                        bankDetails: normalized.verificationProfile?.bankDetails,
                        documents: normalized.verificationProfile?.documents,
                    } : {}),
                },
                status: normalized.verificationProfile?.status || "pending",
                // Normalised onto the shape the admin screen reads.
                //
                // SELLER_VERIFICATIONS has two writers and neither produces what
                // this screen expects. Address, state and LGA were blank for both
                // paths; business name and phone were blank for applications
                // submitted through the verification form; and the detail modal
                // renders `{data.address}` directly, which for that path is an
                // OBJECT — React throws "Objects are not valid as a React child"
                // and the admin screen came down.
                //
                // Normalising on READ rather than migrating: records already
                // exist in both shapes, so changing the writers fixes nothing
                // already stored. See lib/seller-verification-shape.ts.
                //
                // Applied BEFORE the normalizeAggressive fields, so those still
                // win — they draw on the user document as well as the
                // application, which is a wider source than this adapter has.
                // `canonical` is the raw application normalised, so it carries
                // whatever the two writers put there — account number, BVN and
                // NIN among it. Stripped rather than overridden field by field:
                // a spread of a document nobody controls cannot be gated by
                // naming the keys you happen to know about.
                data: maySeeVerificationPii ? {
                    ...canonical,
                    // normalizeAggressive draws on the USER document as well as
                    // the application, which is a wider source than the adapter
                    // has, so it wins where it has a value.
                    bankDetails: normalized.verificationProfile?.bankDetails ?? canonical.bankDetails,
                    documents: {
                        // Its own keys (businessCert / idCard) are kept for the
                        // raw view; the three the screen reads come from the
                        // adapter, which is the only place they line up.
                        ...(normalized.verificationProfile?.documents ?? {}),
                        ...canonical.documents,
                    }
                } : stripPii(canonical)
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

            // Sort the final forms in memory
            const dir = sortOrder || "desc";
            finalForms.sort((a: any, b: any) => {
                // toMillis, not another hand-rolled coercion.
                //
                // This read `new Date(x?.toDate ? x.toDate().toISOString() : x || 0)`,
                // which covers a Timestamp with toDate() and a string — and not a
                // plain `{seconds}` object, for which `new Date({...})` is an
                // Invalid Date, getTime() is NaN, and a comparator returning NaN
                // does not order anything. Same family as the 34 sort keys fixed
                // in de0a1a87.
                const dateA = toMillis(a.data?.createdAt);
                const dateB = toMillis(b.data?.createdAt);
                return dir === "desc" ? dateB - dateA : dateA - dateB;
            });
        }

        // ALWAYS apply date filters in memory as a definitive backstop.
        if (dateFrom) {
            const from = dateRangeStart(dateFrom);
            finalForms = finalForms.filter((app: any) => new Date(app.data?.createdAt?.toDate ? app.data.createdAt.toDate().toISOString() : app.data?.createdAt || 0) >= from);
        }
        if (dateTo) {
            const to = dateRangeEnd(dateTo);
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

        // Same shape as the seller verification list above: isAdmin() admits
        // every admin role, and each row carried a marketplace buyer's or
        // seller's bank account. Acting on one requires
        // "marketplace:approve_sellers" or "marketplace:suspend_sellers".
        const maySeeBankDetails = hasAdminPermission(session.user.roles, "marketplace:approve_sellers");

        let q: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.USERS);

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

        // Fetch ALL matching marketplace users for accurate in-memory search,
        // stats and pagination — and say so to the adapter.
        //
        // A `fetchLimit` was computed one line above the query and never
        // applied to it: `const fetchLimit = options.search ? 5000 : (limit || 50)`
        // sat there while `q.get()` ran unbounded. That is not the harmless
        // leftover it looks like, because `.get()` on a query with no `.limit()`
        // does not return everything — it stops at the adapter's
        // DEFAULT_QUERY_LIMIT of 5,000 rows and hands back a snapshot that
        // looks complete. Everything below runs over that snapshot: the search
        // filter, `stats.total`, the buyer/seller/both counts, and the paging.
        //
        // So past 5,000 marketplace users the admin's search silently stops
        // finding people, and the totals beside it silently understate — the
        // same defect getCooperativeStats already carries a comment about,
        // fixed there and left here. `.all()` is the adapter's answer for a
        // caller that genuinely needs every row, and it reports at error level
        // if it reaches its far higher runaway ceiling. `truncated` is
        // surfaced in the payload so a partial list is distinguishable from a
        // complete one by the caller and not only in a log.
        const snapshot = await q.all().get();
        const truncated = Boolean((snapshot as any).truncated);
        if (truncated) {
            logger.error(
                "[getMarketplaceUsersAction] hit the row ceiling — the marketplace user list, its "
                + "search and its totals are INCOMPLETE.",
                { search: options.search ?? null, roleFilter: options.roleFilter ?? null }
            );
        }

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
                phone: (() => {
                    const PLACEHOLDER_NAMES = new Set(["user", "unknown", "unknown user", "n/a", ""]);
                    const isPlaceholder = (v: any) => !v || PLACEHOLDER_NAMES.has(String(v).toLowerCase().trim());
                    let p = data.phone || data.phoneNumber || data.kyc?.phoneNumber || data.kyc?.phone || "";
                    if (isPlaceholder(p) && data.serviceRegistrations) {
                        for (const reg of Object.values(data.serviceRegistrations) as any[]) {
                            const profile = reg?.profile || reg;
                            if (profile && profile.phone && !isPlaceholder(profile.phone)) {
                                p = profile.phone;
                                break;
                            }
                        }
                    }
                    return isPlaceholder(p) ? "" : p;
                })(),
                state: data.address?.state || data.stateOfOrigin || "",
                lga: data.address?.lga || data.lga || "",
                roles: data.roles || [],
                buyerRole,
                status: data.status || "active",
                createdAt: safeToISOString(data.createdAt, new Date(0).toISOString()),
                ...(maySeeBankDetails ? {
                    bankDetails: serializeValue(data.bankDetails || {
                        bankName: data.bankName || data.bankAccount?.bankName || "",
                        accountNumber: data.accountNumber || data.bankAccountNumber || data.bankAccount?.accountNumber || "",
                        accountName: data.accountName || data.bankAccountName || data.bankAccount?.accountName || data.fullName || (data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : ""),
                        bankCode: data.bankCode || data.bankAccount?.bankCode || ""
                    }) ?? null,
                } : {}),
            };
        }).filter(Boolean) as any[];

        // ALWAYS apply date filters in memory as a definitive backstop.
        if (options.dateFrom) {
            const from = dateRangeStart(options.dateFrom);
            users = users.filter((u: any) => new Date(u.createdAt) >= from);
        }
        if (options.dateTo) {
            const to = dateRangeEnd(options.dateTo);
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
            // A partial list must be distinguishable from a complete one.
            meta: { stats: { ...stats, truncated } }
        };

    } catch (error: any) {
        logger.error("Failed to fetch marketplace buyers:", error);
        return { success: false as const, error: "Internal server error", data: null };
    }
}

export const approveSellerVerificationAction = withFlexibleSafeAction("approveSellerVerificationAction", _approveSellerVerificationAction);

export const toggleVerifiedBadgeAction = withFlexibleSafeAction("toggleVerifiedBadgeAction", _toggleVerifiedBadgeAction);

export const getStandardSellerVerificationsAction = withFlexibleSafeAction("getStandardSellerVerificationsAction", _getStandardSellerVerificationsAction);

export const getMarketplaceUsersAction = withFlexibleSafeAction("getMarketplaceUsersAction", _getMarketplaceUsersAction);

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

/**
 * Approve Marketplace User (Buyer)
 */
async function _approveMarketplaceUserAction(userId: string): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null };
        // marketplace:approve_sellers, not "is some kind of admin".
        //
        // isAdmin() is true for every admin role, so an academy_admin or a
        // wave_admin could approve a marketplace seller. The matrix grants this
        // to super_admin, admin and marketplace_admin only.
        if (!hasAdminPermission(sessionResult.session.user.roles, "marketplace:approve_sellers")) return { success: false as const, error: "Unauthorized", data: null };

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

        try {
            const { invalidateUserCache } = await import("@/lib/cache-invalidation");
            await invalidateUserCache(userId);
            await invalidateAdminGlobalStats();
        } catch (cacheError) {
            logger.error('[Approve Marketplace User Cache] Cache clear error:', cacheError);
        }

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
        // marketplace:suspend_sellers — see the note on the approve path above.
        if (!hasAdminPermission(sessionResult.session.user.roles, "marketplace:suspend_sellers")) return { success: false as const, error: "Unauthorized", data: null };

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

        try {
            const { invalidateUserCache } = await import("@/lib/cache-invalidation");
            await invalidateUserCache(options.userId);
            await invalidateAdminGlobalStats();
        } catch (cacheError) {
            logger.error('[Reject Marketplace User Cache] Cache clear error:', cacheError);
        }

        return { success: true as const, error: null, data: null };
    } catch (error: any) {
        logger.error("Reject marketplace user error:", error);
        return { success: false as const, error: error.message || "Failed to reject user", data: null };
    }
}

export const rejectMarketplaceUserAction = withFlexibleSafeAction("rejectMarketplaceUserAction", _rejectMarketplaceUserAction);

// ============================================
// Product moderation
// ============================================

/**
 * Admin: list products by status, so a moderator can see them at all.
 *
 * WHY THIS DID NOT EXIST
 * ----------------------
 * There was no admin screen or action anywhere that listed or acted on a
 * product. createProductAction wrote `status: "pending"`, every buyer-facing
 * reader filters on `status == "active"`, and nothing moved a product between
 * the two — so the primary seller form produced listings no buyer could see and
 * no admin could release. admin-content.ts COUNTED pending products, which meant
 * the dashboard displayed the size of the backlog without offering any way to
 * clear it.
 *
 * PRODUCT_INITIAL_STATUS is "active" now, so new listings are not held. This
 * exists to release the backlog that accumulated, and to give moderation a
 * mechanism at all — see lib/product-status.ts for the reasoning and for how to
 * switch to approval-before-publication.
 */
async function _getAdminProductsAction(options: {
    status?: string;
    limitCount?: number;
    lastId?: string;
} = {}): Promise<ActionResponse<{ products: any[]; lastId?: string; hasMore: boolean; stats: Record<string, number> }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;
        // A READ, so isAdmin is the right gate here: every admin role holds
        // "users:read" and seeing the moderation queue is not acting on it.
        // Narrowing this to content:approve would blind marketplace_admin to
        // its own backlog. The gate that needed tightening is the write —
        // _reviewProductAction below.
        if (!session?.user || !isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const limitCount = Math.min(Math.max(Number(options.limitCount) || 25, 1), 100);
        const status = normaliseProductStatus(options.status);

        const col = db.collection(COLLECTIONS.PRODUCTS);

        // Counts per status, so the page can show the backlog it is clearing.
        // Server-side COUNT, not a length of a capped page — the mistake #37 and
        // the WAVE admin list both made.
        const countable = ["pending", "active", "rejected", "suspended", "draft"] as const;
        const counts = await Promise.all(
            countable.map((s) => col.where("status", "==", s).count().get()),
        );
        const stats: Record<string, number> = {};
        countable.forEach((s, i) => { stats[s] = counts[i].data().count; });

        let query: import("@/lib/supabase-db").SupabaseQuery = status
            ? (col.where("status", "==", status) as any)
            : (col as any);
        query = query.orderBy("createdAt", "desc");

        if (options.lastId) {
            const lastDoc = await col.doc(options.lastId).get();
            if (lastDoc.exists) query = query.startAfter(lastDoc);
        }

        const snapshot = await query.limit(limitCount + 1).get();
        const hasMore = snapshot.docs.length > limitCount;
        const docs = hasMore ? snapshot.docs.slice(0, limitCount) : snapshot.docs;

        return {
            success: true as const,
            error: null,
            data: {
                products: serializeDocs(docs),
                lastId: docs.length > 0 ? docs[docs.length - 1].id : undefined,
                hasMore,
                stats,
            },
        };
    } catch (error: any) {
        logger.error("Get admin products error:", error);
        return { success: false as const, error: "Failed to fetch products", data: null };
    }
}

export const getAdminProductsAction = withFlexibleSafeAction("getAdminProductsAction", _getAdminProductsAction);

/**
 * Admin: publish, reject or suspend a product listing.
 *
 * ON THE PRIMITIVE
 * ----------------
 * claimStatusTransitionFromAny, not a read-then-write and not runTransaction.
 * supabaseDb.runTransaction takes no lock (see the note at the top of
 * lib/types/marketplace-escrow.ts), so a status check inside it is an ordinary
 * read and two admins acting at once would both proceed. The claim advances the
 * status only if it still holds one of the expected values, and tells the caller
 * whether it was the one that changed it — so exactly one admin's decision, and
 * one audit row, results from a double-click or two moderators on the same
 * queue.
 *
 * `products` is not in DEDICATED_TABLE_MAP, so it lives in
 * document_collections and claim_status_transition can reach it. That is worth
 * stating because #15 was exactly the opposite case.
 */
async function _reviewProductAction(input: {
    productId: string;
    action: "approve" | "reject" | "suspend";
    reason?: string;
}): Promise<ActionResponse<{ status: string }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;
        // content:approve — putting a product live, refusing it or suspending
        // it is content moderation, which the matrix grants to super_admin,
        // admin and moderator. isAdmin() is true for every admin role, so an
        // academy_admin or an export_admin could publish a marketplace product.
        if (!session?.user || !hasAdminPermission(session.user.roles, "content:approve")) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const productId = String(input?.productId ?? "").trim();
        if (!productId) {
            return { success: false as const, error: "A product id is required", data: null };
        }
        if (!["approve", "reject", "suspend"].includes(input?.action)) {
            return { success: false as const, error: "Unknown review action", data: null };
        }

        // A rejection or suspension that does not say why leaves the seller with
        // an unexplained dead listing and nothing to fix.
        const reason = String(input.reason ?? "").trim();
        if (input.action !== "approve" && reason.length < 5) {
            return {
                success: false as const,
                error: "Please give a reason of at least 5 characters, so the seller knows what to change",
                data: null,
            };
        }

        const to = input.action === "approve" ? "active" : input.action === "reject" ? "rejected" : "suspended";
        const from = input.action === "approve" ? PRODUCT_APPROVABLE_FROM : PRODUCT_REJECTABLE_FROM;

        const claim = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.PRODUCTS,
            id: productId,
            fromAny: [...from],
            to,
            patch: {
                reviewedBy: session.user.id,
                reviewedAt: new Date().toISOString(),
                ...(input.action === "approve"
                    ? { rejectionReason: null }
                    : { rejectionReason: reason }),
            },
        });

        if (!claim.claimed) {
            if (claim.status === null) {
                return {
                    success: false as const,
                    error: claim.exists === false
                        ? "Product not found"
                        : "This product has no status recorded, so it cannot be reviewed.",
                    data: null,
                };
            }
            return {
                success: false as const,
                error: `This product is '${claim.status}' and cannot be ${input.action}d from that state.`,
                data: null,
            };
        }

        await createAdminAuditLog({
            action: input.action === "approve"
                ? "product_approved"
                : input.action === "reject"
                    ? "product_rejected"
                    : "product_suspended",
            userId: session.user.id,
            targetId: productId,
            targetType: "product",
            metadata: { decision: input.action, from: claim.status, to, reason: reason || null },
        });

        revalidatePath("/admin/marketplace/products");
        revalidatePath("/marketplace/buyer/products");
        revalidatePath(`/marketplace/products/${productId}`);

        return { success: true as const, error: null, data: { status: to } };
    } catch (error: any) {
        logger.error("Review product error:", error);
        return { success: false as const, error: "Failed to review product", data: null };
    }
}

export const reviewProductAction = withFlexibleSafeAction("reviewProductAction", _reviewProductAction);
