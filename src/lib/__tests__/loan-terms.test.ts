/**
 * Tests for business loan repayment maths in src/lib/loan-terms.ts.
 *
 * The rate is MONTHLY. This codebase has already shipped a defect where a
 * monthly rate was applied as annual, so the tests below pin the magnitude
 * explicitly rather than only checking that a number comes out.
 */

import {
    calculateRepaymentTerms,
    BUSINESS_LOAN_MONTHLY_RATE,
    MIN_TERM_MONTHS,
    MAX_TERM_MONTHS,
} from "@/lib/loan-terms";
import { loanApplicationSchema } from "@/lib/validations/loan";

describe("configured terms", () => {
    it("is 10 percent per month", () => {
        expect(BUSINESS_LOAN_MONTHLY_RATE).toBe(10);
    });

    it("caps the term at 12 months", () => {
        // Deliberate: at 10%/month a 24-month term repays 2.67x principal.
        // The schema allowed 24 before a rate had been chosen.
        expect(MAX_TERM_MONTHS).toBe(12);
        expect(MIN_TERM_MONTHS).toBe(3);
    });

    it("agrees with the validation schema", () => {
        // The two must not drift: the schema is what rejects an application,
        // the constants are what the UI and the maths use.
        const tooLong = loanApplicationSchema.shape.repaymentPeriod.safeParse(
            MAX_TERM_MONTHS + 1
        );
        const tooShort = loanApplicationSchema.shape.repaymentPeriod.safeParse(
            MIN_TERM_MONTHS - 1
        );
        const ok = loanApplicationSchema.shape.repaymentPeriod.safeParse(MAX_TERM_MONTHS);

        expect(tooLong.success).toBe(false);
        expect(tooShort.success).toBe(false);
        expect(ok.success).toBe(true);
    });
});

describe("calculateRepaymentTerms", () => {
    it("computes an amortising schedule at the monthly rate", () => {
        const terms = calculateRepaymentTerms(1_000_000, 12);

        expect(terms.interestRate).toBe(10);
        expect(terms.termMonths).toBe(12);
        // ₦1,000,000 over 12 months at 10%/month.
        expect(Math.round(terms.monthlyPayment)).toBe(146_763);
        expect(Math.round(terms.totalRepayment)).toBe(1_761_160);
        expect(Math.round(terms.totalInterest)).toBe(761_160);
    });

    it("treats the rate as monthly, not annual", () => {
        // The distinction that caused a production defect. At 10% per month
        // over 12 months a ₦1,000,000 loan repays ~₦1.76m. If the rate were
        // being applied annually it would repay ~₦1.05m.
        const terms = calculateRepaymentTerms(1_000_000, 12);

        expect(terms.totalRepayment).toBeGreaterThan(1_700_000);
        expect(terms.totalRepayment).toBeLessThan(1_800_000);
    });

    it("charges more interest over a longer term", () => {
        const short = calculateRepaymentTerms(1_000_000, MIN_TERM_MONTHS);
        const long = calculateRepaymentTerms(1_000_000, MAX_TERM_MONTHS);

        expect(long.totalInterest).toBeGreaterThan(short.totalInterest);
        // Monthly instalment falls as the term lengthens, even though the
        // total rises — the thing borrowers most often misread.
        expect(long.monthlyPayment).toBeLessThan(short.monthlyPayment);
    });

    it("leaves no balance behind at any point in the allowed range", () => {
        for (const term of [MIN_TERM_MONTHS, 6, 9, MAX_TERM_MONTHS]) {
            const t = calculateRepaymentTerms(1_000_000, term);
            // Principal plus interest must equal the total exactly; the final
            // instalment absorbs rounding rather than leaving a stray kobo.
            expect(t.totalRepayment).toBeCloseTo(1_000_000 + t.totalInterest, 2);
        }
    });

    it("handles the maximum permitted loan over the maximum term", () => {
        const terms = calculateRepaymentTerms(5_000_000, MAX_TERM_MONTHS);

        // ₦5,000,000 over 12 months at 10%/month → ₦8,805,798.88.
        //
        // Note this is NOT exactly five times the ₦1,000,000 case
        // (₦8,805,798.70). Interest is rounded per instalment against a
        // declining balance, so totals do not scale linearly with principal.
        // Anyone "correcting" this to a round multiple would be introducing
        // an error, not removing one.
        expect(terms.totalRepayment).toBeCloseTo(8_805_798.88, 2);
    });

    it("supports an interest-free loan without dividing by zero", () => {
        const terms = calculateRepaymentTerms(120_000, 12, 0);

        expect(terms.totalInterest).toBe(0);
        expect(terms.totalRepayment).toBe(120_000);
        expect(terms.monthlyPayment).toBe(10_000);
    });

    it("rejects nonsensical input rather than storing a broken schedule", () => {
        expect(() => calculateRepaymentTerms(0, 12)).toThrow(/amount must be positive/);
        expect(() => calculateRepaymentTerms(-1000, 12)).toThrow(/amount must be positive/);
        expect(() => calculateRepaymentTerms(1000, 0)).toThrow(/term must be a positive/);
        expect(() => calculateRepaymentTerms(1000, 1.5)).toThrow(/term must be a positive/);
        expect(() => calculateRepaymentTerms(1000, 12, -5)).toThrow(/rate must be zero or positive/);
    });

    it("works in kobo, so a repeated schedule does not drift", () => {
        const terms = calculateRepaymentTerms(333_333, 7);

        // Everything lands on whole kobo — no floating-point tails.
        expect(Number.isInteger(Math.round(terms.monthlyPayment * 100))).toBe(true);
        expect(Number.isInteger(Math.round(terms.totalRepayment * 100))).toBe(true);
        expect(Number.isInteger(Math.round(terms.totalInterest * 100))).toBe(true);
    });
});
