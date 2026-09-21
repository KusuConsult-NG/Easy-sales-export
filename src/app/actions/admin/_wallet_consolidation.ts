"use server";

/**
 * Recovering a wallet balance filed under a profile nobody signs in as.
 *
 *   THE TRAP THE WALLET-KEYING WORK DISARMED BUT COULD NOT EMPTY.
 *
 *   The wallet id is the user id, and money only ever moves at the LIVE id:
 *   migration 005's credit and debit functions both key on `p_user_id`, and a
 *   session id is live by construction (#490 ranks a superseded row last at
 *   login). So a balance left under a superseded profile cannot be received
 *   into, cannot be spent from, and cannot be withdrawn — not by the member,
 *   not by checkout, not by support.
 *
 *   Three things now stand between a member and that state, and this is the
 *   third:
 *
 *     _duplicate_profiles   REFUSES to supersede a record still holding a
 *                           balance — the only way one is ever created
 *     actions/user.ts       the deletion guard counts every owned wallet, so
 *                           an account holding stranded money cannot be erased
 *     here                  and the way OUT, for anything already in it
 *
 *   Without this last one the platform could detect the condition, refuse to
 *   make it worse, and do nothing about it — which is a diagnosis, not a fix.
 *
 * ── THE MOVE IS THE DATABASE'S, NOT THIS FILE'S ─────────────────────────────
 *
 *   Migration 046 does the work in one transaction and carries its own
 *   authorisation: it re-reads the `_migratedTo` / `supabaseAuthId` pointer
 *   inside that transaction and refuses any pair the platform does not already
 *   say is one person. Nothing here can widen that, and nothing here should be
 *   trusted to — this action is a door onto the rule, not the rule.
 *
 *   What this file adds is what a database function cannot: who asked, why,
 *   and a written record of it before anything moves.
 */

import { requireAdmin } from "@/lib/require-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createAdminAuditLog } from "@/lib/audit-log";
import { logger } from "@/lib/logger";
import { consolidateWalletToLiveProfile } from "@/lib/wallet-ledger";
import { isPositiveAmount } from "@/lib/amount";
import { supersedingPointer } from "@/lib/user-identity";
import { mapWithConcurrency } from "@/lib/bounded-concurrency";
import { withFlexibleSafeAction, type ActionResponse } from "@/lib/safe-action";

/** One profile holding money it cannot spend, and where the money should go. */
export interface StrandedWallet {
    /** The superseded profile the balance is filed under. */
    fromId: string;
    /** The live profile it points at — where the balance belongs. */
    toId: string;
    balance: number;
    email: string;
    fullName: string;
}

export interface StrandedWalletReport {
    stranded: StrandedWallet[];
    /** Superseded profiles carrying a wallet row at all, stranded or not. */
    scanned: number;
}

/** Matches the duplicate tool's paging, so both read the same population. */
const PAGE = 1000;
const MAX_PAGES = 50;

async function _findStrandedWalletsAction(): Promise<ActionResponse<StrandedWalletReport | null>> {
    try {
        const authCheck = await requireAdmin("users:update");
        if ("error" in authCheck) {
            return { success: false as const, error: authCheck.error, data: null };
        }

        /*
         *   EVERY SUPERSEDED PROFILE, then the wallet for each — rather than
         *   every wallet, then the profile for each.
         *
         *   Superseded profiles are the smaller set by a wide margin (765
         *   against every account on the platform), migration 042 indexes
         *   `_migratedTo` for exactly this search, and a wallet read is a
         *   primary-key lookup. The other direction would scan the wallets
         *   table to find the few hundred rows that could possibly qualify.
         */
        const superseded: { id: string; data: Record<string, unknown> }[] = [];
        let cursor: string | undefined;

        for (let page = 0; page < MAX_PAGES; page += 1) {
            let q = db.collection(COLLECTIONS.USERS).orderBy("id").limit(PAGE);
            if (cursor) q = q.startAfter(cursor);
            const snap = await q.get();
            if (snap.docs.length === 0) break;

            for (const d of snap.docs) {
                const data = (d.data() ?? {}) as Record<string, unknown>;
                //   #810 — the shared rule, not a fourth copy of it. This one
                //   was CORRECT; #804 fixed three readers that were not, and
                //   left this one spelling the same comparison out by hand. A
                //   correct copy is how the next one drifts.
                //
                //   `supabaseAuthId` is honoured alongside `_migratedTo` here
                //   deliberately — the same pair pointerOf reads — because on an
                //   ordinary linked account that field names the row itself,
                //   which is exactly the case the rule exists to exclude.
                if (supersedingPointer(d.id, data._migratedTo ?? data.supabaseAuthId)) {
                    superseded.push({ id: d.id, data });
                }
            }

            cursor = snap.docs[snap.docs.length - 1].id;
            if (snap.docs.length < PAGE) break;
        }

        /*
         *   #810 THE SAME SHAPE THAT TIMED THE FARM NATION SCREEN OUT.
         *
         *   This was `for (const row of superseded) { await …doc(row.id).get() }`
         *   — one keyed read per superseded profile, one after another. The
         *   measured population is 765 superseded profiles, 272 of them
         *   carrying a wallet row, so that is 765 serialized round trips before
         *   the screen can answer. At 20ms each that is fifteen seconds; at
         *   50ms, thirty-eight. #805 is the bill for doing exactly this in
         *   _farm_nation_approvals, and the pool written there is reused rather
         *   than a second one appearing beside it.
         *
         *   The bound is the same 8, and for the same reason: eight primary-key
         *   reads in flight is a modest ask of the connection pool, where 765
         *   is not.
         *
         *   ORDER IS PRESERVED — mapWithConcurrency indexes results by input
         *   position — so `stranded` is the same list, in the same order, that
         *   the sequential loop produced. Nothing about what is read changes.
         */
        const SCAN_CONCURRENCY = 8;

        //   `exists` is carried separately from `balance` on purpose. A wallet
        //   row that exists with NO balance field still counts towards
        //   `scanned` — it is a superseded profile carrying a wallet — and
        //   collapsing the two into one `undefined` would quietly drop it from
        //   that figure while leaving `stranded` correct.
        const wallets = await mapWithConcurrency(
            superseded, SCAN_CONCURRENCY,
            async (row): Promise<{ exists: boolean; balance: unknown }> => {
                const snap = await db.collection(COLLECTIONS.WALLETS).doc(row.id).get();
                return { exists: Boolean(snap.exists), balance: snap.data()?.balance };
            },
        );

        const stranded: StrandedWallet[] = [];
        let scanned = 0;

        for (const [index, row] of superseded.entries()) {
            const wallet = wallets[index];
            if (!wallet.exists) continue;
            scanned += 1;

            /*
             *   `isPositiveAmount`, not `balance > 0` — #607's rule, and it
             *   applies here for the reason the rule exists: `NaN <= 0` is
             *   FALSE, so a balance that failed to parse would read as money
             *   and be listed as stranded. The `|| 0` above happens to catch
             *   that today, which is precisely the upstream coupling the shared
             *   helper removes.
             */
            if (!isPositiveAmount(wallet.balance)) continue;
            const balance = Number(wallet.balance);

            stranded.push({
                fromId: row.id,
                toId: String(row.data._migratedTo ?? row.data.supabaseAuthId ?? ""),
                balance,
                email: String(row.data.email ?? ""),
                fullName: String(row.data.fullName ?? ""),
            });
        }

        if (stranded.length > 0) {
            //   Loud, because this is money nobody can reach. The measured
            //   state when this was written was 272 wallet rows on superseded
            //   profiles and every one at zero — so a non-empty answer here is
            //   a change, not a backlog.
            logger.error(
                `[admin/wallet-consolidation] ${stranded.length} profile(s) hold a wallet balance `
                + `nothing can reach.`,
                { ids: stranded.map((s) => `${s.fromId}->${s.toId}:${s.balance}`) },
            );
        }

        return { success: true as const, error: null, data: { stranded, scanned } };
    } catch (error: any) {
        logger.error("[admin/wallet-consolidation] could not scan for stranded balances", {
            error: error?.message ?? String(error),
        });
        return { success: false as const, error: "Could not scan for stranded balances.", data: null };
    }
}

export interface ConsolidateWalletInput {
    fromId: string;
    toId: string;
    reason: string;
}

async function _consolidateWalletAction(
    input: ConsolidateWalletInput,
): Promise<ActionResponse<{ moved: boolean; amount: number; toBalance: number } | null>> {
    try {
        const authCheck = await requireAdmin("users:update");
        if ("error" in authCheck) {
            return { success: false as const, error: authCheck.error, data: null };
        }

        const fromId = String(input?.fromId ?? "").trim();
        const toId = String(input?.toId ?? "").trim();
        const reason = String(input?.reason ?? "").trim();

        if (!fromId || !toId) {
            return { success: false as const, error: "Both profiles are required.", data: null };
        }
        if (reason.length < 4) {
            //   The same bar the duplicate tool sets, for the same reason: six
            //   months on, the rows will not explain why somebody's balance
            //   moved, and the audit row is the only place that can.
            return { success: false as const, error: "Say why this balance is being moved.", data: null };
        }

        //   Written BEFORE the effect — #530's rule. createAdminAuditLog never
        //   throws, so this cannot fail the operation, and it cannot be skipped
        //   by an early return either.
        await createAdminAuditLog({
            action: "wallet_balance_consolidated",
            userId: authCheck.userId,
            targetId: toId,
            targetType: "wallet",
            details: `Moved the wallet balance from superseded profile ${fromId} to ${toId}. Reason: ${reason}`,
            metadata: { fromId, toId, reason },
        });

        const result = await consolidateWalletToLiveProfile({
            fromId, toId, actorId: authCheck.userId,
        });

        if (!result.moved) {
            /*
             *   EVERY REFUSAL COMES FROM THE DATABASE, and they are reported
             *   apart because they ask for different things. `nothing_to_move`
             *   is the ordinary answer — the balance is already where it
             *   belongs, or somebody else moved it a moment ago — and is not a
             *   failure. The rest mean the pair is wrong.
             */
            const MESSAGES: Record<string, string> = {
                nothing_to_move: "That profile holds no balance — there is nothing to move.",
                not_the_same_person:
                    "Those two records are not linked. A balance can only be moved to the profile "
                    + "the old one already points at, so settle the duplicate first.",
                target_is_not_live:
                    "The destination profile has itself been superseded. Move the balance to the "
                    + "record at the end of the chain, or the money is stranded again.",
                source_profile_not_found: "That profile no longer exists.",
                target_profile_not_found: "The destination profile no longer exists.",
                no_source_wallet: "That profile has no wallet.",
                same_profile: "Those are the same profile.",
            };

            const message = MESSAGES[String(result.reason)]
                ?? "That balance could not be moved.";

            //   Reported as a SUCCESS when nothing needed doing, because the
            //   caller asked for a state and that state holds.
            if (result.reason === "nothing_to_move") {
                return {
                    success: true as const, error: null,
                    data: { moved: false, amount: 0, toBalance: result.toBalance },
                };
            }

            logger.warn(`[admin/wallet-consolidation] refused ${fromId} -> ${toId}: ${result.reason}`);
            return { success: false as const, error: message, data: null };
        }

        logger.info(
            `[admin/wallet-consolidation] ${authCheck.userId} moved ₦${result.amount} `
            + `from ${fromId} to ${toId}. Reason: ${reason}`,
        );

        return {
            success: true as const, error: null,
            data: { moved: true, amount: result.amount, toBalance: result.toBalance },
        };
    } catch (error: any) {
        logger.error("[admin/wallet-consolidation] could not move a balance", {
            error: error?.message ?? String(error),
        });
        return { success: false as const, error: "Could not move that balance.", data: null };
    }
}

export const findStrandedWalletsAction = withFlexibleSafeAction(
    "findStrandedWalletsAction", _findStrandedWalletsAction);

export const consolidateWalletAction = withFlexibleSafeAction(
    "consolidateWalletAction", _consolidateWalletAction);
