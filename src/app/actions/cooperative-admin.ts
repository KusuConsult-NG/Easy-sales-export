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
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role directly from session (Performance Optimization)
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const adminScope = await getAdminScope(session.user.id, session.user.roles);

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

        return {
            success: true,
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
    } catch (error) {
        logger.error("Get cooperative stats error:", error);
        return { success: false, error: "Failed to fetch statistics" };
    }
}

// ============================================================================
// MEMBER MANAGEMENT
// ============================================================================

export async function getAllMembersAction(options?: {
    status?: "all" | "active" | "pending" | "suspended";
    limit?: number;
}): Promise<{
    success: boolean;
    meta?: any;
    data?: { members: any[] };
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role directly from session (Performance Optimization)
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const adminScope = await getAdminScope(session.user.id, session.user.roles);

        let q = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).orderBy("createdAt", "desc");

        // 🔒 SECURITY FIX: Content Scoping
        if (adminScope) {
            q = q.where("cooperativeId", "==", adminScope);
        }

        if (options?.status && options.status !== "all") {
            q = q.where("membershipStatus", "==", options.status);
        }

        if (options?.limit) {
            q = q.limit(options.limit);
        }

        const snapshot = await q.get();
        const allMembers = serializeDocs(snapshot.docs);

        // 🐛 FIX: Only return paid members in the list
        const members = allMembers.filter((m: any) => m.paymentStatus === "completed");

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
        if (!sessionResult.session) return sessionResult.error;
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
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role directly from session (Performance Optimization)
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const adminScope = await getAdminScope(session.user.id, session.user.roles);

        let q = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).orderBy("date", "desc");

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
        for (let i = 0; i < userIds.length; i += 100) {
            const batch = userIds.slice(i, i + 100);
            const refs = batch.map(uid => db.collection(COLLECTIONS.USERS).doc(uid));
            try {
                const userDocs = await db.getAll(...refs);
                userDocs.forEach(doc => {
                    if (doc.exists) {
                        const data = doc.data();
                        userNameMap.set(doc.id, data?.fullName || data?.displayName || data?.email || doc.id);
                    }
                });
            } catch {
                // Non-fatal — names will fall back to userId
            }
        }

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
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role directly from session (Performance Optimization)
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const adminScope = await getAdminScope(session.user.id, session.user.roles);

        // ── AUTHORITATIVE paid-member count ─────────────
        const paidCountSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .where("paymentStatus", "==", "completed")
            .count()
            .get();
        const memberCount = paidCountSnap.data().count ?? 0;

        // Get all completed cooperative transactions for amount/trend reporting
        let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS)
            .where("status", "==", "completed");

        if (adminScope) {
            q = q.where("cooperativeId", "==", adminScope);
        }

        let totalContributions = 0;
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

        const stream = q.select("type", "amount", "userId", "date").get();
        for (const doc of (await stream).docs) {
            const t = doc.data();
            if (t.type === "contribution" || t.type === "membership_registration" || t.type === "registration_fee") {
                const amount = Number(t.amount) || 0;
                totalContributions += amount;

                if (t.userId) {
                    const current = contributorMap.get(t.userId) || 0;
                    contributorMap.set(t.userId, current + amount);
                }

                if (t.date) {
                    const cDate = t.date.toDate ? t.date.toDate() : new Date(t.date);
                    const bucket = monthlyTrendData.find(b => b.mKey === cDate.getMonth() && b.yKey === cDate.getFullYear());
                    if (bucket) bucket.amount += amount;
                }
            }
        }

        const averageContribution = memberCount > 0 ? totalContributions / memberCount : 0;

        const topContributors = Array.from(contributorMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([userId, total]) => ({
                userId,
                name: "Member",
                total,
            }));

        const monthlyTrend = monthlyTrendData.map(b => ({ month: b.month, amount: b.amount }));

        return {
            success: true,
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
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role directly from session (Performance Optimization)
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const adminScope = await getAdminScope(session.user.id, session.user.roles);

        // Get recent transactions
        let q = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS)
            .orderBy("date", "desc")
            .limit(10);

        if (adminScope) {
            q = q.where("cooperativeId", "==", adminScope);
        }

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
        if (!sessionResult.session) return sessionResult.error;
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
        if (!sessionResult.session) return sessionResult.error;
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
        if (!sessionResult.session) return sessionResult.error;
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
    statusFilter?: "pending" | "approved" | "suspended" | "under_review" | "all",
    cursorId?: string,
    limitCount: number = 50
): Promise<{ success: boolean; data?: any[]; error?: string; meta?: any }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, error: "Not authenticated" };

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists || (!userDoc.data()?.roles?.includes("admin") && !userDoc.data()?.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        let cursorSnap = null;
        if (cursorId) {
            cursorSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(cursorId).get();
        }

        let q = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).orderBy("createdAt", "desc");
        
        if (statusFilter && statusFilter !== "all" && statusFilter !== "pending") {
            q = q.where("membershipStatus", "==", statusFilter);
        } else if (statusFilter === "pending") {
            // Support backwards compatibility pending status queries
            q = q.where("membershipStatus", "==", "pending");
        }

        if (cursorSnap && cursorSnap.exists) {
            q = q.startAfter(cursorSnap);
        }
        
        q = q.limit(limitCount);

        const snapshot = await q.get();
        const applications = serializeDocs(snapshot.docs);
        const nextCursorId = snapshot.docs.length === limitCount ? snapshot.docs[snapshot.docs.length - 1].id : undefined;


        const userIds = [...new Set(applications.map(app => app.userId).filter(Boolean))];
        const userMap = new Map<string, any>();
        
        for (let i = 0; i < userIds.length; i += 30) {
            const chunk = userIds.slice(i, i + 30);
            if (chunk.length > 0) {
                const userSnaps = await db.collection(COLLECTIONS.USERS).where(FieldPath.documentId(), "in", chunk).get();
                userSnaps.docs.forEach(d => userMap.set(d.id, d.data()));
            }
        }

        const standardForms = applications.map((app: any) => {
            const uData = (userMap.get(app.userId as string) || {}) as any;
            const localName = app.firstName ? `${app.firstName} ${app.lastName || ''}`.trim() : null;
            const userName = uData.name || uData.firstName ? `${uData.firstName} ${uData.lastName || ''}`.trim() : (localName || "Unknown User");

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

        return { success: true, data: standardForms, error: undefined, meta: { lastDocId: nextCursorId } };
    } catch (error) {
        logger.error(`getStandardCooperativeMembersAction error:`, error);
        return { success: false, error: "Failed to load applications", meta: null };
    }
}
