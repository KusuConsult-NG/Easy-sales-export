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

        // Extract document data (uploaded to Firebase Storage)
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
            // Documents
            documents: {
                validId: documents.validId,
                passportPhoto: documents.passportPhoto,
                proofOfAddress: documents.proofOfAddress,
            },
            bvn: bvn,
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
            id: membershipSnapshot.docs[0].id,
            cooperativeId: membershipData.cooperativeId || "default", // Handle missing cooperativeId?
            cooperativeName: cooperativeDoc?.data()?.name || "KusuConsult Cooperative", // Fallback
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
        const membershipsRef = collection(db, COLLECTIONS.COOPERATIVE_MEMBERS);
        const q = query(membershipsRef, where("userId", "==", userId));
        const membershipSnapshot = await getDocs(q);

        if (membershipSnapshot.empty) {
            return { error: "You must be a cooperative member to apply for a loan", success: false };
        }

        const membershipDoc = membershipSnapshot.docs[0];
        const membershipData = membershipDoc.data();

        // 1. Check for active loans (Prevent multiple active loans if policy requires)
        const loansRef = collection(db, "cooperative_loans");
        const activeLoanQuery = query(
            loansRef,
            where("memberId", "==", userId),
            where("status", "in", ["pending", "approved", "disbursed"])
        );
        const activeLoans = await getDocs(activeLoanQuery);

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

        const productRef = doc(db, "cooperative_loan_products", productId);
        const productDoc = await getDoc(productRef);
        if (productDoc.exists()) {
            const prod = productDoc.data();
            interestRate = prod.interestRate;
            durationMonths = prod.durationMonths;
        }

        const interestAmount = amount * (interestRate / 100);
        const totalRepayment = amount + interestAmount;
        const monthlyPayment = totalRepayment / durationMonths;

        // Create Loan Application
        await addDoc(loansRef, {
            memberId: userId,
            productId,
            amount,
            purpose,
            interestAmount,
            totalRepayment,
            monthlyPayment,
            durationMonths,
            status: "pending",
            appliedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        return {
            error: null,
            success: true,
            message: "Loan application submitted successfully. It is now under review."
        };

    } catch (error) {
        console.error("Loan application failed:", error);
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

        // Check wallet/savings balance to ensure they have funds to lock
        const membershipsRef = collection(db, COLLECTIONS.COOPERATIVE_MEMBERS);
        const q = query(membershipsRef, where("userId", "==", userId));
        const membershipSnapshot = await getDocs(q);

        if (membershipSnapshot.empty) {
            return { error: "Membership not found", success: false };
        }

        const membershipDoc = membershipSnapshot.docs[0];
        const currentSavings = membershipDoc.data().savingsBalance || 0;

        if (currentSavings < amount) {
            return { error: "Insufficient savings balance to create this fixed savings plan", success: false };
        }

        // Deduct from main savings
        await updateDoc(membershipDoc.ref, {
            savingsBalance: increment(-amount)
        });

        // Create Fixed Savings Record
        await addDoc(collection(db, "cooperative_fixed_savings"), {
            memberId: userId,
            amount,
            durationMonths,
            startDate: serverTimestamp(),
            status: "active",
            interestRate: 10, // Example: 10% p.a.
            createdAt: serverTimestamp(),
        });

        return {
            error: null,
            success: true,
            message: `Fixed savings plan of ₦${amount.toLocaleString()} created successfully.`
        };

    } catch (error) {
        console.error("Fixed savings creation failed:", error);
        return {
            error: error instanceof Error ? error.message : "Failed to create fixed savings plan",
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

        // Check balance
        const membershipsRef = collection(db, COLLECTIONS.COOPERATIVE_MEMBERS);
        const q = query(membershipsRef, where("userId", "==", userId));
        const membershipSnapshot = await getDocs(q);

        if (membershipSnapshot.empty) return { error: "Membership not found", success: false };

        const membershipDoc = membershipSnapshot.docs[0];
        const balance = membershipDoc.data().savingsBalance || 0;

        if (balance < amount) {
            return { error: "Insufficient funds", success: false };
        }

        // Create withdrawal request
        await addDoc(collection(db, "cooperative_withdrawals"), {
            userId,
            amount,
            status: "pending",
            createdAt: serverTimestamp(),
        });

        return { error: null, success: true, message: "Withdrawal request submitted for review" };
    } catch (error) {
        return { error: "Failed to submit withdrawal", success: false };
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
        if (!session?.user) return { error: "Unauthorized", success: false };

        const membershipsRef = collection(db, COLLECTIONS.COOPERATIVE_MEMBERS);
        const q = query(membershipsRef, where("membershipStatus", "==", "approved")); // Only approved members
        const snapshot = await getDocs(q);

        const members = snapshot.docs.map(doc => {
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
        console.error("Failed to fetch directory:", error);
        return { error: "Failed to load directory", success: false };
    }
}
