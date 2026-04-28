/**
 * Admin Server Actions for Cooperative Management
 * Provides admin-level oversight and management capabilities
 */

"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { FieldValue, FieldPath } from "firebase-admin/firestore";
import { logAuditAction } from "@/lib/audit";
import { serializeDocs } from "@/lib/firestore-serialize";
import { paginatedOk, paginatedErr, nextCursor as computeNextCursor } from "@/lib/admin-action-response";
import {
    sendWithdrawalApprovedEmail,
    sendWithdrawalRejectedEmail
} from "@/lib/email-notifications";
import { COLLECTIONS } from "@/lib/types/firestore";
import { Resend } from "resend";

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

export async function getCooperativeStatsAction(): Promise<{
    success: boolean;
    meta?: any;
    data?: {
        stats: {
            totalMembers: number;
            paidMembers: number;
            activeMembers: number;
            pendingMembers: number;
            suspendedMembers: number;
            totalContributions: number;
            monthlyContributions: number;
            totalLoans: number;
            activeLoans: number;
            pendingLoans: number;
            totalSavings: number;
            monthlyGrowth: number;
            totalTransactions: number;
            totalTransactionAmount: number;
            completedTransactions: number;
            pendingTransactions: number;
            failedTransactions: number;
        }
    };
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role directly from session (Performance Optimization)
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const adminScope = await getAdminScope(session.user.id, session.user.roles);

        const { getCached, setCache } = await import("@/lib/redis");
        const cacheKey = adminScope ? `admin:coop-stats:${adminScope}` : "admin:coop-stats:global";

        try {
            const cached = await getCached<any>(cacheKey);
            if (cached) return cached;
        } catch (e) {}

        // ── PAID MEMBERS COUNT (Paystack-authoritative) ──────────────────────
        // Read from PROCESSED_PAYMENTS where type is cooperative_membership_registration
        // and status is completed. This matches exactly what Paystack reports, because
        // the sync and webhook both write here. COOPERATIVE_MEMBERS.paymentStatus can
        // be stale for legacy registrations from the old cooperative portal.
        const [membersSnapR] = await Promise.allSettled([
            db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .limit(adminScope ? 5000 : 5000)
                .get(),
        ]);

        const allMembers = membersSnapR.status === "fulfilled"
            ? membersSnapR.value.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
            : [];

        const totalMembers = allMembers.length;
        // For status breakdown, still use COOPERATIVE_MEMBERS paymentStatus (best effort)
        const paidMembersList = allMembers.filter((m: any) => m.paymentStatus === "completed");
        const paidMembersCount = paidMembersList.length;

        // Count approved members across both field names (membershipStatus and status)
        // Some docs use membershipStatus="active", others use status="approved" — check both
        const activeMembers = paidMembersList.filter((m: any) =>
            m.membershipStatus === "active" || m.membershipStatus === "approved" ||
            m.status === "active" || m.status === "approved"
        ).length;
        const pendingMembers = paidMembersList.filter((m: any) =>
            m.membershipStatus === "pending" || m.status === "pending"
        ).length;
        const suspendedMembers = paidMembersList.filter((m: any) =>
            m.membershipStatus === "suspended" || m.status === "suspended"
        ).length;

        // Get transactions (Scoped)
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

        // Get loans (Scoped via memberId mapping is hard without joins, assuming loans have coopId or we filter by member list)
        // Ideally loans should have cooperativeId. Checking Schema...
        // If not, we filter in memory against the 'members' list we already fetched.
        const loansStream = db.collection(COLLECTIONS.COOPERATIVE_LOANS).select("memberId", "amount", "status").get();
        let totalLoans = 0;
        let activeLoans = 0;
        let pendingLoans = 0;
        const validMemberIds = adminScope ? new Set(paidMembersList.map((m: any) => m.id)) : null;

        for (const doc of (await loansStream).docs) {
            const l = doc.data();
            if (validMemberIds && !validMemberIds.has(l.memberId)) continue;
            
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
            success: true as const,
            data: {
                stats: {
                    totalMembers,
                    paidMembers: paidMembersCount,
                    activeMembers,
                    pendingMembers,
                    suspendedMembers,
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
        logger.error("Get cooperative stats error:", error);
        return { success: false, error: "Failed to fetch statistics" };
    }
}

// ============================================================================
// MEMBER MANAGEMENT
// ============================================================================

export async function getAllMembersAction(options?: {
    status?: "all" | "active" | "pending" | "suspended" | string;
    limit?: number;
    search?: string;
}): Promise<{
    success: boolean;
    meta?: any;
    data?: { members: any[] };
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role directly from session (Performance Optimization)
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const adminScope = await getAdminScope(session.user.id, session.user.roles);

        let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);

        // 🔒 SECURITY FIX: Content Scoping — where() MUST come before orderBy()
        if (adminScope) {
            q = q.where("cooperativeId", "==", adminScope);
        }

        if (options?.status && options.status !== "all") {
            q = q.where("membershipStatus", "==", options.status);
        }

        // 🐛 FIX: Only return paid members in the list by querying at DB level if possible, 
        // or increasing the fetch limit before filtering. Since paymentStatus is not always indexed 
        // cleanly with createdAt, we fetch more documents to ensure we get enough paid members.
        const fetchLimit = options?.search ? 2000 : (options?.limit ? options.limit * 10 : 500);
        q = q.orderBy("createdAt", "desc").limit(fetchLimit);

        const snapshot = await q.get();
        const allMembers = serializeDocs(snapshot.docs);

        let members = allMembers.filter((m: any) => m.paymentStatus === "completed");
        
        // If limit was specified without search, apply limit after filter
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
                    m.bvn
                ].filter(Boolean).join(" ").toLowerCase();
                
                return searchString.includes(s);
            });
        }

        return { success: true, data: { members }, meta: { hasMore: false, cursor: null } };
    } catch (error) {
        logger.error("Get all members error:", error);
        return { success: false, error: "Failed to fetch members" };
    }
}

export async function updateMemberStatusAction(
    memberId: string,
    status: "active" | "suspended"
): Promise<{ success: boolean; meta?: any; data?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role directly from session (Performance Optimization)
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const batch = db.batch();
        batch.update(db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(memberId), {
            membershipStatus: status,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Verify user and assign role if activating
        if (status === "active") {
            // Fetch user data so we can send an approval email
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(memberId).get();
            const userData = userDoc.data();

            batch.update(db.collection(COLLECTIONS.USERS).doc(memberId), {
                isVerified: true,
                roles: FieldValue.arrayUnion("cooperative_member"),
                "serviceRegistrations.cooperatives.status": "active",
                "serviceRegistrations.cooperatives.activatedAt": FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            // 📧 Send approval notification email (non-blocking)
            try {
                const resend = new Resend(process.env.RESEND_API_KEY);
                if (userData?.email) {
                    const { error } = await resend.emails.send({
                        from: 'Easy Sales Export <noreply@easysalesexport.com>',
                        to: userData.email,
                        subject: '✅ Your Cooperative Membership Has Been Approved!',
                        html: `
                            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                                <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:32px;border-radius:12px;text-align:center;margin-bottom:24px;">
                                    <h1 style="color:white;margin:0;">Welcome to the Cooperative!</h1>
                                </div>
                                <h2 style="color:#7c3aed;">Membership Approved ✅</h2>
                                <p>Dear <strong>${userData.fullName || 'Member'}</strong>,</p>
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
                }
            } catch (emailError) {
                logger.error('Cooperative approval email failed (non-blocking):', emailError);
            }
        }

        await batch.commit();
        
        return { success: true, data: { message: "Member status updated" }, meta: null };
    } catch (error) {
        logger.error("Update member status error:", error);
        return { success: false, error: "Failed to update member status" };
    }
}

// ============================================================================
// TRANSACTION MONITORING
// ============================================================================

export async function getAllTransactionsAction(options?: {
    type?: "all" | "contribution" | "withdrawal" | "loan" | "fixed_savings" | "membership_registration";
    status?: "all" | "pending" | "completed" | "failed";
    limit?: number;
    lastDocId?: string;
}): Promise<{
    success: boolean;
    meta?: any;
    data?: { transactions: Array<{
        id: string;
        userId: string;
        userName: string;
        type: string;
        amount: number;
        status: string;
        date: string;
        description?: string;
        reference?: string;
        metadata?: Record<string, unknown>;
    }> };
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role directly from session (Performance Optimization)
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const adminScope = await getAdminScope(session.user.id, session.user.roles);

        // Build query: where() MUST precede orderBy() in Firestore Admin SDK
        let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS);

        // 🔒 SECURITY FIX: Content Scoping
        if (adminScope) {
            q = q.where("cooperativeId", "==", adminScope);
        }

        if (options?.type && options.type !== "all") {
            q = q.where("type", "==", options.type);
        }

        if (options?.status && options.status !== "all") {
            q = q.where("status", "==", options.status);
        }

        // orderBy LAST — after all where() filters
        q = q.orderBy("date", "desc");

        const fetchLimit = options?.limit || 100;
        let query = q;

        if (options?.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        const snapshot = await query.limit(fetchLimit + 1).get();
        const hasMore = snapshot.docs.length > fetchLimit;
        const docs = hasMore ? snapshot.docs.slice(0, fetchLimit) : snapshot.docs;

        const rawDocs = docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        // Batch-resolve user names
        const userIds = [...new Set(rawDocs.map((d: any) => d.userId).filter(Boolean))];
        const userNameMap = new Map<string, string>();
        
        // Firestore getAll supports up to 100 refs at a time
        const userPromises = [];
        for (let i = 0; i < userIds.length; i += 100) {
            const batch = userIds.slice(i, i + 100);
            const refs = batch.map(uid => db.collection(COLLECTIONS.USERS).doc(uid));
            userPromises.push(
                db.getAll(...refs).then(userDocs => {
                    userDocs.forEach(doc => {
                        if (doc.exists) {
                            const data = doc.data();
                            userNameMap.set(doc.id, data?.fullName || data?.displayName || data?.email || doc.id);
                        }
                    });
                }).catch(() => {})
            );
        }
        await Promise.all(userPromises);

        // Serialize: convert Firestore Timestamps to ISO strings
        const transactions = rawDocs.map((raw: any) => {
            const dateVal = raw.date?.toDate ? raw.date.toDate() : (raw.date ? new Date(raw.date) : new Date());
            return {
                id: raw.id,
                userId: raw.userId || "",
                userName: userNameMap.get(raw.userId) || raw.userId || "Unknown",
                type: raw.type || "unknown",
                amount: Number(raw.amount) || 0,
                status: raw.status || "unknown",
                date: dateVal.toISOString(),
                description: raw.description || raw.notes || raw.purpose || undefined,
                reference: raw.reference || raw.paymentReference || raw.id?.slice(0, 12) || undefined,
                metadata: raw,
            };
        });

        // Sanitize metadata timestamps
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

        const nextCursor = hasMore && docs.length > 0 ? docs[docs.length - 1].id : null;

        return { success: true, data: { transactions }, meta: { hasMore, lastDocId: nextCursor } };
    } catch (error) {
        logger.error("Get all transactions error:", error);
        return { success: false, error: "Failed to fetch transactions" };
    }
}

// ============================================================================
// CONTRIBUTION REPORTS
// ============================================================================

export async function getContributionReportsAction(options?: {
    month?: number;
    year?: number;
}): Promise<{
    success: boolean;
    meta?: any;
    data?: {
        reports: {
            totalContributions: number;
            memberCount: number;
            averageContribution: number;
            topContributors: Array<{ userId: string; name: string; total: number }>;
            monthlyTrend: Array<{ month: string; amount: number }>;
        }
    };
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role directly from session (Performance Optimization)
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const adminScope = await getAdminScope(session.user.id, session.user.roles);

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
        // This is a fixed ₦10,000 one-time registration fee — if Paystack shows
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
                        contributorMap.set(uid, amount); // always ₦10,000 for registration
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
            success: true as const,
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
        return { success: false, error: "Failed to generate report" };
    }
}

// ============================================================================
// RECENT ACTIVITY
// ============================================================================

export async function getRecentActivityAction(): Promise<{
    success: boolean;
    meta?: any;
    data?: { activities: Array<{
        type: string;
        description: string;
        timestamp: Date;
        userId?: string;
    }> };
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role directly from session (Performance Optimization)
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const adminScope = await getAdminScope(session.user.id, session.user.roles);

        // Build query: where() MUST precede orderBy()
        let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS);

        if (adminScope) {
            q = q.where("cooperativeId", "==", adminScope);
        }

        q = q.orderBy("date", "desc").limit(10);

        const transactionsSnap = await q.get();

        const activities = transactionsSnap.docs.map((doc) => {
            const data = doc.data();
            return {
                type: data.type,
                description: `${data.type} of ₦${data.amount?.toLocaleString()}`,
                timestamp: data.date?.toDate ? data.date.toDate() : new Date(data.date),
                userId: data.userId,
            };
        });

        return { success: true, data: { activities }, meta: null };
    } catch (error) {
        logger.error("Get recent activity error:", error);
        return { success: false, error: "Failed to fetch activity" };
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
): Promise<{ success: boolean; meta?: any; data?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        // Check admin role directly from session (Performance Optimization)
        if (!session?.user?.id || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        const adminId = session.user.id;
        const withdrawalRef = db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).doc(withdrawalId);

        const adminScope = await getAdminScope(adminId, session.user.roles);

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

        // 📜 Audit Log & Notification
        if (notificationData) {
            await logAuditAction({
                userId: adminId,
                action: "APPROVE_WITHDRAWAL",
                details: `Approved withdrawal of ₦${notificationData.amount} for user ${notificationData.email}`,
                metadata: { withdrawalId, amount: notificationData.amount }
            });

            if (notificationData.email) {
                await sendWithdrawalApprovedEmail(
                    notificationData.email,
                    notificationData.name,
                    notificationData.amount,
                    withdrawalId
                );
            }
        }

        return { success: true, data: { message: "Withdrawal approved" }, meta: null };

    } catch (error: any) {
        logger.error("Approve withdrawal error:", error);
        return { success: false, error: error.message || "Failed to approve withdrawal" };
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
): Promise<{ success: boolean; meta?: any; data?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        const adminId = session.user.id;
        const withdrawalRef = db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).doc(withdrawalId);

        const adminScope = await getAdminScope(adminId, session.user.roles);

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

        // 📜 Audit Log & Notification
        if (notificationData) {
            await logAuditAction({
                userId: adminId,
                action: "REJECT_WITHDRAWAL",
                details: `Rejected withdrawal of ₦${notificationData.amount} for user ${notificationData.userId}. Reason: ${reason}`,
                metadata: { withdrawalId, amount: notificationData.amount, reason }
            });

            if (notificationData.email) {
                await sendWithdrawalRejectedEmail(
                    notificationData.email,
                    notificationData.name,
                    notificationData.amount,
                    reason
                );
            }
        }

        return { success: true, data: { message: "Withdrawal rejected" }, meta: null };

    } catch (error: any) {
        logger.error("Reject withdrawal error:", error);
        return { success: false, error: error.message || "Failed to reject withdrawal" };
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
): Promise<{ success: boolean; meta?: any; data?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.roles?.includes('admin') && !session?.user?.roles?.includes('super_admin')) {
            return { success: false, error: 'Admin access required' };
        }

        // Fetch member doc to get userId and email
        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(memberId);
        const memberDoc = await memberRef.get();
        if (!memberDoc.exists) return { success: false, error: 'Member not found' };

        const memberData = memberDoc.data();
        const userId = memberData?.userId;

        const batch = db.batch();
        batch.update(memberRef, {
            membershipStatus: 'revision_required',
            revisionNote: reason,
            revisionRequestedAt: FieldValue.serverTimestamp(),
            revisionRequestedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        });

        if (userId) {
            batch.update(db.collection(COLLECTIONS.USERS).doc(userId), {
                'serviceRegistrations.cooperatives.status': 'revision_required',
                updatedAt: FieldValue.serverTimestamp(),
            });
        }
        await batch.commit();

        // Send revision requested email (non-blocking)
        try {
            const resend = new Resend(process.env.RESEND_API_KEY);
            const email = memberData?.email;
            const name = memberData?.firstName ? `${memberData.firstName} ${memberData.lastName || ''}`.trim() : 'Member';
            if (email) {
                const { error } = await resend.emails.send({
                    from: 'Easy Sales Export <noreply@easysalesexport.com>',
                    to: email,
                    subject: '⚠️ Action Required: Update Your Cooperative Application',
                    html: `
                        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                            <h2 style="color:#d97706;">Application Update Requested</h2>
                            <p>Dear <strong>${name}</strong>,</p>
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

        return { success: true, data: { message: "Revision requested" }, meta: null };
    } catch (error) {
        logger.error('requestCooperativeRevisionAction error:', error);
        return { success: false, error: 'Failed to request revision' };
    }
}

export async function getStandardCooperativeMembersAction(
    options: {
        status?: "pending" | "approved" | "suspended" | "under_review" | "all";
        paymentStatus?: "pending" | "completed" | "failed" | "all";
        cursorId?: string;
        limit?: number;
        search?: string;
    } = {}
): Promise<{ success: boolean; data: any[]; hasMore: boolean; lastDocId?: string; error?: string; meta?: any }> {
    const { status: statusFilter = "all", paymentStatus: paymentFilter = "all", cursorId, limit: limitCount = 50, search } = options;
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return paginatedErr('Not authenticated');
        const { session } = sessionResult;
        if (!session?.user?.id) return paginatedErr('Not authenticated');

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists || (!userDoc.data()?.roles?.includes("admin") && !userDoc.data()?.roles?.includes("super_admin"))) {
            return paginatedErr('Unauthorized');
        }

        let cursorSnap = null;
        if (cursorId) {
            cursorSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(cursorId).get();
        }

        const fetchLimit = search ? 2000 : limitCount;

        let q = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).orderBy("createdAt", "desc");
        
        if (statusFilter && statusFilter !== "all") {
            q = q.where("membershipStatus", "==", statusFilter);
        }

        // Server-side paymentStatus filter — prevents client-side filter on paginated data
        // causing mismatch between stat counts and table rows.
        if (paymentFilter && paymentFilter !== "all") {
            q = q.where("paymentStatus", "==", paymentFilter);
        }

        if (cursorSnap && cursorSnap.exists) {
            q = q.startAfter(cursorSnap);
        }
        
        q = q.limit(fetchLimit);

        const snapshot = await q.get();
        const applications = serializeDocs(snapshot.docs);
        const nextCursorId = computeNextCursor(snapshot.docs, fetchLimit);


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
            const localName = app.firstName ? `${app.firstName} ${app.lastName || ''}`.trim() : null;
            // Fix: check firstName FIRST to avoid "undefined undefined" for legacy users
            const userName = uData.firstName
                ? `${uData.firstName} ${uData.lastName || ''}`.trim()
                : (uData.name || uData.fullName || localName || "Unknown User");

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
                email:               app.email               || uData.email              || null,
                // nextOfKin: remap stored field names to what the admin modal reads
                // Firestore stores: { fullName, phone, residentialAddress }
                // Admin modal reads: { name, phone, address }
                nextOfKin: app.nextOfKin ? {
                    ...app.nextOfKin,
                    name:    app.nextOfKin.fullName    || app.nextOfKin.name    || null,
                    address: app.nextOfKin.residentialAddress || app.nextOfKin.address || null,
                } : null,
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
                },
                status: app.membershipStatus || "pending",
                data: mergedData
            };
        });

        if (search) {
            const s = search.toLowerCase();
            standardForms = standardForms.filter((f: any) => 
                f.user.name?.toLowerCase().includes(s) || 
                f.user.email?.toLowerCase().includes(s) || 
                f.user.phone?.includes(s)
            );
        }

        return paginatedOk(standardForms, nextCursorId);
    } catch (error) {
        logger.error(`getStandardCooperativeMembersAction error:`, error);
        return paginatedErr("Failed to load cooperative members");
    }
}
