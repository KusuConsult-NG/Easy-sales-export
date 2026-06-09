/**
 * Admin Server Actions for Cooperative Management
 * Provides admin-level oversight and management capabilities
 */

"use server";
import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";
import { userMetricsService } from "@/services";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { normalizeUserUpdate } from "@/lib/schema-normalizer";
import { isAdmin } from "@/lib/admin-permissions";
import { FieldValue, FieldPath } from "firebase-admin/firestore";
import { logAuditAction } from "@/lib/audit-log";
import { serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { ActionResponse, withFlexibleSafeAction } from "@/lib/safe-action";
import { paginatedOk, paginatedErr, nextCursor as computeNextCursor, PaginatedAdminResponse } from "@/lib/admin-action-response";
import {
    sendWithdrawalApprovedEmail,
    sendWithdrawalRejectedEmail
} from "@/lib/email-notifications";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createAdminAuditLog } from "@/lib/audit-log";
import { Resend } from "resend";
import { revalidateTag } from "next/cache";
import { deleteCache, invalidateCooperativeCache, invalidateAdminGlobalStats } from "@/lib/cache-invalidation";
import { extractCanonicalUser } from "@/lib/canonical/normalizer";

// ============================================================================
// ============================================================================
// HELPER: Admin Scoping (IDOR Fix)
// ============================================================================

/**
 * Determines the scope of access for an admin.
 * Returns `cooperativeId` if scoped, or `null` if global (Platform Admin/Super Admin).
 */
async function getAdminScope(userId: string, userRoles: string[]): Promise<string | null> {
    // Super Admins see everything
    if (userRoles.includes("super_admin")) return null;

    // Check if admin is restricted to a cooperative
    // We assume admins with a 'cooperativeId' in their profile are scoped.
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    const data = userDoc.data();

    // If they have a cooperativeId, they are scoped
    if (data?.cooperativeId) {
        return data.cooperativeId;
    }

    // Platform Admins (role 'admin' but no coopId) see everything
    return null;
}

// ============================================================================
// ADMIN DASHBOARD STATS
// ============================================================================

async function _getCooperativeStatsAction(): Promise<ActionResponse<any>> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated", data: null };
        }

        let roles = session.user.roles;
        if (!isAdmin(roles)) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            if (isAdmin(liveRoles)) {
                roles = liveRoles;
            } else {
                return { success: false as const, error: "Unauthorized", data: null };
            }
        }

        const adminScope = await getAdminScope(session.user.id, roles);

        const { getCached, setCache } = await import("@/lib/redis");
        const cacheKey = adminScope ? `admin:coop-stats:${adminScope}` : "admin:coop-stats:global";

        try {
            const cached = await getCached<any>(cacheKey);
            if (cached) return cached;
        } catch (e) {}

        const [metrics, paymentsSnapR] = await Promise.allSettled([
            userMetricsService.getCooperativeMemberMetrics(adminScope || undefined),
            db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                .where("type", "==", "cooperative_membership_registration")
                .where("status", "==", "completed")
                .select("userId")
                .get()
        ]);

        const metricsData = metrics.status === "fulfilled" ? metrics.value : {
            totalApplications: 0,
            paidMembersCount: 0,
            unpaidMembers: 0,
            pendingCount: 0,
            approvedCount: 0,
            suspendedCount: 0,
            orphanedPaymentsCount: 0
        };

        const {
            totalApplications: totalMembersCount,
            paidMembersCount,
            unpaidMembers,
            pendingCount: pendingMembers,
            approvedCount: activeMembers,
            suspendedCount: suspendedMembers,
            orphanedPaymentsCount
        } = metricsData;


        let txnQuery: FirebaseFirestore.Query = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS);
        if (adminScope) {
            txnQuery = txnQuery.where("cooperativeId", "==", adminScope);
        }

        let totalTransactions = 0;
        let totalTransactionAmount = 0;
        let completedTransactions = 0;
        let pendingTransactions = 0;
        let failedTransactions = 0;

        let totalContributions = 0;
        let monthlyContributions = 0;
        let previousMonthContributions = 0;
        let totalSavings = 0;

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

        const txnStream = txnQuery.select("type", "status", "amount", "date").get();
        for (const doc of (await txnStream).docs) {
            const t = doc.data();
            totalTransactions++;
            const amount = Number(t.amount) || 0;
            totalTransactionAmount += amount;

            if (t.status === "completed") completedTransactions++;
            else if (t.status === "pending") pendingTransactions++;
            else if (t.status === "failed") failedTransactions++;

            if (t.status === "completed") {
                if (t.type === "fixed_savings") {
                    totalSavings += amount;
                } else if (t.type === "contribution" || t.type === "membership_registration") {
                    totalContributions += amount;
                    if (t.date) {
                        const date = t.date.toDate ? t.date.toDate() : new Date(t.date);
                        if (date >= thirtyDaysAgo) {
                            monthlyContributions += amount;
                        } else if (date >= sixtyDaysAgo && date < thirtyDaysAgo) {
                            previousMonthContributions += amount;
                        }
                    }
                }
            }
        }

        let loansQuery: FirebaseFirestore.Query = db.collection(COLLECTIONS.COOPERATIVE_LOANS).select("memberId", "amount", "status");
        if (adminScope) {
            loansQuery = loansQuery.where("cooperativeId", "==", adminScope);
        }
        const loansStream = await loansQuery.get();
        
        let totalLoans = 0;
        let activeLoans = 0;
        let pendingLoans = 0;

        for (const doc of loansStream.docs) {
            const l = doc.data();
            totalLoans += Number(l.amount) || 0;
            if (l.status === "disbursed" || l.status === "approved") {
                activeLoans++;
            } else if (l.status === "pending") {
                pendingLoans++;
            }
        }

        const monthlyGrowth =
            previousMonthContributions > 0
                ? ((monthlyContributions - previousMonthContributions) / previousMonthContributions) * 100
                : 0;

        const payload = {
            error: null, success: true as const,
            data: {
                stats: {
                    totalMembers: Math.max(totalMembersCount, paidMembersCount),
                    paidMembers: paidMembersCount,
                    unpaidMembers,
                    activeMembers,
                    pendingMembers,
                    suspendedMembers,
                    orphanedPaymentsCount,
                    totalContributions,
                    monthlyContributions,
                    totalLoans,
                    activeLoans,
                    pendingLoans,
                    totalSavings,
                    monthlyGrowth,
                    totalTransactions,
                    totalTransactionAmount,
                    completedTransactions,
                    pendingTransactions,
                    failedTransactions,
                }
            },
            meta: null
        };

        try {
            await setCache(cacheKey, payload, 120);
        } catch (e) {}

        return payload;
    } catch (error) {
        logger.error("Get cooperative stats error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch statistics", data: null };
    }
}
export const getCooperativeStatsAction = withFlexibleSafeAction("getCooperativeStatsAction", _getCooperativeStatsAction);

// ============================================================================
// MEMBER MANAGEMENT
// ============================================================================

async function _getAllMembersAction(options?: {
    status?: "all" | "active" | "pending" | "suspended" | string;
    limit?: number;
    search?: string;
}): Promise<ActionResponse<{ members: any[] }>> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        let roles = session.user.roles;
        if (!isAdmin(roles)) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            if (isAdmin(liveRoles)) {
                roles = liveRoles;
            } else {
                return { success: false as const, error: "Unauthorized", data: null };
            }
        }

        // Audit logging
        await createAdminAuditLog({
            userId: session.user.id,
            userEmail: session.user.email ?? "unknown",
            action: "FETCH_COOPERATIVE_MEMBERS",
            targetType: "COOPERATIVE_MEMBERS",
            details: JSON.stringify({ status: options?.status, limit: options?.limit })
        });

        const adminScope = await getAdminScope(session.user.id, roles);

        let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);

        if (adminScope) {
            q = q.where("cooperativeId", "==", adminScope);
        }

        if (options?.status && options.status !== "all") {
            if (options.status === "approved" || options.status === "active") {
                q = q.where("membershipStatus", "in", ["approved", "active"]);
            } else {
                q = q.where("membershipStatus", "==", options.status);
            }
        }

        const fetchLimit = options?.search ? 5000 : (options?.limit ? options.limit * 10 : 500);
        q = q.orderBy("createdAt", "desc").limit(fetchLimit);

        let snapshot;
        try {
            snapshot = await q.get();
        } catch (error: any) {
            if (error.code === 9 || error.message?.includes("FAILED_PRECONDITION")) {
                logger.error("Firestore Index Missing for Cooperative Members:", error.message);
                return { 
                    success: false, 
                    error: "Administrative index is currently being provisioned. Please try again in 5 minutes.", 
                    data: null 
                };
            }
            throw error;
        }

        const allMembersRaw = serializeDocs(snapshot.docs);

        // Filter: Show members who are active/approved OR have completed payment.
        // "approved" is the legacy status written by the approve-member API route before
        // the May 2026 fix that standardised it to "active". Both must be accepted to
        // avoid hiding the 166 members the admin already approved.
        const membersRaw = allMembersRaw.filter((m: any) =>
            m.membershipStatus === "active"   ||
            m.membershipStatus === "approved" ||
            m.paymentStatus    === "completed" ||
            m.registrationStatus === "completed"
        );

        // --- HYDRATION START ---
        const memberUserIds = [...new Set(membersRaw.map(m => m.userId || m.id).filter(Boolean))];
        const userMap = new Map<string, any>();
        
        if (memberUserIds.length > 0) {
            const userPromises = [];
            for (let i = 0; i < memberUserIds.length; i += 30) {
                const chunk = memberUserIds.slice(i, i + 30);
                if (chunk.length > 0) {
                    userPromises.push(db.collection(COLLECTIONS.USERS).where(FieldPath.documentId(), "in", chunk).get());
                }
            }
            const userSnapsArray = await Promise.all(userPromises);
            userSnapsArray.forEach(snap => snap.docs.forEach(d => userMap.set(d.id, serializeValue(d.data()))));
        }
        // --- HYDRATION END ---

        let members = membersRaw.map((m: any) => {
            const uData = userMap.get(m.userId || m.id) || {};
            const canonical = extractCanonicalUser(uData, m);

            return {
                ...m,
                user: {
                    id: m.userId || m.id,
                    name: canonical.name,
                    email: canonical.email,
                    phone: canonical.phone,
                    bankDetails: canonical.bankDetails
                }
            };
        });

        if (!options?.search && options?.limit) {
            members = members.slice(0, options.limit);
        }

        if (options?.search) {
            const s = options.search.toLowerCase().trim();
            members = members.filter((m: any) => {
                const searchString = [
                    m.id,
                    m.userId,
                    m.firstName,
                    m.lastName,
                    m.fullName,
                    m.email,
                    m.phone,
                    m.bankName,
                    m.accountNumber,
                    m.nin,
                    m.bvn,
                    m.user?.name,
                    m.user?.email
                ].filter(Boolean).join(" ").toLowerCase();
                return searchString.includes(s);
            });
        }

        return { error: null, success: true as const, data: { members }, meta: { hasMore: false, cursor: null } };
    } catch (error) {
        logger.error("Get all members error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch members", data: null };
    }
}
export const getAllMembersAction = withFlexibleSafeAction("getAllMembersAction", _getAllMembersAction);

async function _updateMemberStatusAction(
    memberId: string,
    status: "active" | "suspended"
): Promise<{ error: string | null, success: boolean; meta?: any; data?: any;  }> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated", data: null };
        }

        let roles = session.user.roles;
        if (!isAdmin(roles)) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            if (isAdmin(liveRoles)) {
                roles = liveRoles;
            } else {
                return { success: false as const, error: "Unauthorized", data: null };
            }
        }

        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(memberId);
        const memberDoc = await memberRef.get();
        if (!memberDoc.exists) {
            return { success: false as const, error: "Member not found", data: null };
        }
        
        const memberData = memberDoc.data()!;
        let targetUserId = memberData.userId;

        if (!targetUserId && memberData.email) {
            // Find user by email
            const userSnap = await db.collection(COLLECTIONS.USERS)
                .where("email", "==", memberData.email.toLowerCase())
                .limit(1)
                .get();
            if (!userSnap.empty) {
                targetUserId = userSnap.docs[0].id;
                // Heal the membership document by setting the userId
                await memberRef.update({ userId: targetUserId });
                logger.info(`[updateMemberStatus] Healed membership ${memberId} with userId ${targetUserId}`);
            }
        }

        if (!targetUserId) {
            targetUserId = memberId; // fallback
        }

        const emailData = await db.runTransaction(async (transaction) => {
            const mRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(memberId);
            const mDoc = await transaction.get(mRef);
            if (!mDoc.exists) throw new Error("Member not found");

            transaction.update(mRef, {
                membershipStatus: status,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1),
                userId: targetUserId,
            });

            let notificationInfo: { email: string; fullName: string } | null = null;

            if (status === "active") {
                const userRef = db.collection(COLLECTIONS.USERS).doc(targetUserId);
                const userDoc = await transaction.get(userRef);
                const userData = userDoc.data();
                if (userData?.email) {
                    notificationInfo = {
                        email: userData.email,
                        fullName: userData.fullName || 'Member'
                    };
                }

                transaction.update(userRef, normalizeUserUpdate({
                    isVerified: true,
                    roles: FieldValue.arrayUnion("cooperative_member"),
                    "serviceRegistrations.cooperatives.status": "active",
                    "serviceRegistrations.cooperatives.activatedAt": FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: FieldValue.increment(1),
                }));
            }
            return { notificationInfo, targetUserId };
        });

        const { notificationInfo } = emailData || {};

        if (status === "active" && notificationInfo && targetUserId) {
            // 4. Invalidate Caches (Kill the "State vs. Truth" bug)
            try {
                await invalidateCooperativeCache(targetUserId);
                const { invalidateUserCache } = await import('@/lib/cache-invalidation');
                await invalidateUserCache(targetUserId);
                await invalidateAdminGlobalStats();
                // Clear scoped coop stats
                const adminScope = await getAdminScope(session.user.id, session.user.roles);
                if (adminScope) {
                    await deleteCache(`admin:coop-stats:${adminScope}`);
                    await deleteCache(`admin:coop-reports:${adminScope}`);
                }
            } catch (cacheErr) {
                logger.error("Cache invalidation failed after member approval", cacheErr);
            }

            try {
                const resend = new Resend(process.env.RESEND_API_KEY);
                const { error } = await resend.emails.send({
                    from: 'Easy Sales Export <noreply@easysalesexport.com>',
                    to: notificationInfo.email,
                    subject: '✅ Your Cooperative Membership Has Been Approved!',
                    html: `
                        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                            <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:32px;border-radius:12px;text-align:center;margin-bottom:24px;">
                                <h1 style="color:white;margin:0;">Welcome to the Cooperative!</h1>
                            </div>
                            <h2 style="color:#7c3aed;">Membership Approved ✅</h2>
                            <p>Dear <strong>${notificationInfo.fullName}</strong>,</p>
                            <p>Congratulations! Your cooperative membership application has been <strong>approved</strong>. You now have full access to cooperative benefits including loans, fixed savings, and member forums.</p>
                            <div style="text-align:center;margin:24px 0;">
                                <a href="${process.env.NEXTAUTH_URL || 'https://easysalesexport.com'}/cooperatives/dashboard" style="background:#7c3aed;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">Go to Your Dashboard</a>
                            </div>
                            <p style="color:#6b7280;font-size:14px;">Easy Sales Export Cooperative Team</p>
                        </div>
                    `,
                });
                if (error) {
                    logger.error("Resend API Error (Cooperative approval email):", error);
                }
            } catch (emailError) {
                logger.error('Cooperative approval email failed (non-blocking):', emailError);
            }
        }
        return { error: null, success: true as const, data: null, meta: null };
    } catch (error) {
        logger.error("Update member status error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to update member status", data: null };
    }
}
export const updateMemberStatusAction = withFlexibleSafeAction("updateMemberStatusAction", _updateMemberStatusAction);

// ============================================================================
// TRANSACTION MONITORING
// ============================================================================

async function _getAllTransactionsAction(options?: {
    type?: "all" | "contribution" | "withdrawal" | "loan" | "fixed_savings" | "membership_registration";
    status?: "all" | "pending" | "completed" | "failed";
    limit?: number;
    lastDocId?: string;
    search?: string;   // Search by user name, userId, description, or reference
    dateFrom?: string; // YYYY-MM-DD
    dateTo?: string;   // YYYY-MM-DD
}): Promise<ActionResponse<{ transactions: any[] }>> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        let roles = session.user.roles;
        if (!isAdmin(roles)) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            if (isAdmin(liveRoles)) {
                roles = liveRoles;
            } else {
                return { success: false as const, error: "Unauthorized", data: null };
            }
        }

        // Audit logging
        await createAdminAuditLog({
            userId: session.user.id,
            userEmail: session.user.email ?? "unknown",
            action: "FETCH_COOPERATIVE_TRANSACTIONS",
            targetType: "COOPERATIVE_TRANSACTIONS",
            details: JSON.stringify({ type: options?.type, status: options?.status })
        });

        const adminScope = await getAdminScope(session.user.id, roles);

        let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS);

        if (adminScope) {
            q = q.where("cooperativeId", "==", adminScope);
        }

        if (options?.type && options.type !== "all") {
            q = q.where("type", "==", options.type);
        }

        if (options?.status && options.status !== "all") {
            q = q.where("status", "==", options.status);
        }

        // Date range filters — must be added BEFORE orderBy() for Firestore compliance.
        // Firestore requires all where() on a field to precede orderBy() on that field.
        if (options?.dateFrom) {
            q = q.where("date", ">=", dateRangeStart(options.dateFrom));
        }
        if (options?.dateTo) {
            q = q.where("date", "<=", dateRangeEnd(options.dateTo));
        }

        q = q.orderBy("date", "desc");

        const fetchLimit = (options?.search || options?.dateFrom || options?.dateTo) ? 5000 : (options?.limit || 100);
        let query = q;

        if (options?.lastDocId && !options?.search && !options?.dateFrom && !options?.dateTo) {
            const lastDoc = await db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        let snapshot;
        try {
            snapshot = await query.limit(fetchLimit + 1).get();
        } catch (error: any) {
            if (error.code === 9 || error.message?.includes("FAILED_PRECONDITION")) {
                logger.error("Firestore Index Missing for Cooperative Transactions:", error.message);
                return { 
                    success: false, 
                    error: "Administrative index is currently being provisioned. Please try again in 5 minutes.", 
                    data: null 
                };
            }
            throw error;
        }

        const hasMore = snapshot.docs.length > fetchLimit;
        const docs = hasMore ? snapshot.docs.slice(0, fetchLimit) : snapshot.docs;

        const rawDocs = docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        // HYDRATION: Batch-resolve user profiles and bank details
        const userIds = [...new Set(rawDocs.map((d: any) => d.userId).filter(id => id && typeof id === 'string' && id.trim().length > 0))];
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
                    const uData = doc.data();
                    userMap[doc.id] = extractCanonicalUser(uData);
                });
            });
        }

        const transactions = rawDocs.map((raw: any) => {
            const dateVal = raw.date?.toDate ? raw.date.toDate() : (raw.date ? new Date(raw.date) : new Date());
            const canonical = userMap[raw.userId] || null;
            
            return {
                id: raw.id,
                userId: raw.userId || "",
                userName: canonical?.name || raw.userId || "Unknown",
                user: canonical,
                bankDetails: canonical?.bankDetails || {
                    bankName: raw.bankName || "",
                    accountNumber: raw.accountNumber || "",
                    accountName: raw.accountName || "",
                    bankCode: raw.bankCode || ""
                },
                type: raw.type || "unknown",
                amount: Number(raw.amount) || 0,
                status: raw.status || "unknown",
                date: dateVal.toISOString(),
                description: raw.description || raw.notes || raw.purpose || undefined,
                reference: raw.reference || raw.paymentReference || raw.id?.slice(0, 12) || undefined,
                metadata: raw,
            };
        });

        for (const tx of transactions) {
            if (tx.metadata) {
                tx.metadata = JSON.parse(JSON.stringify(tx.metadata, (_key, value) => {
                    if (value && typeof value === "object" && typeof value.toDate === "function") {
                        return value.toDate().toISOString();
                    }
                    if (value && typeof value === "object" && value._seconds !== undefined) {
                        return new Date(value._seconds * 1000).toISOString();
                    }
                    return value;
                }));
            }
        }

        // In-memory search filter (applied after user enrichment so userName is available)
        let finalTransactions = transactions;
        if (options?.search) {
            const s = options.search.toLowerCase().trim();
            finalTransactions = transactions.filter(tx => {
                const searchable = [
                    tx.userName,
                    tx.userId,
                    tx.description,
                    tx.reference,
                    tx.type,
                    tx.status
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchable.includes(s);
            });
        }

        const nextCursor = hasMore && docs.length > 0 ? docs[docs.length - 1].id : null;

        return { error: null, success: true as const, data: { transactions: finalTransactions }, meta: { hasMore, lastDocId: nextCursor } };
    } catch (error) {
        logger.error("Get all transactions error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch transactions", data: null };
    }
}
export const getAllTransactionsAction = withFlexibleSafeAction("getAllTransactionsAction", _getAllTransactionsAction);

// ============================================================================
// CONTRIBUTION REPORTS
// ============================================================================

export async function getContributionReportsAction(options?: {
    month?: number;
    year?: number;
}): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated", data: null };
        }

        let roles = session.user.roles;
        if (!isAdmin(roles)) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            if (isAdmin(liveRoles)) {
                roles = liveRoles;
            } else {
                return { success: false as const, error: "Unauthorized", data: null };
            }
        }

        const adminScope = await getAdminScope(session.user.id, roles);

        const { getCached, setCache } = await import("@/lib/redis");
        const cacheKey = adminScope ? `admin:coop-reports:${adminScope}` : "admin:coop-reports:global";

        try {
            const cached = await getCached<any>(cacheKey);
            if (cached) return cached;
        } catch (e) {}

        // memberCount and averageContribution are derived from cooperative_transactions
        // (the Paystack-authoritative collection) — never from a different collection
        // to avoid cross-collection count drift.

        // Get all completed cooperative transactions for amount/trend reporting
        let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS)
            .where("status", "==", "completed");

        if (adminScope) {
            q = q.where("cooperativeId", "==", adminScope);
        }

        let totalContributions = 0;
        let transactionCount = 0; // count from the same source as totalContributions
        const contributorMap = new Map<string, number>();
        const monthlyTrendData: Array<{ month: string; mKey: number; yKey: number; amount: number }> = [];

        // Initialize last 6 months buckets
        const today = new Date();
        for (let i = 5; i >= 0; i--) {
            const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
            monthlyTrendData.push({
                month: date.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
                mKey: date.getMonth(),
                yKey: date.getFullYear(),
                amount: 0
            });
        }

        const stream = q.select("type", "amount", "userId", "date", "paidAt").get();
        // Track the FIRST (earliest) transaction per user only.
        // This is a one-time registration fee — if Paystack shows
        // multiple charges for the same userId those are accidental repeat payments,
        // not additional contributions. We count each member exactly once.
        const seenUserIds = new Set<string>();

        for (const doc of (await stream).docs) {
            const t = doc.data();
            if (t.type === "contribution" || t.type === "membership_registration" || t.type === "registration_fee") {
                const amount = Number(t.amount) || 0;
                const uid = t.userId as string | undefined;

                // Deduplicate per user — only count their first/canonical payment
                const isNewUser = !uid || !seenUserIds.has(uid);
                if (isNewUser) {
                    totalContributions += amount;
                    transactionCount++;
                    if (uid) {
                        seenUserIds.add(uid);
                        contributorMap.set(uid, amount); // for registration
                    }
                }

                // Prefer paidAt (Paystack-sourced) over date field
                const rawDate = t.paidAt || t.date;
                if (rawDate && isNewUser) {
                    const cDate = rawDate.toDate ? rawDate.toDate() : new Date(rawDate);
                    const bucket = monthlyTrendData.find(b => b.mKey === cDate.getMonth() && b.yKey === cDate.getFullYear());
                    if (bucket) bucket.amount += amount;
                }
            }
        }

        // Both numerator and denominator come from unique users — no drift, no duplicates
        const memberCount = transactionCount;
        const averageContribution = transactionCount > 0 ? totalContributions / transactionCount : 0;

        const topContributors = Array.from(contributorMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([userId, total]) => ({
                userId,
                name: "Member",
                total,
            }));

        const monthlyTrend = monthlyTrendData.map(b => ({ month: b.month, amount: b.amount }));

        const payload = {
            error: null, success: true as const,
            data: {
                reports: {
                    totalContributions,
                    memberCount,
                    averageContribution,
                    topContributors,
                    monthlyTrend,
                }
            },
            meta: null
        };

        try {
            await setCache(cacheKey, payload, 120);
        } catch (e) {}

        return payload;
    } catch (error) {
        logger.error("Get contribution reports error:", error);
        return { success: false as const, error: "Failed to generate report", data: null };
    }
}

// ============================================================================
// RECENT ACTIVITY
// ============================================================================

export async function getRecentActivityAction(): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated", data: null };
        }

        let roles = session.user.roles;
        if (!isAdmin(roles)) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            if (isAdmin(liveRoles)) {
                roles = liveRoles;
            } else {
                return { success: false as const, error: "Unauthorized", data: null };
            }
        }

        const adminScope = await getAdminScope(session.user.id, roles);

        // Build query: where() MUST precede orderBy()
        let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS);

        if (adminScope) {
            q = q.where("cooperativeId", "==", adminScope);
        }

        q = q.orderBy("date", "desc").limit(10);

        const transactionsSnap = await q.get();

        const activities = transactionsSnap.docs.map((doc) => {
            const data = doc.data();
            const dateVal = data.date?.toDate ? data.date.toDate() : (data.date ? new Date(data.date) : new Date());
            return {
                type: data.type,
                description: `${data.type} of ₦${data.amount?.toLocaleString()}`,
                timestamp: dateVal.toISOString(),
                userId: data.userId,
            };
        });

        return { error: null, success: true as const, data: { activities }, meta: null };
    } catch (error) {
        logger.error("Get recent activity error:", error);
        return { success: false as const, error: "Failed to fetch activity", data: null };
    }
}

// ============================================================================
// WITHDRAWAL MANAGEMENT (ADMIN)
// ============================================================================

/**
 * Approve Withdrawal
 * - Confirms the funds removal (already locked/debited)
 * - Decrements lockedBalance
 * - Updates status to approved
 */
export async function approveWithdrawalAction(
    withdrawalId: string
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!session?.user?.id) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        let roles = session.user.roles;
        if (!isAdmin(roles)) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            if (isAdmin(liveRoles)) {
                roles = liveRoles;
            } else {
                return { success: false as const, error: "Unauthorized", data: null };
            }
        }

        const adminId = session.user.id;
        const withdrawalRef = db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).doc(withdrawalId);

        const adminScope = await getAdminScope(adminId, roles);

        // Execute transaction and return notification data
        const notificationData = await db.runTransaction(async (transaction) => {
            const withdrawalDoc = await transaction.get(withdrawalRef);
            if (!withdrawalDoc.exists) {
                throw new Error("Withdrawal request not found");
            }

            const withdrawalData = withdrawalDoc.data();

            // 🔒 Prevent IDOR on Approval
            if (adminScope && withdrawalData?.cooperativeId && withdrawalData.cooperativeId !== adminScope) {
                throw new Error("Unauthorized: Cannot approve withdrawal for another cooperative");
            }

            if (withdrawalData?.status !== "pending") {
                throw new Error(`Request is already ${withdrawalData?.status}`);
            }

            const userId = withdrawalData.userId;
            const amount = withdrawalData.amount;

            // Fetch user for details
            let email = "";
            let name = "Member";

            const userDoc = await transaction.get(db.collection(COLLECTIONS.USERS).doc(userId));
            if (userDoc.exists) {
                email = userDoc.data()?.email || "";
                name = userDoc.data()?.fullName || "Member";
            }

            const coopMemberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
            const coopMemberDoc = await transaction.get(coopMemberRef);

            if (coopMemberDoc.exists) {
                transaction.update(coopMemberRef, {
                    lockedBalance: FieldValue.increment(-amount),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            } else {
                if (withdrawalData.cooperativeId) {
                    const nestedMemberRef = db
                        .collection(COLLECTIONS.COOPERATIVES)
                        .doc(withdrawalData.cooperativeId)
                        .collection("members")
                        .doc(userId);

                    const nestedDoc = await transaction.get(nestedMemberRef);
                    if (nestedDoc.exists) {
                        transaction.update(nestedMemberRef, {
                            lockedBalance: FieldValue.increment(-amount),
                            updatedAt: FieldValue.serverTimestamp(),
                        });
                    }
                }
            }

            transaction.update(withdrawalRef, {
                status: "approved",
                approvedBy: adminId,
                approvedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            return { email, name, amount, userId };
        });

        // 🚀 POST-COMMIT SIDE EFFECTS (Non-blocking)
        try {
            if (notificationData) {
                await Promise.allSettled([
                    logAuditAction({
                        userId: adminId,
                        action: "APPROVE_WITHDRAWAL",
                        details: `Approved withdrawal of ₦${notificationData.amount} for user ${notificationData.email}`,
                        metadata: { withdrawalId, amount: notificationData.amount }
                    }),
                    notificationData.email ? sendWithdrawalApprovedEmail(
                        notificationData.email,
                        notificationData.name,
                        notificationData.amount,
                        withdrawalId
                    ) : Promise.resolve()
                ]);
            }
        } catch (sideEffectError) {
            logger.error("[approveWithdrawalAction] Post-commit side effects failed:", sideEffectError);
        }

        return { error: null, success: true as const, data: null, meta: null };

    } catch (error: any) {
        logger.error("Approve withdrawal error:", error);
        return { success: false as const, error: (error as any).message || "Failed to approve withdrawal", data: null };
    }
}

/**
 * Reject Withdrawal
 * - REFUNDS the funds: Increment savingsBalance, Decrement lockedBalance
 * - Updates status to rejected
 */
export async function rejectWithdrawalAction(
    withdrawalId: string,
    reason: string
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        let roles = session.user.roles;
        if (!isAdmin(roles)) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            if (isAdmin(liveRoles)) {
                roles = liveRoles;
            } else {
                return { success: false as const, error: "Unauthorized", data: null };
            }
        }

        const adminId = session.user.id;
        const withdrawalRef = db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).doc(withdrawalId);

        const adminScope = await getAdminScope(adminId, roles);

        // Execute transaction and return notification data
        const notificationData = await db.runTransaction(async (transaction) => {
            const withdrawalDoc = await transaction.get(withdrawalRef);
            if (!withdrawalDoc.exists) {
                throw new Error("Withdrawal request not found");
            }

            const withdrawalData = withdrawalDoc.data();

            // 🔒 Prevent IDOR on Rejection
            if (adminScope && withdrawalData?.cooperativeId && withdrawalData.cooperativeId !== adminScope) {
                throw new Error("Unauthorized: Cannot reject withdrawal for another cooperative");
            }

            if (withdrawalData?.status !== "pending") {
                throw new Error(`Request is already ${withdrawalData?.status}`);
            }

            const userId = withdrawalData.userId;
            const amount = withdrawalData.amount;

            // Fetch user for details
            let email = "";
            let name = "Member";

            const userDoc = await transaction.get(db.collection(COLLECTIONS.USERS).doc(userId));
            if (userDoc.exists) {
                email = userDoc.data()?.email || "";
                name = userDoc.data()?.fullName || "Member";
            }

            const coopMemberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
            const coopMemberDoc = await transaction.get(coopMemberRef);

            if (coopMemberDoc.exists) {
                transaction.update(coopMemberRef, {
                    savingsBalance: FieldValue.increment(amount),
                    lockedBalance: FieldValue.increment(-amount),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            } else {
                if (withdrawalData.cooperativeId) {
                    const nestedMemberRef = db
                        .collection(COLLECTIONS.COOPERATIVES)
                        .doc(withdrawalData.cooperativeId)
                        .collection("members")
                        .doc(userId);

                    const nestedDoc = await transaction.get(nestedMemberRef);
                    if (nestedDoc.exists) {
                        transaction.update(nestedMemberRef, {
                            balance: FieldValue.increment(amount),
                            lockedBalance: FieldValue.increment(-amount),
                            updatedAt: FieldValue.serverTimestamp(),
                        });
                    }
                }
            }

            transaction.update(withdrawalRef, {
                status: "rejected",
                rejectionReason: reason,
                rejectedBy: adminId,
                rejectedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            return { email, name, amount, userId };
        });

        // 🚀 POST-COMMIT SIDE EFFECTS (Non-blocking)
        try {
            if (notificationData) {
                await Promise.allSettled([
                    logAuditAction({
                        userId: adminId,
                        action: "REJECT_WITHDRAWAL",
                        details: `Rejected withdrawal of ₦${notificationData.amount} for user ${notificationData.userId}. Reason: ${reason}`,
                        metadata: { withdrawalId, amount: notificationData.amount, reason }
                    }),
                    notificationData.email ? sendWithdrawalRejectedEmail(
                        notificationData.email,
                        notificationData.name,
                        notificationData.amount,
                        reason
                    ) : Promise.resolve()
                ]);
            }
        } catch (sideEffectError) {
            logger.error("[rejectWithdrawalAction] Post-commit side effects failed:", sideEffectError);
        }

        return { error: null, success: true as const, data: null, meta: null };

    } catch (error: any) {
        logger.error("Reject withdrawal error:", error);
        return { success: false as const, error: (error as any).message || "Failed to reject withdrawal", data: null };
    }
}

// ============================================================================
// REVISION FLOW
// ============================================================================

/**
 * Admin: Request revision on a cooperative membership application
 */
export async function requestCooperativeRevisionAction(
    memberId: string,
    reason: string
): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!session?.user?.id) {
            return { success: false as const, error: 'Admin access required', data: null };
        }

        let roles = session.user.roles;
        if (!isAdmin(roles)) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            if (isAdmin(liveRoles)) {
                roles = liveRoles;
            } else {
                return { success: false as const, error: 'Admin access required', data: null };
            }
        }

        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(memberId);
        // Execute transaction for atomic updates to application and user registration
        const notificationData = await db.runTransaction(async (t) => {
            const memberDoc = await t.get(memberRef);
            if (!memberDoc.exists) throw new Error('Member not found');

            const memberData = memberDoc.data();
            const userId = memberData?.userId;

            t.update(memberRef, {
                membershipStatus: 'revision_required',
                revisionNote: reason,
                revisionRequestedAt: FieldValue.serverTimestamp(),
                revisionRequestedBy: session.user.id,
                updatedAt: FieldValue.serverTimestamp(),
            });

            if (userId) {
                t.update(db.collection(COLLECTIONS.USERS).doc(userId), normalizeUserUpdate({
                    'serviceRegistrations.cooperatives.status': 'revision_required',
                    updatedAt: FieldValue.serverTimestamp(),
                }));
            }

            return {
                email: memberData?.email,
                name: memberData?.firstName ? `${memberData.firstName} ${memberData.lastName || ''}`.trim() : 'Member'
            };
        });

        // Send revision requested email (non-blocking post-commit)
        try {
            if (notificationData?.email) {
                const resend = new Resend(process.env.RESEND_API_KEY);
                const { error } = await resend.emails.send({
                    from: 'Easy Sales Export <noreply@easysalesexport.com>',
                    to: notificationData.email,
                    subject: '⚠️ Action Required: Update Your Cooperative Application',
                    html: `
                        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                            <h2 style="color:#d97706;">Application Update Requested</h2>
                            <p>Dear <strong>${notificationData.name}</strong>,</p>
                            <p>Our team has reviewed your cooperative membership application and requires some updates before it can be approved.</p>
                            <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:16px;margin:16px 0;">
                                <p style="margin:0;color:#92400e;"><strong>Note from Admin:</strong><br/>${reason}</p>
                            </div>
                            <p>Please log in to update and resubmit your application.</p>
                            <div style="text-align:center;margin:24px 0;">
                                <a href="${process.env.NEXTAUTH_URL || 'https://easysalesexport.com'}/cooperatives/onboarding" style="background:#7c3aed;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">Update Application</a>
                            </div>
                        </div>
                    `,
                });
                if (error) {
                    logger.error("Resend API Error (Cooperative revision email):", error);
                }
            }
        } catch (emailError) {
            logger.error('Cooperative revision email failed (non-blocking):', emailError);
        }

        return { success: true, error: null, data: { message: "Revision requested" }, meta: null };
    } catch (error: any) {
        logger.error('requestCooperativeRevisionAction error:', error);
        return { success: false as const, error: (error as any).message || 'Failed to request revision', data: null };
    }
}

export async function getStandardCooperativeMembersAction(
    options: {
        status?: "pending" | "approved" | "active" | "suspended" | "under_review" | "all";
        paymentStatus?: "pending" | "completed" | "failed" | "unpaid" | "all";
        cursorId?: string;
        limit?: number;
        search?: string;
        dateFrom?: string; // YYYY-MM-DD
        dateTo?: string;   // YYYY-MM-DD
    } = {}
): Promise<PaginatedAdminResponse<any>> {
    const { status: statusFilter = "all", paymentStatus: paymentFilter = "all", cursorId, limit: limitCount = 50, search } = options;
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return paginatedErr('Not authenticated');
        const { session } = sessionResult;
        if (!session?.user?.id) return paginatedErr('Not authenticated');

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const liveRoles = userDoc.data()?.roles;
        if (!isAdmin(liveRoles)) {
            return paginatedErr('Unauthorized');
        }

        let cursorSnap = null;
        if (cursorId && !/^\d+$/.test(cursorId)) {
            cursorSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(cursorId).get();
        }

        const useMemoryPagination = !!search || !!options.dateFrom || !!options.dateTo;
        const fetchLimit = useMemoryPagination ? 5000 : limitCount;

        const adminScope = await getAdminScope(session.user.id, liveRoles);
        // Build query with all where() clauses BEFORE orderBy() to satisfy
        // Firestore composite index requirements (FAILED_PRECONDITION otherwise)
        let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);

        if (adminScope) {
            q = q.where("cooperativeId", "==", adminScope);
        }

        if (statusFilter && statusFilter !== "all") {
            if (statusFilter === "approved" || statusFilter === "active") {
                q = q.where("membershipStatus", "in", ["approved", "active"]);
            } else {
                q = q.where("membershipStatus", "==", statusFilter);
            }
        }

        // Server-side paymentStatus filter — prevents client-side filter on paginated data
        // causing mismatch between stat counts and table rows.
        if (paymentFilter && paymentFilter !== "all") {
            if (paymentFilter === "completed") {
                q = q.where("paymentStatus", "==", "completed");
            } else if (paymentFilter === "unpaid" || paymentFilter === "pending") {
                q = q.where("paymentStatus", "in", ["pending", "unpaid", "failed"]);
            } else {
                q = q.where("paymentStatus", "==", paymentFilter);
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

        // orderBy must come after all where() clauses
        q = q.orderBy("createdAt", "desc");

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
        const nextCursor = applications.length > 0 ? applications[applications.length - 1].id as string : undefined;


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
        userSnapsArray.forEach(snap => snap.docs.forEach(d => userMap.set(d.id, d.data())));

        let standardForms = applications.map((app: any) => {
            const uData = (userMap.get(app.userId as string) || {}) as any;
            const localName = app.firstName ? `${app.firstName} ${app.lastName || ''}`.trim() : (app.fullName || null);
            // Fix: check firstName FIRST to avoid "undefined undefined" for legacy users
            const userName = uData.firstName
                ? `${uData.firstName} ${uData.lastName || ''}`.trim()
                : (uData.fullName || uData.name || uData.displayName || localName || "");

            // Merge USERS data into app.data as fallback for fields that were never filled via onboarding.
            // Legacy members who only paid (never submitted the form) will have blank phone/gender/dob etc.
            // on the cooperative_members doc — so we surface it from the USERS profile instead.
            const mergedData = {
                ...app,
                // Personal details — prefer cooperative_members doc, fall back to users profile
                phone:               app.phone               || uData.phone              || uData.phoneNumber || null,
                gender:              app.gender              || uData.gender             || null,
                dateOfBirth:         app.dateOfBirth         || uData.dateOfBirth        || uData.dob        || null,
                occupation:          app.occupation          || uData.occupation         || null,
                stateOfOrigin:       app.stateOfOrigin       || uData.stateOfOrigin      || (typeof uData.address === 'object' ? uData.address?.state : null) || null,
                lga:                 app.lga                 || uData.lga                || (typeof uData.address === 'object' ? uData.address?.lga   : null) || null,
                residentialAddress:  app.residentialAddress  || (typeof uData.address === 'object' ? uData.address?.street : uData.address) || null,
                // Name fields
                firstName:           app.firstName           || uData.firstName          || null,
                lastName:            app.lastName            || uData.lastName           || null,
                email:               app.email               || uData.email              || uData.userEmail  || null,
                // nextOfKin: remap stored field names to what the admin modal reads
                // Firestore stores: { fullName, phone, residentialAddress }
                // Admin modal reads: { name, phone, address }
                nextOfKin: app.nextOfKin ? {
                    ...app.nextOfKin,
                    name:    app.nextOfKin.fullName    || app.nextOfKin.name    || null,
                    address: app.nextOfKin.residentialAddress || app.nextOfKin.address || null,
                } : null,
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
                    email: mergedData.email || "",
                    phone: mergedData.phone || "",
                    dob: mergedData.dateOfBirth || "",
                    address: mergedData.residentialAddress || "",
                    state: mergedData.stateOfOrigin || "",
                    lga: mergedData.lga || "",
                    bankDetails
                },
                status: app.membershipStatus || "pending",
                data: {
                    ...mergedData,
                    bankDetails
                }
            };
        });

        if (search) {
            const s = search.toLowerCase().trim();
            standardForms = standardForms.filter((f: any) => {
                const searchString = [
                    f.user?.name,
                    f.user?.email,
                    f.user?.phone,
                    f.data?.firstName,
                    f.data?.lastName,
                    f.data?.phone
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(s);
            });
        }

        // ALWAYS apply date filters in memory as a definitive backstop.
        if (options.dateFrom) {
            const from = new Date(options.dateFrom);
            from.setHours(0, 0, 0, 0);
            standardForms = standardForms.filter((f: any) => {
                const d = f.data?.createdAt?.seconds ? new Date(f.data.createdAt.seconds * 1000) : new Date(f.data?.createdAt);
                return d >= from;
            });
        }
        if (options.dateTo) {
            const to = new Date(options.dateTo);
            to.setHours(23, 59, 59, 999);
            standardForms = standardForms.filter((f: any) => {
                const d = f.data?.createdAt?.seconds ? new Date(f.data.createdAt.seconds * 1000) : new Date(f.data?.createdAt);
                return d <= to;
            });
        }

        let page = 0;
        const pageOption = (options as any).page;
        if (pageOption !== undefined) {
            page = Number(pageOption);
        } else if (cursorId && /^\d+$/.test(cursorId)) {
            page = Number(cursorId);
        }

        const offset = page * limitCount;
        const paged = useMemoryPagination ? standardForms.slice(offset, offset + limitCount) : standardForms;
        const _hasMore = useMemoryPagination 
            ? (offset + limitCount < standardForms.length)
            : hasMoreRaw;

        const _nextCursor = useMemoryPagination 
            ? (_hasMore ? String(page + 1) : undefined)
            : (_hasMore ? nextCursor : undefined);

        return paginatedOk(paged, _nextCursor);
    } catch (error) {
        logger.error(`getStandardCooperativeMembersAction error:`, error);
        return paginatedErr("Failed to load cooperative members");
    }
}
