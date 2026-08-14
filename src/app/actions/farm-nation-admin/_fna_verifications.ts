"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";
import { serializeDocs } from "@/lib/firestore-serialize";
import { FieldValue } from "@/lib/firestore-compat";
import { FieldPath } from "@/lib/firestore-compat";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { createAdminAuditLog } from "@/lib/audit-log";

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

        const [totalSnap, pendingSnap1, pendingSnap2, verifiedSnap, rejectedSnap] = await Promise.all([
            db.collection(COLLECTIONS.LAND_LISTINGS).count().get(),
            db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "pending_verification").count().get(),
            db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "inspection_scheduled").count().get(),
            db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "verified").count().get(),
            db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "rejected").count().get(),
        ]);

        const stats = {
            total: totalSnap.data().count,
            pending: pendingSnap1.data().count + pendingSnap2.data().count,
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
            const mappedStatus = options.status === "pending" ? "pending_verification" : options.status;
            if (mappedStatus === "pending_verification") {
                queryRef = db.collection(COLLECTIONS.LAND_LISTINGS)
                    .where("status", "in", ["pending_verification", "inspection_scheduled"])
                    .orderBy("createdAt", orderDirection);
            } else {
                queryRef = db.collection(COLLECTIONS.LAND_LISTINGS)
                    .where("status", "==", mappedStatus)
                    .orderBy("createdAt", orderDirection);
            }
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
                    const mappedStatus = options.status === "pending" ? "pending_verification" : options.status;
                    if (mappedStatus === "pending_verification") {
                        fallbackQuery = fallbackQuery.where("status", "in", ["pending_verification", "inspection_scheduled"]);
                    } else {
                        fallbackQuery = fallbackQuery.where("status", "==", mappedStatus);
                    }
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
            let mappedVerificationStatus = "pending";
            if (doc.status === "verified") mappedVerificationStatus = "verified";
            else if (doc.status === "rejected") mappedVerificationStatus = "rejected";
            else if (doc.status === "pending_verification" || doc.status === "inspection_scheduled") mappedVerificationStatus = "pending";
            
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
                const mappedStatus = options.status === "pending" ? "pending_verification" : options.status;
                filteredVerifications = filteredVerifications.filter((v: any) => {
                    if (mappedStatus === "pending_verification") {
                        return v.status === "pending_verification" || v.status === "inspection_scheduled";
                    }
                    return v.status === mappedStatus;
                });
            }
        } else {
            const [totalSnap, pendingSnap1, pendingSnap2, verifiedSnap, rejectedSnap] = await Promise.all([
                db.collection(COLLECTIONS.LAND_LISTINGS).count().get(),
                db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "pending_verification").count().get(),
                db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "inspection_scheduled").count().get(),
                db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "verified").count().get(),
                db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "rejected").count().get(),
            ]);
            stats = {
                total: totalSnap.data().count,
                pending: pendingSnap1.data().count + pendingSnap2.data().count,
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
    
    if (!isAdmin(session.user.roles)) {
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
