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

/** What this window is raising towards — 0 meaning "no goal recorded". */
export function windowFundingGoal(
    w: { fundingGoal?: unknown; goal?: unknown } | null | undefined,
): number {
    return counter(w?.fundingGoal, w?.goal);
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
    w: { fundedAmount?: unknown; currentFunding?: unknown; fundingGoal?: unknown; goal?: unknown } | null | undefined,
): number {
    const goal = windowFundingGoal(w);
    if (goal <= 0) return 0;
    return Math.min(100, Math.max(0, (windowRaisedAmount(w) / goal) * 100));
}
