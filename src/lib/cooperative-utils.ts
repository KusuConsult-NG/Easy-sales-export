/**
 * Cooperative Utilities
 * Helper functions for cooperative balance and credit management
 */

"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

/**
 * Get user's cooperative balance
 */
export async function getCooperativeBalance(): Promise<{
    success: boolean;
    balance?: number;
    error?: string;
}> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        const memberRef = doc(db, "cooperative_members", session.user.id);
        const memberDoc = await getDoc(memberRef);

        if (!memberDoc.exists()) {
            return { success: false, error: "Not a cooperative member" };
        }

        const data = memberDoc.data();
        return {
            success: true,
            balance: data.savingsBalance || 0,
        };
    } catch (error) {
        console.error("Get cooperative balance error:", error);
        return { success: false, error: "Failed to fetch balance" };
    }
}

/**
 * Check if user can use cooperative credit for a purchase
 */
export async function checkCooperativeCreditEligibility(amount: number): Promise<{
    success: boolean;
    eligible?: boolean;
    availableCredit?: number;
    error?: string;
}> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        const memberRef = doc(db, "cooperative_members", session.user.id);
        const memberDoc = await getDoc(memberRef);

        if (!memberDoc.exists()) {
            return {
                success: true,
                eligible: false,
                availableCredit: 0,
            };
        }

        const data = memberDoc.data();
        const savingsBalance = data.savingsBalance || 0;
        const loanBalance = data.loanBalance || 0;

        // Credit is 50% of savings balance minus outstanding loans
        const availableCredit = Math.max(0, savingsBalance * 0.5 - loanBalance);

        return {
            success: true,
            eligible: availableCredit >= amount,
            availableCredit,
        };
    } catch (error) {
        console.error("Check credit eligibility error:", error);
        return { success: false, error: "Failed to check eligibility" };
    }
}

/**
 * Get cooperative membership status
 */
export async function getCooperativeMembershipStatus(): Promise<{
    success: boolean;
    isMember?: boolean;
    status?: "pending" | "active" | "suspended";
    error?: string;
}> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        const memberRef = doc(db, "cooperative_members", session.user.id);
        const memberDoc = await getDoc(memberRef);

        if (!memberDoc.exists()) {
            return {
                success: true,
                isMember: false,
            };
        }

        const data = memberDoc.data();
        return {
            success: true,
            isMember: true,
            status: data.membershipStatus,
        };
    } catch (error) {
        console.error("Get membership status error:", error);
        return { success: false, error: "Failed to check status" };
    }
}

/**
 * Get cooperative quick stats for dashboard widget
 */
export async function getCooperativeQuickStats(): Promise<{
    success: boolean;
    data?: {
        savingsBalance: number;
        loanBalance: number;
        availableCredit: number;
        nextPaymentDate?: Date;
        nextPaymentAmount?: number;
    };
    error?: string;
}> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        const memberRef = doc(db, "cooperative_members", session.user.id);
        const memberDoc = await getDoc(memberRef);

        if (!memberDoc.exists()) {
            return { success: false, error: "Not a member" };
        }

        const data = memberDoc.data();
        const savingsBalance = data.savingsBalance || 0;
        const loanBalance = data.loanBalance || 0;
        const availableCredit = Math.max(0, savingsBalance * 0.5 - loanBalance);

        // TODO: Fetch next payment from loans collection
        // For now returning mock data
        const stats = {
            savingsBalance,
            loanBalance,
            availableCredit,
            nextPaymentDate: loanBalance > 0 ? new Date("2026-03-01") : undefined,
            nextPaymentAmount: loanBalance > 0 ? 45000 : undefined,
        };

        return {
            success: true,
            data: stats,
        };
    } catch (error) {
        console.error("Get quick stats error:", error);
        return { success: false, error: "Failed to fetch stats" };
    }
}
