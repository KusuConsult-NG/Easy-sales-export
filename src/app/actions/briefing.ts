"use server";

import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "@/lib/logger";
import { sendBriefingConfirmationEmail } from "@/lib/email-notifications";
import { generateAndSendWhatsAppInvite } from "@/lib/whatsapp-invites";
import { ActionResponse, withSafeAction } from "@/lib/safe-action";

// Status type for strict typing
export type BriefingStatus = "registered" | "attended" | "cancelled";

export interface BriefingRegistrationData {
    fullName: string;
    phoneNumber: string;
    email: string;
    state: string;
    role: string;
}

import { z } from "zod";

// Zod Validation Schema for Registration Data
const briefingRegistrationSchema = z.object({
    fullName: z.string().trim().min(2, { message: "Full Name must be at least 2 characters" }),
    email: z.string().trim().email({ message: "Please enter a valid email address" }).toLowerCase(),
    phoneNumber: z.string().trim()
        .transform(val => val.replace(/\s/g, "")) // Remove spaces
        .pipe(z.string().min(10, { message: "Invalid phone number length" }).max(14, { message: "Invalid phone number length" })),
    state: z.string().trim().min(2, { message: "State is required" }),
    role: z.string().trim().min(2, { message: "Role is required" }),
});

/**
 * Register a guest for the WAVE National Awareness Briefing
 * Public action — no auth required
 */
export const registerForBriefingAction = withSafeAction(
    "registerForBriefingAction",
    async (data: BriefingRegistrationData): Promise<ActionResponse<void>> => {
        try {
            // Strict Zero-Trust Validation via Zod
            const validationResult = briefingRegistrationSchema.safeParse(data);

            if (!validationResult.success) {
                // Extract the first validation error message using Zod's error.issues
                const firstError = validationResult.error.issues[0]?.message || "Invalid submission data";
                return { success: false, error: firstError };
            }

            const validData = validationResult.data;

            // Note: From this point on, we use validData instead of data for the database insertions
            const emailToStore = validData.email;
            const phoneToStore = validData.phoneNumber;

            // Check for duplicate registration
            const existingSnapshot = await db
                .collection("wave_briefing_registrations")
                .where("email", "==", emailToStore)
                .limit(1)
                .get();

            if (!existingSnapshot.empty) {
                return { success: false, error: "This email is already registered for the briefing" };
            }

            // ... (existing helper functions if any)

            // Store registration with standardized schema
            const status: BriefingStatus = "registered";
            const docRef = await db.collection("wave_briefing_registrations").add({
                fullName: validData.fullName,
                phoneNumber: phoneToStore,
                email: emailToStore,
                state: validData.state,
                role: validData.role,
                createdAt: FieldValue.serverTimestamp(), // Standardized from registeredAt
                updatedAt: FieldValue.serverTimestamp(), // Standardized
                status: status,
                confirmationSent: false,
                attended: false, // Explicit field for attendance tracking
            });

            logger.info(`[WAVE Briefing] New registration: ${emailToStore}`);

            // Send confirmation email
            try {
                const emailResult = await sendBriefingConfirmationEmail(
                    emailToStore,
                    validData.fullName
                );

                if (emailResult.success) {
                    await docRef.update({ confirmationSent: true });
                    logger.info(`[WAVE Briefing] Confrimation email sent to ${emailToStore}`);
                } else {
                    logger.warn(`[WAVE Briefing] Email failed for ${emailToStore}: ${emailResult.error}`);
                }

                // Send WhatsApp group invite (one-time link via email)
                try {
                    await generateAndSendWhatsAppInvite("wave_briefing", {
                        email: emailToStore,
                        name: validData.fullName,
                    });
                } catch (waError) {
                    logger.error(`[WAVE Briefing] WhatsApp invite failed for ${emailToStore}:`, waError);
                    // Non-blocking: registration still succeeds
                }
            } catch (emailError) {
                logger.error(`[WAVE Briefing] Email system error for ${emailToStore}:`, emailError);
                // Non-blocking: We still return success for the registration itself
            }

            return { success: true };
        } catch (error) {
            logger.error("[WAVE Briefing] Registration error:", error);
            // The error will still be caught by our withSafeAction wrapper
            throw error;
        }
    });
