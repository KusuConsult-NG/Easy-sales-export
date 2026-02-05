"use server";

import { db } from "@/lib/firebase";
import { doc, setDoc, serverTimestamp, getDoc, updateDoc, increment } from "firebase/firestore";
import { auth } from "@/lib/auth";
import {
    waveApplicationSchema,
    academyEnrollmentSchema,
    withdrawalSchema,
} from "@/lib/schemas";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * Server Actions for Platform Forms
 * 
 * Handles WAVE applications, Academy enrollments, and Cooperative withdrawals
 * with Firestore integration and validation.
 */

// Type definitions for action return states
type ActionErrorState = {
    error: string;
    success: false;
};

type WaveSuccessState = {
    error: null;
    success: true;
    message: string;
    applicationId: string;
};

type EnrollmentSuccessState = {
    error: null;
    success: true;
    message: string;
    enrollmentId: string;
};

type WithdrawalSuccessState = {
    error: null;
    success: true;
    message: string;
    withdrawalId: string;
};

export type WaveApplicationState = ActionErrorState | WaveSuccessState;
export type EnrollmentActionState = ActionErrorState | EnrollmentSuccessState;
export type WithdrawalActionState = ActionErrorState | WithdrawalSuccessState;


// ============================================
// WAVE Application Actions
// ============================================

export async function submitWaveApplicationAction(
    prevState: WaveApplicationState,
    formData: FormData
): Promise<WaveApplicationState> {
    try {
        // Get authenticated user
        const session = await auth();
        if (!session?.user) {
            return { error: "You must be logged in to apply", success: false };
        }

        // Extract and validate form data
        const applicationData = {
            fullName: formData.get("fullName") as string,
            email: formData.get("email") as string,
            phone: formData.get("phone") as string,
            gender: formData.get("gender") as string,
            businessName: formData.get("businessName") as string,
            businessType: formData.get("businessType") as string,
            yearsInBusiness: parseInt(formData.get("yearsInBusiness") as string) || 0,
            reasonForApplying: formData.get("reasonForApplying") as string,
        };

        // Validate with Zod (enforces female-only validation)
        const validatedData = waveApplicationSchema.parse(applicationData);

        // Double-check gender enforcement at server level
        if (validatedData.gender !== "female") {
            return {
                error: "WAVE Program is exclusively for female entrepreneurs",
                success: false,
            };
        }

        // Generate application ID
        const applicationId = `WAVE-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

        // Save to Firestore
        await setDoc(doc(db, COLLECTIONS.WAVE_APPLICATIONS, applicationId), {
            ...validatedData,
            userId: session.user.id,
            status: "pending", // pending | approved | rejected
            applicationDate: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        return {
            error: null,
            success: true,
            message: "Application submitted successfully! We'll review it within 1 week.",
            applicationId,
        };
    } catch (error: any) {
        console.error("WAVE application error:", error);

        if (error.name === "ZodError") {
            const zodError = error as any;
            const firstError = zodError.errors[0];
            return {
                error: firstError?.message || "Please fill in all required fields correctly",
                success: false,
            };
        }

        return { error: "Failed to submit application. Please try again.", success: false };
    }
}

// ============================================
// Academy Enrollment Actions
// ============================================

export async function enrollInCourseAction(
    prevState: EnrollmentActionState,
    formData: FormData
): Promise<EnrollmentActionState> {
    try {
        // Get authenticated user
        const session = await auth();
        if (!session?.user) {
            return { error: "You must be logged in to enroll", success: false };
        }

        // Extract and validate form data
        const enrollmentData = {
            fullName: formData.get("fullName") as string,
            email: formData.get("email") as string,
            phone: formData.get("phone") as string,
            courseId: formData.get("courseId") as string,
        };

        // Validate with Zod
        const validatedData = academyEnrollmentSchema.parse(enrollmentData);

        // Check if user already enrolled in this course
        const existingEnrollmentQuery = await getDoc(
            doc(db, COLLECTIONS.ENROLLMENTS, `${session.user.id}_${validatedData.courseId}`)
        );

        if (existingEnrollmentQuery.exists()) {
            return { error: "You are already enrolled in this course", success: false };
        }

        // Generate enrollment ID (composite key: userId_courseId)
        const enrollmentId = `${session.user.id}_${validatedData.courseId}`;

        // Save enrollment to Firestore
        await setDoc(doc(db, COLLECTIONS.ENROLLMENTS, enrollmentId), {
            userId: session.user.id,
            courseId: validatedData.courseId,
            fullName: validatedData.fullName,
            email: validatedData.email,
            phone: validatedData.phone,
            enrollmentDate: serverTimestamp(),
            status: "active", // active | completed | dropped
            progress: 0,
            updatedAt: serverTimestamp(),
        });

        // Increment course student count (if course document exists)
        const courseRef = doc(db, COLLECTIONS.COURSES, validatedData.courseId);
        const courseDoc = await getDoc(courseRef);
        if (courseDoc.exists()) {
            await updateDoc(courseRef, {
                students: increment(1),
            });
        }

        return {
            error: null,
            success: true,
            message: "Enrollment successful! Check your email for course access details.",
            enrollmentId,
        };
    } catch (error: any) {
        console.error("Enrollment error:", error);

        if (error.name === "ZodError") {
            return { error: "Please fill in all required fields correctly", success: false };
        }

        return { error: "Failed to enroll. Please try again.", success: false };
    }
}

// ============================================
// Cooperative Withdrawal Actions
// ============================================

export async function submitWithdrawalAction(
    prevState: WithdrawalActionState,
    formData: FormData
): Promise<WithdrawalActionState> {
    try {
        // Get authenticated user
        const session = await auth();
        if (!session?.user) {
            return { error: "You must be logged in to request withdrawal", success: false };
        }

        // Extract and validate form data
        const withdrawalData = {
            cooperativeId: formData.get("cooperativeId") as string,
            amount: parseFloat(formData.get("amount") as string),
            accountNumber: formData.get("accountNumber") as string,
            accountName: formData.get("accountName") as string,
            bankName: formData.get("bankName") as string,
            reason: formData.get("reason") as string,
        };

        // Validate with Zod
        const validatedData = withdrawalSchema.parse(withdrawalData);

        // Verify user is a member of the cooperative
        const memberRef = doc(
            db,
            COLLECTIONS.COOPERATIVES,
            validatedData.cooperativeId,
            "members",
            session.user.id
        );
        const memberDoc = await getDoc(memberRef);

        if (!memberDoc.exists()) {
            return { error: "You are not a member of this cooperative", success: false };
        }

        const memberData = memberDoc.data();

        // Check if user has sufficient balance
        if (memberData.balance < validatedData.amount) {
            return {
                error: `Insufficient balance. Available: ₦${memberData.balance.toLocaleString()}`,
                success: false,
            };
        }

        // Check minimum balance requirement (e.g., must keep ₦5,000)
        const MIN_BALANCE = 5000;
        if (memberData.balance - validatedData.amount < MIN_BALANCE) {
            return {
                error: `You must maintain a minimum balance of ₦${MIN_BALANCE.toLocaleString()}`,
                success: false,
            };
        }

        // Generate withdrawal request ID
        const withdrawalId = `WD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

        // Save withdrawal request to Firestore
        await setDoc(doc(db, COLLECTIONS.WITHDRAWALS, withdrawalId), {
            userId: session.user.id,
            cooperativeId: validatedData.cooperativeId,
            amount: validatedData.amount,
            accountNumber: validatedData.accountNumber,
            accountName: validatedData.accountName,
            bankName: validatedData.bankName,
            reason: validatedData.reason,
            status: "pending", // pending | approved | rejected | completed
            requestDate: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        return {
            error: null,
            success: true,
            message: `Withdrawal request submitted! Reference: ${withdrawalId}`,
            withdrawalId,
        };
    } catch (error: any) {
        console.error("Withdrawal error:", error);

        if (error.name === "ZodError") {
            return { error: "Please fill in all required fields correctly", success: false };
        }

        if (error.message.includes("balance")) {
            return { error: error.message, success: false };
        }

        return { error: "Failed to submit withdrawal request. Please try again.", success: false };
    }
}
