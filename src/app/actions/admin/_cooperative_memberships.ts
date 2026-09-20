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
import { identityPatchFor, rowNamesSomebody } from "@/lib/cooperative-identity-backfill";
import { ledgerBalanceOf } from "@/lib/cooperative-ledger-balance";
import {
    checkRepair,
    membershipRowFor,
    type MissingMembershipCase, tierIsADecision } from "@/lib/cooperative-membership-repair";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { logger } from "@/lib/logger";
import { withFlexibleSafeAction, type ActionResponse } from "@/lib/safe-action";
import { ownedProfileIdsFor, filterByOwner } from "@/lib/owned-profile-ids";

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

    //   ACROSS EVERY PROFILE ROW THEY OWN. This ledger DERIVES the savings
    //   balance the repair writes, and this file's own header is unambiguous
    //   about the stakes: "Inventing a savings figure would be inventing
    //   money." A member whose contributions are filed under a superseded
    //   profile would have had them summed to zero, and the repair would have
    //   written that zero onto their membership as fact.
    const ledger = await filterByOwner(
        db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS), "userId",
        await ownedProfileIdsFor(userId))
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
        //   #803 — a decision only when the cooperative actually offers a
        //   choice. It has one tier, so an absent tier is not a question for a
        //   person; checkRepair writes DEFAULT_MEMBERSHIP_TIER. Should a second
        //   tier ever be priced again, this turns the question back on.
        needsATier: tierIsADecision(knownTier),
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

// ─────────────────────────────────────────────────────────────────────────────
// BACKFILLING THE IDENTITY OF MEMBERS THE PLATFORM PAID ATTENTION TO ONCE
// ─────────────────────────────────────────────────────────────────────────────

/** What a backfill did, or would do. */
export interface IdentityBackfillReport {
    /** Membership rows examined — active/approved, paid, never onboarded. */
    scanned: number;
    /** Of those, how many name nobody. The 715. */
    unnamed: number;
    /** Rows this would write to. */
    fillable: number;
    /** Of those, how many gain a name specifically. */
    namesRecovered: number;
    /** Field name → how many rows would gain it. */
    byField: Record<string, number>;
    /** Rows written. Zero on a dry run. */
    written: number;
    /** True when the scan hit its bound and the counts are a lower bound. */
    truncated: boolean;
    dryRun: boolean;
}

/**
 * Fill in what the platform already knows about members who never onboarded.
 *
 *   DRY RUN BY DEFAULT. 715 rows is not a thing to write to on the strength of
 *   a function name, and the report below says exactly what would change —
 *   per field, and how many members gain a NAME — before anything does.
 *
 *   NOTHING ABOUT STATUS CHANGES. Not membershipStatus, not paymentStatus, and
 *   above all not `onboardingCompleted`: see the header of
 *   lib/cooperative-identity-backfill for why setting that would hand these
 *   members the exact grant three heal guards were just written to withhold.
 *   Whether a member who still cannot be identified should stay active is a
 *   separate decision about people's access, and this is not it.
 */
async function _backfillMemberIdentitiesAction(
    input: { dryRun?: boolean; limit?: number } = {},
): Promise<ActionResponse<IdentityBackfillReport>> {
    const dryRun = input.dryRun !== false;
    const limit = Math.max(1, Math.min(input.limit ?? 1000, 5000));

    try {
        const auth = await requireAdmin("cooperatives:approve_members");
        if ("error" in auth) {
            return { success: false as const, error: auth.error, data: null };
        }

        const snap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .where("paymentStatus", "==", "completed")
            .limit(limit + 1)
            .get();

        const rows = snap.docs.slice(0, limit);
        const truncated = snap.docs.length > limit;

        const report: IdentityBackfillReport = {
            scanned: 0, unnamed: 0, fillable: 0, namesRecovered: 0,
            byField: {}, written: 0, truncated, dryRun,
        };

        for (const doc of rows) {
            const member = doc.data() ?? {};

            //   The cohort: paid, never onboarded, and admitted anyway. A
            //   member who completed the form is not this tool's business even
            //   if a field is blank — they answered, and a blank is an answer.
            if (member.onboardingCompleted === true) continue;
            const status = String(member.membershipStatus ?? member.status ?? "").toLowerCase();
            if (status !== "active" && status !== "approved") continue;

            report.scanned += 1;
            const wasUnnamed = !rowNamesSomebody(member);
            if (wasUnnamed) report.unnamed += 1;

            const userId = member.userId;
            if (!userId) continue;

            const userSnap = await db.collection(COLLECTIONS.USERS).doc(String(userId)).get();
            const patch = identityPatchFor(member, userSnap.exists ? userSnap.data() : {});
            if (patch.filled.length === 0) continue;

            report.fillable += 1;
            if (wasUnnamed && patch.filled.includes("fullName")) report.namesRecovered += 1;
            for (const f of patch.filled) {
                report.byField[f] = (report.byField[f] ?? 0) + 1;
            }

            if (dryRun) continue;

            await doc.ref.set({
                ...patch.fields,
                //   Derived, and said so. An admin must always be able to tell
                //   a value the member declared from one inferred for them.
                _identityBackfilledAt: FieldValue.serverTimestamp(),
                _identityBackfilledFields: patch.filled,
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
            report.written += 1;
        }

        if (!dryRun && report.written > 0) {
            await createAdminAuditLog({
                action: "cooperative_identity_backfill",
                userId: auth.userId,
                targetId: "cooperative_members",
                targetType: "collection",
                details: `Backfilled identity onto ${report.written} membership row(s) from the `
                    + `user document and its module registrations. ${report.namesRecovered} gained a name. `
                    + `No status and no onboardingCompleted flag was changed.`,
                metadata: { ...report.byField, written: report.written, scanned: report.scanned },
            });
        }

        logger.info(
            `[cooperative-identity-backfill] ${dryRun ? "DRY RUN" : "WROTE"} — scanned ${report.scanned}, `
            + `unnamed ${report.unnamed}, fillable ${report.fillable}, names ${report.namesRecovered}`,
            report.byField,
        );

        return { success: true as const, error: null, data: report };
    } catch (error: any) {
        logger.error("[cooperative-identity-backfill] failed", {
            error: error?.message ?? String(error),
        });
        return { success: false as const, error: "Could not run the identity backfill.", data: null };
    }
}

export const backfillMemberIdentitiesAction = withFlexibleSafeAction(
    "backfillMemberIdentitiesAction", _backfillMemberIdentitiesAction);
