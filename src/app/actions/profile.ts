/**
 * Server Actions for User Profile Management
 */

"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { syncAuthEmail } from "@/lib/auth-revocation";
import { logger } from '@/lib/logger';
import { isPaymentBypassAccount } from "@/lib/payment-bypass";
import { adminAuth } from "@/lib/firebase-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { namePartsOf, joinFullName } from "@/lib/person-name";
import { z } from "zod";
import { strictEmailSchema, strictPhoneSchema } from "@/lib/schemas";
import { withSafeAction } from "@/lib/safe-action";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { versionedUpdate } from "@/lib/optimistic-locking";
import { FieldValue } from "@/lib/firestore-compat";
import { serializeDoc } from "@/lib/firestore-serialize";

// Validation schemas
const profileUpdateSchema = z.object({ firstName: z.string().max(50).optional(),
    lastName: z.string().max(50).optional(),
    otherName: z.string().max(50).optional(),
    email: strictEmailSchema.optional(),
    phone: strictPhoneSchema.optional(),
    location: z.string().optional(),
    bio: z.string().max(500).optional(),
    identityDocument: z.string().optional(),
    photoURL: z.string().optional(),
    gender: z.enum(["male", "female"]).optional(),
    version: z.number().optional() });

const notificationPreferencesSchema = z.object({ email: z.boolean(),
    push: z.boolean(),
    sms: z.boolean() });

/**
 * Get user profile data
 */
export const getUserProfileAction = withSafeAction("getUserProfileAction", async () => { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    const userId = session.user.id;
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();

    if (!userDoc.exists) { return { success: false as const, error: "User profile not found", data: null };
    }

    const userData = userDoc.data()!;

    /**
     *   #452 THIS SPLIT `fullName` INTO TWO PARTS AND OVERWROTE THE THREE THE
     *        ROW ACTUALLY STORED, WHICH DUPLICATED MIDDLE NAMES ON SAVE.
     *
     *        It was `first = parts[0]`, `last = parts.slice(1).join(" ")`,
     *        applied unconditionally. Registration stores first / other / last
     *        correctly, so for "Ada Ngozi Obi" the screen showed
     *        last = "Ngozi Obi" while otherName was still "Ngozi". The form
     *        sent both back untouched and the writer joined them into
     *        "Ada Ngozi Ngozi Obi" — growing by one copy every save, with
     *        nothing edited.
     *
     *        namePartsOf prefers what is STORED and derives only for rows
     *        written before the parts were kept separately. One rule, in
     *        lib/person-name.ts, shared with registration and the writer.
     */
    const nameSplit = namePartsOf(userData);

    const profile = serializeDoc<any>(userId, userData);

    return { 
        error: null, 
        success: true as const, 
        data: {
            profile: {
                ...profile,
                firstName: nameSplit.first,
                otherName: nameSplit.other,
                lastName: nameSplit.last,
                version: userData._version || 0
            }
        }
    };
});

/**
 * Update user profile information
 * 
 * 🔒 SECURITY NOTE: 
 * Identity fields like 'gender' and 'dateOfBirth' are EXCLUDED from subsequent changes.
 * They are set once during registration/verification and should ONLY be changeable 
 * via a specific admin request to prevent "Identity Hopping" in programs like WAVE.
 * We permit setting it ONCE if it has not been set yet (for legacy compatibility).
 */
export const updateUserProfileAction = withSafeAction("updateUserProfileAction", async (data: { firstName?: string;
    lastName?: string;
    otherName?: string;
    email?: string;
    phone?: string;
    location?: string;
    bio?: string;
    identityDocument?: string;
    photoURL?: string;
    gender?: string;
    version?: number; }) => { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    const validated = profileUpdateSchema.parse(data);
    const userId = session.user.id;

    if (validated.email && validated.email !== session.user.email) {
        // Nobody moves onto the payment-bypass list by editing their profile.
        //
        // payment-bypass.ts records that the bypass is safe because "there is
        // no self-service action that changes a user's email". This action is
        // one, added afterwards, so that reason no longer holds.
        //
        // What actually stops the default address being taken today is
        // Supabase's uniqueness constraint — the owner's account already holds
        // it, so the change below fails. That protection is real but
        // conditional, and nothing requires a bypass address to correspond to a
        // registered account. Add a colleague's address to
        // PAYMENT_BYPASS_EMAILS before they sign up, or mistype one, and any
        // user could claim free cooperative and academy membership by editing
        // their profile.
        //
        // Refused outright, which does not depend on who happens to hold the
        // address. No legitimate profile edit moves a user onto that list.
        if (isPaymentBypassAccount(validated.email)) {
            logger.warn("[profile] refused an email change onto the payment-bypass list", {
                userId,
                attempted: validated.email.trim().toLowerCase(),
            });
            return {
                success: false as const,
                error: "That email address is already in use by another account.",
                data: null,
            };
        }

        // The email has to change in the store that authenticates.
        //
        // This updated Firebase only. lib/auth.ts signs in against Supabase
        // first, so the OLD address kept working — and the new one fell through
        // to the Firebase fallback, which then tries to provision the account in
        // Supabase and can fork a second auth identity for the same person.
        const sync = await syncAuthEmail(userId, validated.email);
        if (!sync.primaryRevoked) {
            const message = String(sync.error || "");
            if (/already|exists|registered/i.test(message)) {
                return { success: false as const, error: "That email address is already in use by another account.", data: null };
            }
            logger.error("Auth email update failed:", message);
            return { success: false as const, error: "Failed to update email. Please try again.", data: null };
        }
    }

    const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

    // Gender is set once, as the note above this function already says.
    //
    // It did not enforce that. The code was
    //
    //     if (validated.gender) updatePayload.gender = validated.gender.toLowerCase();
    //
    // with no comparison to the stored value — so any user could change it, any
    // number of times, through their own profile screen. The `existing`
    // document was read in the transaction below and used to assemble the name,
    // so the value needed for the check was already in hand.
    //
    // WHY IT MATTERS
    //
    // WAVE is a female-only programme and _enrollInWaveAction enforces that by
    // reading this exact field:
    //
    //     const isMale = applicantGender?.toLowerCase() === "male";
    //     if (isMale && !isUserAdmin && ...) return "Only female applicants are
    //         eligible to enroll in the WAVE program."
    //
    // Its own comment calls that "🔒 SECURITY: Strict Gender Enforcement". A
    // male applicant refused there could call updateUserProfileAction({ gender:
    // "female" }) and enrol — the eligibility check was reading a field the
    // applicant controlled. That is the "identity hopping" the note names.
    //
    // The intended route exists: _updateUserGenderAction in admin.ts requires
    // the users:update permission and writes a `user_gender_update` audit entry.
    // So the design was set-once plus an audited admin override, and only the
    // self-service half was missing.
    //
    // Read before the transaction so the refusal is a proper error rather than a
    // throw from inside the callback. A concurrent first-set is caught by the
    // version check in versionedUpdate.
    const currentDoc = await userRef.get();
    const currentGender = String(currentDoc.data()?.gender ?? "").trim().toLowerCase();
    const requestedGender = validated.gender?.toLowerCase();

    if (requestedGender && currentGender && requestedGender !== currentGender) {
        return {
            success: false as const,
            error: "Gender cannot be changed here. Please contact support if it is recorded incorrectly.",
            data: null,
        };
    }

    await db.runTransaction(async (transaction) => {
        const existingDoc = await transaction.get(userRef);
        const existing = existingDoc.data() || {};

        const updatePayload: Record<string, any> = { ...validated,
            profileComplete: true };
        // Remove version from payload as it's handled by versionedUpdate
        delete updatePayload.version;

        // Written only on the first set. Sending the value it already holds is
        // not an error — a profile form resubmits every field — it simply
        // writes nothing.
        delete updatePayload.gender;
        if (requestedGender && !currentGender) {
            updatePayload.gender = requestedGender;
        }

        if (validated.firstName || validated.lastName || validated.otherName) {
            // #452. The fallback here restated the two-part split a THIRD time.
            // namePartsOf gives the row's own parts under the one rule; the
            // submitted fields override them; joinFullName is split's exact
            // inverse, so the round trip cannot grow a name.
            const stored = namePartsOf(existing);
            updatePayload.fullName = joinFullName({
                first: validated.firstName ?? stored.first,
                other: validated.otherName ?? stored.other,
                last: validated.lastName ?? stored.last,
            });
        }

        await versionedUpdate(transaction, userRef, validated.version, updatePayload);
    });

    await invalidateUserCache(userId);

    return { error: null, success: true as const , data: null };
});

/**
 * Update notification preferences
 */
export const updateNotificationPreferencesAction = withSafeAction("updateNotificationPreferencesAction", async (preferences: { email: boolean;
    push: boolean;
    sms: boolean; }) => { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    // Validate input
    const validated = notificationPreferencesSchema.parse(preferences);

    const userId = session.user.id;

    // Update Firestore
    await db.collection(COLLECTIONS.USERS).doc(userId).update({ notifications: validated,
        updatedAt: new Date() });

    return { error: null, success: true as const , data: null };
});
