"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
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
import { revalidatePath } from "next/cache";

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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
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
                channels: ["bank_transfer", "card", "bank", "ussd"], // Broaden allowed channels to prevent payment failures
                metadata: {
                    userId,
                    membershipId: userId,
                    membershipTier: tier,
                    type: "cooperative_membership_registration",
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        if (!session?.user) {
            return { error: "You must be logged in to register", success: false };
        }

        const userId = session.user.id;

        // Check for existing partial record with payment
        const existingMemberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
        const existingMember = await existingMemberRef.get();

        // Legacy import members already have paymentStatus=completed set by the script.
        // We create the member doc below if it doesn't exist (defensive).
        if (!existingMember.exists) {
            return { error: "No membership record found. Please complete payment first.", success: false };
        }

        const memberData = existingMember.data();

        // 🔒 Verify Payment Status
        // Legacy import members (_importSource present) already have paymentStatus='completed'
        // set by the admin import script — they never went through Paystack, so we skip
        // the payment gate for them. For all other members, payment must be confirmed.
        const isLegacyImport = Boolean(memberData?._importSource);
        if (!isLegacyImport && memberData?.paymentStatus !== "completed") {
            return {
                error: "Payment not verified. Please ensure you have completed the payment step.",
                success: false,
            };
        }

        // Parse and validate form data
        const rawData = {
            firstName: formData.get("firstName") as string,
            otherName: formData.get("otherName") as string || undefined,
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
            membershipTier: (memberData?.membershipTier ?? "basic") as "basic" | "premium",
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

        // 🔒 DEDUP GUARD: Collection-level phone & email check
        // Catches cross-account duplicates (same phone/email, different account)
        const [coopPhoneExists, coopEmailExists] = await Promise.all([
            db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where("phone", "==", validatedData.phone)
                .limit(1)
                .get(),
            db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where("email", "==", validatedData.email)
                .limit(1)
                .get(),
        ]);

        // Allow only if the match is for the SAME user (edit path)
        const phoneDoc = (coopPhoneExists as any).docs?.[0];
        const emailDoc = (coopEmailExists as any).docs?.[0];

        if (!coopPhoneExists.empty && phoneDoc?.id !== userId) {
            return { error: "A cooperative member with this phone number already exists.", success: false };
        }
        if (!coopEmailExists.empty && emailDoc?.id !== userId) {
            return { error: "A cooperative member with this email address already exists.", success: false };
        }

        // Update membership record with profile data
        const updatedData = {
            firstName: validatedData.firstName,
            otherName: validatedData.otherName || null,
            lastName: validatedData.lastName,
            fullName: [validatedData.firstName, validatedData.otherName, validatedData.lastName]
                .filter(Boolean).join(" ").trim(),
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
            // Flag to distinguish "form submitted" from "payment initiated"
            onboardingCompleted: true,
            updatedAt: FieldValue.serverTimestamp(),
        };

        // Save to Firestore (Merge)
        await existingMemberRef.update(updatedData);

        // Update user service registration and sync profile data for global modules (like Admin Communication Hub)
        // Dot notation prevents cross-module data loss
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            "serviceRegistrations.cooperatives.status": "pending",
            "serviceRegistrations.cooperatives.membershipTier": validatedData.membershipTier,
            "serviceRegistrations.cooperatives.onboardingCompletedAt": FieldValue.serverTimestamp(),

            // Sync KYC name fields for Admin Communication Hub & admin portal
            firstName: validatedData.firstName,
            lastName: validatedData.lastName,
            otherName: validatedData.otherName || null,
            fullName: [validatedData.firstName, validatedData.otherName, validatedData.lastName]
                .filter(Boolean).join(" ").trim(),

            // Sync other PII for cross-module functionality
            phone: validatedData.phone,
            gender: validatedData.gender,
            "address.state": validatedData.stateOfOrigin,
            "address.lga": validatedData.lga,
            "address.street": validatedData.residentialAddress,

            updatedAt: FieldValue.serverTimestamp(),
        });

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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
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

        // Atomic batch: all 3-4 writes committed together so no partial state on crash.
        const batch = db.batch();

        const newMemberRef = membershipsRef.doc();
        batch.set(newMemberRef, {
            userId,
            cooperativeId,
            savingsBalance: initialContribution,
            loanBalance: 0,
            memberSince: FieldValue.serverTimestamp(),
            monthlyTarget: 50000,
            status: "active"
        });

        const cooperativeUpdateData: Record<string, any> = {
            memberCount: FieldValue.increment(1)
        };

        if (initialContribution > 0) {
            const txRef = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).doc();
            batch.set(txRef, {
                userId,
                cooperativeId,
                type: "contribution",
                amount: initialContribution,
                date: FieldValue.serverTimestamp(),
                status: "completed",
                description: "Initial contribution upon joining"
            });
            cooperativeUpdateData.totalSavings = FieldValue.increment(initialContribution);
        }

        batch.update(cooperativeRef, cooperativeUpdateData);
        await batch.commit();

        revalidatePath("/cooperatives");
        revalidatePath("/dashboard/cooperatives");

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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
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

        // Atomic transaction: Record contribution + update both balances in one commit.
        // Without this, two concurrent contributions can both read the old balance
        // before either write lands, causing double-counting in cooperative totals.
        await db.runTransaction(async (t) => {
            // Re-read membership inside transaction for consistency
            const freshMembership = await t.get(membershipDoc.ref);
            if (!freshMembership.exists) throw new Error("Membership not found");

            const txRef = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).doc();
            t.set(txRef, {
                userId,
                cooperativeId,
                type,
                amount,
                date: FieldValue.serverTimestamp(),
                status: "completed",
                description: type === "savings" ? "Savings contribution" : "Loan repayment"
            });

            if (type === "savings") {
                t.update(membershipDoc.ref, {
                    savingsBalance: FieldValue.increment(amount)
                });
                t.update(db.collection(COLLECTIONS.COOPERATIVES).doc(cooperativeId), {
                    totalSavings: FieldValue.increment(amount)
                });
            } else {
                t.update(membershipDoc.ref, {
                    loanBalance: FieldValue.increment(-amount)
                });
            }
        });

        revalidatePath("/cooperatives");
        revalidatePath("/dashboard/cooperatives");

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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { tier: null, totalContributions: 0 };
        const { session } = sessionResult;

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
// Check Cooperative Application Status Action
// ============================================

export async function checkCooperativeStatusAction(): Promise<string | null> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null;
        const { session } = sessionResult;

        // ── PRIMARY: Check central user document for service registration ──
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        // Support both key variants:
        //  - 'cooperatives' (plural) — written by registerCooperativeMemberAction post-V2
        //  - 'cooperative' (singular) — written by the legacy import script
        const registration =
            userData?.serviceRegistrations?.cooperative ||
            userData?.serviceRegistrations?.cooperatives;

        if (registration?.status) {
            // 'legacy_pending_onboarding' is a sentinel set by the import script.
            // Pass it through so OnboardingClient knows to show the form without payment.
            return registration.status;
        }

        // ── FALLBACK: cooperative_members doc predates V2 schema ─────────
        const memberSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .doc(session.user.id)
            .get();

        if (memberSnap.exists) {
            const memberData = memberSnap.data()!;
            // Legacy import members: paymentStatus=completed but onboardingCompleted=false
            if (memberData.paymentStatus === 'completed' && !memberData.onboardingCompleted) {
                return 'legacy_pending_onboarding';
            }
            const derivedStatus = memberData.membershipStatus ?? memberData.status ?? 'pending';

            // Backfill the user doc so future reads hit the fast path
            await db.collection(COLLECTIONS.USERS).doc(session.user.id).set(
                { serviceRegistrations: { cooperatives: { status: derivedStatus, syncedFromLegacy: true, syncedAt: new Date().toISOString() } } },
                { merge: true }
            );
            logger.info(`[checkCooperativeStatus] Backfilled status '${derivedStatus}' for user ${session.user.id}`);
            return derivedStatus;
        }

        return null;
    } catch (error) {
        logger.error("Error checking cooperative status:", error);
        return null;
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
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

        await db.runTransaction(async (t) => {
            // Verify membership and eligibility
            const membershipsRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);
            const membershipSnapshot = await t.get(membershipsRef.where("userId", "==", userId));

            if (membershipSnapshot.empty) {
                throw new Error("You must be a cooperative member to apply for a loan");
            }

            const membershipDoc = membershipSnapshot.docs[0];
            const membershipData = membershipDoc.data();

            // 1. Check for active loans (Prevent multiple active loans if policy requires)
            const loansRef = db.collection(COLLECTIONS.COOPERATIVE_LOANS);
            const activeLoansQuery = loansRef
                .where("memberId", "==", userId)
                .where("status", "in", ["pending", "approved", "disbursed"]);
            const activeLoansSnap = await t.get(activeLoansQuery);

            if (!activeLoansSnap.empty) {
                throw new Error("You already have an active or pending loan application");
            }

            // 2. Check Loan Limit (e.g., 3x Savings Balance)
            const savingsBalance = membershipData.savingsBalance || 0;
            const maxLoanAmount = savingsBalance * 3;

            if (amount > maxLoanAmount) {
                throw new Error(`Loan amount exceeds your limit of ₦${maxLoanAmount.toLocaleString()} (3x Savings)`);
            }

            // 3. Get Loan Product Details (Simulated/fetched)
            let interestRate = 5; // Default 5%
            let durationMonths = 6;

            const productDoc = await t.get(db.collection(COLLECTIONS.COOPERATIVE_LOAN_PRODUCTS).doc(productId));
            if (productDoc.exists) {
                const prod = productDoc.data()!;
                interestRate = prod.interestRate;
                durationMonths = prod.durationMonths;
            }

            const interestAmount = amount * (interestRate / 100);
            const totalRepayment = amount + interestAmount;
            const monthlyPayment = totalRepayment / durationMonths;

            // Create Loan Application
            const newLoanRef = loansRef.doc();
            t.set(newLoanRef, {
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
        });

        return {
            error: null,
            success: true,
            message: "Loan application submitted successfully. It is now under review."
        };

    } catch (error: any) {
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
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
            const fixedSavingsRef = db.collection(COLLECTIONS.COOPERATIVE_FIXED_SAVINGS).doc();
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
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
            const withdrawalRef = db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).doc();
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
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

// ============================================================================
// REVISION FLOW — Fetch existing application data & resubmit
// ============================================================================

/**
 * Get the current user's existing cooperative onboarding data (for pre-populating edit form)
 */
export async function getCooperativeApplicationAction(): Promise<{
    success: boolean;
    data?: any;
    revisionNote?: string;
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        if (!session?.user) return { success: false, error: 'Unauthorized' };

        // Find the member doc by userId
        const snap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .where('userId', '==', session.user.id)
            .limit(1)
            .get();

        if (snap.empty) return { success: false, error: 'No application found' };

        const data = snap.docs[0].data();
        return { success: true, data, revisionNote: data?.revisionNote };
    } catch (error) {
        logger.error('getCooperativeApplicationAction error:', error);
        return { success: false, error: 'Failed to fetch application' };
    }
}

/**
 * Resubmit cooperative application after a revision request
 */
export async function resubmitCooperativeApplicationAction(
    formData: FormData
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        if (!session?.user) return { success: false, error: 'Unauthorized' };

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const existingStatus = userDoc.data()?.serviceRegistrations?.cooperatives?.status;

        const allowedStatuses = ['pending', 'revision_required'];
        if (!allowedStatuses.includes(existingStatus)) {
            return { success: false, error: 'Your application cannot be resubmitted at this time.' };
        }

        // Find the existing member doc
        const snap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .where('userId', '==', session.user.id)
            .limit(1)
            .get();

        if (snap.empty) return { success: false, error: 'No existing application found' };

        const memberRef = snap.docs[0].ref;

        const first = (formData.get('firstName') as string || '').trim();
        const other = (formData.get('otherName') as string || '').trim();
        const last = (formData.get('lastName') as string || '').trim();
        const updatePayload: Record<string, any> = {
            firstName: first,
            otherName: other || null,
            lastName: last,
            fullName: [first, other, last].filter(Boolean).join(' '),
            dateOfBirth: formData.get('dateOfBirth') || '',
            gender: formData.get('gender') || '',
            email: formData.get('email') || '',
            phone: formData.get('phone') || '',
            occupation: formData.get('occupation') || '',
            stateOfOrigin: formData.get('stateOfOrigin') || '',
            lga: formData.get('lga') || '',
            residentialAddress: formData.get('residentialAddress') || '',
            nextOfKinName: formData.get('nextOfKinName') || '',
            nextOfKinPhone: formData.get('nextOfKinPhone') || '',
            nextOfKinAddress: formData.get('nextOfKinAddress') || '',
            membershipStatus: 'pending',
            revisionNote: null,
            resubmittedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        if (formData.get('validIdUrl')) {
            updatePayload['documents.validIdUrl'] = formData.get('validIdUrl');
            updatePayload['documents.validIdName'] = formData.get('validIdName') || '';
        }
        if (formData.get('passportPhotoUrl')) {
            updatePayload['documents.passportPhotoUrl'] = formData.get('passportPhotoUrl');
        }
        if (formData.get('proofOfAddressUrl')) {
            updatePayload['documents.proofOfAddressUrl'] = formData.get('proofOfAddressUrl');
        }

        const batch = db.batch();
        batch.update(memberRef, updatePayload);
        
        batch.update(db.collection(COLLECTIONS.USERS).doc(session.user.id), {
            'serviceRegistrations.cooperatives.status': 'pending',
            updatedAt: FieldValue.serverTimestamp(),
        });

        await batch.commit();

        return { success: true };
    } catch (error) {
        logger.error('resubmitCooperativeApplicationAction error:', error);
        return { success: false, error: 'Failed to resubmit application' };
    }
}

// ============================================
// MEMBER ID CARD
// ============================================

export type MemberIdCardData = {
    fullName: string;
    memberNumber: string;
    membershipTier: "basic" | "premium";
    gender: string;
    stateOfOrigin: string;
    passportPhotoUrl: string | null;
    joinedAt: string;
    validUntil: string;
    membershipStatus: string;
    paymentStatus: string;
};

/**
 * Get member data for ID card rendering.
 * Gate 1: paymentStatus === 'completed' (Paystack verified)
 * Gate 2: membershipStatus === 'active' (admin approved)
 */
export async function getCooperativeMemberIdCardAction(): Promise<{
    success: boolean;
    data?: MemberIdCardData;
    error?: string;
    reason?: "payment_required" | "pending_approval" | "not_member";
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: "Not authenticated", reason: "not_member" };
        const { session } = sessionResult;

        const userId = session.user.id;
        const memberDoc = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).get();

        if (!memberDoc.exists) {
            return { success: false, error: "No cooperative membership found.", reason: "not_member" };
        }

        const d = memberDoc.data()!;

        // Gate 1: Paystack payment must be verified
        if (d.paymentStatus !== "completed") {
            return {
                success: false,
                error: "Your membership fee payment has not been verified. Please complete payment to access your ID card.",
                reason: "payment_required",
            };
        }

        // Gate 2: Admin must have approved
        if (d.membershipStatus !== "active") {
            return {
                success: false,
                error: "Your membership is pending admin approval. Your ID card will be available once approved.",
                reason: "pending_approval",
                data: {
                    fullName: `${d.firstName || ""} ${d.lastName || ""}`.trim(),
                    memberNumber: "",
                    membershipTier: d.membershipTier || "basic",
                    gender: d.gender || "",
                    stateOfOrigin: d.stateOfOrigin || "",
                    passportPhotoUrl: d.documents?.passportPhoto?.url || null,
                    joinedAt: "",
                    validUntil: "",
                    membershipStatus: d.membershipStatus || "pending",
                    paymentStatus: d.paymentStatus || "completed",
                },
            };
        }

        // Deterministic member number — no extra write needed
        const joinedAt: Date = d.createdAt?.toDate ? d.createdAt.toDate() : new Date();
        const joinYear = joinedAt.getFullYear();
        const memberNumber = `ESE-COOP-${joinYear}-${userId.slice(0, 6).toUpperCase()}`;

        const validUntil = new Date(joinedAt);
        validUntil.setFullYear(validUntil.getFullYear() + 1);

        return {
            success: true,
            data: {
                fullName: `${d.firstName || ""} ${d.lastName || ""}`.trim(),
                memberNumber,
                membershipTier: d.membershipTier || "basic",
                gender: d.gender || "",
                stateOfOrigin: d.stateOfOrigin || "",
                passportPhotoUrl: d.documents?.passportPhoto?.url || null,
                joinedAt: joinedAt.toISOString(),
                validUntil: validUntil.toISOString(),
                membershipStatus: d.membershipStatus,
                paymentStatus: d.paymentStatus,
            },
        };
    } catch (error) {
        logger.error("getCooperativeMemberIdCardAction error:", error);
        return { success: false, error: "Failed to load ID card data. Please try again." };
    }
}

/**
 * Update passport photo for existing cooperative members
 * Works for members at any status (pending, active) who need to add/replace their passport
 */
export async function updatePassportPhotoAction(
    passportUrl: string,
    passportName: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: "Not authenticated" };
        const { session } = sessionResult;

        const userId = session.user.id;
        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
        const memberDoc = await memberRef.get();

        if (!memberDoc.exists) {
            return { success: false, error: "No cooperative membership found. Please register first." };
        }

        await memberRef.update({
            "documents.passportPhoto": {
                name: passportName,
                url: passportUrl,
            },
            updatedAt: FieldValue.serverTimestamp(),
        });

        revalidatePath("/cooperatives/id-card");

        return { success: true };
    } catch (error) {
        logger.error("updatePassportPhotoAction error:", error);
        return { success: false, error: "Failed to update passport photo. Please try again." };
    }
}
