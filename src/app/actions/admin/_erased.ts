"use server";

/**
 * Reading a deleted member's retained profile — #530.
 *
 * Owner instruction, verbatim: "the users profile should still be saved even
 * after they delete their profile so admin can use it for audit incase of
 * fraud etc."
 *
 * The first half of that is done in lib/user-erasure: erasureRetentionRecord
 * now carries the whole profile (minus credentials) into ERASURE_RETENTION.
 * This is the second half — "so admin can use it". Without a reader the
 * retention is a copy nobody can consult, which satisfies the letter of the
 * instruction and none of its purpose.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is not a restore. Nothing here writes to the user row, and there is no
 * un-delete: the account stays scrubbed and refused at login, and this hands
 * back a READ of the retained copy. Reinstating a person is a different act
 * with different consent questions and is not smuggled in here.
 *
 * It is not a list. There is no "browse everyone who left" — the caller must
 * already know whose record they are opening, which is what an investigation
 * looks like and what a fishing expedition does not.
 *
 * WHY super_admin ONLY
 * --------------------
 * This is the most sensitive read the platform has: the complete record of
 * somebody who asked to be forgotten, BVN and NIN included. users:read is held
 * by every admin role and users:export by `admin` as well, so neither expresses
 * it. "users:read_erased" is new for the same reason "users:export" was —
 * #64's note: "There was no permission to use. users:read is the closest and is
 * held by all ten roles, which is the problem restated rather than fixed."
 *
 * WHY EVERY READ IS RECORDED
 * --------------------------
 * Because the whole justification for keeping the data is accountability, and a
 * retention nobody can audit the use of is the opposite of that. The row is
 * written BEFORE the record is returned, under the platform's existing
 * 'data_access' action — the same one broadcast.ts uses when it reads member
 * addresses — so a failed audit write cannot be followed by a successful read.
 */

import { requireAdmin } from "@/lib/require-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createAdminAuditLog } from "@/lib/audit-log";
import { logger } from "@/lib/logger";
import { withFlexibleSafeAction, type ActionResponse } from "@/lib/safe-action";

async function _getErasedUserRecordAction(userId: string): Promise<ActionResponse<any>> {
    try {
        // requireAdmin, not session.user.roles: it re-reads the roles from the
        // database rather than trusting the JWT, which #356 established can be
        // hours stale, and refuses a suspended or banned account while it has
        // the document. #526 found this exact shape unfixed on the role
        // endpoint; a new privileged reader does not get to repeat it.
        const authCheck = await requireAdmin("users:read_erased");
        if ("error" in authCheck) {
            return { success: false as const, error: authCheck.error, data: null };
        }

        const target = String(userId ?? "").trim();
        if (!target) {
            return { success: false as const, error: "A user id is required.", data: null };
        }

        const snap = await db.collection(COLLECTIONS.ERASURE_RETENTION).doc(target).get();
        if (!snap.exists) {
            // Distinguished from a refusal on purpose: "no record" and "you may
            // not see it" are different answers and an investigator needs to
            // know which one they got.
            return {
                success: false as const,
                error: "No retained record exists for that account.",
                data: null,
            };
        }

        // Written BEFORE the record is handed over. createAdminAuditLog never
        // throws (see recordAdminAction), so this cannot fail the read — but it
        // also cannot be skipped by an early return further down.
        await createAdminAuditLog({
            action: "data_access",
            userId: authCheck.userId,
            targetId: target,
            targetType: "erased_user",
            details: `Read the retained profile of erased account ${target}.`,
            metadata: { basis: "fraud_prevention" },
        });

        return { success: true as const, error: null, data: snap.data() };
    } catch (error: any) {
        logger.error("[erased-record] read failed", { error: error?.message });
        return { success: false as const, error: "Could not read the retained record.", data: null };
    }
}

export const getErasedUserRecordAction = withFlexibleSafeAction(
    "getErasedUserRecordAction",
    _getErasedUserRecordAction,
);
