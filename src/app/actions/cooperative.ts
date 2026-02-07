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
    serverTimestamp,
    addDoc
} from "firebase/firestore";
import { auth } from "@/lib/auth";
import { COLLECTIONS } from "@/lib/types/firestore";
import {
    contributionSchema,
    cooperativeMembershipSchema,
    type MembershipRegistrationState
} from "@/lib/types/cooperative";
import type {
    CooperativeMembership,
    CooperativeTransaction,
    JoinCooperativeState,
    MakeContributionState,
    GetMembershipState,
    GetTransactionsState
} from "@/lib/types/cooperative";

/**
 * Server Actions for Cooperative Management
 * 
 * Handles cooperative membership, contributions, and transaction history.
 * Works with the existing submitWithdrawalAction for withdrawal requests.
 * 
 * PHASE 2 PRD ADDITIONS:
 * - Membership registration with Paystack integration
 * - Fixed savings management
 * - Loan application and management
 */

// ============================================
// MEMBERSHIP REGISTRATION (PRD Phase 2)
// =========================================

/**
 * Register a new cooperative member with Paystack payment integration
 */
export async function registerCooperativeMemberAction(
    formData: FormData
): Promise<MembershipRegistrationState> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "You must be logged in to register", success: false };
        }

        const userId = session.user.id;

        // Check if user is already a member
        const existingMemberRef = doc(db, "cooperative_members", userId);
        const existingMember = await getDoc(existingMemberRef);

        if (existingMember.exists()) {
            return { error: "You are already registered as a cooperative member", success: false };
        }

        // Parse and validate form data
        const rawData = {
            firstName: formData.get("firstName") as string,
            middleName: formData.get("middleName") as string || undefined,
            lastName: formData.get("lastName") as string,
            dateOfBirth: formData.get("dateOfBirth") as string,
            gender: formData.get("gender") as "male" | "female",
            email: formData.get("email") as string,
            phone: formData.get("phone") as string,
            stateOfOrigin: formData.get("stateOfOrigin") as string,
            lga: formData.get("lga") as string,
            residentialAddress: formData.get("residentialAddress") as string,
            occupation: formData.get("occupation") as string,
            nextOfKinName: formData.get("nextOfKinName") as string,
            nextOfKinPhone: formData.get("nextOfKinPhone") as string,
            nextOfKinAddress: formData.get("nextOfKinAddress") as string,
            membershipTier: formData.get("membershipTier") as "basic" | "premium",
        };

        // Validate with Zod
        const validationResult = cooperativeMembershipSchema.safeParse(rawData);
        if (!validationResult.success) {
            return {
                error: validationResult.error.issues[0]?.message || "Validation failed",
                success: false
            };
        }

        const validatedData = validationResult.data;
        const registrationFee = validatedData.membershipTier === "basic" ? 10000 : 20000;

        // Create membership record
        const membershipData = {
            userId,
            firstName: validatedData.firstName,
            middleName: validatedData.middleName,
            lastName: validatedData.lastName,
            dateOfBirth: validatedData.dateOfBirth,
            gender: validatedData.gender,
            email: validatedData.email,
            phone: validatedData.phone,
            stateOfOrigin: validatedData.stateOfOrigin,
            lga: validatedData.lga,
            residentialAddress: validatedData.residentialAddress,
            occupation: validatedData.occupation,
            nextOfKin: {
                name: validatedData.nextOfKinName,
                phone: validatedData.nextOfKinPhone,
                address: validatedData.nextOfKinAddress,
            },
            membershipTier: validatedData.membershipTier,
            registrationFee,
            membershipStatus: "pending" as const,
            paymentStatus: "pending" as const,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        // Save to Firestore
        await setDoc(existingMemberRef, membershipData);

        // Initialize Paystack payment
        const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
        if (!paystackSecretKey) {
            return {
                error: "Payment system not configured. Please contact support.",
                success: false
            };
        }

        const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${paystackSecretKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                email: validatedData.email,
                amount: registrationFee * 100, // Paystack expects amount in kobo
                metadata: {
                    userId,
                    membershipTier: validatedData.membershipTier,
                    purpose: "cooperative_membership_registration",
                },
                callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/cooperatives/payment/callback`,
            }),
        });

        if (!paystackResponse.ok) {
            return {
                error: "Failed to initialize payment. Please try again.",
                success: false
            };
        }

        const paystackData = await paystackResponse.json();

        if (!paystackData.status || !paystackData.data?.authorization_url) {
            return {
                error: "Failed to generate payment link. Please try again.",
                success: false
            };
        }

        // Update membership with payment reference
        await updateDoc(existingMemberRef, {
            paymentReference: paystackData.data.reference,
        });

        return {
            error: null,
            success: true,
            message: "Registration initiated. Redirecting to payment...",
            paymentUrl: paystackData.data.authorization_url,
        };
    } catch (error) {
        console.error("Membership registration failed:", error);
        return {
            error: error instanceof Error ? error.message : "Registration failed. Please try again.",
            success: false
        };
    }
}

// ============================================
// EXISTING ACTIONS (from original file)
// ============================================

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

        // Check if user is already a member
        const membershipsRef = collection(db, COLLECTIONS.COOPERATIVE_MEMBERS);
        const q = query(
            membershipsRef,
            where("userId", "==", userId),
            where("cooperativeId", "==", cooperativeId)
        );
        const existingMembership = await getDocs(q);

        if (!existingMembership.empty) {
            return { error: "You are already a member of this cooperative", success: false };
        }

        // Create membership
        const membershipRef = doc(membershipsRef);
        await setDoc(membershipRef, {
            userId,
            cooperativeId,
            savingsBalance: initialContribution,
            loanBalance: 0,
            memberSince: serverTimestamp(),
            monthlyTarget: 50000,
            status: "active"
        });

        // Record initial contribution if any
        if (initialContribution > 0) {
            const transactionsRef = collection(db, COLLECTIONS.COOPERATIVE_TRANSACTIONS);
            await addDoc(transactionsRef, {
                userId,
                cooperativeId,
                type: "contribution",
                amount: initialContribution,
                date: serverTimestamp(),
                status: "completed",
                description: "Initial contribution upon joining"
            });

            // Update cooperative total savings
            await updateDoc(cooperativeRef, {
                totalSavings: increment(initialContribution),
                memberCount: increment(1)
            });
        } else {
            await updateDoc(cooperativeRef, {
                memberCount: increment(1)
            });
        }

        return {
            error: null,
            success: true,
            message: "Successfully joined the cooperative"
        };
    } catch (error) {
        console.error("Join cooperative failed:", error);
        return {
            error: error instanceof Error ? error.message : "Failed to join cooperative",
            success: false
        };
    }
}

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

        // Parse and validate form data
        const rawData = {
            cooperativeId: formData.get("cooperativeId") as string,
            amount: Number(formData.get("amount")),
            type: formData.get("type") as "savings" | "loan_repayment",
        };

        const validationResult = contributionSchema.safeParse(rawData);
        if (!validationResult.success) {
            return {
                error: validationResult.error.issues[0]?.message || "Invalid contribution data",
                success: false
            };
        }

        const { cooperativeId, amount, type } = validationResult.data;

        // Verify membership
        const membershipsRef = collection(db, COLLECTIONS.COOPERATIVE_MEMBERS);
        const q = query(
            membershipsRef,
            where("userId", "==", userId),
            where("cooperativeId", "==", cooperativeId)
        );
        const membershipSnapshot = await getDocs(q);

        if (membershipSnapshot.empty) {
            return { error: "You are not a member of this cooperative", success: false };
        }

        const membershipDoc = membershipSnapshot.docs[0];

        // Record transaction
        const transactionsRef = collection(db, COLLECTIONS.COOPERATIVE_TRANSACTIONS);
        await addDoc(transactionsRef, {
            userId,
            cooperativeId,
            type,
            amount,
            date: serverTimestamp(),
            status: "completed",
            description: type === "savings" ? "Savings contribution" : "Loan repayment"
        });

        // Update balances
        if (type === "savings") {
            await updateDoc(membershipDoc.ref, {
                savingsBalance: increment(amount)
            });

            const cooperativeRef = doc(db, COLLECTIONS.COOPERATIVES, cooperativeId);
            await updateDoc(cooperativeRef, {
                totalSavings: increment(amount)
            });
        } else {
            await updateDoc(membershipDoc.ref, {
                loanBalance: increment(-amount)
            });
        }

        return {
            error: null,
            success: true,
            message: `Successfully contributed ₦${amount.toLocaleString()}`
        };
    } catch (error) {
        console.error("Contribution failed:", error);
        return {
            error: error instanceof Error ? error.message : "Failed to make contribution",
            success: false
        };
    }
}

export async function getMembershipAction(): Promise<GetMembershipState> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "You must be logged in", success: false };
        }

        const userId = session.user.id;
        const membershipsRef = collection(db, COLLECTIONS.COOPERATIVE_MEMBERS);
        const q = query(membershipsRef, where("userId", "==", userId));
        const membershipSnapshot = await getDocs(q);

        if (membershipSnapshot.empty) {
            return { error: "You are not a member of any cooperative", success: false };
        }

        const membershipData = membershipSnapshot.docs[0].data();
        const cooperativeDoc = await getDoc(
            doc(db, COLLECTIONS.COOPERATIVES, membershipData.cooperativeId)
        );

        const membership: CooperativeMembership = {
            cooperativeId: membershipData.cooperativeId,
            cooperativeName: cooperativeDoc.data()?.name || "Unknown Cooperative",
            savingsBalance: membershipData.savingsBalance || 0,
            loanBalance: membershipData.loanBalance || 0,
            memberSince: membershipData.memberSince?.toDate() || new Date(),
            monthlyTarget: membershipData.monthlyTarget || 50000,
        };

        return {
            error: null,
            success: true,
            data: membership
        };
    } catch (error) {
        console.error("Failed to get membership:", error);
        return {
            error: error instanceof Error ? error.message : "Failed to get membership",
            success: false
        };
    }
}

export async function getTransactionsAction(): Promise<GetTransactionsState> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "You must be logged in", success: false };
        }

        const userId = session.user.id;
        const transactionsRef = collection(db, COLLECTIONS.COOPERATIVE_TRANSACTIONS);
        const q = query(transactionsRef, where("userId", "==", userId));
        const transactionsSnapshot = await getDocs(q);

        const transactions: CooperativeTransaction[] = transactionsSnapshot.docs.map(doc => ({
            id: doc.id,
            type: doc.data().type,
            amount: doc.data().amount,
            date: doc.data().date?.toDate() || new Date(),
            status: doc.data().status,
            description: doc.data().description,
        }));

        return {
            error: null,
            success: true,
            data: transactions
        };
    } catch (error) {
        console.error("Failed to get transactions:", error);
        return {
            error: error instanceof Error ? error.message : "Failed to get transactions",
            success: false
        };
    }
}

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
