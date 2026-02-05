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
        it('should return Basic tier for contributions under 20,000', () => {
            expect(calculateUserTier(0)).toBe('Basic');
            expect(calculateUserTier(15000)).toBe('Basic');
            expect(calculateUserTier(19999)).toBe('Basic');
        });

        it('should return Premium tier for contributions 20,000 and above', () => {
            expect(calculateUserTier(20000)).toBe('Premium');
            expect(calculateUserTier(50000)).toBe('Premium');
            expect(calculateUserTier(100000)).toBe('Premium');
        });

        it('should handle edge cases', () => {
            expect(calculateUserTier(19999.99)).toBe('Basic');
            expect(calculateUserTier(20000.01)).toBe('Premium');
        });

        it('should handle negative values as Basic', () => {
            expect(calculateUserTier(-1000)).toBe('Basic');
        });
    });

    describe('getTierInterestRate', () => {
        it('should return 2.5% monthly rate for Basic tier', () => {
            const rate = getTierInterestRate('Basic');
            expect(rate).toBe(2.5);
        });

        it('should return 2%monthly rate for Premium tier', () => {
            const rate = getTierInterestRate('Premium');
            expect(rate).toBe(2.0);
        });
    });

    describe('getTierMaxDuration', () => {
        it('should return 6 months for Basic tier', () => {
            expect(getTierMaxDuration('Basic')).toBe(6);
        });

        it('should return 12 months for Premium tier', () => {
            expect(getTierMaxDuration('Premium')).toBe(12);
        });
    });

    describe('isEligibleForLoan', () => {
        it('should reject if contribution is below minimum', () => {
            const result = isEligibleForLoan(5000, 10000, false);
            expect(result.eligible).toBe(false);
            expect(result.reason).toContain('Minimum');
        });

        it('should reject if user has active loan', () => {
            const result = isEligibleForLoan(50000, 100000, true);
            expect(result.eligible).toBe(false);
            expect(result.reason).toContain('active loan');
        });

        it('should reject if loan exceeds tier multiplier (Basic)', () => {
            // Basic: 2x multiplier, so max loan for 15k is 30k
            const result = isEligibleForLoan(15000, 40000, false);
            expect(result.eligible).toBe(false);
            expect(result.reason).toContain('Maximum');
        });

        it('should approve valid Basic tier loan', () => {
            const result = isEligibleForLoan(15000, 25000, false);
            expect(result.eligible).toBe(true);
        });

        it('should approve valid Premium tier loan', () => {
            // Premium: 3x multiplier
            const result = isEligibleForLoan(50000, 120000, false);
            expect(result.eligible).toBe(true);
        });

        it('should approve loan at exact tier limit', () => {
            const result = isEligibleForLoan(20000, 40000, false); // Exactly 2x
            expect(result.eligible).toBe(true);
        });
    });

    describe('calculateRepaymentSchedule', () => {
        it('should calculate correct schedule for 3-month loan', () => {
            const schedule = calculateRepaymentSchedule(30000, 2.5, 3);

            expect(schedule).toHaveLength(3);
            expect(schedule[0].installmentNumber).toBe(1);
            expect(schedule[1].installmentNumber).toBe(2);
            expect(schedule[2].installmentNumber).toBe(3);
        });

        it('should calculate principal and interest correctly', () => {
            const principal = 12000;
            const rate = 2.5; // 2.5% monthly
            const months = 12;

            const schedule = calculateRepaymentSchedule(principal, rate, months);

            const totalPrincipal = schedule.reduce((sum, inst) => sum + inst.principalAmount, 0);
            const totalInterest = schedule.reduce((sum, inst) => sum + inst.interestAmount, 0);

            expect(totalPrincipal).toBeCloseTo(principal, 0);
            expect(totalInterest).toBeGreaterThan(0);
        });

        it('should have equal installment amounts (simple interest)', () => {
            const schedule = calculateRepaymentSchedule(24000, 2.5, 6);

            const payments = schedule.map(inst => inst.totalAmount);
            const firstPayment = payments[0];

            // All payments should be equal (simple interest model)
            payments.forEach(payment => {
                expect(payment).toBeCloseTo(firstPayment, 1);
            });
        });

        it('should handle 1-month loan', () => {
            const schedule = calculateRepaymentSchedule(10000, 2.5, 1);

            expect(schedule).toHaveLength(1);
            expect(schedule[0].principalAmount).toBeCloseTo(10000, 0);
        });

        it('should calculate higher interest for longer duration', () => {
            const short = calculateRepaymentSchedule(50000, 2.5, 3);
            const long = calculateRepaymentSchedule(50000, 2.5, 12);

            const shortInterest = short.reduce((sum, inst) => sum + inst.interestAmount, 0);
            const longInterest = long.reduce((sum, inst) => sum + inst.interestAmount, 0);

            expect(longInterest).toBeGreaterThan(shortInterest);
        });

        it('should have consistent interest per installment (simple interest)', () => {
            const schedule = calculateRepaymentSchedule(60000, 2.5, 12);

            // In simple interest model, interest is the same for all installments
            expect(schedule[0].interestAmount).toBe(schedule[11].interestAmount);
        });
    });

    describe('COOPERATIVE_TIERS constant', () => {
        it('should have correct Basic tier configuration', () => {
            expect(COOPERATIVE_TIERS.Basic.name).toBe('Basic');
            expect(COOPERATIVE_TIERS.Basic.minContribution).toBe(10000);
            expect(COOPERATIVE_TIERS.Basic.maxLoanMultiplier).toBe(2);
            expect(COOPERATIVE_TIERS.Basic.color).toBe('blue');
        });

        it('should have correct Premium tier configuration', () => {
            expect(COOPERATIVE_TIERS.Premium.name).toBe('Premium');
            expect(COOPERATIVE_TIERS.Premium.minContribution).toBe(20000);
            expect(COOPERATIVE_TIERS.Premium.maxLoanMultiplier).toBe(3);
            expect(COOPERATIVE_TIERS.Premium.color).toBe('emerald');
        });
    });
});
