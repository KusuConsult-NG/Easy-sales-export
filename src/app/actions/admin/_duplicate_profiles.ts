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
import { walletBalancesFor } from "@/lib/wallet-lookup";
import { footprintsFor, clearlyRicher, type Footprint } from "@/lib/profile-footprint";
import { consolidateWalletToLiveProfile } from "@/lib/wallet-ledger";

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
    /**
     * What each candidate HOLDS — #813, and only for the groups that need a
     * decision. Keyed by profile id; absent for a candidate not asked about.
     *
     * A source that could not be read is `null` in the counts and never 0:
     * "this record holds nothing" is the sentence that would send an operator
     * to discard the record that holds everything.
     */
    footprints: Record<string, Footprint>;
    /**
     * Per group email: the id that clearly holds more, or null when nothing
     * distinguishes them. NOT a recommendation — the screen already recommends
     * from the ranking the login itself applies, and a second rule is how a
     * tool comes to disagree with the platform it describes.
     */
    richest: Record<string, string | null>;
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

        /*
         *   #806 — THE BALANCE IS EVIDENCE, AND IT DECIDES THE GROUP.
         *
         *   Superseding a funded record strands the money, so the operator
         *   needs the figure BEFORE they choose. Until now the server read the
         *   wallets only on the way to refusing them, which meant the one fact
         *   that could change their answer arrived after the answer.
         *
         *   Read for every candidate in every group, settled ones included: a
         *   balance on an ALREADY superseded row is the failure this module
         *   exists to prevent, and no other screen would show it.
         */
        const candidateIds = [...byEmail.values()]
            .filter((rows) => rows.length >= 2)
            .flatMap((rows) => rows.map((r) => r.id));
        const balances = await walletBalancesFor(
            db.collection(COLLECTIONS.WALLETS), candidateIds,
        );

        for (const [email, rows] of byEmail) {
            if (rows.length < 2) continue;
            groups.push(describeGroup(email, maskAddress(email), rows, balances));
        }

        /*
         *   ORDERED BY WHAT IS OWED, not by size.
         *
         *   The forensic scan sorts worst-first by count, which is right for a
         *   report. This is a worklist: a group that needs a decision is work
         *   and a resolved pair is not, so a screen sorted by size would bury
         *   the three real decisions under thirty settled migrations.
         */
        /*
         *   #813 — WHAT EACH RECORD HOLDS, for the groups that need a decision.
         *
         *   The owner's answer to "choose the one that is the person" was that
         *   they cannot: they did not onboard these members and the staff who
         *   did have left. That is a question this screen should never have
         *   needed a human memory for — the platform knows which record placed
         *   the orders, holds the membership and sat the course, and was simply
         *   not showing it.
         *
         *   ONLY the groups that need a decision. Nine count queries per
         *   candidate across twelve hundred records would answer a question 493
         *   of the 496 groups do not ask.
         */
        const undecided = groups.filter((g) => g.state === "needs-a-decision");
        const footprints = await footprintsFor(
            db as any, undecided.flatMap((g) => g.candidates.map((c) => c.id)),
        );

        const richest: Record<string, string | null> = {};
        for (const g of undecided) {
            const forGroup: Record<string, Footprint> = {};
            for (const c of g.candidates) {
                if (footprints[c.id]) forGroup[c.id] = footprints[c.id];
            }
            richest[g.email] = clearlyRicher(forGroup);
        }

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
                footprints,
                richest,
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
    /**
     * Consent to move the balances off the records being superseded — #806.
     *
     * Absent or false, a funded record is refused exactly as before. This is
     * not a formality: see the block that reads it.
     */
    moveBalances?: boolean;
}

async function _resolveDuplicateProfileGroupAction(
    input: ResolveDuplicateInput,
): Promise<ActionResponse<{ superseded: string[]; moved: string[] } | null>> {
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
        const moveBalances = input?.moveBalances === true;

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

        /*
         *   AND NOT WHILE ONE OF THEM STILL HOLDS MONEY.
         *
         *   THIS IS THE ONLY WAY A WALLET BALANCE EVER BECOMES UNREACHABLE.
         *   The wallet id is the user id, and both balance functions key on the
         *   session's id (migration 005: `credit_wallet_once` inserts at
         *   `p_user_id`, `debit_wallet_once` updates `WHERE id = p_user_id`).
         *   A session id is live by construction — profile-choice ranks a
         *   superseded row last (#490) — so no naira can ever ARRIVE under a
         *   superseded profile. It can only be left there, by this action,
         *   pointing a funded row at another one.
         *
         *   After which nothing can reach it: not the person, whose dashboard
         *   reads the live row; not checkout, which debits the live row; not
         *   support, without hand-written SQL. It is the one irreversible thing
         *   an otherwise perfectly reversible tool can do, and the header above
         *   promises the opposite — "if the owner picks wrong, clearing the
         *   pointer puts the group back exactly as it was". A stranded balance
         *   is not put back by clearing the pointer.
         *
         *   So the money moves first, and a person decides how. Refusing costs
         *   an admin one more step on a group they can settle a minute later;
         *   allowing it costs somebody their balance with no trace of where it
         *   went.
         *
         *   NOT A RULE IN checkResolution, deliberately: that function is pure
         *   and synchronous, and every rule in it is derivable from the group it
         *   is handed. This one needs a read of another collection.
         */
        const balances = await walletBalancesFor(
            db.collection(COLLECTIONS.WALLETS), supersedeIds,
        );
        const funded = supersedeIds.filter((id) => (balances[id] ?? 0) > 0);
        const naira = (n: number) => `₦${n.toLocaleString()}`;

        /*
         *   #806 — IT USED TO REFUSE HERE, AND THE INSTRUCTION IT GAVE COULD
         *   NOT BE FOLLOWED.
         *
         *   "Move the balance onto the record you are keeping first, then
         *   settle the group." There was no way to do that. The mover is
         *   migration 046, which re-reads the pointer inside its own
         *   transaction and answers `not_the_same_person` when the source
         *   "points somewhere ELSE or points nowhere at all" — its words. A
         *   split account has no pointer, so:
         *
         *       supersede  →  refused, move the money first
         *       move       →  refused, settle the duplicate first
         *
         *   Each named the other as its prerequisite and neither could go
         *   first. `findStrandedWalletsAction` could not help either: it lists
         *   rows that ALREADY point somewhere, so a split account never
         *   appeared on it. The deadlock had no exit inside the product.
         *
         * ── WHAT BREAKS IT, AND WHY IT IS SAFE TO ────────────────────────────
         *
         *   The pointer is written FIRST and the money moves SECOND. That is
         *   the only order 046 accepts, and it is not a way around its guard:
         *   the guard asks whether the platform records these two rows as one
         *   person, and an admin with `users:update`, a written reason and an
         *   audit row has just recorded exactly that. 046 still refuses any
         *   pair this action did not point.
         *
         * ── AND WHY IT IS NOT AUTOMATIC ─────────────────────────────────────
         *
         *   `moveBalances` is required, and the refusal below now states the
         *   record and the amount. Moving somebody's money as a silent side
         *   effect of an identity decision is the shape this audit keeps
         *   filing against — #463's lesson in one line, "an operator about to
         *   repair live data is owed the specific sentence".
         *
         *   It also costs something real. The header promises that clearing one
         *   field puts the group back as it was; once the balance has moved
         *   that is no longer wholly true, because the money is on the keeper.
         *   The member can reach it there, which is the direction that matters
         *   — but it is a second act, so it is consented to and audited as one.
         */
        if (funded.length > 0 && !moveBalances) {
            logger.warn(
                `[admin/duplicate-profiles] ${maskAddress(email)}: `
                + `${funded.length} record(s) hold a balance and no move was authorised.`,
            );
            const detail = funded.map((id) => `${id} (${naira(balances[id] ?? 0)})`).join(", ");
            return {
                success: false as const,
                error:
                    `${funded.length === 1 ? "One of those records holds" : `${funded.length} of those records hold`} `
                    + `a wallet balance — ${detail}. Superseding without moving it would leave the money `
                    + "in a wallet nothing can reach: not the member, not checkout, not this screen. "
                    + `Confirm the move onto ${keepId} and apply again.`,
                data: null,
            };
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
            metadata: { keepId, supersedeIds, reason, funded },
        });

        /*
         *   PUTTING ONE ROW BACK. Not a delete — `FieldValue.delete()` is
         *   refused by this module's own ratchet, and rightly: nothing here
         *   destroys. An empty string is what every reader already treats as
         *   "no pointer", because they all go through `str()`, which answers
         *   null for it — and `where("_migratedTo", "!=", "")` does not match
         *   it either, so the row leaves the superseded population the same way
         *   it would if the field had never been written.
         */
        const clearPointer = async (id: string) => {
            await db.collection(COLLECTIONS.USERS).doc(id).set({
                _migratedTo: "",
                supersededAt: null,
                supersededBy: "",
                supersededReason: "",
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
        };

        const superseded: string[] = [];
        const movedTotals: string[] = [];

        for (const id of supersedeIds) {
            /*
             *   ONE FIELD, MERGED. `_migratedTo` is what every reader already
             *   follows; `supersededAt`/`supersededBy`/`supersededReason` are
             *   recorded beside it so the row itself says who decided and why,
             *   rather than that living only in the audit table.
             *
             *   Nothing else is touched. No delete, no clear, no copy between
             *   rows.
             */
            await db.collection(COLLECTIONS.USERS).doc(id).set({
                _migratedTo: keepId,
                supersededAt: FieldValue.serverTimestamp(),
                supersededBy: authCheck.userId,
                supersededReason: reason,
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });

            if ((balances[id] ?? 0) > 0) {
                //   Its own audit row, before its own effect, in the same
                //   vocabulary _wallet_consolidation uses for the same act.
                await createAdminAuditLog({
                    action: "wallet_balance_consolidated",
                    userId: authCheck.userId,
                    targetId: keepId,
                    targetType: "wallet",
                    details: `Moved ${naira(balances[id] ?? 0)} from superseded profile ${id} to `
                        + `${keepId} while settling ${maskAddress(email)}. Reason: ${reason}`,
                    metadata: { fromId: id, toId: keepId, reason },
                });

                let outcome: { moved: boolean; amount: number; reason: string | null };
                try {
                    outcome = await consolidateWalletToLiveProfile({
                        fromId: id, toId: keepId, actorId: authCheck.userId,
                    });
                } catch (moveError: any) {
                    /*
                     *   THE POINTER GOES BACK. Leaving it would produce exactly
                     *   the state the old refusal existed to prevent — a
                     *   superseded row still holding money — and it would be
                     *   this action that created it.
                     *
                     *   The likeliest cause by far is migration 046 not being
                     *   applied, in which case the RPC does not exist and this
                     *   throws rather than answering. The operator is told that
                     *   in the one place they are already looking.
                     */
                    await clearPointer(id);
                    logger.error(
                        `[admin/duplicate-profiles] wallet move failed for ${id} -> ${keepId}; `
                        + `pointer rolled back`,
                        { error: moveError?.message ?? String(moveError) },
                    );
                    return {
                        success: false as const,
                        error: `${id} was put back: its balance could not be moved (`
                            + `${moveError?.message ?? "unknown error"}). If migration 046 has not been `
                            + `applied to this database, that is why. `
                            + `${superseded.length} record(s) were settled before it.`,
                        data: null,
                    };
                }

                /*
                 *   `nothing_to_move` IS NOT A FAILURE. It means the balance
                 *   reached zero between the read above and the call — somebody
                 *   spent it, or another admin moved it — and the state this
                 *   asked for now holds. Every other reason means the pair was
                 *   refused, and the pointer goes back.
                 */
                if (!outcome.moved && outcome.reason !== "nothing_to_move") {
                    await clearPointer(id);
                    logger.error(
                        `[admin/duplicate-profiles] wallet move refused for ${id} -> ${keepId}: `
                        + `${outcome.reason}; pointer rolled back`,
                    );
                    return {
                        success: false as const,
                        error: `${id} was put back: the database refused to move its balance `
                            + `(${outcome.reason ?? "no reason given"}). `
                            + `${superseded.length} record(s) were settled before it.`,
                        data: null,
                    };
                }

                if (outcome.moved) movedTotals.push(`${naira(outcome.amount)} from ${id}`);
            }

            superseded.push(id);
        }

        logger.info(
            `[admin/duplicate-profiles] ${authCheck.userId} kept ${keepId} for ${maskAddress(email)} `
            + `and superseded ${superseded.length} record(s)`
            + `${movedTotals.length > 0 ? `, moving ${movedTotals.join(" and ")}` : ""}.`,
        );

        //   `moved` is reported back so the screen can SAY what happened to the
        //   money rather than leaving the operator to infer it from silence.
        return {
            success: true as const,
            error: null,
            data: { superseded, moved: movedTotals },
        };
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
