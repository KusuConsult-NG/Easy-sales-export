/**
 * Cooperative Utilities
 * Helper functions for cooperative balance and credit management
 */

"use server";

import { auth } from "@/lib/auth";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { getMaxLoanAmount } from "@/lib/cooperative-tiers";

const doc = (dbInstance: any, collectionName: string, id: string) => dbInstance.doc(collectionName, id);
const getDoc = async (ref: any) => ref.get();

/**
 * How much a member may draw against their savings, after what they already owe.
 *
 * A FOURTH COPY OF THE LOAN MULTIPLIER LIVED HERE, TWICE.
 *
 * Both call sites read `savingsBalance * 0.5 - loanBalance`. That 0.5 is
 * COOPERATIVE_TIERS.Member.maxLoanMultiplier, which was itself corrected from 3
 * to 0.5 — cooperative-tiers.ts still carries the note: "Previously 3 — a member
 * could borrow three times their savings, six times more than intended."
 *
 * lib/testing/policy-constant-scan.ts exists specifically to stop the next copy
 * of that rule, and it did not catch these two. Its rule is "a numeric literal
 * ASSIGNED to a policy-named variable", and here the literal sits inside an
 * arithmetic expression instead. The scan has been widened; see the note there.
 *
 * getMaxLoanAmount also picks the tier, so if a second tier is ever added this
 * stays correct instead of silently applying the Member multiplier to everyone.
 */
function availableCreditFor(savingsBalance: number, loanBalance: number): number {
    return Math.max(0, getMaxLoanAmount(savingsBalance) - loanBalance);
}

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

        const memberRef = doc(db, COLLECTIONS.COOPERATIVE_MEMBERS, session.user.id);
        const memberDoc = await getDoc(memberRef);

        if (!memberDoc.exists) {
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

        const memberRef = doc(db, COLLECTIONS.COOPERATIVE_MEMBERS, session.user.id);
        const memberDoc = await getDoc(memberRef);

        if (!memberDoc.exists) {
            return {
                success: true,
                eligible: false,
                availableCredit: 0,
            };
        }

        const data = memberDoc.data();
        const savingsBalance = data.savingsBalance || 0;
        const loanBalance = data.loanBalance || 0;
        const availableCredit = availableCreditFor(savingsBalance, loanBalance);

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

        const memberRef = doc(db, COLLECTIONS.COOPERATIVE_MEMBERS, session.user.id);
        const memberDoc = await getDoc(memberRef);

        if (!memberDoc.exists) {
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

        const memberRef = doc(db, COLLECTIONS.COOPERATIVE_MEMBERS, session.user.id);
        const memberDoc = await getDoc(memberRef);

        if (!memberDoc.exists) {
            return { success: false, error: "Not a member" };
        }

        const data = memberDoc.data();
        const savingsBalance = data.savingsBalance || 0;
        const loanBalance = data.loanBalance || 0;
        const availableCredit = availableCreditFor(savingsBalance, loanBalance);

        // Fetch active loans to get next payment
        let nextPaymentDate: Date | undefined;
        let nextPaymentAmount: number | undefined;

        if (loanBalance > 0) {
            /**
             * `memberId`, not `userId`.
             *
             * Every other query against COOPERATIVE_LOANS in the cooperative
             * module filters on `memberId` — that is the field the loan rows are
             * written with. This one asked for `userId`, matched nothing, and
             * left nextPaymentDate and nextPaymentAmount permanently undefined:
             * a dashboard widget whose whole purpose is "when is my next
             * payment" that could never answer. Same shape as #49 and #88, a
             * query keyed on a field the writers do not set.
             */
            const loansQuery = db.collection(COLLECTIONS.COOPERATIVE_LOANS)
                .where('memberId', '==', session.user.id)
                .where('status', 'in', ['disbursed', 'approved'])
                .orderBy('nextPaymentDate', 'asc')
                .limit(1);

            const loansSnapshot = await loansQuery.get();

            if (!loansSnapshot.empty) {
                const loanData = loansSnapshot.docs[0].data() as any;
                nextPaymentDate = loanData.nextPaymentDate?.toDate ? loanData.nextPaymentDate.toDate() : (loanData.nextPaymentDate ? new Date(loanData.nextPaymentDate) : undefined);
                nextPaymentAmount = loanData.nextPaymentAmount || loanData.monthlyPayment;
            }
        }

        const stats = {
            savingsBalance,
            loanBalance,
            availableCredit,
            nextPaymentDate,
            nextPaymentAmount,
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
