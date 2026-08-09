"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { waveApplicationSchema,
    academyEnrollmentSchema,
    withdrawalSchema } from "@/lib/schemas";
import { COLLECTIONS } from "@/lib/types/firestore";
import { claimIdempotencyKey, debitJsonbBalance } from "@/lib/wallet-ledger";
import { ZodError } from "zod";
import { revalidatePath } from "next/cache";
import { parseCurrencyStringToFloat } from "@/lib/utils";

/**
 * Server Actions for Platform Forms
 * 
 * Handles WAVE applications, Academy enrollments, and Cooperative withdrawals
 * with Firestore integration and validation.
 */

// Type definitions for action return states
type ActionErrorState = { error: string;
    success: false;
    data?: null;
    meta?: null; };

type WaveSuccessState = { error: null;
    success: true;
    message: string;
    applicationId: string; };

type EnrollmentSuccessState = { error: null;
    success: true;
    message: string;
    enrollmentId: string; };

type WithdrawalSuccessState = { error: null;
    success: true;
    message: string;
    withdrawalId: string; };

export type WaveApplicationState = ActionErrorState | WaveSuccessState;
export type EnrollmentActionState = ActionErrorState | EnrollmentSuccessState;
export type WithdrawalActionState = ActionErrorState | WithdrawalSuccessState;


// ============================================
// WAVE Application Actions
// ============================================

export async function submitWaveApplicationAction(
    prevState: WaveApplicationState,
    formData: FormData
): Promise<WaveApplicationState> { try {
        // Get authenticated user
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;

        // Extract and validate form data
        const applicationData = { fullName: (formData.get("fullName") as string | null)?.trim() ?? "",
            email: (formData.get("email") as string | null)?.trim() ?? "",
            phone: (formData.get("phone") as string | null)?.trim() ?? "",
            gender: (formData.get("gender") as string | null)?.trim() ?? "",
            businessName: (formData.get("businessName") as string | null)?.trim() ?? "",
            businessType: (formData.get("businessType") as string | null)?.trim() ?? "",
            yearsInBusiness: (() => { const y = parseInt((formData.get("yearsInBusiness") as string | null) ?? "0", 10); return isNaN(y) ? 0 : y; })(),
            reasonForApplying: (formData.get("reasonForApplying") as string | null)?.trim() ?? "" };

        // Validate with Zod (enforces female-only validation)
        const validatedData = waveApplicationSchema.parse(applicationData);

        // Double-check gender enforcement at server level
        if (validatedData.gender.toLowerCase() !== "female") { return { error: "WAVE Program is exclusively for female entrepreneurs", success: false as const };
        }

        // Generate application ID
        const applicationId = `WAVE-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

        // Save to Firestore
        await db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(applicationId).set({ ...validatedData,
            userId: session.user.id,
            status: "pending", // pending | approved | rejected
            applicationDate: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() });

        return { error: null, success: true as const, message: "Application submitted successfully! We'll review it within 1 week.", applicationId  };
    } catch (error: any) { logger.error("WAVE application error:", error);

        if (error.name === "ZodError") {
            const zodError = error as ZodError;
            const firstError = zodError.issues[0];
            return { error: firstError?.message || "Please fill in all required fields correctly", success: false as const };
        }

        return { error: "Failed to submit application. Please try again.", success: false as const };
    }
}

// ============================================
// Academy Enrollment Actions
// ============================================

export async function enrollInCourseAction(
    prevState: EnrollmentActionState,
    formData: FormData
): Promise<EnrollmentActionState> { try {
        // Get authenticated user
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;

        // Extract and validate form data
        const enrollmentData = { fullName: (formData.get("fullName") as string | null)?.trim() ?? "",
            email: (formData.get("email") as string | null)?.trim() ?? "",
            phone: (formData.get("phone") as string | null)?.trim() ?? "",
            courseId: (formData.get("courseId") as string | null)?.trim() ?? "" };

        // Validate with Zod
        const validatedData = academyEnrollmentSchema.parse(enrollmentData);

        // Check if user already enrolled in this course
        const enrollmentId = `${session.user.id}_${validatedData.courseId}`;
        const enrollmentRef = db.collection(COLLECTIONS.ENROLLMENTS).doc(enrollmentId);
        const existingEnrollment = await enrollmentRef.get();

        if (existingEnrollment.exists) { return { error: "You are already enrolled in this course", success: false as const };
        }

        // Save enrollment to Firestore
        await enrollmentRef.set({ userId: session.user.id,
            courseId: validatedData.courseId,
            fullName: validatedData.fullName,
            email: validatedData.email,
            phone: validatedData.phone,
            enrollmentDate: FieldValue.serverTimestamp(),
            status: "active", // active | completed | dropped
            progress: 0,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() });

        // Increment course student count (if course document exists)
        const courseRef = db.collection(COLLECTIONS.COURSES).doc(validatedData.courseId);
        const courseDoc = await courseRef.get();
        if (courseDoc.exists) { await courseRef.update({
                students: FieldValue.increment(1) });
        }

        return { error: null, success: true as const, message: "Enrollment successful! Check your email for course access details.", enrollmentId  };
    } catch (error: any) { logger.error("Enrollment error:", error);

        if (error.name === "ZodError") {
            return { error: "Please fill in all required fields correctly", success: false as const };
        }

        return { error: "Failed to enroll. Please try again.", success: false as const };
    }
}

// ============================================
// Cooperative Withdrawal Actions
// ============================================

export async function submitWithdrawalAction(
    prevState: WithdrawalActionState,
    formData: FormData
): Promise<WithdrawalActionState> { try {
        // Get authenticated user
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;

        const idempotencyKey = (formData.get("idempotencyKey") as string | null)?.trim() ?? "";
        if (!idempotencyKey) { return { error: "Missing security token. Please refresh the page.", success: false as const };
        }

        // Extract and validate form data
        const rawAmount = formData.get("amount") as string | null;
        const parsedAmount = rawAmount ? parseCurrencyStringToFloat(rawAmount) : NaN;
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return { error: "Invalid amount", success: false as const };
        }
        const withdrawalData = { cooperativeId: (formData.get("cooperativeId") as string | null)?.trim() ?? "",
            amount: parsedAmount,
            accountNumber: (formData.get("accountNumber") as string | null)?.trim() ?? "",
            accountName: (formData.get("accountName") as string | null)?.trim() ?? "",
            bankName: (formData.get("bankName") as string | null)?.trim() ?? "",
            reason: (formData.get("reason") as string | null)?.trim() ?? "" };

        // Validate with Zod
        const validatedData = withdrawalSchema.parse(withdrawalData);

        // Generate withdrawal request ID
        const withdrawalId = `WD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

        // WHAT WAS WRONG HERE
        // -------------------
        // Two defects, both on a path that locks a member's savings.
        //
        // 1. The idempotency key was read at the top and written at the BOTTOM,
        //    with the fund lock in between. Two submissions carrying the same
        //    key both read "absent" and both proceeded, so the member's savings
        //    were locked TWICE for one request. The key made the duplicate look
        //    impossible without preventing it.
        //
        // 2. The balance was read, compared to the amount, and then decremented
        //    — inside runTransaction, which takes no lock. The same overdraft
        //    shape already fixed on _submitWithdrawalAction and WAVE earnings.
        //
        // The key is claimed first, then the debit is taken under a row lock.
        const keyClaim = await claimIdempotencyKey({
            key: idempotencyKey,
            userId: session.user.id,
            action: "submit_withdrawal",
        });

        if (!keyClaim.claimed) {
            return { error: "Duplicate transaction detected. Please wait.", success: false as const };
        }

        // CORRECT PATTERN: Use Root Collection for members (Standardized)
        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(session.user.id);
        const memberDoc = await memberRef.get();

        if (!memberDoc.exists) { throw new Error("You are not a member of any cooperative");
        }

        const memberData = memberDoc.data();

        // Validate that the user belongs to the target cooperative
        if (memberData?.cooperativeId !== validatedData.cooperativeId) { throw new Error("Membership mismatch: You do not belong to this cooperative");
        }

        // Use 'savingsBalance' as per schema, fallback to 'balance' if legacy
        const currentBalance = memberData?.savingsBalance || memberData?.balance || 0;

        // The minimum-balance rule is a policy floor, and this read is still
        // advisory: two withdrawals that each leave 5,000 behind can together
        // dip under it. What the debit below guarantees is that the balance
        // cannot go NEGATIVE, which is the part that was losing money. Closing
        // the floor race too would need a debit primitive that takes a floor —
        // recorded in docs/audit/atomic-money-migration.md rather than invented
        // here.
        const MIN_BALANCE = 5000;
        if (currentBalance - validatedData.amount < MIN_BALANCE) {
            throw new Error(`You must maintain a minimum balance of ₦${MIN_BALANCE.toLocaleString()}`);
        }

        // 1. Lock Funds — debited under a row lock, not read-check-write.
        const debit = await debitJsonbBalance({
            table: "cooperative_members",
            id: session.user.id,
            field: "savingsBalance",
            amount: validatedData.amount,
        });

        if (!debit.ok) {
            return {
                error: debit.reason === "insufficient_funds"
                    ? `Insufficient balance. Available: ₦${Number(debit.balance).toLocaleString()}`
                    : "You are not a member of any cooperative",
                success: false as const,
            };
        }

        await memberRef.update({
            lockedBalance: FieldValue.increment(validatedData.amount),
            updatedAt: FieldValue.serverTimestamp() });

        // 2. Create Withdrawal Request
        const withdrawalRef = db.collection(COLLECTIONS.WITHDRAWALS).doc(withdrawalId);
        await withdrawalRef.set({ userId: session.user.id,
            cooperativeId: validatedData.cooperativeId,
            amount: validatedData.amount,
            accountNumber: validatedData.accountNumber,
            accountName: validatedData.accountName,
            bankName: validatedData.bankName,
            reason: validatedData.reason,
            status: "pending", // pending | approved | rejected | completed
            requestDate: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() });

        // (The idempotency key row is written by claimIdempotencyKey above.)

        revalidatePath("/cooperatives");
        revalidatePath("/dashboard/cooperatives");
        revalidatePath("/admin/withdrawals");

        return {
            error: null,
            success: true as const,
            message: `Withdrawal request submitted! Reference: ${withdrawalId}`,
            withdrawalId
        };
    } catch (error: any) { logger.error("Withdrawal error:", error);

        if (error.name === "ZodError") {
            return { error: "Please fill in all required fields correctly", success: false as const };
        }

        if (error.message.includes("balance")) { return { error: error.message, success: false as const };
        }

        return { error: "Failed to submit withdrawal request. Please try again.", success: false as const };
    }
}
