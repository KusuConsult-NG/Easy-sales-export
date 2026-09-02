"use server";

import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";
import { ZodError } from "zod";
import { withFlexibleSafeAction, ActionResponse, type ActionState } from "@/lib/safe-action";
import { revalidatePath, updateTag } from 'next/cache';
import { invalidateAdminGlobalStats, invalidateServiceCache } from "@/lib/cache-invalidation";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { FieldPath } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createAdminAuditLog } from "@/lib/audit-log";
import { serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { ExportOnboardingReviewSchema } from "@/lib/schemas";
import { hasAdminPermission, isAdmin } from "@/lib/admin-permissions";
import { stripPii } from "@/lib/admin-pii";
import { atomicUpdateUser } from "@/lib/services/userService";
import { recordAdminAction } from "@/lib/audit-log";
import { canSendEmail } from "@/lib/email-notifications";

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
        let appDocRef: any;
        let appData: any;

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
            await invalidateAdminGlobalStats();
            logger.info(`[Export Approval] Cache cleared for user: ${userId} and global stats invalidated`);
        } catch (cacheError) {
            logger.error('[Export Approval] Cache clear error:', cacheError);
        }

        // 4. Send Approval Email
        if (canSendEmail("export decision email", appData.userEmail)) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);

                const { error } = await resend.emails.send({
                    from: process.env.EMAIL_FROM || "Easy Sales Export <info@easysalesexport.com>",
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
        updateTag(`user-status-${userId}`);

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
        // #265 export_admin holds export:approve_applications and was refused
        // here, while _approveExportOnboardingAction above already accepts it.
        // Approving and asking for a revision are the same job.
        if (!hasAdminPermission(session?.user?.roles, "users:update")
            && !hasAdminPermission(session?.user?.roles, "export:approve_applications")) {
            return { error: "Unauthorized: export:approve_applications required", success: false as const };
        }

        if (!revisionNote?.trim()) {
            return { error: "Revision note is required", success: false as const };
        }

        // Find the application — may be passed either as the Firestore doc ID or applicationId field
        let appDocRef: any;
        let appData: any;

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
        if (canSendEmail("export decision email", appData.userEmail)) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);
                await resend.emails.send({
                    from: process.env.EMAIL_FROM || "Easy Sales Export <info@easysalesexport.com>",
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

        // Clear cache
        try {
            await invalidateAdminGlobalStats();
        } catch (cacheError) {
            logger.error('[Export Revision Cache] Cache clear error:', cacheError);
        }

        await recordAdminAction({
            action: 'export_status_update',
            userId: session.user.id,
            targetId: applicationId,
            targetType: 'export_application',
            metadata: { revisionNote },
        });
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
    sortBy?: "createdAt" | "gender";
    sortOrder?: "asc" | "desc";
} = {}): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Not authenticated", data: null };

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized", data: null };

        }

        /**
         *   #338 THE STRIP WRITTEN FOR RAW-DOCUMENT SPREADS WAS NOT APPLIED
         *        HERE EITHER.
         *
         *        Both branches below emit `data: { ...mergedData, bankDetails }`
         *        — the whole EXPORT_APPLICATIONS document merged with the user
         *        document — and it is rendered field by field by
         *        DynamicDetailModal, whose exclude list covers bvnVerified and
         *        bvnStatus but not `bvn` itself.
         *
         *        The gate above is isAdmin(), true for all TEN admin roles.
         *        lib/admin-pii.ts exists for exactly this ("This is the strip
         *        for those spreads") and was applied to three sites; this was
         *        not one of them. Gated on the permission the screen exists to
         *        exercise, as _withdrawals.ts and _marketplace.ts do.
         */
        const maySeeApplicantPii = hasAdminPermission(session.user.roles, "export:approve_applications");

        const useMemoryPagination = options.sortBy === "gender" || !!options.search || !!options.dateFrom || !!options.dateTo;
        const fetchLimit = useMemoryPagination ? 5000 : (options.limit || 50);

        let q: any = db.collection(COLLECTIONS.EXPORT_APPLICATIONS);
        
        // Skip status filter if using memory pagination
        if (!useMemoryPagination) {
            if (options.status && options.status !== "all") {
                if (options.status === "pending") {
                    q = q.where("status", "in", ["pending", "pending_review"]);
                } else {
                    q = q.where("status", "==", options.status);
                }
            }
        }
        
        // Server-side date range filter (if not using memory pagination)
        if (options.dateFrom && !useMemoryPagination) {
            const fromTs = dateRangeStart(options.dateFrom);
            q = q.where("createdAt", ">=", fromTs);
        }
        if (options.dateTo && !useMemoryPagination) {
            const toTs = dateRangeEnd(options.dateTo);
            q = q.where("createdAt", "<=", toTs);
        }

        q = q.orderBy("createdAt", "desc").limit(fetchLimit + 1);

        if (options.lastDocId && !useMemoryPagination) {
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

        // Perform in-memory filtering & cohort calculations
        let stats: any = null;
        if (useMemoryPagination) {
            // Apply in-memory search
            if (options.search) {
                const s = options.search.toLowerCase().trim();
                const { searchUserIdsByQuery } = await import("@/lib/admin-search-helper");
                const matchingUserIds = await searchUserIdsByQuery(options.search);
                const matchingUserIdsSet = new Set(matchingUserIds);
                applications = applications.filter((app: any) => {
                    const profile = (app.profile || {}) as any;
                    const kyc = (app.kyc?.kycData || {}) as any;
                    const searchString = [
                        app.id,
                        app.userId,
                        app.userEmail,
                        profile.fullName,
                        profile.phone,
                        kyc.firstName,
                        kyc.lastName,
                        kyc.phone
                    ].filter(Boolean).map(String).join(" ").toLowerCase();
                    return searchString.includes(s) || matchingUserIdsSet.has(app.userId as string);
                });
            }

            // Apply date filters in memory
            if (options.dateFrom) {
                const from = dateRangeStart(options.dateFrom);
                applications = applications.filter((app: any) => {
                    const d = app.createdAt?.seconds ? new Date(app.createdAt.seconds * 1000) : new Date(app.createdAt as any);
                    return d >= from;
                });
            }
            if (options.dateTo) {
                const to = dateRangeEnd(options.dateTo);
                applications = applications.filter((app: any) => {
                    const d = app.createdAt?.seconds ? new Date(app.createdAt.seconds * 1000) : new Date(app.createdAt as any);
                    return d <= to;
                });
            }

            // Compute cohort counts before status filtering
            const pending = applications.filter((app: any) => app.status === "pending" || app.status === "pending_review").length;
            const approved = applications.filter((app: any) => app.status === "approved").length;
            const rejected = applications.filter((app: any) => app.status === "rejected").length;
            const resubmitted = applications.filter((app: any) => app.resubmittedAt !== undefined && app.resubmittedAt !== null).length;
            stats = { pending, approved, rejected, resubmitted };

            // Apply status filter
            if (options.status && options.status !== "all") {
                if (options.status === "pending") {
                    applications = applications.filter((app: any) => app.status === "pending" || app.status === "pending_review");
                } else {
                    applications = applications.filter((app: any) => app.status === options.status);
                }
            }
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

        let standardForms: any[] = [];
        if (options.sortBy === "gender") {
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

            const mapped = applications.map((app: any) => {
                const uData = (userMap.get(app.userId as string) || {}) as any;
                const kyc = (app.kyc || {}) as any;
                const profile = (app.profile || {}) as any;
                const kycName = kyc?.kycData?.firstName ? `${kyc.kycData.firstName} ${kyc.kycData.lastName || ''}`.trim() : null;
                const userName = uData.name || uData.firstName ? `${uData.firstName} ${uData.lastName || ''}`.trim() : (profile?.fullName || kycName || "Unknown User");
                
                let status = app.status || "pending";
                if (status === "pending_review") status = "pending";

                const mergedData = {
                    ...app,
                    phone:              app.phone              || profile?.phone              || uData.phone       || uData.phoneNumber || uData.kyc?.phoneNumber || uData.kyc?.phone || null,
                    gender:             app.gender             || profile?.gender             || uData.gender      || null,
                    dateOfBirth:        app.dateOfBirth        || profile?.dateOfBirth        || uData.dob         || null,
                    occupation:         app.occupation         || profile?.occupation         || uData.occupation  || null,
                    stateOfOrigin:      app.stateOfOrigin      || app.state || profile?.state || profile?.stateOfOrigin || app.companyInfo?.state || (typeof uData.address === 'object' ? uData.address?.state : uData.state) || uData.stateOfOrigin || uData.state || null,
                    lga:                app.lga                || profile?.lga                || app.companyInfo?.lga   || (typeof uData.address === 'object' ? uData.address?.lga   : uData.lga)   || uData.lga || null,
                    residentialAddress: app.residentialAddress || profile?.residentialAddress || (typeof uData.address === 'object' ? uData.address?.street : uData.address)        || null,
                    firstName:          profile?.firstName      || app.firstName              || uData.firstName   || null,
                    lastName:           profile?.lastName       || app.lastName               || uData.lastName    || null,
                    email:              app.userEmail           || app.email                  || uData.email        || null,
                };

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
                        gender: mergedData.gender || "Unknown",
                        bankDetails
                    },
                    status: status,
                    data: maySeeApplicantPii
                        ? { ...mergedData, bankDetails }
                        : stripPii({ ...mergedData, bankDetails })
                };
            });

            // Sort by gender
            const order = options.sortOrder || "desc";
            mapped.sort((a, b) => {
                const ga = (a.user?.gender || "").toLowerCase();
                const gb = (b.user?.gender || "").toLowerCase();
                return order === "asc" ? ga.localeCompare(gb) : gb.localeCompare(ga);
            });

            standardForms = mapped.slice(offset, offset + limit);
        } else {
            const userIds = [...new Set(paged.map((app: any) => app.userId).filter(Boolean))];
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

            standardForms = paged.map((app: any) => {
                const uData = (userMap.get(app.userId as string) || {}) as any;
                const kyc = (app.kyc || {}) as any;
                const profile = (app.profile || {}) as any;
                const kycName = kyc?.kycData?.firstName ? `${kyc.kycData.firstName} ${kyc.kycData.lastName || ''}`.trim() : null;
                const userName = uData.name || uData.firstName ? `${uData.firstName} ${uData.lastName || ''}`.trim() : (profile?.fullName || kycName || "Unknown User");
                
                let status = app.status || "pending";
                if (status === "pending_review") status = "pending";

                const mergedData = {
                    ...app,
                    phone:              app.phone              || profile?.phone              || uData.phone       || uData.phoneNumber || uData.kyc?.phoneNumber || uData.kyc?.phone || null,
                    gender:             app.gender             || profile?.gender             || uData.gender      || null,
                    dateOfBirth:        app.dateOfBirth        || profile?.dateOfBirth        || uData.dob         || null,
                    occupation:         app.occupation         || profile?.occupation         || uData.occupation  || null,
                    stateOfOrigin:      app.stateOfOrigin      || app.state || profile?.state || profile?.stateOfOrigin || app.companyInfo?.state || (typeof uData.address === 'object' ? uData.address?.state : uData.state) || uData.stateOfOrigin || uData.state || null,
                    lga:                app.lga                || profile?.lga                || app.companyInfo?.lga   || (typeof uData.address === 'object' ? uData.address?.lga   : uData.lga)   || uData.lga || null,
                    residentialAddress: app.residentialAddress || profile?.residentialAddress || (typeof uData.address === 'object' ? uData.address?.street : uData.address)        || null,
                    firstName:          profile?.firstName      || app.firstName              || uData.firstName   || null,
                    lastName:           profile?.lastName       || app.lastName               || uData.lastName    || null,
                    email:              app.userEmail           || app.email                  || uData.email        || null,
                };

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
                        gender: mergedData.gender || "Unknown",
                        bankDetails
                    },
                    status: status,
                    data: maySeeApplicantPii
                        ? { ...mergedData, bankDetails }
                        : stripPii({ ...mergedData, bankDetails })
                };
            });
        }

        return { 
            error: null, success: true as const, 
            data: standardForms,
            lastDocId: _nextCursor,
            hasMore: _hasMore,
            meta: {
                totalFetched: useMemoryPagination ? applications.length : standardForms.length,
                hasMore: _hasMore,
                stats
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
        // #265 As above: the export admin could approve an application and
        // could not reject one.
        if (!hasAdminPermission(session?.user?.roles, "users:update")
            && !hasAdminPermission(session?.user?.roles, "export:approve_applications")) {
            return { error: "Unauthorized: export:approve_applications required", success: false as const };
        }

        const valid = ExportOnboardingReviewSchema.safeParse({ applicationId, status: "rejected", reason });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false as const };
        }

        // 1. Get Application Doc — may be passed either as the Firestore doc ID or applicationId field
        let appDocRef: any;
        let appData: any;

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
            await invalidateAdminGlobalStats();
            logger.info(`[Export Rejection] Cache cleared for user: ${userId} and global stats invalidated`);
        } catch (cacheError) {
            logger.error('[Export Rejection] Cache clear error:', cacheError);
        }

        // 4. Send Rejection Email
        if (canSendEmail("export decision email", appData.userEmail)) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);

                const { error } = await resend.emails.send({
                    from: process.env.EMAIL_FROM || "Easy Sales Export <info@easysalesexport.com>",
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
        updateTag(`user-status-${userId}`);

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

export const getAllExportRequestsAction = withFlexibleSafeAction("getAllExportRequestsAction", _getAllExportRequestsAction);

export const approveExportOnboardingAction = withFlexibleSafeAction("approveExportOnboardingAction", _approveExportOnboardingAction);

export const requestExportApplicationRevisionAction = withFlexibleSafeAction("requestExportApplicationRevisionAction", _requestExportApplicationRevisionAction);

export const getExportApplicationsStatsAction = withFlexibleSafeAction("getExportApplicationsStatsAction", _getExportApplicationsStatsAction);

export const getStandardExportApplicationsAction = withFlexibleSafeAction("getStandardExportApplicationsAction", _getStandardExportApplicationsAction);

export const rejectExportApplicationAction = withFlexibleSafeAction("rejectExportApplicationAction", _rejectExportApplicationAction);
