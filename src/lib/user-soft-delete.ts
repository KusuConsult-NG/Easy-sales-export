import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { logger } from "@/lib/logger";
import { userErasurePatch, erasedEmailFor, erasureRetentionRecord } from "@/lib/user-erasure";
import { eraseModuleApplications } from "@/lib/module-application-erasure";
import { revokeAuthAccess } from "@/lib/auth-revocation";

/**
 * Deleting one user account — the whole operation, in one place.
 *
 *   #206 THE BULK DELETE SCRUBBED NO PERSONAL DATA AT ALL.
 *
 *        Two doors delete a member, both gated on `users:delete`, both
 *        described in their own files as doing the same job:
 *
 *          softDeleteUserAction   (admin_extensions.ts) — one user
 *          bulkDeleteUsersAction  (bulk-user-operations.ts) — up to 50
 *
 *        The single door does the work #283, #300, #305, #371 and #376 built:
 *        it writes the retention record FIRST so nothing is destroyed, applies
 *        the shared PII patch, scrubs the eight module rows the member's
 *        identity is copied onto, and revokes sign-in against the scrubbed
 *        address.
 *
 *        The bulk door wrote FIVE FIELDS:
 *
 *            { deleted: true, deletedAt, deletedBy, deletionReason,
 *              suspended: true }
 *
 *        and nothing else. Name, email, phone, BVN, NIN, next of kin, bank
 *        account and identity-document URLs all remained, on the user row and
 *        on every module row, for as many as fifty people at a time. The
 *        account was refused at login — `suspended` is the field lib/auth.ts
 *        actually reads — so this was never an access defect. It was a
 *        retention one, and the same compliance failure #283 opened.
 *
 *        THE SHAPE IS THE ONE THIS CODEBASE KEEPS PRODUCING: two doors onto one
 *        operation, and five successive fixes all landing on the door somebody
 *        happened to be looking at. lib/user-erasure.ts said so in its own
 *        header — "there is more than one deletion path — see the note on
 *        bulk-user-operations.ts" — and the fixes still went to one of them.
 *
 *        Sharing the FIELD LISTS was not enough, because the omission was never
 *        a field: it was the four STEPS. So the operation lives here now, and
 *        both doors call it.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not decide WHO may delete, and it does not decide whether a
 * particular target is deletable. Both doors have their own rules — the single
 * one refuses admins unless the caller is a super_admin, the bulk one skips
 * them and reports the id — and those are authorisation, which belongs at the
 * door. This is the operation, once it has been authorised.
 *
 * NOTHING IS DESTROYED. The retention record is written before the scrub, and
 * the row survives with its uid so foreign keys like an order's `sellerId` do
 * not break. That is the standing instruction for this codebase.
 */

export type SoftDeleteOutcome =
    | { ok: true }
    | { ok: false; stage: "retention" | "modules" | "auth" | "write"; reason: string };

/** What each failure stage means to whoever is reading the report. */
export const SOFT_DELETE_STAGE_MESSAGE: Record<
    Exclude<SoftDeleteOutcome, { ok: true }>["stage"], string
> = {
    retention: "the retention record could not be written, so nothing was scrubbed",
    write: "the account row could not be scrubbed",
    modules: "the account was scrubbed but some module records could not be reached",
    auth: "the account was scrubbed but sign-in could not be revoked",
};

/**
 * Scrub one account and revoke its sign-in.
 *
 * ORDER MATTERS AND IS NOT INCIDENTAL:
 *
 *   1. RETENTION FIRST. erasureRetentionRecord copies the identity-document
 *      references into the server-only collection before the row's copy of
 *      them is removed. If this fails, NOTHING is scrubbed — losing the
 *      references is the one outcome the owner ruled out.
 *   2. The user row.
 *   3. The eight module rows the identity is copied onto (#376).
 *   4. Auth revocation, against the scrubbed address.
 *
 * A failure after step 2 is reported rather than swallowed, and rather than
 * rolled back: the data is already scrubbed, and un-scrubbing it to make the
 * report tidy would put the personal data back.
 */
export async function softDeleteUserRecord(
    targetUserId: string,
    deletedBy: string,
    extra: Record<string, unknown> = {},
): Promise<SoftDeleteOutcome> {
    const userRef = db.collection(COLLECTIONS.USERS).doc(targetUserId);

    let userData: Record<string, unknown> | undefined;
    try {
        const snap = await userRef.get();
        if (!snap.exists) return { ok: false, stage: "write", reason: "user not found" };
        userData = snap.data() as Record<string, unknown>;
    } catch (error: any) {
        return { ok: false, stage: "write", reason: error?.message ?? "could not read the account" };
    }

    const scrubbedEmail = erasedEmailFor(targetUserId);

    // 1 — retention, before anything is removed.
    try {
        await db.collection(COLLECTIONS.ERASURE_RETENTION).doc(targetUserId).set(
            erasureRetentionRecord(targetUserId, userData),
            { merge: true },
        );
    } catch (error: any) {
        logger.error(`[soft-delete] retention write failed for ${targetUserId}; nothing scrubbed`, error);
        return { ok: false, stage: "retention", reason: error?.message ?? "retention write failed" };
    }

    // 2 — the user row.
    try {
        await userRef.update({
            ...userErasurePatch(targetUserId),
            deleted: true,
            deletedAt: FieldValue.serverTimestamp(),
            deletedBy,
            // `suspended` is the field lib/auth.ts actually refuses at login;
            // roles and isActive are read by nothing in the sign-in path, and
            // are set for the records rather than as the control.
            roles: ["deleted"],
            isActive: false,
            suspended: true,
            ...extra,
            updatedAt: FieldValue.serverTimestamp(),
        });
    } catch (error: any) {
        logger.error(`[soft-delete] account scrub failed for ${targetUserId}`, error);
        return { ok: false, stage: "write", reason: error?.message ?? "account scrub failed" };
    }

    // 3 — the eight module rows (#376).
    const moduleErasure = await eraseModuleApplications(targetUserId);
    if (!moduleErasure.ok) {
        logger.error(`[soft-delete] module rows could not be scrubbed for ${targetUserId}`, {
            failures: moduleErasure.failures,
        });
        return { ok: false, stage: "modules", reason: `${moduleErasure.failures.length} module row(s) unreachable` };
    }

    // 4 — sign-in, against the scrubbed address.
    const revocation = await revokeAuthAccess(targetUserId, scrubbedEmail);
    if (!revocation.primaryRevoked) {
        logger.error(`[soft-delete] auth revocation failed for ${targetUserId}: ${revocation.error}`);
        return { ok: false, stage: "auth", reason: revocation.error ?? "auth revocation failed" };
    }

    return { ok: true };
}
