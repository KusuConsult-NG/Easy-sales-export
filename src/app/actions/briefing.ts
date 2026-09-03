"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { logger } from "@/lib/logger";
import { sendBriefingConfirmationEmail } from "@/lib/email-notifications";
import { generateAndSendWhatsAppInvite } from "@/lib/whatsapp-invites";
import { ActionResponse, withSafeAction } from "@/lib/safe-action";
import { rateLimit, getActionClientIp } from "@/lib/rate-limiter";
import { rateLimitConfig } from "@/lib/rate-limits.config";

/**
 *   #268 THE ONE PUBLIC ENDPOINT THAT MAILS STRANGERS HAD NO RATE LIMIT.
 *
 *        registerForBriefingAction is unauthenticated by design, and on every
 *        successful call it sends a confirmation email through Resend AND a
 *        WhatsApp invite. It had no limit of any kind, so a loop with fresh
 *        addresses mails arbitrary third parties from our domain as fast as
 *        requests can be made. The Resend bill and the junk registrations are
 *        recoverable; sender reputation is not, because the recipients never
 *        asked and will mark it as spam.
 *
 *        Three public endpoints here send mail to an unauthenticated caller's
 *        chosen address. api/contact and actions/password-reset both take the
 *        contactForm bucket; this one took nothing — and it is the only one that
 *        also sends a WhatsApp invite. password-reset.ts already carries the
 *        argument in full ("unauthenticated, sends a real email through Resend
 *        on every call, and had no limit of any kind"). One copy short.
 *
 *        KEYED ON THE CALLER, NOT THE ADDRESS, and that differs from
 *        password-reset deliberately. There, one address is what gets abused,
 *        so the address is the key. Here the duplicate check already refuses a
 *        second registration for the same email BEFORE anything is sent, so one
 *        address cannot be mailed twice however hard you try; what is abused is
 *        the endpoint, with a fresh address each time. getActionClientIp is
 *        what #260 made trustworthy.
 */
const briefingLimiter = rateLimit(rateLimitConfig.contactForm);

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
import { isPlatformAdmin } from "@/lib/admin-permissions";
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

        // Before anything is written or sent. See #268 above.
        const callerIp = await getActionClientIp();
        const limit = await briefingLimiter.check(`wave-briefing:${callerIp}`);
        if (!limit.success) {
            return {
                success: false as const,
                error: "Too many registration attempts. Please try again later.",
                data: null,
            };
        }

        const validData = validationResult.data!;
        const emailToStore = validData.email;
        const phoneToStore = validData.phoneNumber;

        // 🔒 DEMOGRAPHIC GATE: Strict Gender Alignment check
        let userProfile: any = null;
        let isUserAdmin = false;
        let sessionUserId: string | null = null;
        try {
            const { requireSession } = await import("@/lib/session-guard");
            const sessionResult = await requireSession();
            if (sessionResult.session) {
                sessionUserId = sessionResult.session.user.id;
                const userDoc = await db.collection(COLLECTIONS.USERS).doc(sessionUserId).get();
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

        /**
         *   #269 AND AN ANONYMOUS CALLER'S ROLES CAME FROM AN EMAIL THEY TYPED.
         *
         *        This read `userProfile.roles`, and userProfile may have come
         *        from the EMAIL FALLBACK above — a USERS lookup on the address
         *        the caller submitted, with no session at all. isUserAdmin
         *        waives the female-only participation gate, so typing an
         *        admin's address was treated as being one. Nobody proved
         *        anything; they knew an address.
         *
         *        #36's class ("adopts an application matched on a free-text
         *        email"), and #83's, which found that fix had landed on WAVE
         *        only. Here it is again, in a public action, granting a waiver.
         *
         *        Roles come from the AUTHENTICATED session and nowhere else.
         *        The gender lookup above stays: genderToValidate prefers the
         *        submitted value and skips the gate entirely when nothing
         *        resolves, so adopting a stranger's recorded gender can only
         *        make this stricter. It grants nothing, which is the whole
         *        difference between the two halves.
         */
        if (sessionUserId && userProfile) {
            const roles = userProfile.roles || [];
            try {
                const { isAdmin } = await import("@/lib/admin-permissions");
                isUserAdmin = isAdmin(roles);
            } catch (e) {
                // #365. The fallback was NARROWER than the thing it fell back from.
                isUserAdmin = isPlatformAdmin(roles);
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

        // Proactive demographic sync: if the user is logged in, has a valid female gender, and profile gender is currently unset,
        // sync the gender back to the USERS collection to lock in their gender and prevent subsequent blocks in WAVE onboarding.
        if (sessionUserId && genderToValidate && genderToValidate.toLowerCase().trim() === "female" && !userProfile?.gender) {
            try {
                await db.collection(COLLECTIONS.USERS).doc(sessionUserId).update({
                    gender: "Female",
                    updatedAt: FieldValue.serverTimestamp()
                });
                logger.info(`[WAVE Briefing] Automatically populated gender 'Female' for user ${sessionUserId}`);
            } catch (err) {
                logger.error(`[WAVE Briefing] Failed to populate gender for user ${sessionUserId}:`, err);
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

