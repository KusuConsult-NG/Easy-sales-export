"use server";

import { db } from "@/lib/firebase";
import {
    collection,
    query,
    where,
    getDocs,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    increment,
    serverTimestamp
} from "firebase/firestore";
import { auth } from "@/lib/auth";
import { COLLECTIONS } from "@/lib/types/firestore";
import { z } from "zod";

/**
 * Server Actions for Cooperative Management
 * 
 * Handles cooperative membership, contributions, and transaction history.
 * Works with the existing submitWithdrawalAction for withdrawal requests.
 */

// Contribution Schema
export const contributionSchema = z.object({
    cooperativeId: z.string().min(1, "Cooperative ID is required"),
    amount: z.number().positive("Amount must be greater than 0"),
    type: z.enum(["savings", "loan_repayment"], {
        message: "Please select contribution type",
    }),
});

export type ContributionFormData = z.infer<typeof contributionSchema>;

// Type definitions
export type CooperativeMembership = {
    cooperativeId: string;
    cooperativeName: string;
    savingsBalance: number;
    loanBalance: number;
    memberSince: Date;
    monthlyTarget: number;
};

export type CooperativeTransaction = {
    id: string;
    type: "contribution" | "withdrawal" | "loan" | "loan_repayment";
    amount: number;
    date: Date;
    status: string;
    description: string;
};

type ActionErrorState = {
    error: string;
    success: false;
};

type JoinSuccessState = {
    error: null;
    success: true;
    message: string;
};

type ContributionSuccessState = {
    error: null;
    success: true;
    message: string;
};

type MembershipSuccessState = {
    error: null;
    success: true;
    data: CooperativeMembership;
};

type TransactionsSuccessState = {
    error: null;
    success: true;
    data: CooperativeTransaction[];
};

export type JoinCooperativeState = ActionErrorState | JoinSuccessState;
export type MakeContributionState = ActionErrorState | ContributionSuccessState;
export type GetMembershipState = ActionErrorState | MembershipSuccessState;
export type GetTransactionsState = ActionErrorState | TransactionsSuccessState;

// Alias for modal compatibility
export type ContributionActionState = MakeContributionState;
export type WithdrawalActionState =
    | { error: string; success: false }
    | { error: null; success: true; message: string };

export async function joinCooperativeAction(
    cooperativeId: string,
    initialContribution: number = 0
): Promise<JoinCooperativeState> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "You must be logged in to join a cooperative", success: false };
        }

        const userId = session.user.id;

        // Check if cooperative exists
        const cooperativeRef = doc(db, COLLECTIONS.COOPERATIVES, cooperativeId);
        const cooperativeDoc = await getDoc(cooperativeRef);

        if (!cooperativeDoc.exists()) {
            return { error: "Cooperative not found", success: false };
        }

        // Check if already a member
        const memberRef = doc(db, COLLECTIONS.COOPERATIVES, cooperativeId, "members", userId);
        const memberDoc = await getDoc(memberRef);

        if (memberDoc.exists()) {
            return { error: "You are already a member of this cooperative", success: false };
        }

        // Add user as member
        await setDoc(memberRef, {
            userId,
            balance: initialContribution,
            loanBalance: 0,
            joinedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        // Update cooperative member count
        await updateDoc(cooperativeRef, {
            memberCount: increment(1),
            totalSavings: increment(initialContribution),
        });

        // Update user's cooperativeId
        await updateDoc(doc(db, COLLECTIONS.USERS, userId), {
            cooperativeId,
            updatedAt: serverTimestamp(),
        });

        return {
            error: null,
            success: true,
            message: "Successfully joined the cooperative!",
        };
    } catch (error: any) {
        console.error("Join cooperative error:", error);
        return { error: "Failed to join cooperative. Please try again.", success: false };
    }
}

// ============================================
// Make Contribution Action
// ============================================

export async function makeContributionAction(
    prevState: MakeContributionState,
    formData: FormData
): Promise<MakeContributionState> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "You must be logged in to make a contribution", success: false };
        }

        const userId = session.user.id;

        // Extract and validate form data
        const contributionData = {
            cooperativeId: formData.get("cooperativeId") as string,
            amount: parseFloat(formData.get("amount") as string),
            type: formData.get("type") as "savings" | "loan_repayment",
        };

        // Validate with Zod
        const validatedData = contributionSchema.parse(contributionData);

        // Verify membership
        const memberRef = doc(
            db,
            COLLECTIONS.COOPERATIVES,
            validatedData.cooperativeId,
            "members",
            userId
        );
        const memberDoc = await getDoc(memberRef);

        if (!memberDoc.exists()) {
            return { error: "You are not a member of this cooperative", success: false };
        }

        // Update member balance
        if (validatedData.type === "savings") {
            await updateDoc(memberRef, {
                balance: increment(validatedData.amount),
                updatedAt: serverTimestamp(),
            });

            // Update cooperative total savings
            await updateDoc(doc(db, COLLECTIONS.COOPERATIVES, validatedData.cooperativeId), {
                totalSavings: increment(validatedData.amount),
            });
        } else {
            // Loan repayment
            const currentLoanBalance = memberDoc.data().loanBalance || 0;
            if (currentLoanBalance <= 0) {
                return { error: "You have no outstanding loan to repay", success: false };
            }

            const newLoanBalance = Math.max(0, currentLoanBalance - validatedData.amount);
            await updateDoc(memberRef, {
                loanBalance: newLoanBalance,
                updatedAt: serverTimestamp(),
            });
        }

        // Record transaction
        await setDoc(doc(collection(db, COLLECTIONS.TRANSACTIONS)), {
            userId,
            cooperativeId: validatedData.cooperativeId,
            type: validatedData.type,
            amount: validatedData.amount,
            timestamp: serverTimestamp(),
            status: "completed",
        });

        return {
            error: null,
            success: true,
            message: `Contribution of ₦${validatedData.amount.toLocaleString()} recorded successfully!`,
        };
    } catch (error: any) {
        console.error("Make contribution error:", error);

        if (error.name === "ZodError") {
            return { error: "Please fill in all required fields correctly", success: false };
        }

        return { error: "Failed to process contribution. Please try again.", success: false };
    }
}

// ============================================
// Get Cooperative Membership Action
// ============================================

export async function getCooperativeMembershipAction(): Promise<GetMembershipState> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        const userId = session.user.id;

        // Get user's cooperative ID
        const userDoc = await getDoc(doc(db, COLLECTIONS.USERS, userId));
        const cooperativeId = userDoc.data()?.cooperativeId;

        if (!cooperativeId) {
            return { error: "You are not a member of any cooperative", success: false };
        }

        // Get cooperative details
        const cooperativeDoc = await getDoc(doc(db, COLLECTIONS.COOPERATIVES, cooperativeId));
        if (!cooperativeDoc.exists()) {
            return { error: "Cooperative not found", success: false };
        }

        // Get member details
        const memberDoc = await getDoc(
            doc(db, COLLECTIONS.COOPERATIVES, cooperativeId, "members", userId)
        );
        if (!memberDoc.exists()) {
            return { error: "Membership record not found", success: false };
        }

        const cooperativeData = cooperativeDoc.data();
        const memberData = memberDoc.data();

        const membership: CooperativeMembership = {
            cooperativeId,
            cooperativeName: cooperativeData.name,
            savingsBalance: memberData.balance || 0,
            loanBalance: memberData.loanBalance || 0,
            memberSince: memberData.joinedAt?.toDate() || new Date(),
            monthlyTarget: cooperativeData.monthlyTarget || 0,
        };

        return {
            error: null,
            success: true,
            data: membership,
        };
    } catch (error: any) {
        console.error("Get membership error:", error);
        return { error: "Failed to fetch membership details", success: false };
    }
}

// ============================================
// Get Cooperative Transactions Action
// ============================================

export async function getCooperativeTransactionsAction(
    cooperativeId: string
): Promise<GetTransactionsState> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        const userId = session.user.id;

        // Verify membership
        const memberDoc = await getDoc(
            doc(db, COLLECTIONS.COOPERATIVES, cooperativeId, "members", userId)
        );
        if (!memberDoc.exists()) {
            return { error: "You are not a member of this cooperative", success: false };
        }

        // Fetch transactions
        const transactionsQuery = query(
            collection(db, COLLECTIONS.TRANSACTIONS),
            where("userId", "==", userId),
            where("cooperativeId", "==", cooperativeId)
        );

        const snapshot = await getDocs(transactionsQuery);

        const transactions: CooperativeTransaction[] = snapshot.docs.map(doc => ({
            id: doc.id,
            type: doc.data().type,
            amount: doc.data().amount,
            date: doc.data().timestamp?.toDate() || new Date(),
            status: doc.data().status,
            description: doc.data().description || `${doc.data().type} transaction`,
        }));

        // Sort by date (most recent first)
        transactions.sort((a, b) => b.date.getTime() - a.date.getTime());

        return {
            error: null,
            success: true,
            data: transactions,
        };
    } catch (error: any) {
        console.error("Get transactions error:", error);
        return { error: "Failed to fetch transactions", success: false };
    }
}

// ============================================
// Get User Tier Action
// ============================================

/**
 * Get user's cooperative tier for access control
 */
export async function getUserTierAction(): Promise<{
    tier: "Basic" | "Premium" | null;
    totalContributions: number;
}> {
    try {
        const session = await auth();

        if (!session?.user) {
            return { tier: null, totalContributions: 0 };
        }

        const membershipRef = doc(db, COLLECTIONS.COOPERATIVE_MEMBERS, session.user.id);
        const membershipDoc = await getDoc(membershipRef);

        if (!membershipDoc.exists()) {
            return { tier: null, totalContributions: 0 };
        }

        const data = membershipDoc.data();
        const totalContributions = data.totalContributions || 0;

        const { calculateUserTier } = await import("@/lib/cooperative-tiers");
        const tier = calculateUserTier(totalContributions);

        return { tier, totalContributions };
    } catch (error) {
        console.error("Failed to get user tier:", error);
        return { tier: null, totalContributions: 0 };
    }
}
