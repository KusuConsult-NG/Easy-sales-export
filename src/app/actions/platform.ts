"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue } from "firebase-admin/firestore";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { waveApplicationSchema,
    academyEnrollmentSchema,
    withdrawalSchema } from "@/lib/schemas";
import { COLLECTIONS } from "@/lib/types/firestore";
import { ZodError } from "zod";
import { revalidatePath } from "next/cache";

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
        const applicationData = { fullName: formData.get("fullName") as string,
            email: formData.get("email") as string,
            phone: formData.get("phone") as string,
            gender: formData.get("gender") as string,
            businessName: formData.get("businessName") as string,
            businessType: formData.get("businessType") as string,
            yearsInBusiness: parseInt(formData.get("yearsInBusiness") as string) || 0,
            reasonForApplying: formData.get("reasonForApplying") as string };

        // Validate with Zod (enforces female-only validation)
        const validatedData = waveApplicationSchema.parse(applicationData);

        // Double-check gender enforcement at server level
        if (validatedData.gender !== "female") { return { error: "WAVE Program is exclusively for female entrepreneurs", success: false as const };
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
        const enrollmentData = { fullName: formData.get("fullName") as string,
            email: formData.get("email") as string,
            phone: formData.get("phone") as string,
            courseId: formData.get("courseId") as string };

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

        const idempotencyKey = formData.get("idempotencyKey") as string;
        if (!idempotencyKey) { return { error: "Missing security token. Please refresh the page.", success: false as const };
        }

        // Extract and validate form data
        const withdrawalData = { cooperativeId: formData.get("cooperativeId") as string,
            amount: parseFloat(formData.get("amount") as string),
            accountNumber: formData.get("accountNumber") as string,
            accountName: formData.get("accountName") as string,
            bankName: formData.get("bankName") as string,
            reason: formData.get("reason") as string };

        // Validate with Zod
        const validatedData = withdrawalSchema.parse(withdrawalData);

        // Generate withdrawal request ID
        const withdrawalId = `WD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

        // Transactional execution for Financial Integrity
        await db.runTransaction(async (transaction) => { // 0. Idempotency Check
            const idempotencyRef = db.collection(COLLECTIONS.IDEMPOTENCY_KEYS).doc(idempotencyKey);
            const idempotencyDoc = await transaction.get(idempotencyRef);

            if (idempotencyDoc.exists) {
                throw new Error("Duplicate transaction detected. Please wait.");
            }

            // CORRECT PATTERN: Use Root Collection for members (Standardized)
            const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(session.user.id);
            const memberDoc = await transaction.get(memberRef);

            if (!memberDoc.exists) { throw new Error("You are not a member of any cooperative");
            }

            const memberData = memberDoc.data();

            // Validate that the user belongs to the target cooperative
            if (memberData?.cooperativeId !== validatedData.cooperativeId) { throw new Error("Membership mismatch: You do not belong to this cooperative");
            }

            // Use 'savingsBalance' as per schema, fallback to 'balance' if legacy
            const currentBalance = memberData?.savingsBalance || memberData?.balance || 0;

            // Check if user has sufficient balance
            if (currentBalance < validatedData.amount) {
                throw new Error(`Insufficient balance. Available: ₦${currentBalance.toLocaleString()}`);
            }

            // Check minimum balance requirement
            const MIN_BALANCE = 5000;
            if (currentBalance - validatedData.amount < MIN_BALANCE) {
                throw new Error(`You must maintain a minimum balance of ₦${MIN_BALANCE.toLocaleString()}`);
            }

            // 1. Lock Funds (Decrement Balance immediately)
            // Use 'savingsBalance' to be consistent with cooperative.ts
            transaction.update(memberRef, { savingsBalance: FieldValue.increment(-validatedData.amount),
                lockedBalance: FieldValue.increment(validatedData.amount),
                updatedAt: FieldValue.serverTimestamp() });

            // 2. Create Withdrawal Request
            const withdrawalRef = db.collection(COLLECTIONS.WITHDRAWALS).doc(withdrawalId);
            transaction.set(withdrawalRef, { userId: session.user.id,
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

            // 3. Lock Key
            transaction.set(idempotencyRef, { userId: session.user.id,
                action: "submit_withdrawal",
                createdAt: FieldValue.serverTimestamp() });
        });

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
