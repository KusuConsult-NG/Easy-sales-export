"use server";

/**
 * Settling the Farm Nation approvals the forensic scan cannot — #725.
 *
 * The check reports two things that look alike and are not: an approval whose
 * application DISAGREES with it, and an approval with no application findable
 * under any key at all. Neither can be settled unattended, and the reason was
 * written into api/cron/backfill-missing-emails months ago:
 *
 *     "The two available moves are to fabricate an application so the checker
 *      stops reporting it, or to revoke 45 people's approvals. The first makes
 *      the record lie; the second takes something away from members who may
 *      well be entitled to it."
 *
 * THERE IS A THIRD MOVE. An admin can look at a member and vouch for the
 * approval, and recording that — who, when, why — is a TRUE statement about
 * something that happened. It is not a fabricated application, and nothing in
 * this file writes a row into FARM_NATION_APPLICATIONS. There is a test
 * asserting that, because it is the one thing that would make the report green
 * by making the data worse.
 *
 * ── IT LOOKS THE MEMBER UP THE WAY THE SCAN DOES ────────────────────────────
 *
 * Through findFarmNationApplications — the same chain, in the same order, over
 * userId, the applicationId on the user record, legacy_<uid>, then the address.
 * #671 is exactly why: the scan once asked `where("userId","==",id)` and
 * nothing else, and reported 45 of 50 production farmers as approved with no
 * application when the applications were there all along. A tool that looked
 * them up its own way would disagree with the report it exists to work through,
 * and one of them would be wrong.
 *
 * ── NOTHING IS DELETED, AND A REVOKE IS REVERSIBLE ──────────────────────────
 *
 * Every decision writes onto the user's Farm Nation registration and keeps the
 * status it held before, so a revoke can be read back and undone. No document
 * is removed and no registration is cleared. The standing instruction on this
 * audit is that nothing is destroyed.
 */

import { requireAdmin } from "@/lib/require-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { maskAddress } from "@/lib/missing-email-backfill";
import { findFarmNationApplications } from "@/lib/farm-nation-application-lookup";
import {
    checkDecision,
    approvalPatch,
    isSettled,
    type ApprovalDecision,
    type FarmerCase,
} from "@/lib/farm-nation-approval-decision";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { mapWithConcurrency } from "@/lib/bounded-concurrency";
import { logger } from "@/lib/logger";
import { withFlexibleSafeAction, type ActionResponse } from "@/lib/safe-action";

/** Matches the scan's own bound, so both look at the same population. */
const SCAN_LIMIT = 200;

/**
 * How many farmers are looked up at once — #805.
 *
 * Deliberately modest. Each one is a chain of up to eight keyed reads, so this
 * is about forty statements in flight at the peak, not two hundred: enough to
 * take the scan off the timeout without asking the connection pool for
 * something it has no reason to grant.
 */
const SCAN_CONCURRENCY = 8;

/** Build one member's case, or null when there is nothing wrong with them. */
async function buildCase(doc: { id: string; data: () => any }): Promise<FarmerCase | null> {
    const data = doc.data() ?? {};
    const reg = data?.serviceRegistrations?.farmNation ?? {};
    const userStatus: string | null = reg?.status ?? null;

    const matches = await findFarmNationApplications(
        db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS),
        {
            userId: doc.id,
            applicationId: reg?.applicationId ?? null,
            email: data?.email ?? null,
        },
    );

    const base = {
        userId: doc.id,
        fullName: typeof data.fullName === "string" ? data.fullName : "",
        maskedEmail: typeof data.email === "string" && data.email ? maskAddress(data.email) : "(no address)",
        userStatus,
        confirmedBy: typeof reg.reviewDecisionBy === "string" ? reg.reviewDecisionBy : null,
        confirmedAt: typeof reg.reviewDecisionAt === "string" ? reg.reviewDecisionAt : null,
        confirmedReason: typeof reg.reviewDecisionReason === "string" ? reg.reviewDecisionReason : null,
        settled: isSettled(reg),
    };

    if (matches.length === 0) {
        //   Only when the registration actually says approved. A farmer with no
        //   registration at all arrived by some other route and is not this
        //   tool's business — the scan says the same.
        if (userStatus !== "approved") return null;
        return { ...base, issue: "no-application", applicationStatuses: [], foundVia: null };
    }

    const applicationStatuses = matches.map((m) => String(m.data?.status ?? "none"));
    const appApproved = applicationStatuses.includes("approved");
    if (appApproved === (userStatus === "approved")) return null;

    return {
        ...base,
        issue: "drift",
        applicationStatuses,
        foundVia: matches[0].via,
    };
}

export interface FarmNationApprovalReport {
    cases: FarmerCase[];
    noApplication: number;
    drift: number;
    settled: number;
}

async function _listFarmNationApprovalCasesAction(): Promise<ActionResponse<FarmNationApprovalReport | null>> {
    try {
        const authCheck = await requireAdmin("farm_nation:verify_applications");
        if ("error" in authCheck) {
            return { success: false as const, error: authCheck.error, data: null };
        }

        const farmers = await db.collection(COLLECTIONS.USERS)
            .where("roles", "array-contains", "farmer")
            .limit(SCAN_LIMIT)
            .get();

        /*
         *   #805 — SEVERAL AT A TIME. This awaited buildCase once per farmer,
         *   in sequence, and buildCase is eight round trips deep on the path
         *   177 of the 178 production cases take. See lib/bounded-concurrency
         *   for the count; the screen started answering "Could not read the
         *   Farm Nation approvals" because the total sat on the function's
         *   timeout.
         *
         *   Nothing about WHAT is read changes, and the array is indexed by
         *   input position, so `cases` is the same list in the same order it
         *   was before the sort below.
         */
        const built = await mapWithConcurrency(
            farmers.docs, SCAN_CONCURRENCY, (doc: any) => buildCase(doc),
        );
        const cases: FarmerCase[] = built.filter((c): c is FarmerCase => c !== null);

        //   Unsettled first: a case somebody already decided is not work.
        cases.sort((a, b) => {
            if (a.settled !== b.settled) return a.settled ? 1 : -1;
            if (a.issue !== b.issue) return a.issue === "drift" ? -1 : 1;
            return a.userId < b.userId ? -1 : 1;
        });

        return {
            success: true as const,
            error: null,
            data: {
                cases,
                noApplication: cases.filter((c) => c.issue === "no-application" && !c.settled).length,
                drift: cases.filter((c) => c.issue === "drift" && !c.settled).length,
                settled: cases.filter((c) => c.settled).length,
            },
        };
    } catch (error: any) {
        logger.error("[admin/farm-nation-approvals] Could not list the cases", {
            error: error?.message ?? String(error),
        });
        return { success: false as const, error: "Could not read the Farm Nation approvals.", data: null };
    }
}

export interface FarmNationDecisionInput {
    userId: string;
    decision: ApprovalDecision;
    reason: string;
    /** For `reconcile`: "user" or "application". */
    authoritative?: string;
}

async function _decideFarmNationApprovalAction(
    input: FarmNationDecisionInput,
): Promise<ActionResponse<{ userId: string; decision: string } | null>> {
    try {
        const authCheck = await requireAdmin("farm_nation:verify_applications");
        if ("error" in authCheck) {
            return { success: false as const, error: authCheck.error, data: null };
        }

        const userId = String(input?.userId ?? "").trim();
        const decision = String(input?.decision ?? "").trim();
        const reason = String(input?.reason ?? "").trim();
        const authoritative = input?.authoritative ? String(input.authoritative).trim() : undefined;

        if (!userId) {
            return { success: false as const, error: "A member is required.", data: null };
        }

        /*
         *   THE CASE IS REBUILT HERE, from the database, not from the screen.
         *
         *   The member's records can change between the list being rendered and
         *   the button being pressed — an application can arrive, another admin
         *   can decide the same case — and every rule in checkDecision is about
         *   refusing a write that could not be explained afterwards. Deciding
         *   from what the caller sent would make all of them decorative.
         */
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        if (!userDoc.exists) {
            return { success: false as const, error: "That member no longer exists.", data: null };
        }

        const current = await buildCase({ id: userDoc.id, data: () => userDoc.data() } as any);
        if (!current) {
            return {
                success: false as const,
                error: "That member no longer has an approval anomaly — it may already be settled.",
                data: null,
            };
        }

        const verdict = checkDecision({ issue: current.issue, decision, reason, authoritative });
        if (!verdict.ok) {
            return { success: false as const, error: verdict.reason, data: null };
        }

        //   Written BEFORE the effect — #530's rule. createAdminAuditLog never
        //   throws, so this cannot fail the decision, and it cannot be skipped
        //   by an early return either.
        await createAdminAuditLog({
            action: "farm_nation_approval_review",
            userId: authCheck.userId,
            targetId: userId,
            targetType: "user",
            details: `${decision} on a ${current.issue} case for ${userId}. Reason: ${reason}`,
            metadata: {
                decision,
                issue: current.issue,
                reason,
                authoritative: authoritative ?? null,
                userStatusBefore: current.userStatus,
                applicationStatuses: current.applicationStatuses,
            },
        });

        //   For a reconcile the authoritative side decides which status wins.
        const applicationStatus = current.applicationStatuses.includes("approved") ? "approved" : "pending";
        const reconcileTo = decision === "reconcile" && authoritative === "application"
            ? applicationStatus
            : null;

        const patch = approvalPatch({
            decision: decision as ApprovalDecision,
            reason,
            adminId: authCheck.userId,
            previousStatus: current.userStatus,
            reconcileTo,
        });

        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            ...patch,
            "serviceRegistrations.farmNation.reviewDecisionAt": FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        /*
         *   THE OTHER HALF OF A RECONCILE, and only when the USER record is the
         *   authoritative one. Nothing is created — the application already
         *   exists, which is what makes this a drift case rather than a missing
         *   one — so this updates a row that is there.
         */
        if (decision === "reconcile" && authoritative === "user" && current.userStatus) {
            const matches = await findFarmNationApplications(
                db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS),
                { userId, applicationId: null, email: (userDoc.data() ?? {}).email ?? null },
            );
            if (matches.length > 0) {
                await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS).doc(matches[0].id).update({
                    status: current.userStatus,
                    reconciledBy: authCheck.userId,
                    reconciledReason: reason,
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }
        }

        /*
         *   #692 — A WRITE THAT CHANGES ACCESS CLEARS THE CACHE ACCESS IS READ
         *   FROM, and the ratchet for that rule caught this file before it was
         *   pushed.
         *
         *   `serviceRegistrations.farmNation.status` is exactly such a field: a
         *   revoke that leaves the cached profile saying "approved" means the
         *   member keeps the module open until the entry expires, and the admin
         *   who just revoked them sees it take effect and believes it did.
         *   _fn_admin.ts calls this on both its approve and reject paths for
         *   the same reason.
         */
        await invalidateUserCache(userId);

        logger.info(
            `[admin/farm-nation-approvals] ${authCheck.userId} recorded "${decision}" on a `
            + `${current.issue} case for ${userId}.`,
        );

        return { success: true as const, error: null, data: { userId, decision } };
    } catch (error: any) {
        logger.error("[admin/farm-nation-approvals] Could not record the decision", {
            error: error?.message ?? String(error),
        });
        return { success: false as const, error: "Could not record that decision.", data: null };
    }
}

export const listFarmNationApprovalCasesAction = withFlexibleSafeAction(
    "listFarmNationApprovalCasesAction", _listFarmNationApprovalCasesAction);

export const decideFarmNationApprovalAction = withFlexibleSafeAction(
    "decideFarmNationApprovalAction", _decideFarmNationApprovalAction);
