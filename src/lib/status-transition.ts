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
import { getTableName } from "@/lib/supabase-db";

export interface TransitionResult {
    /** True when this call performed the transition. */
    claimed: boolean;
    /**
     * The row's status after the call, or null when the row does not exist.
     * Lets a caller tell "already advanced" from "never existed".
     */
    status: string | null;
    /**
     * Whether the row exists, populated only when a claim failed with a null
     * status.
     *
     * WHY A NULL STATUS IS AMBIGUOUS
     * ------------------------------
     * The SQL matches `raw_data->>'status' = p_from`. A row whose `status` key is
     * absent yields NULL from that expression, and `NULL = anything` is never
     * true — so such a row can never be claimed, and the function then reports
     * its status as NULL. Which is exactly what it reports for a row that is not
     * there at all.
     *
     * Every caller read that single null as "not found", so an existing document
     * with no status recorded was reported to the user as missing. On the land
     * listings collection — which lives in the JSONB table, where `status` is a
     * plain key with no NOT NULL to enforce it — that is a reachable state, and
     * the previous blind writes did work on those rows. Telling an admin a
     * listing they are looking at does not exist would be a worse answer than the
     * one they used to get.
     *
     * Costs one indexed select, only on the refusal path.
     */
    exists?: boolean;
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

    // Resolve the TABLE, not just the collection.
    //
    // claim_status_transition (migration 007) writes to document_collections
    // and nothing else. Eight collections do not live there — supabase-db.ts
    // routes them to their own tables — so for those the CAS matched zero rows
    // and returned claimed:false with a null status, which every caller reads
    // as "someone else got there first".
    //
    // Two such collections are passed here today. COLLECTIONS.COOPERATIVE_LOANS
    // is one; COLLECTIONS.MARKETPLACE_ORDERS is the serious one, with four call
    // sites on the order state machine, none of which could ever claim a
    // transition. Measured, not inferred — see
    // __tests__/db-integration/status-transition-dedicated-tables.test.ts.
    //
    // getTableName is the adapter's own mapping, so there is one definition of
    // where a collection lives rather than a second copy that can drift.
    const table = getTableName(collection);

    const { data, error } = await supabaseAdmin.rpc("claim_status_transition_in", {
        p_table: table,
        p_id: id,
        p_from: from,
        p_to: to,
        // Only meaningful for document_collections; the function ignores it
        // for a dedicated table, where the id alone is the key.
        p_collection: table === "document_collections" ? collection : null,
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

    const claimed = Boolean(row.claimed);
    const status: string | null = row.status ?? null;

    if (claimed || status !== null) {
        return { claimed, status };
    }

    // A null status is ambiguous — see TransitionResult.exists. Resolve it.
    let exists = false;
    try {
        let probe = supabaseAdmin.from(table).select("id").eq("id", id);
        if (table === "document_collections") {
            probe = probe.eq("collection_name", collection);
        }
        const { data: found, error: probeError } = await probe.limit(1);

        if (probeError) {
            // Reported as absent, which is what the caller assumed before this
            // probe existed. Logged rather than thrown: the transition result
            // itself is already known and correct.
            logger.warn("[status-transition] existence probe failed", {
                collection,
                id,
                error: probeError,
            });
        } else {
            exists = Array.isArray(found) && found.length > 0;
        }
    } catch (probeError) {
        logger.warn("[status-transition] existence probe threw", { collection, id, probeError });
    }

    if (exists) {
        logger.warn(
            `[status-transition] ${collection}/${id} exists but has no 'status' recorded, ` +
            `so no transition can be claimed on it.`
        );
    }

    return { claimed, status, exists };
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
    /**
     * Field to record the status this transition came from.
     *
     * With several possible starting states, the caller usually cannot tell
     * afterwards which one won — and needs to, if the transition is ever
     * reversed. A land listing reserved from `verified` must go back to
     * `verified`, not to whichever value the code happens to hardcode.
     */
    recordPreviousAs?: string;
    /**
     * Permits `to` to appear among the starting statuses.
     *
     * OFF BY DEFAULT, AND THE DEFAULT IS THE POINT — see the filter below for
     * what including the target costs: two concurrent callers both succeed.
     *
     * One caller legitimately needs it. dispatch-inspector re-enters
     * `inspection_scheduled` from `inspection_scheduled` so an inspection can be
     * RESCHEDULED with a different inspector or date. That is a patch guarded by
     * the status rather than a transition, and it accepts the trade: two admins
     * dispatching at once will both write, as they did before any of this
     * existed, and no money is attached to the outcome.
     *
     * Anything that moves money or grants access must NOT set this.
     */
    allowSameStatus?: boolean;
}): Promise<TransitionResult> {
    const { collection, id, fromAny, to, patch, recordPreviousAs, allowSameStatus } = params;

    if (fromAny.length === 0) {
        throw new Error("claimStatusTransitionFromAny: fromAny must not be empty");
    }

    /**
     * The target is never a valid starting point, and allowing it destroys the
     * single-winner property this function exists for.
     *
     * HOW THIS WAS FOUND
     * ------------------
     * A shared APPROVABLE_FROM_STATUSES was introduced so five admin decision
     * paths would stop disagreeing, and it includes the for-sale statuses — so
     * that a listing farm-nation created as `available` can be canonicalised to
     * `verified`. But `verified` is itself one of those, so the set contained the
     * target.
     *
     * The consequence, caught by the existing concurrency test in
     * __tests__/db-integration/land-status-transition-guard.test.ts: two admins
     * approving the same listing at once BOTH succeeded. The loser's first
     * attempt failed against `pending_verification`, and the loop then reached
     * `verified` — which the winner had just written — and claimed
     * `verified → verified`. Two audit entries each recording that it made the
     * decision, and `statusBeforeVerification` overwritten with `verified`,
     * destroying the value a reversal needs.
     *
     * Filtered here rather than at the six call sites, because it is a property of
     * compare-and-swap and not of land listings: `to → to` is not a transition,
     * and every caller that lists it has accidentally opted out of the guarantee.
     * No existing caller relies on it — checked across all of them; each lists
     * strictly prior states.
     *
     * A caller now gets `claimed: false` with `status` equal to `to`, which reads
     * as "already in that state" — the honest answer, and the one an admin
     * clicking approve twice should see.
     *
     * `allowSameStatus` opts out, for the one caller that reschedules rather than
     * transitions. See that option for why it is not a general escape hatch.
     */
    const startingPoints = allowSameStatus
        ? fromAny
        : fromAny.filter((from) => from !== to);

    if (startingPoints.length === 0) {
        throw new Error(
            `claimStatusTransitionFromAny: every starting status equals the target ('${to}'), ` +
            `so there is no transition to claim`
        );
    }

    let last: TransitionResult = { claimed: false, status: null };

    for (const from of startingPoints) {
        const attemptPatch = recordPreviousAs
            ? { ...(patch ?? {}), [recordPreviousAs]: from }
            : patch;

        last = await claimStatusTransition({ collection, id, from, to, patch: attemptPatch });
        if (last.claimed) return last;
        // A null status will not become non-null on the next attempt, whether the
        // row is absent or present without one. `exists` on the result tells the
        // caller which, so the two can be reported differently.
        if (last.status === null) return last;
    }

    return last;
}
