/**
 * Compare-and-swap for document status.
 *
 * WHY THIS EXISTS
 * ---------------
 * State machines in this codebase advance with check-then-write:
 *
 *     const fresh = await t.get(ref);
 *     if (fresh.data()?.status !== "pending") throw ...;
 *     t.update(ref, { status: "payout_initiated" });
 *
 * supabaseDb.runTransaction takes no lock, so two callers can both read
 * "pending" and both write. For withdrawal approval that means two admins can
 * both reach the Paystack transfer call and pay the user twice.
 *
 * claimStatusTransition does the check and the write as one conditional UPDATE,
 * so exactly one caller wins. See
 * supabase/migrations/007_status_transition_cas.sql.
 *
 * USE THIS whenever an action must happen once per state change — payouts,
 * escrow release, order fulfilment, loan disbursement. Treat `claimed: false`
 * as "somebody else is handling it", not as an error to retry.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";

export interface TransitionResult {
    /** True when this call performed the transition. */
    claimed: boolean;
    /**
     * The row's status after the call, or null when the row does not exist.
     * Lets a caller tell "already advanced" from "never existed".
     */
    status: string | null;
}

export async function claimStatusTransition(params: {
    collection: string;
    id: string;
    from: string;
    to: string;
    patch?: Record<string, any>;
}): Promise<TransitionResult> {
    const { collection, id, from, to, patch } = params;

    if (!collection) throw new Error("claimStatusTransition: collection is required");
    if (!id) throw new Error("claimStatusTransition: id is required");
    if (!from || !to) throw new Error("claimStatusTransition: from and to are required");

    const { data, error } = await supabaseAdmin.rpc("claim_status_transition", {
        p_collection: collection,
        p_id: id,
        p_from: from,
        p_to: to,
        p_patch: patch ?? {},
    });

    if (error) {
        logger.error("[status-transition] claim_status_transition failed", {
            collection,
            id,
            from,
            to,
            error,
        });
        throw new Error(`Status transition failed: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
        throw new Error("Status transition returned no result");
    }

    return { claimed: Boolean(row.claimed), status: row.status ?? null };
}

/**
 * Claims a transition that may legitimately start from more than one status.
 *
 * Escrow release is valid from `delivered`, `disputed` or `funded`; a dispute
 * may be resolved from `open` or `under_review`. The compare-and-swap takes one
 * `from` at a time, so this tries each in turn.
 *
 * Still race-safe: once any attempt wins, the row holds `to`, so every later
 * attempt — in this call or a concurrent one — fails against all of them.
 *
 * Returns the first successful claim, or the last failure, whose `status` is
 * the value that actually blocked it.
 */
export async function claimStatusTransitionFromAny(params: {
    collection: string;
    id: string;
    fromAny: string[];
    to: string;
    patch?: Record<string, any>;
}): Promise<TransitionResult> {
    const { collection, id, fromAny, to, patch } = params;

    if (fromAny.length === 0) {
        throw new Error("claimStatusTransitionFromAny: fromAny must not be empty");
    }

    let last: TransitionResult = { claimed: false, status: null };

    for (const from of fromAny) {
        last = await claimStatusTransition({ collection, id, from, to, patch });
        if (last.claimed) return last;
        // A missing record will not become present on the next attempt.
        if (last.status === null) return last;
    }

    return last;
}
