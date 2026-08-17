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
import { serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { normalizeAggressive } from "@/lib/canonical/normalizer";
import { hasAdminPermission, isAdmin } from "@/lib/admin-permissions";
import { safeToISOString } from "@/lib/date-utils";

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

            // Sort the final forms in memory
            const dir = sortOrder || "desc";
            finalForms.sort((a, b) => {
                const dateA = new Date(a.data?.createdAt?.toDate ? a.data.createdAt.toDate().toISOString() : a.data?.createdAt || 0).getTime();
                const dateB = new Date(b.data?.createdAt?.toDate ? b.data.createdAt.toDate().toISOString() : b.data?.createdAt || 0).getTime();
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

        const fetchLimit = options.search ? 5000 : (options.limit || 50);
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
            meta: { stats }
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
