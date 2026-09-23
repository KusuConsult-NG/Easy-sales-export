/**
 * Why a Postgres function this platform calls did not answer — and therefore
 * what the operator should actually do about it.
 *
 *   THE OWNER FOLLOWED THIS MESSAGE TO THE WRONG FILE:
 *
 *       [ANALYTICS SERVICE] count_module_registrations unavailable — falling
 *       back to eight sequential scans of the users table, which is #909.
 *       Apply supabase/migrations/049_count_module_registrations.sql.
 *       Reason: canceling statement due to statement timeout
 *
 *   The instruction and the reason contradict each other in the same line. A
 *   function that TIMED OUT exists and ran; applying the migration that
 *   creates it changes nothing, and the operator spends their time on the one
 *   thing that cannot be the cause. The message was written for the case the
 *   author had in mind — a deploy landing ahead of its migration, which the
 *   header of 049 correctly calls "the normal case here" — and then printed
 *   for every other case as well.
 *
 *   THIS IS THE CLASS, NOT AN INSTANCE. #620, #621, #714 and #716 are all the
 *   same finding: a check that cannot tell two states apart, reporting the one
 *   that reads as a fact. #716's is the closest sibling — "UPSTASH_REDIS_REST_URL
 *   IS NOT SET" said to somebody who had set it — and its fix is the one
 *   copied here: name which of the possible states was actually found, and say
 *   the remedy that belongs to THAT state.
 *
 * ── HOW THE THREE ARE TOLD APART ────────────────────────────────────────────
 *
 *   MISSING     PostgREST answers PGRST202 for a function not in its schema
 *               cache, and PostgreSQL 42883 (undefined_function) when the call
 *               reaches it. Either way: the migration has not been applied, and
 *               applying it is the fix.
 *
 *   TIMED OUT   57014, query_canceled, whose message is "canceling statement
 *               due to statement timeout". The function is there. Applying the
 *               migration is not the fix and never was.
 *
 *   UNKNOWN     Anything else — a permission error, a type mismatch, a
 *               connection reset. The honest answer is to print what came back
 *               and NOT to prescribe, because prescribing wrongly is the whole
 *               defect being repaired.
 *
 *   The codes are checked first and the message text second. A code is a
 *   contract; a message is prose that can be reworded by a Postgres upgrade.
 */

export type RpcUnavailableCause = "missing" | "timed-out" | "unknown";

/** The little of a PostgREST/Postgres error this rule needs. */
export interface RpcErrorLike {
    code?: string | null;
    message?: string | null;
}

const MISSING_CODES = new Set(["PGRST202", "42883"]);
const TIMEOUT_CODES = new Set(["57014"]);

export function whyRpcUnavailable(error: RpcErrorLike | null | undefined): RpcUnavailableCause {
    const code = (error?.code ?? "").trim();
    if (MISSING_CODES.has(code)) return "missing";
    if (TIMEOUT_CODES.has(code)) return "timed-out";

    /*
     *   THE MESSAGE IS THE FALLBACK, NOT THE TEST. Supabase's JS client does
     *   not always surface a code — the platform has a live example of exactly
     *   that, "[supabase-db] count users: no message, code, details or hint" —
     *   so the text is read when the code is absent or unrecognised.
     */
    const message = (error?.message ?? "").toLowerCase();
    if (!message) return "unknown";

    if (message.includes("statement timeout") || message.includes("canceling statement")) {
        return "timed-out";
    }
    if (
        message.includes("could not find the function")
        || message.includes("does not exist")
        || message.includes("undefined function")
    ) {
        return "missing";
    }

    return "unknown";
}

/**
 * The line to log when `fn` could not be used, naming the remedy that belongs
 * to the state actually found.
 *
 * `fallback` describes what the caller does instead, because that is the part
 * the operator needs in order to judge urgency — "slow but correct" and "wrong
 * numbers" are different emergencies and only the caller knows which it is.
 */
export function rpcUnavailableAdvice(params: {
    fn: string;
    migration: string;
    fallback: string;
    error: RpcErrorLike | null | undefined;
}): string {
    const { fn, migration, fallback, error } = params;
    const reason = (error?.message ?? "").trim() || "no message";
    const head = `[ANALYTICS SERVICE] ${fn} did not answer — ${fallback}`;

    switch (whyRpcUnavailable(error)) {
        case "missing":
            return `${head} THE FUNCTION IS NOT THERE: apply ${migration}. Reason: ${reason}`;
        case "timed-out":
            return `${head} THE FUNCTION EXISTS AND TIMED OUT — applying ${migration} `
                + `will NOT help, it is already applied. Something it reads has grown past `
                + `the statement timeout; look at the indexes behind it. Reason: ${reason}`;
        default:
            return `${head} Could not tell whether it is missing or merely slow, so no `
                + `remedy is prescribed: check that ${migration} is applied AND how long `
                + `the function takes. Reason: ${reason}`;
    }
}
