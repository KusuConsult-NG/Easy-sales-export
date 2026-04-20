"use server";

import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "@/lib/logger";
import { sendBriefingConfirmationEmail } from "@/lib/email-notifications";
import { generateAndSendWhatsAppInvite } from "@/lib/whatsapp-invites";
import { ActionResponse, withSafeAction } from "@/lib/safe-action";

// Status type for strict typing
export type BriefingStatus = "registered" | "attended" | "cancelled";

export interface BriefingRegistrationData {
    // Separated name fields (KYC-compliant)
    firstName?: string;
    lastName?: string;
    otherName?: string;
    // Derived full name (sent by page on submit)
    fullName: string;
    phoneNumber: string;
    email: string;
    state: string;
    role: string;
}

import { z } from "zod";
import { strictEmailSchema, strictNameSchema } from "@/lib/schemas";
// Zod Validation Schema for Registration Data
const briefingRegistrationSchema = z.object({
    fullName: strictNameSchema,
    firstName: z.string().trim().optional(),
    lastName: z.string().trim().optional(),
    otherName: z.string().trim().optional(),
    email: strictEmailSchema,
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
/**
 * Register a guest for the WAVE National Awareness Briefing
 * Public action — no auth required
 * NOTE: Declared as async function (not const) so Next.js "use server" validator accepts it.
 */
export async function registerForBriefingAction(data: BriefingRegistrationData): Promise<ActionResponse<void>> {
    try {
        // Strict Zero-Trust Validation via Zod
        const validationResult = briefingRegistrationSchema.safeParse(data);

        if (!validationResult.success) {
            const firstError = validationResult.error.issues[0]?.message || "Invalid submission data";
            return { success: false, error: firstError };
        }

        const validData = validationResult.data!;
        const emailToStore = validData.email;
        const phoneToStore = validData.phoneNumber;

        // STRICT DEDUPLICATION: Check email AND phone in parallel
        const [existingByEmail, existingByPhone] = await Promise.all([
            db.collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS)
                .where("email", "==", emailToStore)
                .limit(1)
                .get(),
            db.collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS)
                .where("phoneNumber", "==", phoneToStore)
                .limit(1)
                .get(),
        ]);

        if (!existingByEmail.empty) {
            return { success: false, error: "This email address is already registered for the briefing." };
        }
        if (!existingByPhone.empty) {
            return { success: false, error: "This phone number is already registered for the briefing." };
        }

        const status: BriefingStatus = "registered";
        const docRef = await db.collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS).add({
            fullName: validData.fullName,
            firstName: validData.firstName || validData.fullName.split(' ')[0] || "",
            lastName: validData.lastName || validData.fullName.split(' ').slice(-1)[0] || "",
            otherName: validData.otherName || null,
            phoneNumber: phoneToStore,
            email: emailToStore,
            state: validData.state,
            role: validData.role,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            status: status,
            confirmationSent: false,
            attended: false,
        });

        logger.info(`[WAVE Briefing] New registration: ${emailToStore}`);

        try {
            const emailResult = await sendBriefingConfirmationEmail(emailToStore, validData.fullName);
            if (emailResult.success) {
                await docRef.update({ confirmationSent: true });
                logger.info(`[WAVE Briefing] Confirmation email sent to ${emailToStore}`);
            } else {
                logger.warn(`[WAVE Briefing] Email failed for ${emailToStore}: ${emailResult.error}`);
            }
            try {
                await generateAndSendWhatsAppInvite("wave_briefing", { email: emailToStore, name: validData.fullName });
            } catch (waError) {
                logger.error(`[WAVE Briefing] WhatsApp invite failed for ${emailToStore}:`, waError);
            }
        } catch (emailError) {
            logger.error(`[WAVE Briefing] Email system error for ${emailToStore}:`, emailError);
        }

        return { success: true };
    } catch (error: any) {
        logger.error("[WAVE Briefing] Registration error:", error);
        const msg = typeof error === 'string' ? error : (error?.message || "Registration failed");
        return { success: false, error: msg };
    }
}

