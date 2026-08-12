import "server-only";

import crypto from "crypto";
import { logger } from "@/lib/logger";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { adminAuth } from "@/lib/firebase-admin";

/**
 * Take away someone's ability to sign in.
 *
 * WHY THIS EXISTS
 * ---------------
 * Three separate actions tried to end an account and none of them worked,
 * because they each addressed the wrong store or the wrong field.
 *
 *   admin_extensions.ts   disabled the FIREBASE auth user, with the comment
 *                         "prevent login". lib/auth.ts authenticates against
 *                         SUPABASE first and only falls back to Firebase, so
 *                         the disabled record was never consulted. It also set
 *                         `roles: ["deleted"]` and `isActive: false`, and login
 *                         checks neither — it checks isBanned, status ===
 *                         'banned' and suspended.
 *
 *   user.ts               the user's own right-to-erasure path scrubbed the
 *                         profile and touched NO auth store at all. Somebody
 *                         who deleted their account kept a working password.
 *
 *   profile.ts            changed the email in Firebase only, so the old
 *                         address still signed in through Supabase and the new
 *                         one could fork a second auth identity through the
 *                         JIT-migration branch.
 *
 * WHAT IT DOES
 * ------------
 * Both halves, because either alone has been shown to fail:
 *
 *   1. The profile gets `suspended: true`, which is a field lib/auth.ts already
 *      refuses to log in. This works even if the auth provider call fails, and
 *      it is the belt to the braces below.
 *
 *   2. Supabase Auth — the store that actually authenticates — gets the account
 *      moved to a scrubbed address and a random password nobody holds. That is
 *      what stops the ORIGINAL credentials working, which disabling Firebase
 *      never did.
 *
 * Firebase is disabled too, best effort, so the legacy fallback cannot honour a
 * superseded credential either.
 *
 * The Supabase result is returned rather than thrown, so a caller can decide
 * whether a partial revocation should fail the whole operation. Deletion should
 * say so; an email change should not lose the profile write over it.
 */
export interface RevocationResult {
    /** The primary store was updated. False means the old password may still work. */
    primaryRevoked: boolean;
    /** The legacy store was updated. Informational — most accounts have no record there. */
    legacyRevoked: boolean;
    error?: string;
}

/** Resolve the id Supabase Auth knows this person by. */
export async function resolveSupabaseAuthId(userId: string): Promise<string> {
    try {
        const profile = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        // The JIT migration in lib/auth.ts records supabaseAuthId when it
        // provisions a legacy account. A normally-registered account uses the
        // Supabase UUID as its own document id.
        return profile.data()?.supabaseAuthId || userId;
    } catch {
        return userId;
    }
}

/**
 * Point the account at a new email in every auth store.
 *
 * Used by the profile email change, where the person keeps their access — so
 * the password is deliberately left alone.
 */
export async function syncAuthEmail(userId: string, newEmail: string): Promise<RevocationResult> {
    const authId = await resolveSupabaseAuthId(userId);
    const { supabaseAdmin } = await import("@/lib/supabase");

    const { error } = await supabaseAdmin.auth.admin.updateUserById(authId, { email: newEmail });
    if (error) {
        logger.error("[auth-revocation] Supabase email sync failed", { userId, error });
        return { primaryRevoked: false, legacyRevoked: false, error: error.message };
    }

    let legacyRevoked = false;
    try {
        await adminAuth.updateUser(userId, { email: newEmail });
        legacyRevoked = true;
    } catch (err: any) {
        logger.warn("[auth-revocation] legacy email sync skipped", { userId, message: err?.message });
    }

    return { primaryRevoked: true, legacyRevoked };
}

/**
 * End an account's ability to authenticate.
 *
 * `scrubbedEmail` is the address the account is moved to. Callers that are
 * scrubbing PII already have one; passing theirs keeps the auth record and the
 * profile telling the same story.
 */
export async function revokeAuthAccess(
    userId: string,
    scrubbedEmail: string
): Promise<RevocationResult> {
    const authId = await resolveSupabaseAuthId(userId);
    const { supabaseAdmin } = await import("@/lib/supabase");

    // A password nobody has ever seen. The account cannot be signed into with
    // the credentials its owner remembers, which disabling Firebase did not
    // achieve because Supabase is consulted first.
    const unusablePassword = crypto.randomBytes(48).toString("base64url");

    const { error } = await supabaseAdmin.auth.admin.updateUserById(authId, {
        email: scrubbedEmail,
        password: unusablePassword,
    });

    if (error) {
        logger.error("[auth-revocation] Supabase revocation failed", { userId, error });
        return { primaryRevoked: false, legacyRevoked: false, error: error.message };
    }

    let legacyRevoked = false;
    try {
        await adminAuth.updateUser(userId, {
            disabled: true,
            email: scrubbedEmail,
            password: unusablePassword,
        });
        legacyRevoked = true;
    } catch (err: any) {
        // Plenty of accounts have no Firebase record; the primary store is
        // already correct by this point.
        logger.warn("[auth-revocation] legacy revocation skipped", { userId, message: err?.message });
    }

    return { primaryRevoked: true, legacyRevoked };
}
