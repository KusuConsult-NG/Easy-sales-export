/**
 * @jest-environment node
 */

import {
    calculateUserTier,
    isEligibleForLoan,
    getTierInterestRate,
    getMaxLoanAmount,
    getTierMaxDuration,
    calculateRepaymentSchedule,
    COOPERATIVE_TIERS,
} from '@/lib/cooperative-tiers';

describe('Cooperative Tier System', () => {
    describe('calculateUserTier', () => {
        it('should always return Member tier', () => {
            expect(calculateUserTier(0)).toBe('Member');
            expect(calculateUserTier(15000)).toBe('Member');
            expect(calculateUserTier(50000)).toBe('Member');
        });
    });

    describe('getTierInterestRate', () => {
        // Confirmed business rule: 10% PER MONTH, not per year. The value used
        // to be 10/12 while every screen labelled it "APR", so members were
        // shown an annual figure for a monthly rate.
        it('should return 10% as a monthly rate for Member tier', () => {
            expect(getTierInterestRate('Member')).toBe(10);
        });
    });

    describe('getTierMaxDuration', () => {
        it('should return 12 months for Member tier', () => {
            expect(getTierMaxDuration('Member')).toBe(12);
        });
    });

    describe('isEligibleForLoan', () => {
        it('should reject if contribution is below minimum', () => {
            // minContribution is 5000 per COOPERATIVE_TIERS.Member
            const result = isEligibleForLoan(3000, 10000, 0);
            expect(result.eligible).toBe(false);
            expect(result.reason).toContain('Minimum');
        });

        // Confirmed business rule: savings must be at least TWICE the loan, so
        // the borrowable maximum is half of savings. The multiplier used to be
        // 3, letting a member borrow six times more than intended.
        it('should reject if requested amount plus active loan exceeds half of savings', () => {
            // 20k saved -> max 10k. 8k requested + 4k outstanding = 12k.
            const result = isEligibleForLoan(20000, 8000, 4000);
            expect(result.eligible).toBe(false);
            expect(result.reason).toContain('exceeds your maximum limit');
        });

        it('should reject a loan above half of savings', () => {
            // 20k saved -> max 10k. Request 15k.
            const result = isEligibleForLoan(20000, 15000, 0);
            expect(result.eligible).toBe(false);
            expect(result.reason).toContain('exceeds your maximum limit');
        });

        it('should approve a loan within half of savings', () => {
            // 20k saved -> max 10k. Request 6k.
            const result = isEligibleForLoan(20000, 6000, 0);
            expect(result.eligible).toBe(true);
        });

        it('should approve a loan at exactly half of savings', () => {
            // 20k saved -> max exactly 10k.
            const result = isEligibleForLoan(20000, 10000, 0);
            expect(result.eligible).toBe(true);
        });
    });

    describe('calculateRepaymentSchedule', () => {
        it('should calculate correct schedule for 3-month loan', () => {
            const schedule = calculateRepaymentSchedule(30000, 2.0, 3);

            expect(schedule).toHaveLength(3);
            expect(schedule[0].installmentNumber).toBe(1);
            expect(schedule[1].installmentNumber).toBe(2);
            expect(schedule[2].installmentNumber).toBe(3);
        });

        it('should calculate principal and interest correctly', () => {
            const principal = 12000;
            const rate = 2.0; // 2.0% monthly
            const months = 12;

            const schedule = calculateRepaymentSchedule(principal, rate, months);

            const totalPrincipal = schedule.reduce((sum, inst) => sum + inst.principalAmount, 0);
            const totalInterest = schedule.reduce((sum, inst) => sum + inst.interestAmount, 0);

            expect(totalPrincipal).toBeCloseTo(principal, 0);
            expect(totalInterest).toBeGreaterThan(0);
        });

        it('should have consistent total installments (amortization)', () => {
            const schedule = calculateRepaymentSchedule(24000, 2.0, 6);

            const payments = schedule.map(inst => inst.totalAmount);
            const firstPayment = payments[0];

            // In typical amortized schedule with identical total payment, all should match roughly
            payments.forEach(payment => {
                expect(payment).toBeCloseTo(firstPayment, 1);
            });
        });

        it('should handle 1-month loan', () => {
            const schedule = calculateRepaymentSchedule(10000, 2.0, 1);

            expect(schedule).toHaveLength(1);
            expect(schedule[0].principalAmount).toBeCloseTo(10000, 0);
        });

        it('should calculate higher interest for longer duration', () => {
            const short = calculateRepaymentSchedule(50000, 2.0, 3);
            const long = calculateRepaymentSchedule(50000, 2.0, 12);

            const shortInterest = short.reduce((sum, inst) => sum + inst.interestAmount, 0);
            const longInterest = long.reduce((sum, inst) => sum + inst.interestAmount, 0);

            expect(longInterest).toBeGreaterThan(shortInterest);
        });
    });

    describe('COOPERATIVE_TIERS constant', () => {
        it('should have correct Member tier configuration', () => {
            expect(COOPERATIVE_TIERS.Member.name).toBe('Member');
            // Source of truth: src/lib/cooperative-tiers.ts — minContribution is 5000
            expect(COOPERATIVE_TIERS.Member.minContribution).toBe(5000);
            // Half of savings — see the eligibility tests above.
            expect(COOPERATIVE_TIERS.Member.maxLoanMultiplier).toBe(0.5);
            expect(COOPERATIVE_TIERS.Member.color).toBe('emerald');
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression guards for the confirmed loan terms.
//
// The rate is a MONTHLY percentage. Reading it as annual (or writing an annual
// figure into the field) silently changes what borrowers are billed by 12x,
// and nothing in the type system prevents it.
// ─────────────────────────────────────────────────────────────────────────────
describe('Loan terms — regression guards', () => {
    it('treats the tier rate as monthly, not annual', () => {
        const rate = getTierInterestRate('Member');
        const schedule = calculateRepaymentSchedule(100_000, rate, 1);

        // One month at 10% monthly on 100,000 is 10,000 of interest.
        // If the rate were read as annual it would be roughly 833.
        expect(schedule[0].interestAmount).toBeCloseTo(10_000, 0);
    });

    it('never produces NaN instalments at a zero interest rate', () => {
        // The annuity formula divides by zero when the rate is 0.
        const schedule = calculateRepaymentSchedule(120_000, 0, 12);

        expect(schedule).toHaveLength(12);
        for (const inst of schedule) {
            expect(Number.isFinite(inst.totalAmount)).toBe(true);
            expect(Number.isFinite(inst.principalAmount)).toBe(true);
            expect(inst.interestAmount).toBe(0);
        }
        const totalPrincipal = schedule.reduce((s, i) => s + i.principalAmount, 0);
        expect(totalPrincipal).toBeCloseTo(120_000, 2);
    });

    it('caps borrowing at half of savings', () => {
        expect(getMaxLoanAmount(50_000)).toBe(25_000);
    });

    it('caps the repayment term at 12 months', () => {
        expect(getTierMaxDuration('Member')).toBe(12);
    });
});
