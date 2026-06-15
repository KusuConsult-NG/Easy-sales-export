/**
 * Cooperative Tier System
 * - Member
 */

export type CooperativeTier = "Member";

export interface TierRequirements {
    name: CooperativeTier;
    minContribution: number;
    maxLoanMultiplier: number;
    benefits: string[];
    color: string;
}

export const COOPERATIVE_TIERS: Record<CooperativeTier, TierRequirements> = {
    Member: {
        name: "Member",
        minContribution: 5000,
        maxLoanMultiplier: 3,
        benefits: [
            "Access to cooperative loans",
            "3x contribution loan limit",
            "Monthly interest rate: 0.83% (10% APR)",
            "12-month maximum repayment period",
            "Priority loan processing",
            "Group savings benefits",
        ],
        color: "emerald",
    },
};

/**
 * Calculate user tier based on total contribution
 */
export function calculateUserTier(totalContribution: number): CooperativeTier {
    return "Member";
}

/**
 * Get maximum loan amount for user
 */
export function getMaxLoanAmount(totalContribution: number): number {
    const tier = calculateUserTier(totalContribution);
    return totalContribution * COOPERATIVE_TIERS[tier].maxLoanMultiplier;
}

/**
 * Check if user is eligible for loan
 */
export function isEligibleForLoan(
    totalContribution: number,
    requestedAmount: number,
    currentLoanBalance: number = 0
): { eligible: boolean; reason?: string } {
    if (totalContribution < COOPERATIVE_TIERS.Member.minContribution) {
        return {
            eligible: false,
            reason: `Minimum contribution of ₦${COOPERATIVE_TIERS.Member.minContribution.toLocaleString()} required`,
        };
    }

    const maxLoan = getMaxLoanAmount(totalContribution);
    if ((requestedAmount + currentLoanBalance) > maxLoan) {
        return {
            eligible: false,
            reason: `Requested amount plus current loan balance exceeds your maximum limit of ₦${maxLoan.toLocaleString()}`,
        };
    }

    return { eligible: true };
}

/**
 * Calculate loan repayment schedule
 */
export interface RepaymentInstallment {
    installmentNumber: number;
    dueDate: Date;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    isPaid: boolean;
}

export function calculateRepaymentSchedule(
    loanAmount: number,
    monthlyInterestRate: number,
    durationMonths: number,
    startDate: Date = new Date()
): RepaymentInstallment[] {
    const schedule: RepaymentInstallment[] = [];
    const r = monthlyInterestRate / 100;
    const n = durationMonths;
    const monthlyPayment = (loanAmount * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1);
    
    let remainingPrincipal = loanAmount;

    for (let i = 1; i <= durationMonths; i++) {
        const dueDate = new Date(startDate);
        dueDate.setMonth(dueDate.getMonth() + i);

        const interestAmount = remainingPrincipal * r;
        let principalAmount = monthlyPayment - interestAmount;
        
        // Handle rounding differences on final payment
        if (i === durationMonths) {
            principalAmount = remainingPrincipal;
        }

        const totalAmount = principalAmount + interestAmount;
        remainingPrincipal -= principalAmount;

        schedule.push({
            installmentNumber: i,
            dueDate,
            principalAmount,
            interestAmount,
            totalAmount,
            isPaid: false,
        });
    }

    return schedule;
}

/**
 * Calculate total loan cost
 */
export function calculateLoanCost(
    loanAmount: number,
    monthlyInterestRate: number,
    durationMonths: number
): {
    principal: number;
    totalInterest: number;
    totalRepayment: number;
    monthlyPayment: number;
} {
    const schedule = calculateRepaymentSchedule(loanAmount, monthlyInterestRate, durationMonths);
    const totalInterest = schedule.reduce((sum, inst) => sum + inst.interestAmount, 0);
    const totalRepayment = loanAmount + totalInterest;
    const monthlyPayment = totalRepayment / durationMonths;

    return {
        principal: loanAmount,
        totalInterest,
        totalRepayment,
        monthlyPayment,
    };
}

/**
 * Get tier interest rate
 */
export function getTierInterestRate(tier: CooperativeTier): number {
    return 10 / 12;
}

/**
 * Get tier max duration
 */
export function getTierMaxDuration(tier: CooperativeTier): number {
    return 12;
}
