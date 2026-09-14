"use server";

/**
 * Writing the membership row the platform owes a member — #726.
 *
 * The reconciliation check is unambiguous about what this finding is:
 *
 *     "unlike an unrecorded gender, this is not a fact nobody collected. The
 *      role was granted. The row should exist. Somebody has to make it exist."
 *
 * So this is NOT #725's case. There, writing the missing application would lie
 * about a form nobody submitted and the tool refuses to. Here the missing row
 * is derived bookkeeping the platform owes the member, and creating it is the
 * correct repair.
 *
 * ── WHAT IS DERIVED AND WHAT IS DECIDED ─────────────────────────────────────
 *
 * THE BALANCE IS DERIVED, ALWAYS. From the member's completed cooperative
 * transactions, through the same function the reconciliation check verifies
 * every other member with. That is not a convenience: if this derived a balance
 * by one rule and the check verified it by another, the repair would create a
 * row the check flags as mismatched the instant it was written. Inventing a
 * savings figure would be inventing money.
 *
 * THE TIER IS COPIED WHEN IT IS KNOWN. The user's own registration carries
 * `membershipTier`, written when they paid. A form that let an admin type over
 * it would turn a copy into a decision, and the value written would stop
 * matching what the member bought — so the server refuses a tier that
 * contradicts a known one.
 *
 * WHAT IS LEFT is the member with no recorded tier, and that IS a decision: a
 * tier sets what they may borrow against.
 *
 * ── AND THE ROW IS CREATED `pending`, NOT `active` ──────────────────────────
 *
 * Creating the row is bookkeeping. ACTIVATING a membership is a grant, and this
 * tool does not know what the activation paths know — whether the member was
 * suspended, never completed onboarding, or had a decision taken against them.
 * `pending` lets those paths decide; `active` would pre-empt them.
 */

import { requireAdmin } from "@/lib/require-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { maskAddress } from "@/lib/missing-email-backfill";
import { findCooperativeMemberRow } from "@/lib/cooperative-member-lookup";
import { ledgerBalanceOf } from "@/lib/cooperative-ledger-balance";
import {
    checkRepair,
    membershipRowFor,
    type MissingMembershipCase,
} from "@/lib/cooperative-membership-repair";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { logger } from "@/lib/logger";
import { withFlexibleSafeAction, type ActionResponse } from "@/lib/safe-action";

/** Matches the reconciliation check's own sample bound. */
const SCAN_LIMIT = 200;

/** What the platform knows about one member, or null when their row exists. */
async function buildCase(doc: { id: string; data: () => any }): Promise<MissingMembershipCase | null> {
    const userId = doc.id;
    const data = doc.data() ?? {};

    //   The SHARED lookup — both keys, document id then the `userId` field.
    //   #488: the owner's "2 members with no membership record" was the scan
    //   asking a narrower question than the application, and those rows were
    //   where every other reader finds them.
    const existing = await findCooperativeMemberRow(
        db.collection(COLLECTIONS.COOPERATIVE_MEMBERS), userId,
    );
    if (existing) return null;

    const ledger = await db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS)
        .where("userId", "==", userId)
        .where("status", "==", "completed")
        .get();

    const rows = ledger.docs.map((d: any) => d.data());
    const registration = data?.serviceRegistrations?.cooperatives ?? {};
    const knownTier = typeof registration.membershipTier === "string" && registration.membershipTier.trim() !== ""
        ? registration.membershipTier.trim()
        : null;

    return {
        userId,
        fullName: typeof data.fullName === "string" ? data.fullName : "",
        maskedEmail: typeof data.email === "string" && data.email ? maskAddress(data.email) : "(no address)",
        knownTier,
        ledgerBalance: ledgerBalanceOf(rows),
        ledgerRows: rows.length,
        paymentReference: typeof registration.paymentReference === "string"
            ? registration.paymentReference
            : null,
        needsATier: knownTier === null,
    };
}

export interface MissingMembershipReport {
    cases: MissingMembershipCase[];
    /** Rows the platform can write with no decision at all. */
    fullyKnown: number;
    /** Rows where a person has to choose the tier. */
    needATier: number;
}

async function _listMissingMembershipsAction(): Promise<ActionResponse<MissingMembershipReport | null>> {
    try {
        const authCheck = await requireAdmin("cooperatives:approve_members");
        if ("error" in authCheck) {
            return { success: false as const, error: authCheck.error, data: null };
        }

        const members = await db.collection(COLLECTIONS.USERS)
            .where("roles", "array-contains", "cooperative_member")
            .limit(SCAN_LIMIT)
            .get();

        const cases: MissingMembershipCase[] = [];
        for (const doc of members.docs) {
            const c = await buildCase(doc as any);
            if (c) cases.push(c);
        }

        //   The ones needing a decision first: the rest are a button press.
        cases.sort((a, b) => {
            if (a.needsATier !== b.needsATier) return a.needsATier ? -1 : 1;
            return a.userId < b.userId ? -1 : 1;
        });

        return {
            success: true as const,
            error: null,
            data: {
                cases,
                fullyKnown: cases.filter((c) => !c.needsATier).length,
                needATier: cases.filter((c) => c.needsATier).length,
            },
        };
    } catch (error: any) {
        logger.error("[admin/cooperative-memberships] Could not list the cases", {
            error: error?.message ?? String(error),
        });
        return { success: false as const, error: "Could not read the cooperative memberships.", data: null };
    }
}

export interface CreateMembershipInput {
    userId: string;
    reason: string;
    /** Only when the member has no recorded tier. */
    tier?: string;
}

async function _createMissingMembershipAction(
    input: CreateMembershipInput,
): Promise<ActionResponse<{ userId: string; tier: string; balance: number } | null>> {
    try {
        const authCheck = await requireAdmin("cooperatives:approve_members");
        if ("error" in authCheck) {
            return { success: false as const, error: authCheck.error, data: null };
        }

        const userId = String(input?.userId ?? "").trim();
        const reason = String(input?.reason ?? "").trim();
        const chosenTier = input?.tier ? String(input.tier).trim() : undefined;

        if (!userId) {
            return { success: false as const, error: "A member is required.", data: null };
        }

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        if (!userDoc.exists) {
            return { success: false as const, error: "That member no longer exists.", data: null };
        }

        /*
         *   THE CASE IS REBUILT FROM THE DATABASE, and that includes re-reading
         *   the membership row.
         *
         *   Between the list rendering and the button being pressed the member
         *   may have paid — the registration processor writes this row itself —
         *   or another admin may have repaired the same case. Creating a second
         *   row would split one member's savings across two records, which is a
         *   worse state than the one being fixed.
         */
        const current = await buildCase({ id: userDoc.id, data: () => userDoc.data() } as any);
        if (!current) {
            return {
                success: false as const,
                error: "That member already has a membership row — it may have just been created.",
                data: null,
            };
        }

        const verdict = checkRepair({
            known: { knownTier: current.knownTier, needsATier: current.needsATier },
            chosenTier,
            reason,
        });
        if (!verdict.ok) {
            return { success: false as const, error: verdict.reason, data: null };
        }

        //   Written BEFORE the effect — #530's rule.
        await createAdminAuditLog({
            action: "cooperative_membership_repair",
            userId: authCheck.userId,
            targetId: userId,
            targetType: "user",
            details: `Created the missing cooperative membership row for ${userId} at ${verdict.tier}, `
                + `balance ₦${current.ledgerBalance} derived from ${current.ledgerRows} completed `
                + `transaction(s). Reason: ${reason}`,
            metadata: {
                tier: verdict.tier,
                tierWasKnown: !current.needsATier,
                ledgerBalance: current.ledgerBalance,
                ledgerRows: current.ledgerRows,
                reason,
            },
        });

        /*
         *   Keyed by the USER ID, which is the key findCooperativeMemberRow
         *   tries first and what most writers use. A second row under an
         *   auto-generated id is exactly the shape #488 had to write a
         *   two-key lookup for.
         *
         *   `merge: true` so this can never flatten a row that appeared between
         *   the check above and this write.
         */
        await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).set({
            ...membershipRowFor({
                userId,
                tier: verdict.tier,
                ledgerBalance: current.ledgerBalance,
                paymentReference: current.paymentReference,
                adminId: authCheck.userId,
                reason,
            }),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        //   #692 — the membership row is what cooperative access is read from.
        await invalidateUserCache(userId);

        logger.info(
            `[admin/cooperative-memberships] ${authCheck.userId} created the missing membership row for `
            + `${userId} at ${verdict.tier} with a derived balance of ${current.ledgerBalance}.`,
        );

        return {
            success: true as const,
            error: null,
            data: { userId, tier: verdict.tier, balance: current.ledgerBalance },
        };
    } catch (error: any) {
        logger.error("[admin/cooperative-memberships] Could not create the membership row", {
            error: error?.message ?? String(error),
        });
        return { success: false as const, error: "Could not create that membership row.", data: null };
    }
}

export const listMissingMembershipsAction = withFlexibleSafeAction(
    "listMissingMembershipsAction", _listMissingMembershipsAction);

export const createMissingMembershipAction = withFlexibleSafeAction(
    "createMissingMembershipAction", _createMissingMembershipAction);
