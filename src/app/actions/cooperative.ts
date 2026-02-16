"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { auth } from "@/lib/auth";
import { COLLECTIONS } from "@/lib/types/firestore";
import {
    contributionSchema,
    cooperativeMembershipSchema,
    loanApplicationSchema,
    fixedSavingsSchema,
    type MembershipRegistrationState,
    type LoanApplicationState,
    type FixedSavingsState,
    type WithdrawalActionState
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
/**
 * 1. INITIATE PAYMENT (Step 1)
 * Creates a partial membership record and initializes Paystack
 */
export async function initiateCooperativePaymentAction(
    tier: "basic" | "premium"
): Promise<{
    success: boolean;
    paymentUrl?: string;
    error?: string;
}> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "You must be logged in", success: false };
        }

        const userId = session.user.id;
        const registrationFee = tier === "basic" ? 10000 : 20000;

        // Create or update partial membership record
        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);

        // Check if already paid
        const memberDoc = await memberRef.get();
        if (memberDoc.exists && memberDoc.data()?.paymentStatus === "completed") {
            return { error: "You have already paid. Please proceed to onboarding.", success: false };
        }

        await memberRef.set({
            userId,
            membershipTier: tier,
            registrationFee,
            membershipStatus: "pending",
            paymentStatus: "pending",
            updatedAt: FieldValue.serverTimestamp(),
            // Preserve creation date if exists
            createdAt: memberDoc.exists ? memberDoc.data()?.createdAt : FieldValue.serverTimestamp(),
        }, { merge: true });

        // Initialize Paystack
        const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
        if (!paystackSecretKey) {
            return { error: "Payment system not configured", success: false };
        }

        const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${paystackSecretKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                email: session.user.email,
                amount: registrationFee * 100,
                metadata: {
                    userId,
                    membershipTier: tier,
                    purpose: "cooperative_membership_registration",
                },
                callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/cooperatives/payment/callback`,
            }),
        });

        if (!paystackResponse.ok) {
            return { error: "Failed to initialize payment", success: false };
        }

        const paystackData = await paystackResponse.json();

        if (!paystackData.status || !paystackData.data?.authorization_url) {
            return { error: "Failed to generate payment link", success: false };
        }

        // Save reference
        await memberRef.update({
            paymentReference: paystackData.data.reference,
        });

        return {
            success: true,
            paymentUrl: paystackData.data.authorization_url,
        };

    } catch (error) {
        logger.error("Initiate payment failed:", error);
        return { error: "Failed to initiate payment", success: false };
    }
}

/**
 * 2. COMPLETE REGISTRATION (Step 2)
 * Submits profile data after payment is confirmed.
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

        // Check for existing partial record with payment
        const existingMemberRef = db.collection("cooperative_members").doc(userId);
        const existingMember = await existingMemberRef.get();

        if (!existingMember.exists) {
            return { error: "No membership record found. Please complete payment first.", success: false };
        }

        const memberData = existingMember.data();

        // 🔒 Verify Payment Status
        if (memberData?.paymentStatus !== "completed") {
            return {
                error: "Payment not verified. Please ensure you have completed the payment step.",
                success: false,
                // Optional: Provide payment URL again?
            };
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
            // Membership Tier comes from existing record, but we can validate if sent
            membershipTier: memberData.membershipTier as "basic" | "premium",
        };

        // Extract document data
        const documents = {
            validId: formData.get("validIdUrl") ? {
                name: formData.get("validIdName") as string,
                url: formData.get("validIdUrl") as string,
            } : undefined,
            passportPhoto: formData.get("passportPhotoUrl") ? {
                name: formData.get("passportPhotoName") as string,
                url: formData.get("passportPhotoUrl") as string,
            } : undefined,
            proofOfAddress: formData.get("proofOfAddressUrl") ? {
                name: formData.get("proofOfAddressName") as string,
                url: formData.get("proofOfAddressUrl") as string,
            } : undefined,
        };

        const bvn = formData.get("bvn") as string || undefined;

        // Validate with Zod
        const validationResult = cooperativeMembershipSchema.safeParse(rawData);
        if (!validationResult.success) {
            return {
                error: validationResult.error.issues[0]?.message || "Validation failed",
                success: false
            };
        }

        const validatedData = validationResult.data;

        // Update membership record with profile data
        const updatedData = {
            firstName: validatedData.firstName,
            middleName: validatedData.middleName,
            lastName: validatedData.lastName,
            dateOfBirth: validatedData.dateOfBirth,
            gender: validatedData.gender, // Make sure this matches schema
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
            documents: {
                validId: documents.validId,
                passportPhoto: documents.passportPhoto,
                proofOfAddress: documents.proofOfAddress,
            },
            bvn: bvn,
            // Keep status as pending (admin review needed)
            membershipStatus: "pending",
            updatedAt: FieldValue.serverTimestamp(),
        };

        // Save to Firestore (Merge)
        await existingMemberRef.update(updatedData);

        // Update user service registration
        await db.collection(COLLECTIONS.USERS).doc(userId).set({
            serviceRegistrations: {
                cooperatives: {
                    status: "pending",
                    membershipTier: validatedData.membershipTier,
                    onboardingCompletedAt: FieldValue.serverTimestamp(),
                }
            },
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        return {
            error: null,
            success: true,
            message: "Application submitted successfully.",
        };
    } catch (error) {
        logger.error("Membership registration failed:", error);
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
        const cooperativeRef = db.collection(COLLECTIONS.COOPERATIVES).doc(cooperativeId);
        const cooperativeDoc = await cooperativeRef.get();

        if (!cooperativeDoc.exists) {
            return { error: "Cooperative not found", success: false };
        }

        // Check if user is already a member
        const membershipsRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);
        const existingMembership = await membershipsRef
            .where("userId", "==", userId)
            .where("cooperativeId", "==", cooperativeId)
            .get();

        if (!existingMembership.empty) {
            return { error: "You are already a member of this cooperative", success: false };
        }

        // Create membership
        await membershipsRef.add({
            userId,
            cooperativeId,
            savingsBalance: initialContribution,
            loanBalance: 0,
            memberSince: FieldValue.serverTimestamp(),
            monthlyTarget: 50000,
            status: "active"
        });

        // Record initial contribution if any
        if (initialContribution > 0) {
            const transactionsRef = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS);
            await transactionsRef.add({
                userId,
                cooperativeId,
                type: "contribution",
                amount: initialContribution,
                date: FieldValue.serverTimestamp(),
                status: "completed",
                description: "Initial contribution upon joining"
            });

            // Update cooperative total savings
            await cooperativeRef.update({
                totalSavings: FieldValue.increment(initialContribution),
                memberCount: FieldValue.increment(1)
            });
        } else {
            await cooperativeRef.update({
                memberCount: FieldValue.increment(1)
            });
        }

        return {
            error: null,
            success: true,
            message: "Successfully joined the cooperative"
        };
    } catch (error) {
        logger.error("Join cooperative failed:", error);
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

        if (amount <= 0) {
            return { error: "Contribution amount must be positive", success: false };
        }

        // Verify membership
        const membershipsRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);
        const membershipSnapshot = await membershipsRef
            .where("userId", "==", userId)
            .where("cooperativeId", "==", cooperativeId)
            .get();

        if (membershipSnapshot.empty) {
            return { error: "You are not a member of this cooperative", success: false };
        }

        const membershipDoc = membershipSnapshot.docs[0];

        // Record transaction
        await db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).add({
            userId,
            cooperativeId,
            type,
            amount,
            date: FieldValue.serverTimestamp(),
            status: "completed",
            description: type === "savings" ? "Savings contribution" : "Loan repayment"
        });

        // Update balances
        if (type === "savings") {
            await membershipDoc.ref.update({
                savingsBalance: FieldValue.increment(amount)
            });

            await db.collection(COLLECTIONS.COOPERATIVES).doc(cooperativeId).update({
                totalSavings: FieldValue.increment(amount)
            });
        } else {
            await membershipDoc.ref.update({
                loanBalance: FieldValue.increment(-amount)
            });
        }

        return {
            error: null,
            success: true,
            message: `Successfully contributed ₦${amount.toLocaleString()}`
        };
    } catch (error) {
        logger.error("Contribution failed:", error);
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
        const membershipsRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);
        const membershipSnapshot = await membershipsRef.where("userId", "==", userId).get();

        if (membershipSnapshot.empty) {
            return { error: "You are not a member of any cooperative", success: false };
        }

        const membershipData = membershipSnapshot.docs[0].data();
        const cooperativeDoc = await db.collection(COLLECTIONS.COOPERATIVES).doc(membershipData.cooperativeId).get();

        const membership: CooperativeMembership = {
            id: membershipSnapshot.docs[0].id,
            cooperativeId: membershipData.cooperativeId || "default", // Handle missing cooperativeId?
            cooperativeName: cooperativeDoc.data()?.name || "KusuConsult Cooperative", // Fallback
            savingsBalance: membershipData.savingsBalance || 0,
            loanBalance: membershipData.loanBalance || 0,
            memberSince: membershipData.memberSince?.toDate?.() || membershipData.createdAt?.toDate?.() || new Date(),
            monthlyTarget: membershipData.monthlyTarget || 50000,
            membershipTier: membershipData.membershipTier || "basic",
            membershipStatus: membershipData.membershipStatus || "pending",
            paymentStatus: membershipData.paymentStatus || "pending",
        };

        return {
            error: null,
            success: true,
            data: membership
        };
    } catch (error) {
        logger.error("Failed to get membership:", error);
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
        const transactionsRef = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS);
        const transactionsSnapshot = await transactionsRef.where("userId", "==", userId).get();

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
        logger.error("Failed to get transactions:", error);
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

        const membershipRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(session.user.id);
        const membershipDoc = await membershipRef.get();

        if (!membershipDoc.exists) {
            return { tier: null, totalContributions: 0 };
        }

        const data = membershipDoc.data();
        // Check if data exists and has totalContributions, else 0. 
        // Note: data() returns undefined if not exists but we checked exists. 
        // But TS might want optional chaining or explicit cast.
        const totalContributions = data?.totalContributions || 0;

        const { calculateUserTier } = await import("@/lib/cooperative-tiers");
        const tier = calculateUserTier(totalContributions);

        return { tier, totalContributions };
    } catch (error) {
        logger.error("Failed to get user tier:", error);
        return { tier: null, totalContributions: 0 };
    }
}

// ============================================
// LOAN MANAGEMENT (PRD Phase 2)
// ============================================

export async function applyForLoanAction(
    prevState: LoanApplicationState,
    formData: FormData
): Promise<LoanApplicationState> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "You must be logged in to apply for a loan", success: false };
        }

        const userId = session.user.id;

        // Parse and validate
        const rawData = {
            productId: formData.get("productId") as string,
            amount: Number(formData.get("amount")),
            purpose: formData.get("purpose") as string,
        };

        const validationResult = loanApplicationSchema.safeParse(rawData);
        if (!validationResult.success) {
            return {
                error: validationResult.error.issues[0]?.message || "Invalid loan application",
                success: false
            };
        }

        const { productId, amount, purpose } = validationResult.data;

        // Verify membership and eligibility
        const membershipsRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);
        const membershipSnapshot = await membershipsRef.where("userId", "==", userId).get();

        if (membershipSnapshot.empty) {
            return { error: "You must be a cooperative member to apply for a loan", success: false };
        }

        const membershipDoc = membershipSnapshot.docs[0];
        const membershipData = membershipDoc.data();

        // 1. Check for active loans (Prevent multiple active loans if policy requires)
        const loansRef = db.collection("cooperative_loans");
        const activeLoans = await loansRef
            .where("memberId", "==", userId)
            .where("status", "in", ["pending", "approved", "disbursed"])
            .get();

        if (!activeLoans.empty) {
            return { error: "You already have an active or pending loan application", success: false };
        }

        // 2. Check Loan Limit (e.g., 3x Savings Balance)
        const savingsBalance = membershipData.savingsBalance || 0;
        const maxLoanAmount = savingsBalance * 3;

        if (amount > maxLoanAmount) {
            return {
                error: `Loan amount exceeds your limit of ₦${maxLoanAmount.toLocaleString()} (3x Savings)`,
                success: false
            };
        }

        // 3. Get Loan Product Details (Simulated/fetched)
        let interestRate = 5; // Default 5%
        let durationMonths = 6;

        const productDoc = await db.collection("cooperative_loan_products").doc(productId).get();
        if (productDoc.exists) {
            const prod = productDoc.data()!;
            interestRate = prod.interestRate;
            durationMonths = prod.durationMonths;
        }

        const interestAmount = amount * (interestRate / 100);
        const totalRepayment = amount + interestAmount;
        const monthlyPayment = totalRepayment / durationMonths;

        // Create Loan Application
        await loansRef.add({
            memberId: userId,
            productId,
            amount,
            purpose,
            interestAmount,
            totalRepayment,
            monthlyPayment,
            durationMonths,
            status: "pending",
            appliedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        return {
            error: null,
            success: true,
            message: "Loan application submitted successfully. It is now under review."
        };

    } catch (error) {
        logger.error("Loan application failed:", error);
        return {
            error: error instanceof Error ? error.message : "Failed to submit loan application",
            success: false
        };
    }
}

// ============================================
// FIXED SAVINGS (PRD Phase 2)
// ============================================

export async function createFixedSavingsAction(
    prevState: FixedSavingsState,
    formData: FormData
): Promise<FixedSavingsState> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "You must be logged in", success: false };
        }

        const userId = session.user.id;

        const rawData = {
            amount: Number(formData.get("amount")),
            durationMonths: Number(formData.get("durationMonths")),
        };

        const validationResult = fixedSavingsSchema.safeParse(rawData);
        if (!validationResult.success) {
            return {
                error: validationResult.error.issues[0]?.message || "Invalid input",
                success: false
            };
        }

        const { amount, durationMonths } = validationResult.data;

        if (amount <= 0) {
            return { error: "Amount must be positive", success: false };
        }

        // Transactional execution
        await db.runTransaction(async (transaction) => {
            // Check wallet/savings balance to ensure they have funds to lock
            const membershipsRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);
            const membershipSnapshot = await transaction.get(
                membershipsRef.where("userId", "==", userId)
            );

            if (membershipSnapshot.empty) {
                throw new Error("Membership not found");
            }

            const membershipDoc = membershipSnapshot.docs[0];
            const membershipRef = membershipDoc.ref;

            const currentSavings = membershipDoc.data().savingsBalance || 0;

            if (currentSavings < amount) {
                throw new Error("Insufficient savings balance to create this fixed savings plan");
            }

            // Deduct from main savings
            transaction.update(membershipRef, {
                savingsBalance: FieldValue.increment(-amount)
            });

            // Create Fixed Savings Record
            const fixedSavingsRef = db.collection("cooperative_fixed_savings").doc();
            transaction.set(fixedSavingsRef, {
                memberId: userId,
                amount,
                durationMonths,
                startDate: FieldValue.serverTimestamp(),
                status: "active",
                interestRate: 10, // Example: 10% p.a.
                createdAt: FieldValue.serverTimestamp(),
            });
        });

        return {
            error: null,
            success: true,
            message: `Fixed savings plan of ₦${amount.toLocaleString()} created successfully.`
        };

    } catch (error: any) {
        logger.error("Fixed savings creation failed:", error);
        return {
            error: error.message || "Failed to create fixed savings plan",
            success: false
        };
    }
}

// ============================================
// WITHDRAWALS
// ============================================

export async function submitWithdrawalAction(
    prevState: WithdrawalActionState,
    formData: FormData
): Promise<WithdrawalActionState> {
    try {
        const session = await auth();
        if (!session?.user) return { error: "Unauthorized", success: false };

        const amount = Number(formData.get("amount"));
        if (!amount || amount <= 0) return { error: "Invalid amount", success: false };

        const userId = session.user.id;

        await db.runTransaction(async (transaction) => {
            // Check balance
            const membershipsRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);
            const membershipSnapshot = await transaction.get(
                membershipsRef.where("userId", "==", userId)
            );

            if (membershipSnapshot.empty) throw new Error("Membership not found");

            const membershipDoc = membershipSnapshot.docs[0];
            const membershipRef = membershipDoc.ref;

            const balance = membershipDoc.data().savingsBalance || 0;

            if (balance < amount) {
                throw new Error("Insufficient funds");
            }

            // Deduct funds IMMEDIATELY (Escrow pattern)
            transaction.update(membershipRef, {
                savingsBalance: FieldValue.increment(-amount)
            });

            // Create withdrawal request
            const withdrawalRef = db.collection("cooperative_withdrawals").doc();
            transaction.set(withdrawalRef, {
                userId,
                amount,
                status: "pending",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        return { error: null, success: true, message: "Withdrawal request submitted for review. Funds have been reserved." };
    } catch (error: any) {
        logger.error("Withdrawal error:", error);
        return { error: error.message || "Failed to submit withdrawal", success: false };
    }
}

// ============================================
// DIRECTORY
// ============================================

export async function getDirectoryMembersAction(): Promise<{
    success: boolean;
    data?: any[];
    error?: string;
}> {
    try {
        const session = await auth();
        // Allow any logged in user? Or just admin? Assuming members can view directory.
        if (!session?.user) {
            return { error: "Unauthorized", success: false, data: [] };
        }

        const membershipsRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);
        // Only approved members
        const snapshot = await membershipsRef.where("membershipStatus", "==", "approved").get();

        const members = snapshot.docs.map((doc: any) => {
            const data = doc.data();
            return {
                id: doc.id,
                name: `${data.firstName} ${data.lastName}`,
                role: data.membershipTier === "premium" ? "Premium Member" : "Basic Member",
                location: `${data.lga}, ${data.stateOfOrigin}`,
                occupation: data.occupation,
                joined: data.createdAt?.toDate ? data.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : "Recent",
                image: data.documents?.passportPhoto?.url || null
            };
        });

        return { success: true, data: members };
    } catch (error) {
        logger.error("Failed to fetch directory:", error);
        return { error: "Failed to load directory", success: false };
    }
}
