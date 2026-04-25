/**
 * @jest-environment node
 */

import {
    calculateUserTier,
    isEligibleForLoan,
    getTierInterestRate,
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
        it('should return 2.0% monthly rate for Member tier', () => {
            const rate = getTierInterestRate('Member');
            expect(rate).toBe(2.0);
        });
    });

    describe('getTierMaxDuration', () => {
        it('should return 12 months for Member tier', () => {
            expect(getTierMaxDuration('Member')).toBe(12);
        });
    });

    describe('isEligibleForLoan', () => {
        it('should reject if contribution is below minimum', () => {
            const result = isEligibleForLoan(5000, 10000, 0);
            expect(result.eligible).toBe(false);
            expect(result.reason).toContain('Minimum');
        });

        it('should reject if user has requested amount + active loan exceeding max', () => {
            const result = isEligibleForLoan(15000, 40000, 10000); // 40k+10k = 50k > 3*15k (45k)
            expect(result.eligible).toBe(false);
            expect(result.reason).toContain('exceeds your maximum limit');
        });

        it('should reject if loan exceeds tier multiplier (Member)', () => {
            // Member: 3x multiplier, so max loan for 15k is 45k
            const result = isEligibleForLoan(15000, 50000, 0);
            expect(result.eligible).toBe(false);
            expect(result.reason).toContain('exceeds your maximum limit');
        });

        it('should approve valid Member tier loan', () => {
            const result = isEligibleForLoan(15000, 25000, 0);
            expect(result.eligible).toBe(true);
        });

        it('should approve loan at exact tier limit', () => {
            const result = isEligibleForLoan(20000, 60000, 0); // Exactly 3x
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
            expect(COOPERATIVE_TIERS.Member.minContribution).toBe(10000);
            expect(COOPERATIVE_TIERS.Member.maxLoanMultiplier).toBe(3);
            expect(COOPERATIVE_TIERS.Member.color).toBe('emerald');
        });
    });
});
