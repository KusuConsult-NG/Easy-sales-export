"use server";

/**
 * The screen for a decision the forensic report could only describe — #724.
 *
 * The duplicate-profile scan has reported the same finding for weeks and says
 * why it does nothing about it:
 *
 *     "Nothing here merges or deletes them: which of somebody's records is the
 *      person is not a decision code should make unattended."
 *
 * Right, and it leaves the owner with a number and no next step. This is the
 * next step. The DECISION stays theirs; the evidence, the ranking, the safe
 * application and the record of who chose are done for them.
 *
 * ── WHAT IT WRITES, AND WHY THAT IS ALL IT WRITES ───────────────────────────
 *
 * One field, `_migratedTo`, on the records NOT chosen. Nothing is deleted, no
 * field is cleared, and no data moves between rows — so a superseded record
 * keeps everything it holds and merely stops being mistaken for the person.
 *
 * Every reader already honours that pointer: the login ranks a row carrying it
 * below every other candidate (#490), and resolveActiveUser walks it to the
 * live row on every money path (#449). There is nothing to teach and nothing to
 * repoint.
 *
 * IT IS REVERSIBLE, which matters more here than anywhere else in this audit.
 * If the owner picks wrong, clearing one field puts the group back exactly as
 * it was. A merge-and-delete tool — the obvious thing to build — could not
 * offer that, and the standing instruction on this audit is that nothing is
 * destroyed.
 *
 * ── WHY users:update AND NOT A NEW PERMISSION ───────────────────────────────
 *
 * #530 minted `users:read_erased` because reading a forgotten member's BVN is
 * unlike any other read. This is not that: it writes one ordinary field on a
 * user row, which is what `users:update` already names, and inventing a
 * permission for every screen is how a matrix stops meaning anything. The gate
 * is requireAdmin — which re-reads roles from the database rather than trusting
 * a JWT #356 showed can be hours stale, and refuses a suspended account.
 */

import { requireAdmin } from "@/lib/require-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { maskAddress } from "@/lib/missing-email-backfill";
import {
    describeGroup,
    checkResolution,
    type DuplicateGroup,
} from "@/lib/duplicate-profile-resolution";
import { logger } from "@/lib/logger";
import { withFlexibleSafeAction, type ActionResponse } from "@/lib/safe-action";

/** Matches the forensic scan's own paging, so both read the same population. */
const PAGE = 1000;
const MAX_PAGES = 50;

/** Every profile grouped by its normalised address. Read-only. */
async function loadGroups(): Promise<Map<string, { id: string; data: Record<string, unknown> }[]>> {
    const byEmail = new Map<string, { id: string; data: Record<string, unknown> }[]>();

    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        let q = db.collection(COLLECTIONS.USERS).orderBy("id").limit(PAGE);
        if (cursor) q = q.startAfter(cursor);
        const snap = await q.get();
        if (snap.docs.length === 0) break;

        for (const d of snap.docs) {
            const data = (d.data() ?? {}) as Record<string, unknown>;
            const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
            if (!email) continue;
            byEmail.set(email, [...(byEmail.get(email) ?? []), { id: d.id, data }]);
        }

        cursor = snap.docs[snap.docs.length - 1].id;
        if (snap.docs.length < PAGE) break;
    }

    return byEmail;
}

export interface DuplicateProfileReport {
    groups: DuplicateGroup[];
    /** Counts by state, so the screen can lead with how much is actually owed. */
    needsADecision: number;
    inconsistent: number;
    resolved: number;
}

async function _listDuplicateProfileGroupsAction(): Promise<ActionResponse<DuplicateProfileReport | null>> {
    try {
        const authCheck = await requireAdmin("users:update");
        if ("error" in authCheck) {
            return { success: false as const, error: authCheck.error, data: null };
        }

        const byEmail = await loadGroups();
        const groups: DuplicateGroup[] = [];

        for (const [email, rows] of byEmail) {
            if (rows.length < 2) continue;
            groups.push(describeGroup(email, maskAddress(email), rows));
        }

        /*
         *   ORDERED BY WHAT IS OWED, not by size.
         *
         *   The forensic scan sorts worst-first by count, which is right for a
         *   report. This is a worklist: a group that needs a decision is work
         *   and a resolved pair is not, so a screen sorted by size would bury
         *   the three real decisions under thirty settled migrations.
         */
        const rank = { "needs-a-decision": 0, inconsistent: 1, resolved: 2 } as const;
        groups.sort((a, b) => {
            const byState = rank[a.state] - rank[b.state];
            if (byState !== 0) return byState;
            return b.candidates.length - a.candidates.length;
        });

        return {
            success: true as const,
            error: null,
            data: {
                groups,
                needsADecision: groups.filter((g) => g.state === "needs-a-decision").length,
                inconsistent: groups.filter((g) => g.state === "inconsistent").length,
                resolved: groups.filter((g) => g.state === "resolved").length,
            },
        };
    } catch (error: any) {
        logger.error("[admin/duplicate-profiles] Could not list duplicate profile groups", {
            error: error?.message ?? String(error),
        });
        return { success: false as const, error: "Could not read the duplicate profiles.", data: null };
    }
}

export interface ResolveDuplicateInput {
    /** The address whose group is being settled. */
    email: string;
    /** The record that IS the person. */
    keepId: string;
    /** The records to mark superseded. Never deleted. */
    supersedeIds: string[];
    /** Why, in the operator's own words. Recorded on every superseded row. */
    reason: string;
}

async function _resolveDuplicateProfileGroupAction(
    input: ResolveDuplicateInput,
): Promise<ActionResponse<{ superseded: string[] } | null>> {
    try {
        const authCheck = await requireAdmin("users:update");
        if ("error" in authCheck) {
            return { success: false as const, error: authCheck.error, data: null };
        }

        const email = String(input?.email ?? "").trim().toLowerCase();
        const keepId = String(input?.keepId ?? "").trim();
        const supersedeIds = Array.isArray(input?.supersedeIds)
            ? [...new Set(input.supersedeIds.map((s) => String(s).trim()).filter(Boolean))]
            : [];
        const reason = String(input?.reason ?? "").trim();

        if (!email || !keepId) {
            return { success: false as const, error: "An address and a record to keep are required.", data: null };
        }
        if (reason.length < 4) {
            /*
             *   A REASON IS REQUIRED, and this is not ceremony. The whole value
             *   of an audit row on an identity decision is that somebody later
             *   can tell WHY this record was chosen over that one — six months
             *   on, the evidence on the rows may have changed and the decision
             *   will not be re-derivable from them.
             */
            return { success: false as const, error: "Say why this record is the person.", data: null };
        }

        /*
         *   THE GROUP IS RE-READ AND RE-CLASSIFIED HERE.
         *
         *   Not trusted from the screen, and not from the request. The rows may
         *   have changed since the list was rendered — a login can migrate a
         *   profile, another admin can settle the same group — and every rule
         *   in checkResolution is about refusing a write that one cleared field
         *   could not undo. Deciding from what the caller sent would make all
         *   of them decorative.
         */
        const byEmail = await loadGroups();
        const rows = byEmail.get(email) ?? [];
        if (rows.length < 2) {
            return {
                success: false as const,
                error: "That address no longer holds more than one profile — it may already be settled.",
                data: null,
            };
        }

        const group = describeGroup(email, maskAddress(email), rows);
        const verdict = checkResolution({ group, keepId, supersedeIds });
        if (!verdict.ok) {
            return { success: false as const, error: verdict.reason, data: null };
        }

        //   Written BEFORE the effect, as #530 established for the erasure
        //   reader: createAdminAuditLog never throws, so this cannot fail the
        //   operation, and it also cannot be skipped by an early return.
        await createAdminAuditLog({
            action: "user_profile_supersede",
            userId: authCheck.userId,
            targetId: keepId,
            targetType: "user",
            details: `Chose ${keepId} as the person for ${maskAddress(email)}; superseded `
                + `${supersedeIds.length} record(s). Reason: ${reason}`,
            metadata: { keepId, supersedeIds, reason },
        });

        const superseded: string[] = [];
        for (const id of supersedeIds) {
            /*
             *   ONE FIELD, MERGED. `_migratedTo` is what every reader already
             *   follows; `supersededAt`/`supersededBy`/`supersededReason` are
             *   recorded beside it so the row itself says who decided and why,
             *   rather than that living only in the audit table.
             *
             *   Nothing else is touched. No delete, no clear, no copy between
             *   rows — which is what makes clearing `_migratedTo` a complete
             *   undo.
             */
            await db.collection(COLLECTIONS.USERS).doc(id).set({
                _migratedTo: keepId,
                supersededAt: FieldValue.serverTimestamp(),
                supersededBy: authCheck.userId,
                supersededReason: reason,
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
            superseded.push(id);
        }

        logger.info(
            `[admin/duplicate-profiles] ${authCheck.userId} kept ${keepId} for ${maskAddress(email)} `
            + `and superseded ${superseded.length} record(s).`,
        );

        return { success: true as const, error: null, data: { superseded } };
    } catch (error: any) {
        logger.error("[admin/duplicate-profiles] Could not resolve the group", {
            error: error?.message ?? String(error),
        });
        return { success: false as const, error: "Could not apply that decision.", data: null };
    }
}

export const listDuplicateProfileGroupsAction = withFlexibleSafeAction(
    "listDuplicateProfileGroupsAction", _listDuplicateProfileGroupsAction);

export const resolveDuplicateProfileGroupAction = withFlexibleSafeAction(
    "resolveDuplicateProfileGroupAction", _resolveDuplicateProfileGroupAction);
