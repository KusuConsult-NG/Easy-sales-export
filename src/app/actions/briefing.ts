"use server";

import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "@/lib/logger";
import { sendBriefingConfirmationEmail } from "@/lib/email-notifications";

// Status type for strict typing
export type BriefingStatus = "registered" | "attended" | "cancelled";

export interface BriefingRegistrationData {
    fullName: string;
    phoneNumber: string;
    email: string;
    state: string;
    role: string;
}

/**
 * Register a guest for the WAVE National Awareness Briefing
 * Public action — no auth required
 */
export async function registerForBriefingAction(
    data: BriefingRegistrationData
): Promise<{ success: boolean; error?: string }> {
    try {
        // Validate required fields
        if (!data.fullName?.trim() || !data.email?.trim() || !data.phoneNumber?.trim() || !data.state?.trim() || !data.role?.trim()) {
            return { success: false, error: "All fields are required" };
        }

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(data.email.trim())) {
            return { success: false, error: "Please enter a valid email address" };
        }

        // Phone number validation (Nigerian format)
        const phone = data.phoneNumber.replace(/\s/g, "");
        if (phone.length < 10 || phone.length > 14) {
            return { success: false, error: "Please enter a valid phone number" };
        }

        // Check for duplicate registration
        const existingSnapshot = await db
            .collection("wave_briefing_registrations")
            .where("email", "==", data.email.trim().toLowerCase())
            .limit(1)
            .get();

        if (!existingSnapshot.empty) {
            return { success: false, error: "This email is already registered for the briefing" };
        }

        // ... (existing helper functions if any)

        // Store registration with standardized schema
        const status: BriefingStatus = "registered";
        const docRef = await db.collection("wave_briefing_registrations").add({
            fullName: data.fullName.trim(),
            phoneNumber: phone,
            email: data.email.trim().toLowerCase(),
            state: data.state.trim(),
            role: data.role,
            createdAt: FieldValue.serverTimestamp(), // Standardized from registeredAt
            updatedAt: FieldValue.serverTimestamp(), // Standardized
            status: status,
            confirmationSent: false,
            attended: false, // Explicit field for attendance tracking
        });

        logger.info(`[WAVE Briefing] New registration: ${data.email.trim().toLowerCase()}`);

        // Send confirmation email
        try {
            const emailResult = await sendBriefingConfirmationEmail(
                data.email.trim(),
                data.fullName.trim()
            );

            if (emailResult.success) {
                await docRef.update({ confirmationSent: true });
                logger.info(`[WAVE Briefing] Confrimation email sent to ${data.email.trim()}`);
            } else {
                logger.warn(`[WAVE Briefing] Email failed for ${data.email.trim()}: ${emailResult.error}`);
            }
        } catch (emailError) {
            logger.error(`[WAVE Briefing] Email system error for ${data.email.trim()}:`, emailError);
            // Non-blocking: We still return success for the registration itself
        }

        return { success: true };
    } catch (error) {
        logger.error("[WAVE Briefing] Registration error:", error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return { success: false, error: `Registration failed: ${errorMessage}` };
    }
}
