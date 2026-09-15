/**
 * What to tell the admin who pressed "Sync Paystack".
 *
 *   #764 THE SCREEN SAID ✓ WHATEVER HAPPENED.
 *
 *   The owner read a real run out of the AUDIT LOG rather than off the screen,
 *   and asked why it still looked like this:
 *
 *       total 5517   synced 10   skipped 5502   errors 5   unhandled 0
 *
 *   The reason they had to go to the audit log is that the screen never
 *   mentioned it. /admin/finance built its banner from one field:
 *
 *       const msg = data.synced > 0
 *           ? `✓ Synced ${data.synced} new transaction(s) from Paystack (...)`
 *           : `✓ All Paystack transactions are up to date`;
 *
 *   Both branches open with a tick, and the banner is coloured green by
 *   `syncResult.startsWith("✓")`. So that run — ten fulfilled, five thrown —
 *   reported an unqualified success, and `errors`, `unhandled` and `truncated`
 *   were dropped on the floor.
 *
 *   THE WORST CASE IS THE SECOND BRANCH. A run that synced nothing, hit its
 *   page ceiling and threw on forty transactions printed, in green:
 *
 *       ✓ All Paystack transactions are up to date
 *
 *   which is not a rounding error in the wording — it is the opposite of what
 *   happened, on the screen an admin uses to decide whether a member's missing
 *   payment has been recovered.
 *
 *   #531 PUT THOSE FIELDS IN THE RESPONSE FOR THIS EXACT PURPOSE. Its note on
 *   the route reads: "Named in the response so the admin who pressed the button
 *   sees them. These are payments a person made that nothing on this platform
 *   knows how to fulfil, which is the one result of this job that needs a
 *   human." The route reported faithfully and the only reader ignored it —
 *   which is this audit's most common shape, arriving this time between a
 *   server route and its own screen.
 *
 * ── A FUNCTION, NOT A TERNARY IN A COMPONENT ────────────────────────────────
 *
 *   The verdict is the thing worth testing, and a decision buried in a click
 *   handler can only be tested through a rendered page. Extracted so it can be
 *   asked directly with known inputs — the cure this audit has settled on for
 *   assertions that would otherwise have nothing to bite on.
 *
 *   No imports, so anything may use it.
 */

/** The shape /api/admin/finance/paystack-sync returns on success. */
export interface PaystackSyncResult {
    total?: number;
    synced?: number;
    skipped?: number;
    errors?: number;
    unhandled?: number;
    truncated?: boolean;
    unhandledReferences?: string[];
    errorReferences?: Array<{ reference: string; type?: string | null; amount?: number; reason?: string }>;
    breakdown?: { success?: number; failed?: number; abandoned?: number };
}

export type SyncTone = "ok" | "warning" | "error";

export interface SyncSummary {
    tone: SyncTone;
    /** One line for the banner. */
    message: string;
    /** The references a human has to look at, already capped for display. */
    details: string[];
}

/** How many references to spell out before summarising the rest. */
const SHOWN = 5;

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

function nameSome(refs: string[]): string {
    const shown = refs.slice(0, SHOWN).join(", ");
    const rest = refs.length - SHOWN;
    return rest > 0 ? `${shown} and ${rest} more` : shown;
}

/**
 * The banner for one sync run.
 *
 * A run is only `ok` when there is nothing left for a person to do. Anything
 * this job could not finish — a transaction that threw, a payment nothing can
 * route, or a sweep that hit its page ceiling — is a `warning`, because the
 * admin's next decision depends on knowing it.
 */
export function summarisePaystackSync(result: PaystackSyncResult): SyncSummary {
    const synced = Number(result.synced ?? 0);
    const errors = Number(result.errors ?? 0);
    const unhandled = Number(result.unhandled ?? 0);
    const truncated = result.truncated === true;

    const details: string[] = [];

    if (truncated) {
        details.push(
            "The sweep hit its page ceiling, so older transactions were not read at all. "
            + "Run it again to continue.",
        );
    }

    if (unhandled > 0) {
        const refs = result.unhandledReferences ?? [];
        details.push(
            `${unhandled} ${plural(unhandled, "payment")} could not be routed to any module `
            + `— somebody paid and nothing here knows how to fulfil it`
            + (refs.length > 0 ? `: ${nameSome(refs)}` : "."),
        );
    }

    if (errors > 0) {
        /*
         *   Named, and this is the half the owner's run actually had. An
         *   errored transaction writes no row anywhere, so the next run retries
         *   it from scratch — which means five transactions failing every time
         *   look exactly like five different one-off blips. The references are
         *   what tells those apart.
         */
        const refs = (result.errorReferences ?? []).map((e) =>
            e.reason ? `${e.reference} (${e.reason})` : e.reference,
        );
        details.push(
            `${errors} ${plural(errors, "transaction")} failed while being processed`
            + (refs.length > 0 ? `: ${nameSome(refs)}` : ". Check the server log for the references.")
            + ` Nothing was recorded for ${plural(errors, "it", "them")}, so running the sync again will retry ${plural(errors, "it", "them")}.`,
        );
    }

    const needsAHuman = truncated || unhandled > 0 || errors > 0;

    if (!needsAHuman) {
        const b = result.breakdown;
        const counts = b
            ? ` (success: ${b.success ?? "?"}, failed: ${b.failed ?? "?"}, abandoned: ${b.abandoned ?? "?"})`
            : "";
        return {
            tone: "ok",
            message: synced > 0
                ? `✓ Synced ${synced} new ${plural(synced, "transaction")} from Paystack${counts}`
                : "✓ All Paystack transactions are up to date",
            details: [],
        };
    }

    /*
     *   The count of what DID land stays in the headline. An admin who came here
     *   to rescue one payment needs both halves — "ten went through, and five did
     *   not" is a different instruction from either half alone.
     */
    const done = synced > 0
        ? `Synced ${synced} new ${plural(synced, "transaction")}, but `
        : "Sync finished, but ";

    const outstanding = [
        errors > 0 ? `${errors} ${plural(errors, "transaction")} failed` : null,
        unhandled > 0 ? `${unhandled} could not be routed` : null,
        truncated ? "not every page was read" : null,
    ].filter(Boolean).join(", ");

    return {
        tone: "warning",
        message: `⚠ ${done}${outstanding}. This needs a look.`,
        details,
    };
}
