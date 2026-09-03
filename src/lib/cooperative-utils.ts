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
             *   #335 THE FIX FOR THIS WIDGET LANDED ON THE FILTER KEY AND LEFT
             *        THE ORDER KEY AND BOTH READ FIELDS EQUALLY UNWRITTEN.
             *
             *        The note that stood here recorded a real repair — the
             *        query asked for `userId` where the loan rows carry
             *        `memberId` — and concluded that the widget could now
             *        answer "when is my next payment". It still could not:
             *
             *            .orderBy('nextPaymentDate', 'asc')      nothing writes it
             *            loanData.nextPaymentDate                nothing writes it
             *            loanData.nextPaymentAmount              nothing writes it
             *
             *        _loans_applications.ts writes `monthlyPayment` and a
             *        SCHEDULE; neither of the two fields read here is on a loan
             *        document, anywhere. So the order key ordered nothing (and
             *        `.limit(1)` therefore picked an arbitrary loan), the date
             *        came back undefined every time, and CooperativeWidget
             *        guards the whole block on `stats.nextPaymentDate &&` — so
             *        the panel this exists to fill has never rendered, taking
             *        the amount beside it along with it.
             *
             *        Same shape as #83 and #297: one half of a path corrected
             *        and its siblings missed, with the correcting comment left
             *        implying the whole thing was done.
             *
             *        WHERE THE ANSWER ACTUALLY LIVES. Instalments are rows in
             *        LOAN_REPAYMENTS, each with loanId, userId, dueDate,
             *        totalAmount, paidAmount and status —
             *        _loans_repayments.ts writes them at disbursement. The
             *        member's own /cooperatives/my-loans page already derives
             *        the next payment from exactly that: the first instalment
             *        still "pending" or "partial", and totalAmount - paidAmount
             *        as the sum owed. This is the same derivation, so the
             *        widget and the page can no longer disagree.
             *
             *        Filtered on `userId` alone and ordered in JavaScript, on
             *        purpose: `userId` is an equality filter on a field the
             *        writer sets, and a member has at most a few dozen
             *        instalments. Ordering by dueDate in the query would put a
             *        JSONB timestamp key back in the sort position — which is
             *        what this finding is about.
             */
            const instalmentsSnapshot = await db.collection(COLLECTIONS.LOAN_REPAYMENTS)
                .where('userId', '==', session.user.id)
                .get();

            const outstanding = instalmentsSnapshot.docs
                .map((doc: any) => doc.data() as any)
                .filter((inst: any) => inst?.status === 'pending' || inst?.status === 'partial')
                .map((inst: any) => ({
                    due: inst.dueDate?.toDate
                        ? inst.dueDate.toDate()
                        : (inst.dueDate ? new Date(inst.dueDate) : undefined),
                    owed: (Number(inst.totalAmount) || 0) - (Number(inst.paidAmount) || 0),
                }))
                .filter((inst) => inst.due instanceof Date && !Number.isNaN(inst.due.getTime()))
                .sort((a, b) => a.due!.getTime() - b.due!.getTime());

            if (outstanding.length > 0) {
                nextPaymentDate = outstanding[0].due;
                nextPaymentAmount = outstanding[0].owed;
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
