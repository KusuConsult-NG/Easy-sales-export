"use client";

import { useEffect, useState } from "react";
import { logger } from '@/lib/logger';
import { useRouter } from "next/navigation";
import {
    TrendingUp, Calendar, DollarSign, Clock, Plus,
    ArrowLeft, AlertCircle, CheckCircle, Calculator, Users
} from "lucide-react";
import Link from "next/link";
import { formatCurrency, parseCurrencyStringToFloat } from "@/lib/utils";
import { COOPERATIVE_CONFIG, CURRENCY_CONFIG } from "@/lib/constants";
import {
    FIXED_SAVINGS_ANNUAL_RATE,
    FIXED_SAVINGS_MIN_AMOUNT,
    FIXED_SAVINGS_MIN_MONTHS,
    FIXED_SAVINGS_MAX_MONTHS,
    formatFixedSavingsRate,
    validateFixedSavingsPlan,
    fixedSavingsPlanStatus,
} from "@/lib/cooperative-savings";
import { withdrawMaturedFixedSavingsAction } from "@/app/actions/cooperative";
import OnboardingGuide from "@/components/onboarding/OnboardingGuide";
import { useToast } from "@/contexts/ToastContext";

type FixedSavingsPlan = {
    id: string;
    amount: number;
    startDate: Date;
    maturityDate: Date;
    durationMonths: number;
    interestRate: number;
    projectedProfit: number;
    status: "active" | "matured" | "withdrawn";
    createdAt: Date;
};

export default function FixedSavingsPage() {
    const router = useRouter();
    const { showToast } = useToast();
    const [plans, setPlans] = useState<FixedSavingsPlan[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showCalculator, setShowCalculator] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [membershipStatus, setMembershipStatus] = useState<"approved" | "pending" | "not_member" | null>(null);

    // Calculator state
    const [amount, setAmount] = useState(String(FIXED_SAVINGS_MIN_AMOUNT));
    const [duration, setDuration] = useState(12);
    // The rate a member is QUOTED must be the rate they are PAID. This was
    // useState(14) — a literal, with the number that actually gets stored on
    // the plan living in the route. Same shape as the loan limit, where the
    // figure shown and the figure enforced differed by six times.
    const [interestRate] = useState(FIXED_SAVINGS_ANNUAL_RATE);

    useEffect(() => {
        checkMembership();
        fetchPlans();
    }, []);

    const checkMembership = async () => {
        try {
            const response = await fetch("/api/cooperative/check-membership");
            const data = await response.json();

            if (data.isMember) {
                setMembershipStatus(data.status);
            } else {
                setMembershipStatus("not_member");
            }
        } catch (error) {
            logger.error("Failed to check membership:", error);
            setMembershipStatus("not_member");
        }
    };

    const fetchPlans = async () => {
        try {
            const response = await fetch("/api/cooperative/fixed-savings");
            const data = await response.json();

            if (data.success) {
                setPlans(data.plans || []);
            }
        } catch (error) {
            logger.error("Failed to fetch plans:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const calculateProfit = (principal: number, months: number, rate: number) => {
        // Simple interest calculation: P * R * T / 100
        // T = months/12 for annual rate
        return (principal * rate * (months / 12)) / 100;
    };

    const amountNum = parseCurrencyStringToFloat(amount) || 0;
    const projectedProfit = calculateProfit(amountNum, duration, interestRate);
    const totalReturn = amountNum + projectedProfit;

    async function handleCreatePlan() {
        const targetAmount = parseCurrencyStringToFloat(amount);
        // Same rule the server applies, from the same module — so the client
        // cannot refuse a plan the server would accept, or accept one the
        // server will refuse with a differently-worded message.
        const validation = validateFixedSavingsPlan(targetAmount, duration);
        if (!validation.valid) {
            showToast(validation.reason!, "error");
            return;
        }

        if (!confirm(`Create a ${duration}-month fixed savings plan of ${formatCurrency(targetAmount)}?`)) {
            return;
        }

        setIsCreating(true);
        try {
            const response = await fetch("/api/cooperative/create-fixed-savings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ amount: targetAmount, durationMonths: duration }),
            });

            const data = await response.json();

            if (data.success) {
                showToast("Fixed savings plan created successfully!", "success");
                setShowCalculator(false);
                fetchPlans();
            } else {
                showToast(data.message || "Failed to create plan", "error");
            }
        } catch (error) {
            showToast("An error occurred while creating the plan", "error");
        } finally {
            setIsCreating(false);
        }
    };

    const getDaysRemaining = (maturityDate: Date) => {
        const now = new Date();
        const maturity = new Date(maturityDate);
        const diffTime = maturity.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    };

    const activePlans = plans.filter(p => p.status === "active");
    /**
     *   #419 The reader derives this now, so the section below can appear at
     *   all. Derived again here as a belt: a plan whose maturity passes while
     *   the page is open becomes withdrawable without a reload.
     */
    const maturedPlans = plans.filter(p => fixedSavingsPlanStatus(p) === "matured");

    const [releasingId, setReleasingId] = useState<string | null>(null);

    const handleWithdraw = async (planId: string) => {
        setReleasingId(planId);
        try {
            const result = await withdrawMaturedFixedSavingsAction(planId);
            if (result?.success) {
                showToast(
                    `Paid out to your savings: ${formatCurrency((result as any).data?.amount ?? 0)}`,
                    "success",
                );
                await fetchPlans();
            } else {
                // #406/#337: the refusal is an ordinary resolved result, not a
                // throw, so it has to be read rather than caught.
                showToast(result?.error || "The payout could not be completed.", "error");
            }
        } catch (err) {
            logger.error("[fixed-savings] withdrawal request failed", err);
            showToast("Could not reach the server. Check your savings before retrying.", "error");
        } finally {
            setReleasingId(null);
        }
    };
    const totalInvested = activePlans.reduce((sum, p) => sum + p.amount, 0);
    const totalProjectedReturns = activePlans.reduce((sum, p) => sum + p.amount + p.projectedProfit, 0);

    // Show onboarding if not a member or pending approval
    if (membershipStatus === "not_member" || membershipStatus === "pending") {
        return (
            <div className="min-h-screen bg-slate-50 py-8">
                <div className="max-w-7xl mx-auto px-4">
                    <Link
                        href="/cooperatives"
                        className="inline-flex items-center gap-2 text-primary hover:underline mb-4"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Cooperatives
                    </Link>

                    <OnboardingGuide
                        title="Fixed Savings Plans"
                        description={`Lock your savings for ${FIXED_SAVINGS_MIN_MONTHS}-${FIXED_SAVINGS_MAX_MONTHS} months and earn guaranteed ${formatFixedSavingsRate()} returns. To access this feature, you must first become an approved cooperative member.`}
                        icon={<TrendingUp className="w-8 h-8 text-white" />}
                        steps={[
                            {
                                title: "Join the Cooperative",
                                description: "Complete your membership registration with all required details including personal information and next of kin.",
                                completed: membershipStatus === "pending",
                                action: membershipStatus === "not_member" ? {
                                    label: "Start Registration",
                                    href: "/cooperatives/onboarding"
                                } : undefined
                            },
                            {
                                title: "Pay Membership Fee",
                                description: `Complete your one-time registration fee (${CURRENCY_CONFIG.symbol}${COOPERATIVE_CONFIG.registrationFee.toLocaleString()}) via Paystack.`,
                                completed: membershipStatus === "pending",
                                action: undefined
                            },
                            {
                                title: "Await Approval",
                                description: "Your application will be reviewed by our admin team. This usually takes 1-2 business days.",
                                completed: false,
                                action: undefined
                            },
                            {
                                title: "Create Fixed Savings Plan",
                                description: "Once approved, you can create fixed savings plans and start earning guaranteed returns.",
                                completed: false,
                                action: undefined
                            }
                        ]}
                        primaryAction={membershipStatus === "not_member" ? {
                            label: "Get Started - Join Cooperative",
                            href: "/cooperatives/onboarding"
                        } : undefined}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8"
                >
                    <Link
                        href="/cooperatives"
                        className="inline-flex items-center gap-2 text-primary hover:underline mb-4"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Cooperatives
                    </Link>
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold text-slate-900 mb-2">
                                Fixed Savings Plans
                            </h1>
                            <p className="text-slate-600">
                                Lock your savings for guaranteed returns at {interestRate}% annual interest
                            </p>
                        </div>
                        <button
                            onClick={() => setShowCalculator(!showCalculator)}
                            className="px-6 py-3 bg-linear-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-bold rounded-xl transition-all shadow-lg flex items-center gap-2"
                        >
                            <Plus className="w-5 h-5" />
                            New Plan
                        </button>
                    </div>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white rounded-2xl p-6 shadow-xl">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                                <DollarSign className="w-5 h-5 text-blue-600" />
                            </div>
                            <p className="text-sm text-slate-600">Total Invested</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900">
                            {formatCurrency(totalInvested)}
                        </p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-xl">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                                <TrendingUp className="w-5 h-5 text-green-600" />
                            </div>
                            <p className="text-sm text-slate-600">Projected Returns</p>
                        </div>
                        <p className="text-3xl font-bold text-green-600">
                            {formatCurrency(totalProjectedReturns)}
                        </p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-xl">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                                <Calendar className="w-5 h-5 text-purple-600" />
                            </div>
                            <p className="text-sm text-slate-600">Active Plans</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900">
                            {activePlans.length}
                        </p>
                    </div>
                </div>

                {/* Calculator/Create Form */}
                {showCalculator && (
                    <div className="bg-linear-to-br from-green-50 to-emerald-50 rounded-2xl p-8 mb-8 border border-green-200 shadow-xl">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-12 h-12 bg-linear-to-br from-green-600 to-emerald-600 rounded-xl flex items-center justify-center">
                                <Calculator className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h2 className="text-2xl font-bold text-slate-900">
                                    Create Fixed Savings Plan
                                </h2>
                                <p className="text-slate-600">
                                    Calculate your returns and create a plan
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* Input Section */}
                            <div className="space-y-6">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Amount to Save
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">₦</span>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            pattern="[0-9.,]*"
                                            value={amount}
                                            onChange={(e) => setAmount(e.target.value)}
                                            className="w-full pl-8 pr-4 py-4 bg-white border border-slate-200 rounded-xl text-slate-900 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-green-500"
                                        />
                                    </div>
                                    <p className="text-xs text-slate-500 mt-1">
                                        Minimum: ₦50,000
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Duration (Months)
                                    </label>
                                    <input
                                        type="range"
                                        value={duration}
                                        onChange={(e) => setDuration(Number(e.target.value))}
                                        min={1}
                                        max={12}
                                        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-green-600"
                                    />
                                    <div className="flex justify-between items-center mt-2">
                                        <span className="text-sm text-slate-500">1 month</span>
                                        <span className="text-2xl font-bold text-green-600">
                                            {duration} {duration === 1 ? "month" : "months"}
                                        </span>
                                        <span className="text-sm text-slate-500">12 months</span>
                                    </div>
                                </div>

                                <div className="bg-white rounded-xl p-4 border border-green-200">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm text-slate-600">Interest Rate</span>
                                        <span className="text-lg font-bold text-green-600">
                                            {interestRate}% p.a.
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Results Section */}
                            <div className="bg-white rounded-2xl p-6 border border-green-200">
                                <h3 className="font-bold text-slate-900 mb-4">
                                    Projected Returns
                                </h3>

                                <div className="space-y-4">
                                    <div className="flex items-center justify-between py-3 border-b border-slate-200">
                                        <span className="text-slate-600">Principal Amount</span>
                                        <span className="font-bold text-slate-900">
                                            {formatCurrency(amount)}
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between py-3 border-b border-slate-200">
                                        <span className="text-slate-600">Interest Earned</span>
                                        <span className="font-bold text-green-600">
                                            +{formatCurrency(projectedProfit)}
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between py-3">
                                        <span className="text-lg font-semibold text-slate-900">
                                            Total at Maturity
                                        </span>
                                        <span className="text-2xl font-bold text-green-600">
                                            {formatCurrency(totalReturn)}
                                        </span>
                                    </div>

                                    <div className="bg-green-50 rounded-xl p-4 mt-4">
                                        <div className="flex items-start gap-2">
                                            <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                                            <div>
                                                <p className="text-sm font-semibold text-green-900 mb-1">
                                                    Maturity Date
                                                </p>
                                                <p className="text-sm text-green-700">
                                                    {new Date(Date.now() + duration * 30 * 24 * 60 * 60 * 1000).toLocaleDateString("en-US", {
                                                        year: "numeric",
                                                        month: "long",
                                                        day: "numeric"
                                                    })}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <button
                                    onClick={handleCreatePlan}
                                    disabled={isCreating || amountNum < FIXED_SAVINGS_MIN_AMOUNT}
                                    className="w-full mt-6 px-6 py-4 bg-linear-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {isCreating ? (
                                        <>
                                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                            Creating Plan...
                                        </>
                                    ) : (
                                        <>
                                            <Plus className="w-5 h-5" />
                                            Create Plan
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Active Plans */}
                {isLoading ? (
                    <div className="bg-white rounded-2xl p-12 text-center shadow-xl">
                        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                        <p className="text-slate-600">Loading plans...</p>
                    </div>
                ) : (
                    <>
                        {/* Active Plans Section */}
                        {activePlans.length > 0 && (
                            <div className="mb-8">
                                <h2 className="text-2xl font-bold text-slate-900 mb-4">
                                    Active Plans
                                </h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {activePlans.map((plan) => {
                                        const daysRemaining = getDaysRemaining(plan.maturityDate);
                                        const progress = ((plan.durationMonths * 30 - daysRemaining) / (plan.durationMonths * 30)) * 100;

                                        return (
                                            <div
                                                key={plan.id}
                                                className="bg-white rounded-2xl p-6 shadow-xl border border-green-200"
                                            >
                                                <div className="flex items-start justify-between mb-4">
                                                    <div>
                                                        <p className="text-sm text-slate-600 mb-1">
                                                            Principal Amount
                                                        </p>
                                                        <p className="text-2xl font-bold text-slate-900">
                                                            {formatCurrency(plan.amount)}
                                                        </p>
                                                    </div>
                                                    <div className="px-3 py-1 bg-green-100 rounded-full">
                                                        <span className="text-xs font-bold text-green-700">
                                                            Active
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-2 gap-4 mb-4">
                                                    <div>
                                                        <p className="text-xs text-slate-500 mb-1">
                                                            Interest Rate
                                                        </p>
                                                        <p className="font-semibold text-green-600">
                                                            {plan.interestRate}% p.a.
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <p className="text-xs text-slate-500 mb-1">
                                                            Projected Profit
                                                        </p>
                                                        <p className="font-semibold text-green-600">
                                                            +{formatCurrency(plan.projectedProfit)}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="bg-slate-50 rounded-xl p-4 mb-4">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <Clock className="w-4 h-4 text-slate-500" />
                                                        <span className="text-sm font-semibold text-slate-900">
                                                            {daysRemaining > 0 ? `${daysRemaining} days remaining` : "Matured"}
                                                        </span>
                                                    </div>
                                                    <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-linear-to-r from-green-600 to-emerald-600 transition-all"
                                                            style={{ width: `${Math.min(progress, 100)}%` }}
                                                        />
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between text-sm">
                                                    <div>
                                                        <p className="text-slate-500">Start Date</p>
                                                        <p className="font-semibold text-slate-900">
                                                            {new Date(plan.startDate).toLocaleDateString()}
                                                        </p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-slate-500">Maturity Date</p>
                                                        <p className="font-semibold text-slate-900">
                                                            {new Date(plan.maturityDate).toLocaleDateString()}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="mt-4 pt-4 border-t border-slate-200">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-sm text-slate-600">
                                                            Total at Maturity
                                                        </span>
                                                        <span className="text-xl font-bold text-green-600">
                                                            {formatCurrency(plan.amount + plan.projectedProfit)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Matured Plans Section */}
                        {maturedPlans.length > 0 && (
                            <div>
                                <h2 className="text-2xl font-bold text-slate-900 mb-4">
                                    Matured Plans
                                </h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {maturedPlans.map((plan) => (
                                        <div
                                            key={plan.id}
                                            className="bg-white rounded-2xl p-6 shadow-xl border border-slate-200 opacity-75"
                                        >
                                            <div className="flex items-start justify-between mb-4">
                                                <div>
                                                    <p className="text-sm text-slate-600 mb-1">
                                                        Final Amount
                                                    </p>
                                                    <p className="text-2xl font-bold text-slate-900">
                                                        {formatCurrency(plan.amount + plan.projectedProfit)}
                                                    </p>
                                                </div>
                                                <div className="px-3 py-1 bg-slate-100 rounded-full">
                                                    <span className="text-xs font-bold text-slate-900">
                                                        Matured
                                                    </span>
                                                </div>
                                            </div>
                                            <p className="text-sm text-slate-500">
                                                Matured on {new Date(plan.maturityDate).toLocaleDateString()}
                                            </p>
                                            {/* #419 — the release. Before this there was no way, anywhere,
                                                to get a matured plan's money back into savings. */}
                                            <button
                                                type="button"
                                                onClick={() => handleWithdraw(plan.id)}
                                                disabled={releasingId === plan.id}
                                                className="mt-4 w-full px-4 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition"
                                            >
                                                {releasingId === plan.id
                                                    ? "Paying out…"
                                                    : `Withdraw ${formatCurrency(plan.amount + plan.projectedProfit)} to savings`}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Empty State */}
                        {plans.length === 0 && (
                            <div className="bg-white rounded-2xl p-12 text-center shadow-xl">
                                <TrendingUp className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                                <h3 className="text-xl font-bold text-slate-900 mb-2">
                                    No Fixed Savings Plans Yet
                                </h3>
                                <p className="text-slate-600 mb-6">
                                    Create your first fixed savings plan to start earning guaranteed returns
                                </p>
                                <button
                                    onClick={() => setShowCalculator(true)}
                                    className="px-8 py-3 bg-linear-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-bold rounded-xl transition-all shadow-lg inline-flex items-center gap-2"
                                >
                                    <Plus className="w-5 h-5" />
                                    Create Your First Plan
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
