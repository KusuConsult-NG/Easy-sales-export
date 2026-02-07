"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
    TrendingUp, Calendar, DollarSign, Clock, Plus,
    ArrowLeft, AlertCircle, CheckCircle, Calculator, Users
} from "lucide-react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import OnboardingGuide from "@/components/onboarding/OnboardingGuide";

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
    const [plans, setPlans] = useState<FixedSavingsPlan[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showCalculator, setShowCalculator] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [membershipStatus, setMembershipStatus] = useState<"approved" | "pending" | "not_member" | null>(null);

    // Calculator state
    const [amount, setAmount] = useState(50000);
    const [duration, setDuration] = useState(12);
    const [interestRate] = useState(10); // 10% annual interest for fixed savings

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
            console.error("Failed to check membership:", error);
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
            console.error("Failed to fetch plans:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const calculateProfit = (principal: number, months: number, rate: number) => {
        // Simple interest calculation: P * R * T / 100
        // T = months/12 for annual rate
        return (principal * rate * (months / 12)) / 100;
    };

    const projectedProfit = calculateProfit(amount, duration, interestRate);
    const totalReturn = amount + projectedProfit;

    const handleCreatePlan = async () => {
        if (amount < 50000) {
            alert("Minimum amount is ₦50,000");
            return;
        }

        if (duration < 1 || duration > 12) {
            alert("Duration must be between 1 and 12 months");
            return;
        }

        if (!confirm(`Create a ${duration}-month fixed savings plan of ${formatCurrency(amount)}?`)) {
            return;
        }

        setIsCreating(true);
        try {
            const response = await fetch("/api/cooperative/create-fixed-savings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ amount, durationMonths: duration }),
            });

            const data = await response.json();

            if (data.success) {
                alert("Fixed savings plan created successfully!");
                setShowCalculator(false);
                fetchPlans();
            } else {
                alert(data.message || "Failed to create plan");
            }
        } catch (error) {
            alert("An error occurred while creating the plan");
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
    const maturedPlans = plans.filter(p => p.status === "matured");
    const totalInvested = activePlans.reduce((sum, p) => sum + p.amount, 0);
    const totalProjectedReturns = activePlans.reduce((sum, p) => sum + p.amount + p.projectedProfit, 0);

    // Show onboarding if not a member or pending approval
    if (membershipStatus === "not_member" || membershipStatus === "pending") {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8">
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
                        description="Lock your savings for 1-12 months and earn guaranteed 10% annual returns. To access this feature, you must first become an approved cooperative member."
                        icon={<TrendingUp className="w-8 h-8 text-white" />}
                        steps={[
                            {
                                title: "Join the Cooperative",
                                description: "Complete your membership registration with all required details including personal information and next of kin.",
                                completed: membershipStatus === "pending",
                                action: membershipStatus === "not_member" ? {
                                    label: "Start Registration",
                                    href: "/cooperatives/register"
                                } : undefined
                            },
                            {
                                title: "Pay Membership Fee",
                                description: "Choose your membership tier (Basic ₦10,000 or Premium ₦20,000) and complete payment via Paystack.",
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
                            href: "/cooperatives/register"
                        } : undefined}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8">
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
                            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                                Fixed Savings Plans
                            </h1>
                            <p className="text-slate-600 dark:text-slate-400">
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
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-xl">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                                <DollarSign className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Total Invested</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white">
                            {formatCurrency(totalInvested)}
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-xl">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                                <TrendingUp className="w-5 h-5 text-green-600 dark:text-green-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Projected Returns</p>
                        </div>
                        <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                            {formatCurrency(totalProjectedReturns)}
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-xl">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
                                <Calendar className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Active Plans</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white">
                            {activePlans.length}
                        </p>
                    </div>
                </div>

                {/* Calculator/Create Form */}
                {showCalculator && (
                    <div className="bg-linear-to-br from-green-50 to-emerald-50 dark:from-slate-800 dark:to-slate-900 rounded-2xl p-8 mb-8 border border-green-200 dark:border-slate-700 shadow-xl">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-12 h-12 bg-linear-to-br from-green-600 to-emerald-600 rounded-xl flex items-center justify-center">
                                <Calculator className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                    Create Fixed Savings Plan
                                </h2>
                                <p className="text-slate-600 dark:text-slate-400">
                                    Calculate your returns and create a plan
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* Input Section */}
                            <div className="space-y-6">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Amount to Save
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">₦</span>
                                        <input
                                            type="number"
                                            value={amount}
                                            onChange={(e) => setAmount(Number(e.target.value))}
                                            min={50000}
                                            step={10000}
                                            className="w-full pl-8 pr-4 py-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white text-lg font-bold focus:outline-none focus:ring-2 focus:ring-green-500"
                                        />
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                        Minimum: ₦50,000
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Duration (Months)
                                    </label>
                                    <input
                                        type="range"
                                        value={duration}
                                        onChange={(e) => setDuration(Number(e.target.value))}
                                        min={1}
                                        max={12}
                                        className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-green-600"
                                    />
                                    <div className="flex justify-between items-center mt-2">
                                        <span className="text-sm text-slate-500 dark:text-slate-400">1 month</span>
                                        <span className="text-2xl font-bold text-green-600 dark:text-green-400">
                                            {duration} {duration === 1 ? "month" : "months"}
                                        </span>
                                        <span className="text-sm text-slate-500 dark:text-slate-400">12 months</span>
                                    </div>
                                </div>

                                <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-green-200 dark:border-slate-700">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm text-slate-600 dark:text-slate-400">Interest Rate</span>
                                        <span className="text-lg font-bold text-green-600 dark:text-green-400">
                                            {interestRate}% p.a.
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Results Section */}
                            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-green-200 dark:border-slate-700">
                                <h3 className="font-bold text-slate-900 dark:text-white mb-4">
                                    Projected Returns
                                </h3>

                                <div className="space-y-4">
                                    <div className="flex items-center justify-between py-3 border-b border-slate-200 dark:border-slate-700">
                                        <span className="text-slate-600 dark:text-slate-400">Principal Amount</span>
                                        <span className="font-bold text-slate-900 dark:text-white">
                                            {formatCurrency(amount)}
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between py-3 border-b border-slate-200 dark:border-slate-700">
                                        <span className="text-slate-600 dark:text-slate-400">Interest Earned</span>
                                        <span className="font-bold text-green-600 dark:text-green-400">
                                            +{formatCurrency(projectedProfit)}
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between py-3">
                                        <span className="text-lg font-semibold text-slate-900 dark:text-white">
                                            Total at Maturity
                                        </span>
                                        <span className="text-2xl font-bold text-green-600 dark:text-green-400">
                                            {formatCurrency(totalReturn)}
                                        </span>
                                    </div>

                                    <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 mt-4">
                                        <div className="flex items-start gap-2">
                                            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                                            <div>
                                                <p className="text-sm font-semibold text-green-900 dark:text-green-100 mb-1">
                                                    Maturity Date
                                                </p>
                                                <p className="text-sm text-green-700 dark:text-green-300">
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
                                    disabled={isCreating || amount < 50000}
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
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center shadow-xl">
                        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                        <p className="text-slate-600 dark:text-slate-400">Loading plans...</p>
                    </div>
                ) : (
                    <>
                        {/* Active Plans Section */}
                        {activePlans.length > 0 && (
                            <div className="mb-8">
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                                    Active Plans
                                </h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {activePlans.map((plan) => {
                                        const daysRemaining = getDaysRemaining(plan.maturityDate);
                                        const progress = ((plan.durationMonths * 30 - daysRemaining) / (plan.durationMonths * 30)) * 100;

                                        return (
                                            <div
                                                key={plan.id}
                                                className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-xl border border-green-200 dark:border-green-800"
                                            >
                                                <div className="flex items-start justify-between mb-4">
                                                    <div>
                                                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
                                                            Principal Amount
                                                        </p>
                                                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                                                            {formatCurrency(plan.amount)}
                                                        </p>
                                                    </div>
                                                    <div className="px-3 py-1 bg-green-100 dark:bg-green-900/30 rounded-full">
                                                        <span className="text-xs font-bold text-green-700 dark:text-green-400">
                                                            Active
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-2 gap-4 mb-4">
                                                    <div>
                                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                                                            Interest Rate
                                                        </p>
                                                        <p className="font-semibold text-green-600 dark:text-green-400">
                                                            {plan.interestRate}% p.a.
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                                                            Projected Profit
                                                        </p>
                                                        <p className="font-semibold text-green-600 dark:text-green-400">
                                                            +{formatCurrency(plan.projectedProfit)}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4 mb-4">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <Clock className="w-4 h-4 text-slate-500" />
                                                        <span className="text-sm font-semibold text-slate-900 dark:text-white">
                                                            {daysRemaining > 0 ? `${daysRemaining} days remaining` : "Matured"}
                                                        </span>
                                                    </div>
                                                    <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-linear-to-r from-green-600 to-emerald-600 transition-all"
                                                            style={{ width: `${Math.min(progress, 100)}%` }}
                                                        />
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between text-sm">
                                                    <div>
                                                        <p className="text-slate-500 dark:text-slate-400">Start Date</p>
                                                        <p className="font-semibold text-slate-900 dark:text-white">
                                                            {new Date(plan.startDate).toLocaleDateString()}
                                                        </p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-slate-500 dark:text-slate-400">Maturity Date</p>
                                                        <p className="font-semibold text-slate-900 dark:text-white">
                                                            {new Date(plan.maturityDate).toLocaleDateString()}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-sm text-slate-600 dark:text-slate-400">
                                                            Total at Maturity
                                                        </span>
                                                        <span className="text-xl font-bold text-green-600 dark:text-green-400">
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
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                                    Matured Plans
                                </h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {maturedPlans.map((plan) => (
                                        <div
                                            key={plan.id}
                                            className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-xl border border-slate-200 dark:border-slate-700 opacity-75"
                                        >
                                            <div className="flex items-start justify-between mb-4">
                                                <div>
                                                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
                                                        Final Amount
                                                    </p>
                                                    <p className="text-2xl font-bold text-slate-900 dark:text-white">
                                                        {formatCurrency(plan.amount + plan.projectedProfit)}
                                                    </p>
                                                </div>
                                                <div className="px-3 py-1 bg-slate-100 dark:bg-slate-700 rounded-full">
                                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-400">
                                                        Matured
                                                    </span>
                                                </div>
                                            </div>
                                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                                Matured on {new Date(plan.maturityDate).toLocaleDateString()}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Empty State */}
                        {plans.length === 0 && (
                            <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center shadow-xl">
                                <TrendingUp className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                                    No Fixed Savings Plans Yet
                                </h3>
                                <p className="text-slate-600 dark:text-slate-400 mb-6">
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
