"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logAuditAction } from "@/app/actions/audit";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { COLLECTIONS } from "@/lib/types/firestore";
import { COOPERATIVE_CONFIG } from "@/lib/constants";
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
import { withFlexibleSafeAction } from "@/lib/safe-action";
import type {
    CooperativeMembership,
    CooperativeTransaction,
    JoinCooperativeState,
    MakeContributionState,
    GetMembershipState,
    GetTransactionsState
} from "@/lib/types/cooperative";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";
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
async function _initiateCooperativePaymentAction(
    tier: "Member" = "Member"
): Promise<MembershipRegistrationState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user) {
            return { error: "You must be logged in", success: false };
        }

        const userId = session.user.id;
        const registrationFee = COOPERATIVE_CONFIG.registrationFee; // Reduced for low-barrier entry

        // Create or update partial membership record
        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);

        // Check if already active or paid
        const memberDoc = await memberRef.get();
        if (memberDoc.exists) {
            const data = memberDoc.data();
            if (data?.membershipStatus === "active") {
                return { error: "You are already an active cooperative member.", success: false };
            }
            if (data?.paymentStatus === "completed") {
                return { error: "You have already paid. Please proceed to onboarding.", success: false };
            }
        }

        await memberRef.set({
            userId,
            membershipTier: tier,
            registrationFee,
            membershipStatus: "pending",
            // Only set paymentStatus to pending if they haven't already paid
            paymentStatus: memberDoc.exists && memberDoc.data()?.paymentStatus === "completed" ? "completed" : "pending",
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
            success: true as const,
            error: null,
            data: { message: "Payment link generated", paymentUrl: paystackData.data.authorization_url },
            meta: null
        };

    } catch (error) {
        logger.error("Initiate cooperative payment failed:", {
            tier,
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: "Failed to initiate payment", success: false };
    }
}
export const initiateCooperativePaymentAction = withFlexibleSafeAction("initiateCooperativePaymentAction", _initiateCooperativePaymentAction);

/**
 * 2. COMPLETE REGISTRATION (Step 2)
 * Submits profile data after payment is confirmed.
 */
export async function registerCooperativeMemberAction(
    formData: FormData
): Promise<MembershipRegistrationState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user) {
            return { error: "You must be logged in to register", success: false };
        }

        const userId = session.user.id;
        const inviteToken = formData.get("inviteToken") as string | null;
        const expectedVersionStr = formData.get("_version") as string | null;
        const expectedVersion = expectedVersionStr ? parseInt(expectedVersionStr, 10) : undefined;

        // Check for existing partial record with payment
        const existingMemberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
        const existingMember = await existingMemberRef.get();
        const memberData = existingMember.data();

        let isLegacyImport = false;
        const membershipTier = (memberData?.membershipTier ?? "Member") as "Member";

        if (inviteToken) {
            if (existingMember.exists && memberData?.onboardingCompleted) {
                 return { error: "You have already completed onboarding.", success: false };
            }
            // Validate the token to allow bypassing payment
            const inviteRes = await validateCooperativeInviteAction(inviteToken);
            if (!inviteRes.success) {
                return { error: inviteRes.error || "Invalid invitation token", success: false };
            }
            isLegacyImport = true;
        } else {
            // Legacy check
            if (!existingMember.exists) {
                return { error: "No membership record found. Please complete payment first.", success: false };
            }

            if (memberData?.onboardingCompleted) {
                return { error: "You have already completed onboarding. Profile updates require admin approval.", success: false };
            }

            // 🔒 Verify Payment Status (Authoritative)
            isLegacyImport = Boolean(memberData?._importSource);
            if (!isLegacyImport && memberData?.paymentStatus !== "completed") {
                // Double check processedPayments collection
                const authPayment = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                    .where("userId", "==", userId)
                    .where("type", "==", "cooperative_membership_registration")
                    .where("status", "==", "completed")
                    .limit(1)
                    .get();

                if (authPayment.empty) {
                    return {
                        error: "Payment not verified. Please ensure you have completed the payment step.",
                        success: false as const,
                    };
                }
            }
        }

        // Parse and validate form data
        const rawData = {
            firstName: formData.get("firstName") as string,
            otherName: (formData.get("otherName") as string) || undefined,
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
            membershipTier: membershipTier,
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
        const phoneDoc = coopPhoneExists.docs?.[0];
        const emailDoc = coopEmailExists.docs?.[0];

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
            },
            bvn: formData.get("bvn") as string || undefined,
            // Flat state field for SMS geo-filter broadcast queries
            state: validatedData.stateOfOrigin,
            // Keep status as pending (admin review needed)
            membershipStatus: "pending",
            // Flag to distinguish "form submitted" from "payment initiated"
            onboardingCompleted: true,
            updatedAt: FieldValue.serverTimestamp(),
            // Increment version logic will be handled inside the transaction
        };

        // If from an invite, mark them as paid and from an invite source
        if (inviteToken) {
            Object.assign(updatedData, {
                paymentStatus: "completed",
                _importSource: "email_invite",
                userId: userId,
                createdAt: existingMember.exists ? memberData?.createdAt : FieldValue.serverTimestamp(),
            });
        }

        // Save to Firestore using a transaction for atomicity
        await db.runTransaction(async (transaction) => {
            // Re-read for version check
            const freshMember = await transaction.get(existingMemberRef);
            const freshData = freshMember.data();

            // Optimistic Locking Guard
            if (expectedVersion !== undefined && freshData?._version !== undefined && freshData._version !== expectedVersion) {
                throw new Error("STALE_DATA: Member record was updated by another process.");
            }

            // Calculate next version
            const nextVersion = (freshData?._version || 0) + 1;
            (updatedData as any)._version = nextVersion;

            // 1. Save/Merge Member Data
            transaction.set(existingMemberRef, updatedData, { merge: true });

            // 2. If an invite token was used, mark it as completed
            if (inviteToken) {
                transaction.update(db.collection(COLLECTIONS.COOPERATIVES_INVITES).doc(inviteToken), {
                    status: "used",
                    usedBy: userId,
                    usedAt: FieldValue.serverTimestamp()
                });
            }

            // 3. Update user service registration and sync profile data
            transaction.update(db.collection(COLLECTIONS.USERS).doc(userId), {
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
                stateOfOrigin: validatedData.stateOfOrigin,
                lga: validatedData.lga,
                residentialAddress: validatedData.residentialAddress,
                "address.state": validatedData.stateOfOrigin,
                "address.lga": validatedData.lga,
                "address.street": validatedData.residentialAddress,

                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        // 5. Post-Commit Side Effects (Secondary Integrations)
        if (inviteToken) {
            // Log as side-effect so it doesn't block the primary transaction
            logAuditAction("legacy_member_invited", userId, "cooperative_member", {
                 details: `Legacy member completed onboarding via invite token: ${inviteToken}`
            }).catch(err => logger.error("Deferred audit log failed:", err));
        }

        try {
            await invalidateUserCache(userId);
        } catch (err) {
            logger.error("Failed to invalidate cache after Cooperative application:", err);
        }

        return {
            error: null,
            success: true as const,
            data: { message: "Application submitted successfully." },
            meta: null
        };
    } catch (error) {
        logger.error("Membership registration failed:", {
            error: error instanceof Error ? error.message : String(error)
        });
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
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
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

        const cooperativeUpdateData: Record<string, FieldValue | number> = {
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

            // Universal ledger sync
            batch.set(db.collection(COLLECTIONS.TRANSACTIONS).doc(txRef.id), {
                id: txRef.id,
                userId,
                type: "contribution",
                module: "cooperative",
                amount: initialContribution,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference: txRef.id,
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
            success: true as const,
            data: { message: "Successfully joined the cooperative" },
            meta: null
        };
    } catch (error) {
        logger.error("Join cooperative failed:", {
            cooperativeId,
            error: error instanceof Error ? error.message : String(error)
        });
        return {
            error: error instanceof Error ? error.message : "Failed to join cooperative",
            success: false
        };
    }
}

async function _makeContributionAction(
    prevState: MakeContributionState,
    formData: FormData
): Promise<MakeContributionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
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

        const { cooperativeId, amount, type } = validationResult.data!;

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

            // Universal ledger sync
            t.set(db.collection(COLLECTIONS.TRANSACTIONS).doc(txRef.id), {
                id: txRef.id,
                userId,
                type: type,
                module: "cooperative",
                amount: amount,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference: txRef.id,
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
            success: true as const,
            data: { message: `Successfully contributed ₦${amount.toLocaleString()}` },
            meta: null
        };
    } catch (error) {
        logger.error("Contribution failed:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return {
            error: error instanceof Error ? error.message : "Failed to make contribution",
            success: false
        };
    }
}
export const makeContributionAction = withFlexibleSafeAction("makeContributionAction", _makeContributionAction);

async function _submitWithdrawalAction(
    prevState: WithdrawalActionState,
    formData: FormData
): Promise<WithdrawalActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user) {
            return { error: "You must be logged in", success: false };
        }

        const userId = session.user.id;
        const amount = Number(formData.get("amount"));
        const reason = formData.get("reason") as string;
        const bankAccountStr = formData.get("bankAccount") as string;
        let bankAccount = null;

        if (isNaN(amount) || amount <= 0) {
            return { error: "Amount must be greater than zero", success: false };
        }

        try {
            bankAccount = bankAccountStr ? JSON.parse(bankAccountStr) : null;
        } catch (e) {
            return { error: "Invalid bank account details", success: false };
        }

        await db.runTransaction(async (transaction) => {
            // Verify membership and balance
            const membershipsRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);
            const membershipDoc = await transaction.get(membershipsRef.doc(userId));
            if (!membershipDoc.exists || membershipDoc.data()?.membershipStatus !== "active") {
                throw new Error("You are not an active cooperative member");
            }

            const currentBalance = membershipDoc.data()?.savingsBalance || 0;
            if (amount > currentBalance) {
                throw new Error("Insufficient savings balance");
            }

            // Deduct funds IMMEDIATELY (Escrow pattern)
            transaction.update(membershipDoc.ref, {
                savingsBalance: FieldValue.increment(-amount),
                updatedAt: FieldValue.serverTimestamp()
            });

            // Create withdrawal request
            const withdrawalRef = db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).doc();
            transaction.set(withdrawalRef, {
                userId,
                amount,
                reason: reason || "Standard Withdrawal",
                bankAccount,
                status: "pending",
                requestedAt: FieldValue.serverTimestamp(),
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });
            // Log audit
            await logAuditAction(
                "withdrawal_requested",
                withdrawalRef.id,
                "withdrawal",
                { amount, reason }
            );
        });

        revalidatePath("/cooperatives/withdrawals");
        return { 
            success: true as const, 
            error: null,
            data: { message: "Withdrawal request submitted for review. Funds have been reserved." },
            meta: null
        };
    } catch (error) {
        logger.error("Withdrawal error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: error instanceof Error ? error.message : "Failed to submit withdrawal", success: false };
    }
}
export const submitWithdrawalAction = withFlexibleSafeAction("submitWithdrawalAction", _submitWithdrawalAction);

async function _getMembershipAction(): Promise<GetMembershipState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { error: sessionResult.error.error, success: false };
        const { session } = sessionResult;
        if (!session?.user) {
            return { error: "You must be logged in", success: false };
        }

        const userId = session.user.id;
        const snapshot = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .where("userId", "==", userId)
            .get();

        if (snapshot.empty) {
            return { error: "No membership found", success: false };
        }

        const doc = snapshot.docs[0];
        const membership = serializeDoc<CooperativeMembership>(doc.id, doc.data());

        return { success: true as const, error: null, data: { membership } };
    } catch (error) {
        logger.error("Get membership error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: error instanceof Error ? error.message : "An unexpected error occurred", success: false };
    }
}
export const getMembershipAction = withFlexibleSafeAction("getMembershipAction", _getMembershipAction);

async function _getTransactionsAction(): Promise<GetTransactionsState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { error: sessionResult.error.error, success: false };
        const { session } = sessionResult;
        if (!session?.user) {
            return { error: "You must be logged in", success: false };
        }

        const userId = session.user.id;
        const snapshot = await db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS)
            .where("userId", "==", userId)
            .orderBy("date", "desc")
            .get();

        const transactions = serializeDocs<CooperativeTransaction>(snapshot.docs);

        return { success: true as const, error: null, data: { transactions } };
    } catch (error) {
        logger.error("Get transactions error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: error instanceof Error ? error.message : "An unexpected error occurred", success: false };
    }
}
export const getTransactionsAction = withFlexibleSafeAction("getTransactionsAction", _getTransactionsAction);

async function _getUserTierAction(): Promise<{
    error: null, success: true | false;
    data?: {
        tier: "Member" | null;
        totalContributions: number;
    }
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { error: "Action failed", success: false as const, data: { tier: null, totalContributions: 0 } };
        const { session } = sessionResult;

        const membershipRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(session.user.id);
        const membershipDoc = await membershipRef.get();

        if (!membershipDoc.exists) {
            return { error: null, success: true as const, data: { tier: null, totalContributions: 0 } };
        }

        const data = membershipDoc.data();
        // Check if data exists and has totalContributions, else 0. 
        // Note: data() returns undefined if not exists but we checked exists. 
        // But TS might want optional chaining or explicit cast.
        const totalContributions = data?.totalContributions || 0;

        const { calculateUserTier } = await import("@/lib/cooperative-tiers");
        const tier = calculateUserTier(totalContributions);

        return { error: null, success: true as const, data: { tier, totalContributions } };
    } catch (error) {
        logger.error("Failed to get user tier:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: "Action failed", success: false as const, data: { tier: null, totalContributions: 0 } };
    }
}
export const getUserTierAction = withFlexibleSafeAction("getUserTierAction", _getUserTierAction);

// ============================================
// Check Cooperative Application Status Action
// ============================================

async function _checkCooperativeStatusAction(): Promise<string | null> {
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

        // ── FINAL AUTHORITATIVE CHECK: Paystack Records ─────────────────
        // If no profile status was found above, check the source of truth for payments.
        // This handles cases where a user just paid but the background sync hasn't
        // finished updating the member/user documents.
        const paymentsSnap = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
            .where("userId", "==", session.user.id)
            .where("type", "==", "cooperative_membership_registration")
            .where("status", "==", "completed")
            .limit(1)
            .get();

        if (!paymentsSnap.empty) {
            logger.info(`[checkCooperativeStatus] Auth-Paid status detected for user ${session.user.id}`);
            return "legacy_pending_onboarding"; // Allow them to proceed to fill the form
        }

        return null;
    } catch (error) {
        logger.error("Error checking cooperative status:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return null;
    }
}
export const checkCooperativeStatusAction = withFlexibleSafeAction("checkCooperativeStatusAction", _checkCooperativeStatusAction);

// ============================================
// LOAN MANAGEMENT (PRD Phase 2)
// ============================================

async function _applyForLoanAction(
    prevState: LoanApplicationState,
    formData: FormData
): Promise<LoanApplicationState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
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
            success: true as const,
            data: { message: "Loan application submitted successfully. It is now under review." },
            meta: null
        };

    } catch (error) {
        logger.error("Loan application failed:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return {
            error: error instanceof Error ? error.message : "Failed to submit loan application",
            success: false
        };
    }
}
export const applyForLoanAction = withFlexibleSafeAction("applyForLoanAction", _applyForLoanAction);

// ============================================
// FIXED SAVINGS (PRD Phase 2)
// ============================================

async function _createFixedSavingsAction(
    prevState: FixedSavingsState,
    formData: FormData
): Promise<FixedSavingsState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
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
            success: true as const,
            data: { message: `Fixed savings plan of ₦${amount.toLocaleString()} created successfully.` },
            meta: null
        };

    } catch (error) {
        logger.error("Fixed savings creation failed:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return {
            error: error instanceof Error ? error.message : "Failed to create fixed savings plan",
            success: false
        };
    }
}
export const createFixedSavingsAction = withFlexibleSafeAction("createFixedSavingsAction", _createFixedSavingsAction);

// ============================================
// WITHDRAWALS
// ============================================

// End of withdrawal management
// DIRECTORY
// ============================================

async function _getDirectoryMembersAction(): Promise<{
    error: null, success: true | false;
    meta?: any;
    data?: any;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        // Allow any logged in user? Or just admin? Assuming members can view directory.
        if (!session?.user) {
            return { error: "Unauthorized", success: false as const, data: [] };
        }

        const membershipsRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);
        // Only approved members
        const snapshot = await membershipsRef.where("membershipStatus", "==", "approved").get();

        const members = snapshot.docs
            .map((doc: any) => {
                const data = doc.data();
                // Real-time corruption check
                const isCorrupted = !data.firstName || 
                                   !data.lastName || 
                                   data.firstName === "undefined" || 
                                   data.lastName === "undefined";
                if (isCorrupted) return null;

                return {
                    id: doc.id,
                    name: `${data.firstName} ${data.lastName}`,
                    role: "Member",
                    location: `${data.lga}, ${data.stateOfOrigin}`,
                    occupation: data.occupation,
                    joined: data.createdAt?.toDate ? data.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : "Recent",
                    image: data.documents?.passportPhoto?.url || null,
                    phone: data.phone || ""
                };
            })
            .filter(Boolean); // Remove nulls (corrupted)

        return { error: null, success: true as const, data: { members }, meta: null };

    } catch (error) {
        logger.error("Failed to fetch directory:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: "Failed to load directory", success: false };
    }
}
export const getDirectoryMembersAction = withFlexibleSafeAction("getDirectoryMembersAction", _getDirectoryMembersAction);

// ============================================================================
// REVISION FLOW — Fetch existing application data & resubmit
// ============================================================================

/**
 * Get the current user's existing cooperative onboarding data (for pre-populating edit form)
 */
export async function getCooperativeApplicationAction(): Promise<{
    error: null, success: true | false;
    meta?: any;
    data?: any;
    revisionNote?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: 'Unauthorized' };

        // Find the member doc by userId
        const snap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .where('userId', '==', session.user.id)
            .get();

        if (snap.empty) return { success: false as const, error: 'No application found' };

        const sortedDocs = snap.docs.map(d => d.data()).sort((a: any, b: any) => {
            const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
            const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
            return bTime - aTime;
        });
        const data = sortedDocs[0];
        return { error: null, success: true as const, data: { application: data, revisionNote: data?.revisionNote }, meta: null };
    } catch (error) {
        logger.error('getCooperativeApplicationAction error:', {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: 'Failed to fetch application' };
    }
}

/**
 * Resubmit cooperative application after a revision request
 */
export async function resubmitCooperativeApplicationAction(
    formData: FormData
): Promise<{ error: string | null, success: true | false; meta?: any; data?: any;  }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: 'Unauthorized' };

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const existingStatus = userDoc.data()?.serviceRegistrations?.cooperatives?.status;

        const allowedStatuses = ['pending', 'revision_required'];
        if (!allowedStatuses.includes(existingStatus)) {
            return { success: false as const, error: 'Your application cannot be resubmitted at this time.' };
        }

        // Find the existing member doc
        const snap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .where('userId', '==', session.user.id)
            .get();

        if (snap.empty) return { success: false as const, error: 'No existing application found' };

        const sortedDocs = snap.docs.sort((a, b) => {
            const aTime = a.data().createdAt?.toMillis?.() || a.data().createdAt?.seconds * 1000 || 0;
            const bTime = b.data().createdAt?.toMillis?.() || b.data().createdAt?.seconds * 1000 || 0;
            return bTime - aTime;
        });
        const memberRef = sortedDocs[0].ref;

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

        try {
            await invalidateUserCache(session.user.id);
        } catch (err) {
            logger.error("Failed to invalidate cache after Cooperative application resubmission:", err);
        }

        return { error: null, success: true as const, data: { message: "Application resubmitted successfully." }, meta: null };
    } catch (error) {
        logger.error('resubmitCooperativeApplicationAction error:', {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: 'Failed to resubmit application' };
    }
}

// ============================================
// MEMBER ID CARD
// ============================================

export type MemberIdCardData = {
    fullName: string;
    memberNumber: string;
    membershipTier: "Member";
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
    error: null, success: true | false;
    meta?: any;
    data?: MemberIdCardData;
    reason?: "payment_required" | "pending_approval" | "not_member";
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Not authenticated", reason: "not_member" };
        const { session } = sessionResult;

        const userId = session.user.id;
        const memberDoc = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).get();

        if (!memberDoc.exists) {
            return { success: false as const, error: "No cooperative membership found.", reason: "not_member" };
        }

        const d = memberDoc.data()!;

        // Gate 1: Paystack payment must be verified
        if (d.paymentStatus !== "completed") {
            return {
                success: false as const,
                error: "Your membership fee payment has not been verified. Please complete payment to access your ID card.",
                reason: "payment_required",
            };
        }

        // Gate 2: Admin must have approved
        if (d.membershipStatus !== "active") {
            return {
                success: false as const,
                error: "Your membership is pending admin approval. Your ID card will be available once approved.",
                reason: "pending_approval",
                data: {
                    fullName: `${d.firstName || ""} ${d.lastName || ""}`.trim(),
                    memberNumber: "",
                    membershipTier: d.membershipTier || "Member",
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
            error: null, success: true as const,
            data: {
                fullName: `${d.firstName || ""} ${d.lastName || ""}`.trim(),
                memberNumber,
                membershipTier: d.membershipTier || "Member",
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
        return { success: false as const, error: "Failed to load ID card data. Please try again." };
    }
}

/**
 * Update passport photo for existing cooperative members
 * Works for members at any status (pending, active) who need to add/replace their passport
 */
export async function updatePassportPhotoAction(
    passportUrl: string,
    passportName: string
): Promise<{ error: string | null, success: true | false; meta?: any; data?: any;  }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Not authenticated" };
        const { session } = sessionResult;

        const userId = session.user.id;
        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
        const memberDoc = await memberRef.get();

        if (!memberDoc.exists) {
            return { success: false as const, error: "No cooperative membership found. Please register first." };
        }

        await memberRef.update({
            "documents.passportPhoto": {
                name: passportName,
                url: passportUrl,
            },
            updatedAt: FieldValue.serverTimestamp(),
        });

        revalidatePath("/cooperatives/id-card");

        return { error: null, success: true as const, data: { message: "Passport photo updated" }, meta: null };
    } catch (error) {
        logger.error("updatePassportPhotoAction error:", error);
        return { success: false as const, error: "Failed to update passport photo. Please try again." };
    }
}

// ============================================
// COOPERATIVE INVITES
// ============================================

export async function validateCooperativeInviteAction(
    token: string
): Promise<{ error: string | null, success: true | false; meta?: any; data?: any;  }> {
    try {
        if (!token) return { success: false as const, error: "Invalid token" };

        const inviteRef = db.collection(COLLECTIONS.COOPERATIVES_INVITES).doc(token);
        const inviteDoc = await inviteRef.get();

        if (!inviteDoc.exists) {
            return { success: false as const, error: "Invalid or expired invitation link." };
        }

        const data = inviteDoc.data()!;

        if (data.status !== "pending") {
            return { success: false as const, error: "This invitation has already been used or revoked." };
        }

        return {
            error: null, success: true as const,
            data: {
                email: data.email,
            },
            meta: null
        };

    } catch (error: any) {
        logger.error("validateCooperativeInviteAction error:", error);
        return { success: false as const, error: "Failed to validate invitation link. Please try again." };
    }
}
