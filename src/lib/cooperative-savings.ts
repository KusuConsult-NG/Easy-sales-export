/**
 * Fixed savings terms — the rate, the bounds, and the projection.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The fixed-savings rate was written out as a literal in FOUR places:
 *
 *   api/cooperative/create-fixed-savings/route.ts   const interestRate = 14
 *   actions/cooperative/_coop_money.ts              interestRate: 14
 *   cooperatives/(member)/fixed-savings/page.tsx    useState(14)
 *   cooperatives/(member)/fixed-savings/page.tsx    "...guaranteed 14% annual returns"
 *
 * Two of those decide what a member is PAID, and two decide what a member is
 * TOLD. Nothing kept them equal. This is the same shape as the loan limit, where
 * the figure shown to a member (half their savings) and the figure enforced on
 * them (three times their savings) came from different places and disagreed by
 * six times without anything noticing.
 *
 * ANNUAL, NOT MONTHLY — READ THIS BEFORE CHANGING THE NUMBER
 * ----------------------------------------------------------
 * FIXED_SAVINGS_ANNUAL_RATE is a rate PER YEAR. Every other rate in this
 * codebase is per MONTH: cooperative-tiers.ts documents `interestRate` as a
 * monthly percentage, loan-terms.ts says the same, and confusing the two has
 * already caused one production defect — the cooperative loan rate was applied
 * as 10% per year while being intended and labelled as 10% per month.
 *
 * The collision is worse here than it looks, because a fixed-savings plan is
 * stored with a field literally named `interestRate`, the same name loan
 * products use for a monthly figure. The same field name means two different
 * things in two collections. That is why the constant carries the period in its
 * name and why formatRate() renders "per year" rather than "%" — a bare
 * percentage next to this number is what makes the mistake possible.
 *
 * Savings pay less than loans charge, which is the point: the cooperative lends
 * at 10% per month and pays 14% per year on locked savings.
 */

/** Interest paid on fixed savings, as a percentage PER YEAR. 14 means 14%/year. */
export const FIXED_SAVINGS_ANNUAL_RATE = 14;

/** Smallest plan the cooperative accepts, in naira. */
export const FIXED_SAVINGS_MIN_AMOUNT = 50_000;

/** Term bounds, in months. Matches the loan ceiling in loan-terms.ts. */
export const FIXED_SAVINGS_MIN_MONTHS = 1;
export const FIXED_SAVINGS_MAX_MONTHS = 12;

/** "14% per year" — for anything shown to a member. Never a bare "14%". */
export function formatFixedSavingsRate(): string {
    return `${FIXED_SAVINGS_ANNUAL_RATE}% per year`;
}

/** "₦50,000" — the minimum, formatted for the message that refuses a smaller plan. */
export function formatFixedSavingsMinimum(): string {
    return `₦${FIXED_SAVINGS_MIN_AMOUNT.toLocaleString()}`;
}

/**
 * Interest a plan will have earned at maturity, in naira.
 *
 * Simple interest pro-rated over the term — NOT compounded — which is what both
 * call sites already computed and what the member-facing calculator shows:
 *
 *     amount × rate × (months / 12) / 100
 *
 * Rounded to the kobo. The unrounded value produced figures like ₦5833.3333333
 * on the stored plan, which then appeared in totals.
 *
 * Returns 0 rather than NaN for unusable input. A plan is refused before it
 * gets here; a projection that reads "₦NaN" on a member's savings page is a
 * worse outcome than one that reads zero and is obviously wrong.
 */
export function projectedFixedSavingsProfit(
    amountNaira: number,
    durationMonths: number,
    annualRate: number = FIXED_SAVINGS_ANNUAL_RATE,
): number {
    if (!Number.isFinite(amountNaira) || amountNaira <= 0) return 0;
    if (!Number.isFinite(durationMonths) || durationMonths <= 0) return 0;
    if (!Number.isFinite(annualRate) || annualRate < 0) return 0;

    return Math.round(((amountNaira * annualRate * (durationMonths / 12)) / 100) * 100) / 100;
}

/**
 * Is this a plan the cooperative will accept?
 *
 * Both creation paths applied their own version of these checks — the route
 * inline, the action through fixedSavingsSchema — so they could disagree about
 * what a valid plan is. One rule, stated once.
 */
export function validateFixedSavingsPlan(
    amountNaira: number,
    durationMonths: number,
): { valid: boolean; reason?: string } {
    if (!Number.isFinite(amountNaira) || amountNaira < FIXED_SAVINGS_MIN_AMOUNT) {
        return { valid: false, reason: `Minimum amount is ${formatFixedSavingsMinimum()}` };
    }
    if (!Number.isInteger(durationMonths)
        || durationMonths < FIXED_SAVINGS_MIN_MONTHS
        || durationMonths > FIXED_SAVINGS_MAX_MONTHS) {
        return {
            valid: false,
            reason: `Duration must be between ${FIXED_SAVINGS_MIN_MONTHS} and ${FIXED_SAVINGS_MAX_MONTHS} months`,
        };
    }
    return { valid: true };
}

/**
 * Maturity date for a plan starting now.
 *
 * 30-day months, matching what both call sites already did and what the member
 * page renders as the projected maturity. Kept identical rather than corrected
 * to calendar months: the stored dates on existing plans were computed this
 * way, and changing the arithmetic would move maturity dates members have
 * already been shown.
 */
export function fixedSavingsMaturityDate(durationMonths: number, from: Date = new Date()): Date {
    return new Date(from.getTime() + durationMonths * 30 * 24 * 60 * 60 * 1000);
}
