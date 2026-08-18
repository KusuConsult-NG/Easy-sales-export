"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin, hasAdminPermission } from "@/lib/admin-permissions";
import { serializeDocs } from "@/lib/firestore-serialize";
import { FieldValue } from "@/lib/firestore-compat";
import { FieldPath } from "@/lib/firestore-compat";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { createAdminAuditLog } from "@/lib/audit-log";
import {
    AWAITING_REVIEW_STATUSES,
    PURCHASABLE_STATUSES,
    isPurchasable,
} from "@/lib/land-listing-status";

/**
 * Get aggregate counts for land_listings by verification status.
 */
async function _getFarmNationVerificationStatsAction(): Promise<ActionResponse<{ stats: { total: number; pending: number; verified: number; rejected: number; } }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized: Permission required", data: null };
        }

        const { getCached, setCache } = await import("@/lib/redis");
        const cacheKey = "admin:farm-nation-verification-stats";

        try {
            const cached = await getCached<any>(cacheKey);
            if (cached) return cached;
        } catch (e) {
            // Redis error should not block the action
        }

        const [totalSnap, pendingSnap, verifiedSnap, rejectedSnap] = await Promise.all([
            db.collection(COLLECTIONS.LAND_LISTINGS).count().get(),
            // The shared sets. `verified` alone omitted the `available` that
            // farm-nation's creation path writes and the `approved` that
            // land-visibility.ts publishes, so this panel counted fewer
            // verified listings than were actually on sale.
            db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "in", [...AWAITING_REVIEW_STATUSES]).count().get(),
            db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "in", [...PURCHASABLE_STATUSES]).count().get(),
            db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "rejected").count().get(),
        ]);

        const stats = {
            total: totalSnap.data().count,
            pending: pendingSnap.data().count,
            verified: verifiedSnap.data().count,
            rejected: rejectedSnap.data().count
        };

        const response: ActionResponse<{ stats: { total: number; pending: number; verified: number; rejected: number; } }> = {
            success: true,
            error: null,
            data: { stats }
        };

        try {
            await setCache(cacheKey, response, 60);
        } catch (e) {
            // Redis error should not block the action
        }

        return response;
    } catch (error: any) {
        logger.error("getFarmNationVerificationStatsAction error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, error: "Failed to fetch stats", data: null };
    }
}

export const getFarmNationVerificationStatsAction = withFlexibleSafeAction("getFarmNationVerificationStatsAction", _getFarmNationVerificationStatsAction);


/**
 * The statuses behind each tab of the admin land verification queue.
 *
 * One definition for the database filter, the index-error fallback and the
 * in-memory filter used when a search is active — three places that each
 * resolved the tab label independently, and did not agree.
 */
function statusesForTab(tab: string): string[] {
    if (tab === "pending") return [...AWAITING_REVIEW_STATUSES];
    if (tab === "verified") return [...PURCHASABLE_STATUSES];
    if (tab === "rejected") return ["rejected"];
    // An unrecognised tab is passed through as itself rather than silently
    // widened, so a new tab shows nothing instead of showing everything.
    return [tab];
}

/**
 * Get land listings for admin verification
 */
async function _getAdminLandVerificationsAction(options: { 
    limit?: number;
    search?: string;
    status?: string;
    lastDocId?: string;
    sortOrder?: "asc" | "desc"; 
} = {}): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized: Permission required", data: null };
        }

        const useMemoryPagination = !!options.search;
        const fetchLimit = useMemoryPagination ? 5000 : (options.limit || 50);
        const orderDirection = options.sortOrder || "desc";
        let queryRef: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.LAND_LISTINGS).orderBy("createdAt", orderDirection);

        if (options.status && options.status !== "all" && !useMemoryPagination) {
            // Each tab maps to a SET of statuses. "verified" resolved to the
            // single literal "verified", so the verified tab omitted every
            // listing farm-nation created as `available` and every one an admin
            // marked `approved` — the same listings the stats above now count,
            // which meant the badge and the list it labelled disagreed.
            const tabStatuses = statusesForTab(options.status);
            queryRef = db.collection(COLLECTIONS.LAND_LISTINGS)
                .where("status", "in", tabStatuses)
                .orderBy("createdAt", orderDirection);
        }

        if (options.lastDocId && !useMemoryPagination) {
            const lastDoc = await db.collection(COLLECTIONS.LAND_LISTINGS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                queryRef = queryRef.startAfter(lastDoc);
            }
        }

        let snapshot;
        let indexError = false;
        try {
            snapshot = await queryRef.limit(fetchLimit).get();
        } catch (e: any) {
            if (e.message?.includes("FAILED_PRECONDITION") || e.code === 9 || e.message?.toLowerCase()?.includes("index")) {
                logger.warn("getAdminLandVerificationsAction query failed (missing index). Falling back to memory sorting.");
                indexError = true;
                
                let fallbackQuery: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.LAND_LISTINGS);
                if (options.status && options.status !== "all" && !useMemoryPagination) {
                    fallbackQuery = fallbackQuery.where("status", "in", statusesForTab(options.status));
                }
                
                if (options.lastDocId && !useMemoryPagination) {
                    const lastDoc = await db.collection(COLLECTIONS.LAND_LISTINGS).doc(options.lastDocId).get();
                    if (lastDoc.exists) {
                        fallbackQuery = fallbackQuery.startAfter(lastDoc);
                    }
                }
                
                snapshot = await fallbackQuery.limit(fetchLimit).get();
            } else {
                throw e;
            }
        }

        const rawVerifications = serializeDocs(snapshot.docs).map((doc: any) => {
            /**
             * What the admin queue calls each listing.
             *
             * THE DEFAULT WAS THE DEFECT
             * --------------------------
             * This started at "pending" and only moved off it for `verified`,
             * `rejected`, `pending_verification` and `inspection_scheduled`. Every
             * other status fell through to "pending" — including
             *
             *   available, approved   already for sale
             *   sold, leased          done
             *   pending_escrow,       a buyer's money is held against the parcel
             *   pending_payment,
             *   payment_confirmed,
             *   pending_transfer
             *   deleted               the owner withdrew it
             *
             * and the page renders Approve and Reject buttons on anything it is
             * told is "pending" (land-verification/page.tsx:475). So an admin
             * working this queue was shown sold parcels and parcels with live
             * escrows as awaiting review, and invited to decide on them. The
             * cohort counts below inherited the same default, inflating "pending"
             * by every listing in the collection that was not in one of the four
             * recognised states.
             *
             * The status guards added to the decision paths now refuse those
             * writes, so the button no longer succeeds — but it should not be
             * offered. Unrecognised is reported as "unavailable", not "pending".
             */
            let mappedVerificationStatus: string;
            if (isPurchasable(doc.status)) mappedVerificationStatus = "verified";
            else if (doc.status === "rejected") mappedVerificationStatus = "rejected";
            else if (AWAITING_REVIEW_STATUSES.includes(doc.status)) mappedVerificationStatus = "pending";
            else mappedVerificationStatus = "unavailable";


            let docsObj = { landTitle: "", surveyPlan: "", taxClearance: "" };
            if (doc.documents) {
                if (Array.isArray(doc.documents)) {
                    const landTitle = doc.documents.find((url: string) => url && (url.includes("_title_") || url.includes("title"))) || doc.documents[0] || "";
                    const surveyPlan = doc.documents.find((url: string) => url && (url.includes("_survey_") || url.includes("survey"))) || doc.documents[1] || "";
                    const taxClearance = doc.documents.find((url: string) => url && (url.includes("_tax_") || url.includes("tax"))) || doc.documents[2] || undefined;
                    docsObj = { landTitle, surveyPlan, taxClearance };
                } else if (typeof doc.documents === "object") {
                    docsObj = {
                        landTitle: doc.documents.landTitle || "",
                        surveyPlan: doc.documents.surveyPlan || "",
                        taxClearance: doc.documents.taxClearance || undefined
                    };
                }
            }

            return {
                ...doc,
                totalPrice: doc.totalPrice ?? doc.price ?? 0,
                price: doc.price ?? doc.totalPrice ?? 0,
                verificationStatus: mappedVerificationStatus,
                documents: docsObj,
                createdAt: doc.createdAt || new Date().toISOString(),
                verifiedAt: doc.verificationStatus?.verifiedAt || doc.verifiedAt || undefined
            };
        }) as any[];

        if (indexError) {
            rawVerifications.sort((a, b) => {
                const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return orderDirection === "desc" ? bTime - aTime : aTime - bTime;
            });
        }

        let filteredVerifications = rawVerifications;
        if (options.search) {
            const q = options.search.toLowerCase().trim();
            filteredVerifications = filteredVerifications.filter((v: any) => {
                const searchString = [
                    v.ownerName, v.name, v.state, v.lga, v.size, v.pricePerUnit
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(q);
            });
        }

        // Calculate dynamic cohort stats
        let stats: any = null;
        if (useMemoryPagination) {
            const total = filteredVerifications.length;
            const pending = filteredVerifications.filter((v: any) => v.verificationStatus === "pending").length;
            const verified = filteredVerifications.filter((v: any) => v.verificationStatus === "verified").length;
            const rejected = filteredVerifications.filter((v: any) => v.verificationStatus === "rejected").length;
            stats = { total, pending, verified, rejected };

            // Apply status filter in memory
            if (options.status && options.status !== "all") {
                // The same sets as the database filter above, so searching within
                // a tab returns the same cohort the tab itself does.
                const tabStatuses = statusesForTab(options.status);
                filteredVerifications = filteredVerifications.filter(
                    (v: any) => tabStatuses.includes(String(v.status))
                );
            }
        } else {
            const [totalSnap, pendingSnap, verifiedSnap, rejectedSnap] = await Promise.all([
                db.collection(COLLECTIONS.LAND_LISTINGS).count().get(),
                db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "in", [...AWAITING_REVIEW_STATUSES]).count().get(),
                db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "in", [...PURCHASABLE_STATUSES]).count().get(),
                db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "rejected").count().get(),
            ]);
            stats = {
                total: totalSnap.data().count,
                pending: pendingSnap.data().count,
                verified: verifiedSnap.data().count,
                rejected: rejectedSnap.data().count
            };
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
        const paged = useMemoryPagination ? filteredVerifications.slice(offset, offset + limit) : filteredVerifications;
        const _hasMore = useMemoryPagination 
            ? (offset + limit < filteredVerifications.length)
            : (snapshot.docs.length === fetchLimit);

        const _nextCursor = useMemoryPagination 
            ? (_hasMore ? String(page + 1) : undefined)
            : (snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined);

        // HYDRATION: Batch-resolve owner bank details for active page slice only
        const ownerIds = [...new Set(paged.map((v: any) => v.ownerId).filter(Boolean))];
        const ownerMap: Record<string, any> = {};

        if (ownerIds.length > 0) {
            const chunks = [];
            for (let i = 0; i < ownerIds.length; i += 30) {
                chunks.push(ownerIds.slice(i, i + 30));
            }

            const ownerSnapsArray = await Promise.all(
                chunks.map(chunk => 
                    db.collection(COLLECTIONS.USERS)
                        .where(FieldPath.documentId(), "in", chunk)
                        .get()
                )
            );

            ownerSnapsArray.forEach(snap => {
                snap.forEach(doc => {
                    const data = doc.data();
                    ownerMap[doc.id] = {
                        name: data.name || data.fullName || "Unknown",
                        email: data.email || "",
                        phone: data.phone || data.phoneNumber || data.kyc?.phoneNumber || data.kyc?.phone || "",
                        bankDetails: data.bankDetails || {
                            bankName: data.bankName || data.bankAccount?.bankName || "N/A",
                            accountNumber: data.bankAccountNumber || data.bankAccount?.accountNumber || "N/A",
                            accountName: data.bankAccountName || data.bankAccount?.accountName || data.fullName || (data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : "N/A"),
                            bankCode: data.bankCode || data.bankAccount?.bankCode || "N/A"
                        }
                    };
                });
            });
        }

        const verifications = paged.map((v: any) => ({
            ...v,
            owner: ownerMap[v.ownerId] || null,
            bankDetails: ownerMap[v.ownerId]?.bankDetails || {
                bankName: "N/A",
                accountNumber: "N/A",
                accountName: "N/A",
                bankCode: "N/A"
            }
        }));

        return { 
            success: true, 
            error: null, 
            data: verifications, 
            meta: {
                lastDocId: _nextCursor || null, 
                hasMore: _hasMore,
                stats
            }
        };
    } catch (error: any) {
        logger.error("Get admin land verifications error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, error: "Failed to fetch verifications", data: null };
    }
}


export const getAdminLandVerificationsAction = withFlexibleSafeAction("getAdminLandVerificationsAction", _getAdminLandVerificationsAction);


/**
 * Update Land Listing Details (Admin only)
 */
async function _updateAdminLandListingAction(data: {
    listingId: string;
    title: string;
    category: string;
    state: string;
    lga: string;
    address?: string;
    size: number;
    price: number;
    gpsCoordinates?: { latitude: number; longitude: number };
}): Promise<ActionResponse<null>> {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;
    
    if (!hasAdminPermission(session.user.roles, "land:verify_listings")) {
        return { success: false, error: "Unauthorized: Admin access required", data: null };
    }

    try {
        const docRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(data.listingId);
        const doc = await docRef.get();
        if (!doc.exists) {
            return { success: false, error: "Land listing not found", data: null };
        }

        const updateData: any = {
            title: data.title,
            category: data.category,
            location: {
                state: data.state,
                lga: data.lga,
                address: data.address || doc.data()?.location?.address || ""
            },
            size: Number(data.size),
            price: Number(data.price),
            updatedAt: FieldValue.serverTimestamp()
        };

        if (data.gpsCoordinates) {
            updateData.gpsCoordinates = {
                latitude: Number(data.gpsCoordinates.latitude),
                longitude: Number(data.gpsCoordinates.longitude)
            };
        }

        await docRef.update(updateData);

        // Create audit log
        await createAdminAuditLog({
            action: "land_updated",
            userId: session.user.id,
            userEmail: session.user.email || "",
            targetId: data.listingId,
            targetType: "land_listing",
            metadata: {
                title: data.title,
                size: data.size,
                price: data.price,
                reason: "Admin corrected details"
            }
        });

        return { success: true, error: null, data: null };
    } catch (e: any) {
        logger.error("updateAdminLandListingAction error:", e);
        return { success: false, error: e.message || "Failed to update land listing details", data: null };
    }
}

export const updateAdminLandListingAction = withFlexibleSafeAction("updateAdminLandListingAction", _updateAdminLandListingAction);
