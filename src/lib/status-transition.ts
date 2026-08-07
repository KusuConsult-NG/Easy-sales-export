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
