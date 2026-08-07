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

/**
 * INTEREST RATE CONVENTION — read before changing anything here.
 *
 * `interestRate` is a MONTHLY percentage everywhere in this codebase.
 * 10 means 10% per month.
 *
 * It used to hold `10/12` (0.833% monthly, i.e. 10% per year) while every
 * screen labelled it "APR". The stated rate is 10% per month, so the value is
 * now 10 and the labels read "per month".
 *
 * Existing loan records are deliberately NOT migrated. They store 0.8333 and
 * are still read as a monthly rate, so borrowers who applied earlier keep the
 * terms they applied under. Only new loans are written at the current rate.
 *
 * Rates above 6 months are negotiable. Negotiated terms are expressed by
 * creating a loan product with its own `interestRate` (also monthly) via the
 * admin loan-products screen; that product rate takes precedence over the
 * default below.
 */
export const DEFAULT_MONTHLY_INTEREST_RATE = 10;

export const COOPERATIVE_TIERS: Record<CooperativeTier, TierRequirements> = {
    Member: {
        name: "Member",
        // A member may borrow up to half their savings, i.e. savings must be at
        // least twice the loan. Previously 3 — a member could borrow three
        // times their savings, six times more than intended.
        minContribution: 5000,
        maxLoanMultiplier: 0.5,
        benefits: [
            "Access to cooperative loans",
            "Borrow up to half your total savings",
            "Interest rate: 10% per month",
            "12-month maximum repayment period",
            "Rates negotiable on terms over 6 months",
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

    // A zero rate makes the annuity formula divide by zero and yields NaN for
    // every instalment. Fall back to equal principal repayments.
    const monthlyPayment = r === 0
        ? loanAmount / n
        : (loanAmount * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1);


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
/**
 * Default MONTHLY interest rate, as a percentage. 10 means 10% per month.
 * Previously returned 10/12, which is 10% per year.
 */
export function getTierInterestRate(tier: CooperativeTier): number {
    return DEFAULT_MONTHLY_INTEREST_RATE;
}

/**
 * Get tier max duration
 */
export function getTierMaxDuration(tier: CooperativeTier): number {
    return 12;
}
