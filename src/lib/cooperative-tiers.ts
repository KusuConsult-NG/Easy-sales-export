/**
 * Cooperative Tier System
 * - Basic: ₦10,000 contribution
 * - Premium: ₦20,000 contribution
 */

export type CooperativeTier = "Basic" | "Premium";

export interface TierRequirements {
    name: CooperativeTier;
    minContribution: number;
    maxLoanMultiplier: number;
    benefits: string[];
    color: string;
}

export const COOPERATIVE_TIERS: Record<CooperativeTier, TierRequirements> = {
    Basic: {
        name: "Basic",
        minContribution: 10000,
        maxLoanMultiplier: 2,
        benefits: [
            "Access to cooperative loans",
            "2x contribution loan limit",
            "Monthly interest rate: 2.5%",
            "6-month maximum repayment period",
            "Group savings benefits",
        ],
        color: "blue",
    },
    Premium: {
        name: "Premium",
        minContribution: 20000,
        maxLoanMultiplier: 3,
        benefits: [
            "Access to cooperative loans",
            "3x contribution loan limit",
            "Monthly interest rate: 2%",
            "12-month maximum repayment period",
            "Priority loan processing",
            "Export aggregation priority slots",
            "Group savings benefits",
        ],
        color: "emerald",
    },
};

/**
 * Calculate user tier based on total contribution
 */
export function calculateUserTier(totalContribution: number): CooperativeTier {
    if (totalContribution >= COOPERATIVE_TIERS.Premium.minContribution) {
        return "Premium";
    }
    return "Basic";
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
    hasActiveLoan: boolean
): { eligible: boolean; reason?: string } {
    if (hasActiveLoan) {
        return { eligible: false, reason: "You have an active loan. Please repay before applying again." };
    }

    if (totalContribution < COOPERATIVE_TIERS.Basic.minContribution) {
        return {
            eligible: false,
            reason: `Minimum contribution of ₦${COOPERATIVE_TIERS.Basic.minContribution.toLocaleString()} required`,
        };
    }

    const maxLoan = getMaxLoanAmount(totalContribution);
    if (requestedAmount > maxLoan) {
        return {
            eligible: false,
            reason: `Maximum loan amount for your tier is ₦${maxLoan.toLocaleString()}`,
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
    const monthlyPayment = loanAmount / durationMonths;

    for (let i = 1; i <= durationMonths; i++) {
        const dueDate = new Date(startDate);
        dueDate.setMonth(dueDate.getMonth() + i);

        const interestAmount = loanAmount * (monthlyInterestRate / 100);
        const principalAmount = monthlyPayment;
        const totalAmount = principalAmount + interestAmount;

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
    return tier === "Premium" ? 2.0 : 2.5;
}

/**
 * Get tier max duration
 */
export function getTierMaxDuration(tier: CooperativeTier): number {
    return tier === "Premium" ? 12 : 6;
}
