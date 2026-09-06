/**
 * When a loan instalment falls due.
 *
 * THE DEFECT THIS EXISTS FOR
 * --------------------------
 * Both schedule builders computed instalment N's due date as:
 *
 *     const dueDate = new Date(startDate);
 *     dueDate.setMonth(dueDate.getMonth() + i);
 *
 * `Date.prototype.setMonth` does not clamp. Asked for 31 February it rolls
 * forward into March. So for a loan disbursed on the 31st — or the 30th, or the
 * 29th outside a leap year — the schedule is not monthly at all. A six-month
 * loan disbursed on 31 January 2026 came out as:
 *
 *     1   2026-03-03      February has no payment at all
 *     2   2026-03-31      two payments in March, 28 days apart
 *     3   2026-05-01      April has none
 *     4   2026-05-31      two in May
 *     5   2026-07-01      June has none
 *     6   2026-07-31      two in July
 *
 * The borrower is told the loan is repaid monthly, and is billed twice in three
 * of the six months and not at all in the other three. The first instalment is
 * due 32 days after disbursement, the second 28 days after that.
 *
 * It also moves the maturity date. Disbursed 31 August, instalment six lands on
 * 3 March — a six-month loan whose last payment is six months and three days
 * out, because the rollover compounds at both ends of the term.
 *
 * Roughly a tenth of all disbursements fall on a day this affects, and the
 * schedule is written to LOAN_REPAYMENTS once and then read back for the life
 * of the loan, so the wrong dates are permanent for every loan already issued.
 *
 * WHAT IT DOES NOT AFFECT, SAID PLAINLY. The money is unchanged: the annuity
 * works in whole months and never looks at the dates, and the penalty rule has
 * a seven-day grace period, which absorbs the one-to-three day shift. This is
 * a defect in what the borrower is told to pay and when, not in what they owe.
 *
 * THE RULE
 * --------
 * Anchor on the day-of-month the loan started, and clamp to the last day of the
 * target month when that day does not exist there. 31 January + 1 month is 28
 * February; + 2 months is 31 March, NOT 28 March — the anchor is the original
 * date, never the clamped one, so a single short month does not drag the rest
 * of the schedule backwards with it.
 *
 * That is the ordinary convention for a monthly instalment, and it is the one
 * a borrower reading "monthly" already assumes.
 *
 * ONE RULE, BOTH BUILDERS. The line above appeared twice — in
 * actions/cooperative/_loans_repayments.ts, which writes the rows the borrower
 * and the admin both read, and in lib/cooperative-tiers.ts, whose only caller
 * (calculateLoanCost, behind the loan application wizard) discards the dates
 * and keeps the interest. Only the first is live today. The second is fixed
 * anyway, and by calling this rather than restating it, because a second copy
 * of a rule is how the fix reaches one site and not the other — the failure
 * this audit has now recorded six times.
 *
 * Local calendar, deliberately: the callers construct and display these dates
 * with the local getters, and the point of the fix is the day-of-month a person
 * reads. Switching to UTC here would move the boundary for a different set of
 * loans instead of fixing this one.
 */

/**
 * The last day of the month `date` falls in, in local time.
 *
 * Day 0 of month M+1 is the last day of month M — that is how the Date
 * constructor's overflow is defined, and it is the only place in this module
 * where overflow is used on purpose.
 */
export function lastDayOfMonth(year: number, monthIndex: number): number {
    return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * `start` advanced by `months` whole months, clamped to the end of the target
 * month rather than rolling into the next one.
 *
 * Time of day is preserved. `start` is not mutated.
 *
 * A non-finite or non-integer `months`, or an unreadable `start`, returns an
 * Invalid Date rather than a plausible wrong one: a schedule built from
 * nonsense should fail where it is written, not read as a real due date months
 * later. (`setDate(NaN)` silently producing an Invalid Date that no comparison
 * ever catches is the shape #275 recorded on the escrow extension.)
 */
export function addMonthsClamped(start: Date, months: number): Date {
    if (!(start instanceof Date) || Number.isNaN(start.getTime())) return new Date(NaN);
    if (!Number.isInteger(months)) return new Date(NaN);

    const anchorDay = start.getDate();
    const result = new Date(start.getTime());

    // Move to the 1st BEFORE shifting the month. setMonth on the 31st is the
    // whole defect; from the 1st it cannot overflow whatever month it lands in.
    result.setDate(1);
    result.setMonth(result.getMonth() + months);

    result.setDate(Math.min(anchorDay, lastDayOfMonth(result.getFullYear(), result.getMonth())));
    return result;
}

/**
 * The due date of instalment `installmentNumber` (1-based) for a loan that
 * started on `start`.
 *
 * The anchor is always `start`, never the previous instalment's date, so a
 * February in the middle of the term does not shorten every month after it.
 */
export function installmentDueDate(start: Date, installmentNumber: number): Date {
    return addMonthsClamped(start, installmentNumber);
}
