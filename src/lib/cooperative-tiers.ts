/**
 * Cooperative Tier System
 * - Member
 */

import { installmentDueDate } from "@/lib/loan-schedule-dates";
import { numberOrZero } from "@/lib/numbers";

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
    /*
     *   #744 A NON-FINITE CONTRIBUTION MAKES THIS NaN, AND EVERY CAP BUILT ON
     *   IT THEN ADMITS EVERY AMOUNT — `requested > NaN` is FALSE, in both
     *   directions, so the comparison fails OPEN rather than refusing.
     *
     *   The parameter is typed `number`, and a TypeScript annotation is not a
     *   runtime check on a value read out of JSON: the caller in
     *   _loans_decisions was handing it `appData.contributionAmount`, declared
     *   optional on the stored shape and never written by one of the two
     *   application paths.
     *
     *   Guarded here as well as at that call site, because this is the function
     *   the whole tier rule is expressed in — a third caller reading a stored
     *   field is the next instance, and it should be refused rather than
     *   admitted. numberOrZero turns the unreadable case into a cap of zero,
     *   which refuses; that is the direction a limit must fail in.
     */
    const contribution = numberOrZero(totalContribution);
    const tier = calculateUserTier(contribution);
    return contribution * COOPERATIVE_TIERS[tier].maxLoanMultiplier;
}

/**
 * Check if user is eligible for loan
 */
export function isEligibleForLoan(
    totalContribution: number,
    requestedAmount: number,
    currentLoanBalance: number = 0
): { eligible: boolean; reason?: string } {
    /*
     *   #744 — the same NaN trap twice over in this function. The floor below
     *   is `contribution < minimum`, FALSE for NaN, so an unreadable
     *   contribution cleared the minimum; and the ceiling after it is
     *   `requested > maxLoan`, also FALSE. Two refusals, both skipped, on one
     *   unreadable number.
     *
     *   THE TWO SIDES NEED OPPOSITE TREATMENTS, and getting that backwards is
     *   its own way to fail open. What the member HAS falls back to zero, which
     *   refuses. What the member ASKS FOR must not: numberOrZero on the
     *   requested amount turns an unreadable request into 0, and `0 > maxLoan`
     *   is false — the guard would be reinstated facing the wrong way. So an
     *   unreadable request, or an unreadable outstanding balance, is refused
     *   outright.
     */
    const contribution = numberOrZero(totalContribution);

    if (!Number.isFinite(requestedAmount) || !Number.isFinite(currentLoanBalance)) {
        return { eligible: false, reason: "The loan amount could not be read. Please try again." };
    }
    const requested = requestedAmount;
    const outstanding = currentLoanBalance;

    /*
     *   #745 AND THE AMOUNT HAD A CEILING AND NO FLOOR. Every rule on a loan
     *   amount was written as "not more than" — `requested > maxLoan` here, and
     *   `formData.amount > maxLoanAmount` in the member action — so zero and
     *   NEGATIVE amounts passed every one of them. A negative amount is not a
     *   small loan; it inverts the arithmetic that follows it.
     *
     *   Placed here rather than at the two call sites because this function is
     *   already the platform's stated single home for the rule — the apply-loan
     *   route says so in its own words: "isEligibleForLoan is the single place
     *   the rule is expressed, so a future change to it reaches every path at
     *   once".
     */
    if (requested <= 0) {
        return { eligible: false, reason: "The loan amount must be greater than zero." };
    }
    if (outstanding < 0) {
        return { eligible: false, reason: "The recorded loan balance is invalid." };
    }

    if (contribution < COOPERATIVE_TIERS.Member.minContribution) {
        return {
            eligible: false,
            reason: `Minimum contribution of ₦${COOPERATIVE_TIERS.Member.minContribution.toLocaleString()} required`,
        };
    }

    const maxLoan = getMaxLoanAmount(contribution);
    if ((requested + outstanding) > maxLoan) {
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
        // The same rule the persisted schedule uses, called rather than
        // restated — see lib/loan-schedule-dates. calculateLoanCost, this
        // function's only caller, discards these dates and keeps the interest,
        // so the defect was latent here; a second statement of the rule is
        // exactly how a fix reaches one site and not the other.
        const dueDate = installmentDueDate(startDate, i);

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
 *
 * ── READ THIS BEFORE WIRING calculateLoanCost TO A SCREEN ───────────────────
 *
 *   THIS RATE IGNORES THE LOAN PRODUCT, and that is safe only while nothing
 *   renders the one component that uses it.
 *
 *   Every path that actually CREATES a cooperative loan — _coop_money.ts,
 *   api/cooperative/apply-loan and the member page — reads `interestRate` off
 *   the LOAN_PRODUCTS row and passes it to calculateRepaymentTerms. A prior
 *   finding put them on one function for exactly this reason, and recorded it:
 *   "Same function now, so a rate change or a fix cannot reach only one of
 *   them." Before that, a borrower was quoted their product's terms and the
 *   loan was written at a hardcoded default.
 *
 *   calculateLoanCost is the remaining exception. Its only caller is
 *   components/LoanApplicationWizard.tsx, which is imported by NOTHING, so no
 *   member sees a figure from it today. Rendering that component would quote
 *   every product at DEFAULT_MONTHLY_INTEREST_RATE while the server records the
 *   loan at the product's own rate — a member told one monthly payment and
 *   charged another, which is the defect that was already fixed once.
 *
 *   THE ARITHMETIC ITSELF AGREES, measured rather than assumed: over
 *   (₦100,000, 10%, 6mo), (₦250,000, 5%, 12mo), (₦50,000, 2.5%, 3mo) and
 *   (₦19,999, 7.5%, 9mo), calculateLoanCost and calculateRepaymentTerms return
 *   the same monthly payment to within a fraction of a kobo. The float-versus-
 *   integer difference is not the hazard here. THE RATE IS.
 *
 *   So if that wizard is ever brought back: take the rate from the product and
 *   quote through calculateRepaymentTerms, as the three live paths do.
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

/**
 * Why this repayment duration cannot be used, or null when it can.
 *
 *   #745 THE DURATION HAD A CEILING AND NO FLOOR EITHER, AND THE FLOOR IS THE
 *        ONE THAT COSTS MONEY.
 *
 *   The member loan action checked `formData.durationMonths > maxDuration` and
 *   nothing else, on a value that arrives from the browser — the same untrusted
 *   input #345 found the savings figure coming from, on the neighbouring field
 *   of the same request. Everything below the ceiling passed:
 *
 *       durationMonths   clears cap   interest   monthlyPayment
 *       null             yes          0          Infinity
 *       0                yes          0          Infinity
 *       -5               yes          0          -10,000
 *       "abc"            yes          0          NaN
 *
 *   The amortisation loop is `for (let i = 1; i <= n; i++)`, so any n below 1
 *   runs ZERO iterations and accrues no interest at all. The application is
 *   then filed with `totalRepayment` equal to the principal — an interest-free
 *   loan, in the queue an admin approves from, and nothing on the row says it
 *   was not a legitimate quote.
 *
 *   The sibling route already had this rule, on the product's own field:
 *   `!Number.isInteger(product.durationMonths) || product.durationMonths < 1`.
 *   One path guarded and one did not, which is this audit's most common shape,
 *   so the rule is stated once here and both read it.
 *
 *   TAKES `unknown` DELIBERATELY. The action declares `durationMonths: number`
 *   on its parameter interface and performs no runtime validation, and a
 *   TypeScript annotation is not a check on a value that arrived as JSON — that
 *   assumption is the whole defect.
 */
export function loanDurationProblem(durationMonths: unknown, maxDuration: number): string | null {
    if (typeof durationMonths !== "number" || !Number.isInteger(durationMonths)) {
        return "Repayment duration must be a whole number of months.";
    }
    if (durationMonths < 1) {
        return "Repayment duration must be at least one month.";
    }
    if (durationMonths > maxDuration) {
        return `Repayment duration exceeds the tier limit. Maximum: ${maxDuration} months`;
    }
    return null;
}

/**
 *   #809 THREE WRITERS, THREE VOCABULARIES, ONE FIELD DECLARED AS ONE VALUE.
 *
 *        `membershipTier` is typed `"Member"` in types/index.ts and on the
 *        admin members screen. Three paths write it and only one of them
 *        writes that:
 *
 *          payments/service.ts       `normalisedTier = "Member"`        ✓
 *          _dashboard / _coop_identity
 *            (heal a membership       `paymentData.tier || "Member"` —
 *             from its payment)        the PAYMENT's tier, which is the
 *                                      retired fee band `tier1`          ✗
 *          _coop_identity
 *            (synthesise an ID card)  `userPlan` with its first letter
 *                                      capitalised — "Premium", "Tier1"  ✗
 *
 *        THE FEE BAND IS NOT THE MEMBERSHIP TIER. `tier1`/`tier2` was a
 *        two-band registration fee, 10,000 and 20,000 naira. There is one fee
 *        now — flat 10,000, COOPERATIVE_CONFIG.registrationFee — so `tier2`
 *        denotes a price nobody is charged, and neither name denotes a
 *        membership tier at all.
 *
 *        WHAT IT COSTS. The admin members screen renders the value, so a
 *        healed membership reads "tier1" where every other member reads
 *        "Member". Worse, _cooperative_memberships takes it as `knownTier`,
 *        and the repair screen then writes that string onto a real membership
 *        record — the retired vocabulary propagating out of a heal path into
 *        the thing it heals.
 *
 *        Nothing crashes: getMaxLoanAmount derives the tier from the
 *        contribution rather than reading this field, and getTierInterestRate
 *        and getTierMaxDuration ignore their argument entirely. That is why it
 *        went unnoticed, and it is not a reason to leave it.
 */

/** The tier a membership gets when nothing better is known. */
export const DEFAULT_COOPERATIVE_TIER: CooperativeTier =
    (Object.keys(COOPERATIVE_TIERS) as CooperativeTier[])[0];

/**
 * Whatever was stored, as a tier this cooperative actually has.
 *
 * Case-insensitive because the writers above disagree on capitalisation too,
 * and anything unrecognised — `tier1`, `premium`, an empty string, a number —
 * becomes the default rather than being passed through. Passing it through is
 * precisely how a fee band came to be stored as a membership tier.
 */
export function normaliseMembershipTier(
    value: unknown,
    //   A PARAMETER FOR THE SAME REASON `isApply(argv = process.argv)` TAKES
    //   ONE — so the rule can be exercised without reaching around it.
    //
    //   This cooperative has exactly ONE tier today, which makes "look the name
    //   up" and "always answer the default" the same function: every mutant of
    //   the lookup survives, because both answer "Member" to everything. The
    //   lookup is still what is wanted — the day a second tier is added, a
    //   stored "Member" must not silently become whatever sorts first — so the
    //   seam exists to keep that claim measurable rather than aspirational.
    tiers: readonly string[] = Object.keys(COOPERATIVE_TIERS),
): CooperativeTier {
    const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
    const fallback = (tiers[0] ?? DEFAULT_COOPERATIVE_TIER) as CooperativeTier;
    if (!raw) return fallback;

    for (const key of tiers) {
        if (key.toLowerCase() === raw) return key as CooperativeTier;
    }
    return fallback;
}
