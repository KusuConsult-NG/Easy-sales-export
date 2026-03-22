/**
 * Admin Server Actions for Cooperative Management
 * Provides admin-level oversight and management capabilities
 */

"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { logAuditAction } from "@/lib/audit";
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
    data?: {
        totalMembers: number;
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

        // Get members (Scoped)
        let membersQuery: FirebaseFirestore.Query = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);
        if (adminScope) {
            membersQuery = membersQuery.where("cooperativeId", "==", adminScope);
        }
        const membersSnap = await membersQuery.get();
        // 🐛 FIX: Exclude abandoned/unpaid registrations
        const allMembers = membersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        const members = allMembers.filter((m: any) => m.paymentStatus === "completed");

        const totalMembers = members.length;
        const activeMembers = members.filter((m: any) => m.membershipStatus === "active").length;
        const pendingMembers = members.filter((m: any) => m.membershipStatus === "pending").length;
        const suspendedMembers = members.filter((m: any) => m.membershipStatus === "suspended").length;

        // Get transactions (Scoped)
        let txnQuery: FirebaseFirestore.Query = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS);
        if (adminScope) {
            txnQuery = txnQuery.where("cooperativeId", "==", adminScope);
        }
        const transactionsSnap = await txnQuery.get();
        const transactions = transactionsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

        // Calculate contribution totals
        const contributionTxns = transactions.filter(
            (t: any) => t.type === "contribution" && t.status === "completed"
        );
        const totalContributions = contributionTxns.reduce(
            (sum: number, t: any) => sum + (t.amount || 0),
            0
        );

        // Monthly contributions (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const monthlyContributions = contributionTxns
            .filter((t: any) => {
                const date = t.date?.toDate ? t.date.toDate() : new Date(t.date);
                return date >= thirtyDaysAgo;
            })
            .reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

        // Get loans (Scoped via memberId mapping is hard without joins, assuming loans have coopId or we filter by member list)
        // Ideally loans should have cooperativeId. Checking Schema...
        // If not, we filter in memory against the 'members' list we already fetched.
        const loansSnap = await db.collection(COLLECTIONS.COOPERATIVE_LOANS).limit(5000).get();
        let loans = loansSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

        if (adminScope) {
            const memberIds = new Set(members.map(m => m.id));
            loans = loans.filter((l: any) => memberIds.has(l.memberId));
        }

        const totalLoans = loans.reduce((sum: number, l: any) => sum + (l.amount || 0), 0);
        const activeLoans = loans.filter(
            (l: any) => l.status === "disbursed" || l.status === "approved"
        ).length;
        const pendingLoans = loans.filter((l: any) => l.status === "pending").length;

        // Calculate total savings
        const savingsTxns = transactions.filter(
            (t: any) => t.type === "fixed_savings" && t.status === "completed"
        );
        const totalSavings = savingsTxns.reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

        // Calculate monthly growth (compare last 30 days vs previous 30 days)
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
        const previousMonthContributions = contributionTxns
            .filter((t: any) => {
                const date = t.date?.toDate ? t.date.toDate() : new Date(t.date);
                return date >= sixtyDaysAgo && date < thirtyDaysAgo;
            })
            .reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

        const monthlyGrowth =
            previousMonthContributions > 0
                ? ((monthlyContributions - previousMonthContributions) / previousMonthContributions) * 100
                : 0;

        return {
            success: true,
            data: {
                totalMembers,
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
            },
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
    data?: any[];
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
        const allMembers = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        // 🐛 FIX: Only return paid members in the list
        const members = allMembers.filter((m: any) => m.paymentStatus === "completed");

        return { success: true, data: members };
    } catch (error) {
        logger.error("Get all members error:", error);
        return { success: false, error: "Failed to fetch members" };
    }
}

export async function updateMemberStatusAction(
    memberId: string,
    status: "active" | "suspended"
): Promise<{ success: boolean; error?: string }> {
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

        await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(memberId).update({
            membershipStatus: status,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Verify user and assign role if activating
        if (status === "active") {
            // Fetch user data so we can send an approval email
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(memberId).get();
            const userData = userDoc.data();

            await db.collection(COLLECTIONS.USERS).doc(memberId).set({
                isVerified: true,
                roles: FieldValue.arrayUnion("cooperative_member"),
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
            // Also sync serviceRegistrations status (dot notation to avoid cross-module data loss)
            await db.collection(COLLECTIONS.USERS).doc(memberId).update({
                "serviceRegistrations.cooperatives.status": "active",
                "serviceRegistrations.cooperatives.activatedAt": FieldValue.serverTimestamp(),
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

        return { success: true };
    } catch (error) {
        logger.error("Update member status error:", error);
        return { success: false, error: "Failed to update member status" };
    }
}

// ============================================================================
// TRANSACTION MONITORING
// ============================================================================

export async function getAllTransactionsAction(options?: {
    type?: "all" | "contribution" | "withdrawal" | "loan" | "fixed_savings";
    status?: "all" | "pending" | "completed" | "failed";
    limit?: number;
}): Promise<{
    success: boolean;
    data?: any[];
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

        if (options?.limit) {
            q = q.limit(options.limit);
        }

        const snapshot = await q.get();
        const transactions = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        return { success: true, data: transactions };
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
    data?: {
        totalContributions: number;
        memberCount: number;
        averageContribution: number;
        topContributors: Array<{ userId: string; name: string; total: number }>;
        monthlyTrend: Array<{ month: string; amount: number }>;
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

        // Get all contributions
        let q = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS)
            .where("type", "==", "contribution")
            .where("status", "==", "completed");

        if (adminScope) {
            q = q.where("cooperativeId", "==", adminScope);
        }

        const transactionsSnap = await q.get();

        const contributions = transactionsSnap.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        // Calculate totals
        const totalContributions = contributions.reduce(
            (sum: number, c: any) => sum + (c.amount || 0),
            0
        );

        // Get unique members
        const uniqueMembers = new Set(contributions.map((c: any) => c.userId));
        const memberCount = uniqueMembers.size;

        const averageContribution = memberCount > 0 ? totalContributions / memberCount : 0;

        // Calculate top contributors
        const contributorMap = new Map<string, number>();
        for (const c of contributions as unknown as { userId: string; amount: number }[]) {
            const current = contributorMap.get(c.userId) || 0;
            contributorMap.set(c.userId, current + c.amount);
        }

        const topContributors = Array.from(contributorMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([userId, total]) => ({
                userId,
                name: "Member", // Would need to join with members collection
                total,
            }));

        // Monthly trend (last 6 months)
        const monthlyTrend: Array<{ month: string; amount: number }> = [];
        const today = new Date();
        for (let i = 5; i >= 0; i--) {
            const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const monthName = date.toLocaleDateString("en-US", { month: "short", year: "numeric" });

            const monthContributions = contributions.filter((c: any) => {
                const cDate = c.date?.toDate ? c.date.toDate() : new Date(c.date);
                return (
                    cDate.getMonth() === date.getMonth() && cDate.getFullYear() === date.getFullYear()
                );
            });

            const amount = monthContributions.reduce((sum: number, c: any) => sum + (c.amount || 0), 0);
            monthlyTrend.push({ month: monthName, amount });
        }

        return {
            success: true,
            data: {
                totalContributions,
                memberCount,
                averageContribution,
                topContributors,
                monthlyTrend,
            },
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
    data?: Array<{
        type: string;
        description: string;
        timestamp: Date;
        userId?: string;
    }>;
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

        return { success: true, data: activities };
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
): Promise<{ success: boolean; error?: string }> {
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

        return { success: true };

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
): Promise<{ success: boolean; error?: string }> {
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

        return { success: true };

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
): Promise<{ success: boolean; error?: string }> {
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

        await memberRef.update({
            membershipStatus: 'revision_required',
            revisionNote: reason,
            revisionRequestedAt: FieldValue.serverTimestamp(),
            revisionRequestedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        });

        if (userId) {
            await db.collection(COLLECTIONS.USERS).doc(userId).update({
                'serviceRegistrations.cooperatives.status': 'revision_required',
                updatedAt: FieldValue.serverTimestamp(),
            });
        }

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

        return { success: true };
    } catch (error) {
        logger.error('requestCooperativeRevisionAction error:', error);
        return { success: false, error: 'Failed to request revision' };
    }
}
