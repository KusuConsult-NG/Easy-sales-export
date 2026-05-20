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

export interface BriefingRegistrationData { // Separated name fields (KYC-compliant)
    firstName?: string;
    lastName?: string;
    otherName?: string;
    // Derived full name (sent by page on submit)
    fullName: string;
    phoneNumber: string;
    email: string;
    state: string;
    role: string; 
    gender?: string; // Optional gender submitted by guest demographics
}

import { z } from "zod";
import { strictEmailSchema, strictNameSchema, strictNigerianPhoneSchema } from "@/lib/schemas";
// Zod Validation Schema for Registration Data
const briefingRegistrationSchema = z.object({ fullName: strictNameSchema,
    firstName: z.string().trim().optional(),
    lastName: z.string().trim().optional(),
    otherName: z.string().trim().optional(),
    email: strictEmailSchema,
    phoneNumber: strictNigerianPhoneSchema,
    state: z.string().trim().min(2, { message: "State is required" }),
    role: z.string().trim().min(2, { message: "Role is required" }),
    gender: z.string().trim().optional() });

/**
 * Register a guest for the WAVE National Awareness Briefing
 * Public action — no auth required
 */
/**
 * Register a guest for the WAVE National Awareness Briefing
 * Public action — no auth required
 * NOTE: Declared as async function (not const) so Next.js "use server" validator accepts it.
 */
export async function registerForBriefingAction(data: BriefingRegistrationData): Promise<ActionResponse<void>> { try {
        // Strict Zero-Zero-Trust Validation via Zod
        const validationResult = briefingRegistrationSchema.safeParse(data);

        if (!validationResult.success) {
            const firstError = validationResult.error.issues[0]?.message || "Invalid submission data";
            return { success: false as const, error: firstError, data: null };
        }

        const validData = validationResult.data!;
        const emailToStore = validData.email;
        const phoneToStore = validData.phoneNumber;

        // 🔒 DEMOGRAPHIC GATE: Strict Gender Alignment check
        let userProfile: any = null;
        let isUserAdmin = false;
        try {
            const { requireSession } = await import("@/lib/session-guard");
            const sessionResult = await requireSession();
            if (sessionResult.session) {
                const userDoc = await db.collection(COLLECTIONS.USERS).doc(sessionResult.session.user.id).get();
                if (userDoc.exists) {
                    userProfile = userDoc.data();
                }
            }
        } catch (e) {
            // Session not found or error, continue to check by email
        }

        if (!userProfile) {
            // Fallback: Check if user exists by email in USERS collection
            const userQuery = await db.collection(COLLECTIONS.USERS).where("email", "==", emailToStore).limit(1).get();
            if (!userQuery.empty) {
                userProfile = userQuery.docs[0].data();
            }
        }

        if (userProfile) {
            const roles = userProfile.roles || [];
            try {
                const { isAdmin } = await import("@/lib/admin-permissions");
                isUserAdmin = isAdmin(roles);
            } catch (e) {
                isUserAdmin = roles.includes("admin") || roles.includes("super_admin");
            }
        }

        // Validate gender strictly. WAVE is female-only.
        const submittedGender = validData.gender;
        const profileGender = userProfile?.gender;
        const implicitGender = validData.role === "woman_seeking" ? "female" : undefined;
        const genderToValidate = submittedGender || profileGender || implicitGender;

        if (genderToValidate) {
            const normalizedGender = genderToValidate.toLowerCase().trim();
            if (normalizedGender !== "female" && !isUserAdmin) {
                return {
                    success: false as const,
                    error: "The WAVE program and briefing are exclusively for female participants and women entrepreneurs.",
                    data: null
                };
            }
        }

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

        if (!existingByEmail.empty) { return { success: false as const, error: "This email address is already registered for the briefing.", data: null };
        }
        if (!existingByPhone.empty) { return { success: false as const, error: "This phone number is already registered for the briefing.", data: null };
        }

        const status: BriefingStatus = "registered";
        const docRef = await db.collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS).add({ fullName: validData.fullName,
            firstName: validData.firstName || validData.fullName.split(' ')[0] || "",
            lastName: validData.lastName || validData.fullName.split(' ').slice(-1)[0] || "",
            otherName: validData.otherName || null,
            phoneNumber: phoneToStore,
            email: emailToStore,
            state: validData.state,
            role: validData.role,
            gender: genderToValidate || null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            status: status,
            confirmationSent: false,
            attended: false });

        logger.info(`[WAVE Briefing] New registration: ${emailToStore}`);

        try { const emailResult = await sendBriefingConfirmationEmail(emailToStore, validData.fullName);
            if (emailResult.success) {
                await docRef.update({ confirmationSent: true });
                logger.info(`[WAVE Briefing] Confirmation email sent to ${emailToStore}`);
            } else {
                logger.warn(`[WAVE Briefing] Email failed for ${emailToStore}: ${emailResult.error}`);
            }
            try { await generateAndSendWhatsAppInvite("wave_briefing", { email: emailToStore, name: validData.fullName });
            } catch (waError) {
                logger.error(`[WAVE Briefing] WhatsApp invite failed for ${emailToStore}:`, waError);
            }
        } catch (emailError) {
            logger.error(`[WAVE Briefing] Email system error for ${emailToStore}:`, emailError);
        }

        return { success: true as const, error: null, data: undefined };
    } catch (error: any) { logger.error("[WAVE Briefing] Registration error:", error);
        const msg = typeof error === 'string' ? error : (error?.message || "Registration failed");
        return { success: false as const, error: msg, data: null };
    }
}

