/**
 * What an export window has raised, and what it is raising towards.
 *
 *   #589 A NEW FUNDING WINDOW'S DETAIL PAGE WAS BLANK, AND THAT IS WHERE YOU
 *        INVEST.
 *
 *   createExportWindowAction (the aggregation door) writes
 *
 *       fundingGoal: targetVolume * slotPrice,
 *       currentVolume: 0,
 *
 *   and does NOT write `fundedAmount` — correctly, because that counter belongs
 *   to incrementWithinCeiling, which locks the row and raises it under the
 *   ceiling. A window nobody has invested in yet simply has no such field.
 *
 *   /export/windows/[id] then rendered:
 *
 *       ) : window.fundingGoal > 0 ? (
 *           ₦{window.fundedAmount.toLocaleString()} / ₦{window.fundingGoal.toLocaleString()}
 *
 *   The goal is a positive number, so that branch is taken; `fundedAmount` is
 *   undefined, so `.toLocaleString()` throws DURING RENDER and the whole page is
 *   blank. Not the panel — the page.
 *
 *   AND IT CANNOT RECOVER BY ITSELF. The detail page is where the invest button
 *   lives, so nobody can make the first investment, so `fundedAmount` is never
 *   written, so the page keeps throwing. Every aggregation window is
 *   unreachable from the moment it is created, permanently.
 *
 * ── ONE QUANTITY, SIX READINGS ──────────────────────────────────────────────
 *
 *   Every server reader of this number already defends itself, each in its own
 *   words:
 *
 *       windowData.currentFunding || 0                                (export-payment)
 *       Number(data.fundedAmount ?? 0)                                (forensics)
 *       exportWindow.fundedAmount ?? exportWindow.currentFunding ?? 0 (_ex_investments)
 *       Number(data.fundedAmount ?? data.currentFunding) || 0         (export-investments, twice)
 *
 *   The screen was the sixth reader and the only one with no fallback — and the
 *   only one where being wrong takes a page down. That is #38 / #179 / #183 /
 *   #324's shape: one rule, N copies, and the copy that matters is the odd one
 *   out.
 *
 *   Both names are read because both are written: verifyInvestmentPaymentAction
 *   raises `fundedAmount` through the ceiling primitive and keeps
 *   `currentFunding` in step with a plain increment, and older rows carry only
 *   the latter.
 *
 *   `goal` is read alongside `fundingGoal` for the same reason
 *   initializeInvestmentPaymentAction reads both: older windows recorded it
 *   under that name.
 */

import { exportWindowFundingGoal } from "@/lib/export-window-status";

/** A number, or 0 — never NaN, never undefined. */
function counter(...candidates: unknown[]): number {
    for (const candidate of candidates) {
        if (candidate === undefined || candidate === null || candidate === "") continue;
        const n = Number(candidate);
        if (Number.isFinite(n)) return n;
    }
    return 0;
}

/** What this window has raised so far. */
export function windowRaisedAmount(
    w: { fundedAmount?: unknown; currentFunding?: unknown } | null | undefined,
): number {
    return counter(w?.fundedAmount, w?.currentFunding);
}

/**
 * What this window is raising towards — 0 meaning "nothing to raise".
 *
 *   #950 THIS RETURNED 0 FOR EVERY WINDOW CREATED BEFORE `fundingGoal` EXISTED,
 *   AND THE INVESTOR'S SCREEN READ THAT AS "Availability: Open".
 *
 *   exportWindowFundingGoal in lib/export-window-status derives the goal for
 *   exactly those rows — `targetVolume * slotPrice`, which is the figure
 *   admin/_exports.ts has always computed for the same window and thrown away.
 *   It was written, tested, and called by NOTHING outside the test suite, while
 *   its own suite's header said the derivation "fixes every reader".
 *
 *   So a legacy aggregation window that had taken investment showed no progress
 *   bar and the word "Open" to the next investor deciding whether to put money
 *   in — the bar and the numbers being behind `windowFundingGoal(window) > 0`.
 *   Two functions answering "what is this window raising towards", disagreeing
 *   on the rows that matter, is #452's shape in money.
 *
 *   ONE RULE NOW. This is the reader's spelling of it — 0 rather than null,
 *   because every call site compares it numerically — and the derivation lives
 *   in one place.
 *
 *   WHAT THIS DOES NOT DO, said plainly: incrementWithinCeiling reads a STORED
 *   column through a Postgres function, so a derived goal caps nothing at the
 *   row lock. It makes every READER and every pre-check honest. Capping an
 *   existing row needs the stored value, which is what
 *   scripts/backfill-export-funding-goals.ts writes and which needs a database
 *   this branch does not have.
 */
export function windowFundingGoal(
    w: Record<string, unknown> | { fundingGoal?: unknown; goal?: unknown } | null | undefined,
): number {
    return exportWindowFundingGoal(w as Record<string, unknown> | null | undefined) ?? 0;
}

/**
 * How far along, as a percentage between 0 and 100.
 *
 * Held here because the screen computed it as
 * `(window.fundedAmount / window.fundingGoal) * 100` inside a style attribute,
 * which is a division by zero waiting for a window whose goal is 0 — NaN in a
 * CSS width, which renders as no bar at all rather than an empty one.
 */
export function windowFundedPercent(
    /*
     *   #950 WIDENED with windowFundingGoal, which now derives the goal from
     *   `targetVolume` and `slotPrice` for a legacy row. A signature naming only
     *   the two goal fields would refuse the rows this function most needs to
     *   answer for, and the caller passes a whole window anyway.
     */
    w: Record<string, unknown> | null | undefined,
): number {
    const goal = windowFundingGoal(w);
    if (goal <= 0) return 0;
    return Math.min(100, Math.max(0, (windowRaisedAmount(w) / goal) * 100));
}
