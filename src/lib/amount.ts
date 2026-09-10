/**
 * Deciding whether a sum of money is a sum of money.
 *
 *   #606 ELEVEN MINIMUM-AMOUNT GUARDS, AND NaN WALKS PAST EVERY ONE.
 *
 *   The money entry points all say some version of this:
 *
 *       if (amount < 5000) return { error: "Minimum withdrawal is ₦5,000" };
 *       if (amount < 1000) return { error: "Minimum contribution is ₦1,000" };
 *       if (amountInNaira < 50000 || amountInNaira > 10000000) return …
 *
 *   EVERY COMPARISON WITH NaN IS FALSE. `NaN < 5000` is false, so the guard does
 *   not fire and the amount goes through. The two-sided one is the sharpest
 *   illustration: `< 50000 || > 10000000` looks airtight from both directions,
 *   and NaN fails both halves, so the one value that is not a number is the one
 *   value the bound cannot stop.
 *
 *   The same holds for a string that does not parse. `"abc" < 5000` is false,
 *   and so is `balance < "abc"` — so a sufficiency check written the same way
 *   passes too, and both guards on the path wave the same bad value through.
 *
 * ── THE ARGUMENT IS NOT TYPED AT RUNTIME ────────────────────────────────────
 *
 *   `async function withdrawEarningsAction(amount: number)` is a SERVER ACTION.
 *   Its parameter annotation is erased at compile time; what arrives is whatever
 *   the caller serialised, and the caller is a browser. A `number` in the
 *   signature is a note to the next programmer, not a check — the same mistake
 *   as #597's `formatDate(date: Date)` and #605's `as Timestamp`, on money.
 *
 *   THE BROWSER ALREADY DOES THIS CORRECTLY, WHICH IS THE UNCOMFORTABLE PART.
 *   WaveEarningsClient reads:
 *
 *       const amount = parseCurrencyStringToFloat(withdrawalAmount);
 *       if (isNaN(amount) || amount < 5000) { …refuse… }
 *
 *   The check the server needs was written, tested and shipped — on the one side
 *   of the boundary where it protects nobody. Client-side validation is a
 *   courtesy to the person typing; it is not a control over what the server is
 *   asked to do.
 *
 * ── THE CODEBASE ALREADY KNEW THE IDIOM, IN ONE PLACE ───────────────────────
 *
 *   `loan-actions.ts` disburses on `if (!(amount > 0))` — negated, so NaN takes
 *   the refusing branch. That spelling appears EXACTLY ONCE in the repository
 *   and eleven sites use the form NaN survives. A rule stated by hand at every
 *   call site is a rule applied at most of them: #439's lesson, and the reason
 *   this is a module rather than eleven corrections.
 *
 * ── WHAT IT DELIBERATELY REFUSES ────────────────────────────────────────────
 *
 *   A NUMERIC STRING IS NOT ACCEPTED. "5000" could be coerced, and coercing it
 *   is how "5000abc" becomes NaN one refactor later. Every legitimate caller in
 *   this codebase already sends a parsed number, so strictness costs nothing and
 *   the leniency would have to be re-audited forever.
 *
 *   Infinity is not an amount either, which `Number.isFinite` covers and a
 *   `typeof === "number"` check alone does not.
 */

/**
 * True when `value` is a real number of at least `minimum`, and at most
 * `maximum` when one is given.
 *
 * NaN, Infinity, strings, null, undefined, booleans and objects are all false —
 * including when `minimum` is 0, where a plain `>= 0` would let NaN through.
 *
 * Callers keep their own wording for the refusal. The messages on these screens
 * name specific figures a member has been told elsewhere ("Minimum withdrawal is
 * ₦5,000"), and replacing them with one generic sentence would be a product
 * change riding along inside a defect fix.
 */
export function isAmountAtLeast(value: unknown, minimum: number, maximum = Infinity): boolean {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    return value >= minimum && value <= maximum;
}

/** True when `value` is a real number strictly greater than zero. */
export function isPositiveAmount(value: unknown): boolean {
    return isAmountAtLeast(value, Number.MIN_VALUE);
}
