/**
 * One person's wallet rows — and which of them holds money they cannot reach.
 *
 *   THE WALLET ID IS THE USER ID. my-data.ts says so in one line, and all six
 *   accesses on this platform were written that way:
 *
 *       db.collection(WALLETS).doc(userId)
 *
 *   That is the `_migratedTo` shape again, on money. A member whose profile was
 *   superseded signs in as the live id; a wallet funded before that decision
 *   sits under the old one, and every doc-id read misses it.
 *
 * ── THE FACT THAT DECIDES THE WHOLE DESIGN ──────────────────────────────────
 *
 *   MONEY MOVES AT THE LIVE ID AND NOWHERE ELSE. The balance is not written by
 *   this codebase at all — it is written by the Postgres functions in migration
 *   005, and both of them key on `p_user_id`:
 *
 *       credit_wallet_once   INSERT INTO wallets (id, balance) VALUES (p_user_id, …)
 *                            ON CONFLICT (id) DO UPDATE SET balance = balance + …
 *       debit_wallet_once    UPDATE wallets SET balance = balance - p_amount
 *                            WHERE wallets.id = p_user_id
 *
 *   `p_user_id` is the session's id, and a session id is live by construction:
 *   profile-choice ranks a superseded row below every other candidate (#490).
 *
 *   So a superseded wallet CANNOT RECEIVE and CANNOT BE SPENT FROM. Its balance
 *   is not part of what the person can pay with — it is stranded.
 *
 *   Which is why this module does NOT hand a superseded row back to the read
 *   paths. The obvious "fix" — resolve the balance the way every other reader
 *   resolves a row, newest funded row wins — would put ₦5,000 on the dashboard
 *   and then refuse a ₦1,000 checkout for insufficient funds, because the
 *   debit would run against a different row than the one displayed. That is a
 *   worse bug than the one being repaired, and it is worse in the direction
 *   this platform cares about most.
 *
 *   THE RULE, THEN:
 *
 *       what you are shown    the LIVE row — the balance you can actually spend
 *       what the guards count  EVERY row — because deleting an account and
 *                              marking a wallet are irreversible
 *
 * ── AND NOTHING SILENTLY RECONCILES ─────────────────────────────────────────
 *
 *   Moving a stranded balance to the live id would take a credit and a debit,
 *   and those are two separate RPC calls. They are each idempotent by
 *   reference, but the PAIR is not atomic: a credit that lands without its
 *   debit mints money. A read path is the last place that belongs, so this
 *   module reports the condition and leaves the transfer to a person.
 *
 * ── MEASURED BEFORE CHANGING ANYTHING ───────────────────────────────────────
 *
 *   765 superseded profiles, 272 of them carrying a wallet row, and EVERY ONE
 *   of those at a zero balance. Nothing is stranded today — this is a trap
 *   rather than a fire, and the trap is set by the #724 supersede tool, which
 *   now refuses to spring it (see _duplicate_profiles.ts).
 */

import { ownedProfileIdsFor } from "@/lib/owned-profile-ids";

/** One wallet row: whose id it is filed under, and what is on it. */
export interface WalletRow {
    id: string;
    balance: number;
    /** True for the row the credit/debit functions act on — the live id. */
    live: boolean;
    data: Record<string, any>;
}

/** The minimum a collection has to offer for these lookups. */
interface WalletCollection {
    doc(id: string): { get(): Promise<{ exists: boolean; data(): any }> };
}

/**
 * Every wallet row belonging to this person, the live one first.
 *
 * Normally one, often none. The live row is marked so a caller never has to
 * re-derive which of them money actually moves through.
 */
export async function walletRowsFor(
    wallets: WalletCollection,
    userId: string,
): Promise<WalletRow[]> {
    if (!userId) return [];

    const owned = await ownedProfileIdsFor(userId);
    //   ownedProfileIdsFor resolves forward before it searches backward, so
    //   ids[0] is the LIVE id even when `userId` was a superseded one — which
    //   is what makes `live` below correct for an admin-side caller too.
    const liveId = owned[0] ?? userId;
    const ids = [liveId, ...owned.filter((id) => id !== liveId)];

    const rows: WalletRow[] = [];
    for (const id of ids) {
        const snap = await wallets.doc(id).get();
        if (!snap.exists) continue;
        const data = snap.data() ?? {};
        rows.push({ id, balance: Number(data.balance) || 0, live: id === liveId, data });
    }
    return rows;
}

/**
 * The rows holding money the person cannot spend — superseded, non-zero.
 *
 * Empty for every ordinary account, and empty today for all 272 superseded
 * accounts that carry a wallet row at all. A non-empty answer is a finding: it
 * means somebody's naira is filed under a profile the credit and debit
 * functions will never touch.
 */
export async function strandedWalletRows(
    wallets: WalletCollection,
    userId: string,
): Promise<WalletRow[]> {
    const rows = await walletRowsFor(wallets, userId);
    return rows.filter((r) => !r.live && r.balance > 0);
}

/** Every naira this person holds in a wallet, reachable or not. */
export function totalWalletBalance(rows: WalletRow[]): number {
    return rows.reduce((sum, r) => sum + r.balance, 0);
}

/** Just the part they can spend — the live row, or 0 when they have none. */
export function spendableWalletBalance(rows: WalletRow[]): number {
    return rows.find((r) => r.live)?.balance ?? 0;
}
