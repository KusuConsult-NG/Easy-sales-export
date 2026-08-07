/**
 * Business loan terms and repayment maths.
 *
 * WHY THIS EXISTS
 * ---------------
 * Business loan applications at /loans/apply were stored with no interest rate
 * and no repayment schedule — the record held an amount and a term, and nothing
 * saying what would be owed. Nobody could tell a borrower what they had signed
 * up for, because the number did not exist anywhere in the code.
 *
 * The rate below was confirmed by the business owner on 2026-08-07.
 *
 * MONTHLY, NOT ANNUAL
 * -------------------
 * BUSINESS_LOAN_MONTHLY_RATE is a MONTHLY percentage. This distinction has
 * already caused one production defect: the cooperative loan rate was applied
 * as 10% per year while being labelled, and intended, as 10% per month. Any
 * label rendered next to this number must say "per month".
 *
 * KOBO, NOT NAIRA
 * ---------------
 * All arithmetic runs in kobo (integer) and converts back at the end, matching
 * src/app/actions/cooperative/_loans.ts. Repeated floating-point addition over
 * a full schedule drifts, and drift in money is not acceptable.
 *
 * NOTE: cooperative/_loans.ts carries an equivalent calculation inline, driven
 * by tier rates rather than one flat rate. The two should converge on this
 * module eventually; that is a refactor, not a bug, and the cooperative version
 * was audited recently so it is left alone for now.
 */

/** Monthly interest rate for business loans, as a percentage. */
export const BUSINESS_LOAN_MONTHLY_RATE = 10;

/**
 * Term bounds, matching loanApplicationSchema.
 *
 * The 12-month ceiling is deliberate. At 10% per month, a ₦1,000,000 loan
 * repays ₦1,761,160 over 12 months (1.76× principal) and ₦2,671,194 over 24
 * (2.67×). The longer term was allowed by the schema before anyone had chosen
 * a rate; capped at 12 once the two were considered together.
 */
export const MIN_TERM_MONTHS = 3;
export const MAX_TERM_MONTHS = 12;

/** Amount bounds in naira, matching loanApplicationSchema. */
export const MIN_LOAN_AMOUNT = 1_000;
export const MAX_LOAN_AMOUNT = 5_000_000;

export interface RepaymentTerms {
    /** The monthly rate applied, as a percentage. Stored so a later rate change does not rewrite history. */
    interestRate: number;
    /** Equal monthly instalment, in naira. */
    monthlyPayment: number;
    /** Total repaid over the full term, in naira. */
    totalRepayment: number;
    /** Total interest over the full term, in naira. */
    totalInterest: number;
    /** Term used, in months. */
    termMonths: number;
}

/**
 * Amortising repayment schedule for a business loan.
 *
 * Standard annuity formula: each instalment is equal, and the split between
 * interest and principal shifts across the term. The final instalment clears
 * whatever principal remains, so rounding cannot leave a balance behind.
 *
 * @param amountNaira principal, in naira
 * @param termMonths  repayment period, in months
 * @param monthlyRate monthly interest as a percentage; defaults to the
 *                    configured business rate
 */
export function calculateRepaymentTerms(
    amountNaira: number,
    termMonths: number,
    monthlyRate: number = BUSINESS_LOAN_MONTHLY_RATE
): RepaymentTerms {
    if (!Number.isFinite(amountNaira) || amountNaira <= 0) {
        throw new Error(`calculateRepaymentTerms: amount must be positive, got ${amountNaira}`);
    }
    if (!Number.isInteger(termMonths) || termMonths < 1) {
        throw new Error(`calculateRepaymentTerms: term must be a positive whole number of months, got ${termMonths}`);
    }
    if (!Number.isFinite(monthlyRate) || monthlyRate < 0) {
        throw new Error(`calculateRepaymentTerms: rate must be zero or positive, got ${monthlyRate}`);
    }

    const principalKobo = Math.round(amountNaira * 100);
    const r = monthlyRate / 100;
    const n = termMonths;

    // A zero rate is interest-free: the annuity formula divides by zero there.
    if (r === 0) {
        const monthlyKobo = Math.round(principalKobo / n);
        return {
            interestRate: monthlyRate,
            monthlyPayment: monthlyKobo / 100,
            totalRepayment: principalKobo / 100,
            totalInterest: 0,
            termMonths: n,
        };
    }

    const growth = Math.pow(1 + r, n);
    const monthlyPaymentKobo = Math.round((principalKobo * (r * growth)) / (growth - 1));

    // Walk the schedule so the interest total reflects the declining balance
    // rather than a closed-form approximation.
    let remainingKobo = principalKobo;
    let totalInterestKobo = 0;

    for (let i = 1; i <= n; i++) {
        const interestKobo = Math.round(remainingKobo * r);
        let principalPortionKobo = monthlyPaymentKobo - interestKobo;

        // Final instalment clears the balance, absorbing accumulated rounding.
        if (i === n) {
            principalPortionKobo = remainingKobo;
        }

        totalInterestKobo += interestKobo;
        remainingKobo -= principalPortionKobo;
    }

    return {
        interestRate: monthlyRate,
        monthlyPayment: monthlyPaymentKobo / 100,
        totalRepayment: (principalKobo + totalInterestKobo) / 100,
        totalInterest: totalInterestKobo / 100,
        termMonths: n,
    };
}
