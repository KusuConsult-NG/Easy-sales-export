/**
 * Reading a number off a stored document.
 *
 *   #597 A WINDOW WITHOUT A PRICE TOOK THE OPPORTUNITIES LIST DOWN.
 *
 *   `/export/opportunities` — the screen a member browses to decide where to put
 *   money — rendered each window with
 *
 *       ₦{window.slotPrice.toLocaleString()}
 *       {window.currentVolume.toLocaleString()}kg filled
 *
 *   inside a `.map` over every window. One row whose `slotPrice` or
 *   `currentVolume` was never written throws during render, and the list does
 *   not lose that card: it loses the page. That is #581's and #589's shape on
 *   the screen where investing starts.
 *
 *   `.toLocaleString()` is the specific hazard, and it is everywhere in this
 *   codebase, because it reads as harmless. It is a method on Number, so an
 *   absent field is a TypeError rather than the string "undefined".
 *
 *   THE SAME READING ALREADY EXISTED THREE TIMES, privately, under three names:
 *   `counter` in export-window-funding, `positiveNumber` in
 *   export-catalog-reader, and `Number(x) || 0` written out by hand in a dozen
 *   readers. This is the one place, and the two modules above use it.
 */

/**
 * A finite number, or 0.
 *
 * Never NaN, never undefined. An empty string is not zero by accident here —
 * `Number("")` is 0, which is right for a field a form left blank — but null,
 * undefined, and anything that does not parse all come back as `fallback`.
 */
export function numberOrZero(value: unknown, fallback = 0): number {
    if (value === null || value === undefined) return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * The first of several candidates that is a real number, else 0.
 *
 * Written for the fields this application stores under two names — a window's
 * raised amount is `fundedAmount` on new rows and `currentFunding` on old ones —
 * so that a reader does not have to spell out its own fallback chain and get it
 * slightly different from the last one. That divergence is #589's finding.
 */
export function firstNumber(...candidates: unknown[]): number {
    for (const candidate of candidates) {
        if (candidate === undefined || candidate === null || candidate === "") continue;
        const n = Number(candidate);
        if (Number.isFinite(n)) return n;
    }
    return 0;
}

/** A number formatted with thousands separators, or a dash when there is none. */
export function numberOrDash(value: unknown, fallback = "—"): string {
    if (value === null || value === undefined || value === "") return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString() : fallback;
}
