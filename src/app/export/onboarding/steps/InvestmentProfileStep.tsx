/**
 * Investment Profile Step
 * 
 * First step in Export Windows onboarding - collects investment preferences
 */

"use client";

import { useState } from "react";
import { TrendingUp, DollarSign, Target } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";

interface InvestmentProfileStepProps {
    onNext: (data: any) => void;
    initialData?: any;
}

export function InvestmentProfileStep({
    onNext,
    initialData,
}: InvestmentProfileStepProps) {
    const [minInvestment, setMinInvestment] = useState(
        initialData?.minInvestment || ""
    );
    const [maxInvestment, setMaxInvestment] = useState(
        initialData?.maxInvestment || ""
    );
    const [goals, setGoals] = useState<string[]>(initialData?.investmentGoals || []);
    const [riskTolerance, setRiskTolerance] = useState(
        initialData?.riskTolerance || ""
    );
    const { showToast } = useToast();

    const INVESTMENT_GOALS = [
        "Short-term returns (3-6 months)",
        "Long-term growth (6-12 months)",
        "Portfolio diversification",
        "Support local agriculture",
        "International trade exposure",
    ];

    const toggleGoal = (goal: string) => {
        setGoals((prev) =>
            prev.includes(goal) ? prev.filter((g) => g !== goal) : [...prev, goal]
        );
    };

    function handleSubmit() {
        if (!minInvestment || !maxInvestment || goals.length === 0 || !riskTolerance) {
            showToast("Please fill in all required fields", "error");
            return;
        }

        onNext({
            profile: {
                minInvestment: parseInt(minInvestment),
                maxInvestment: parseInt(maxInvestment),
                investmentGoals: goals,
                riskTolerance,
            },
        });
    };

    return (
        <div className="bg-white rounded-lg p-6 md:p-8">
            <div className="mb-6">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">
                    Investment Profile
                </h2>
                <p className="text-slate-600">
                    Help us customize your export opportunities
                </p>
            </div>

            <div className="space-y-6">
                {/* Investment Range */}
                <div>
                    <label className="block text-sm font-medium text-slate-900 mb-3">
                        Investment Range <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-slate-600 mb-2">
                                Minimum Amount
                            </label>
                            <div className="relative">
                                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <select
                                    value={minInvestment}
                                    onChange={(e) => setMinInvestment(e.target.value)}
                                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                >
                                    <option value="">Select minimum</option>
                                    <option value="50000">₦50,000</option>
                                    <option value="100000">₦100,000</option>
                                    <option value="250000">₦250,000</option>
                                    <option value="500000">₦500,000</option>
                                    <option value="1000000">₦1,000,000</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs text-slate-600 mb-2">
                                Maximum Amount
                            </label>
                            <div className="relative">
                                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <select
                                    value={maxInvestment}
                                    onChange={(e) => setMaxInvestment(e.target.value)}
                                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                >
                                    <option value="">Select maximum</option>
                                    <option value="500000">₦500,000</option>
                                    <option value="1000000">₦1,000,000</option>
                                    <option value="2500000">₦2,500,000</option>
                                    <option value="5000000">₦5,000,000</option>
                                    <option value="10000000">₦10,000,000+</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Investment Goals */}
                <div>
                    <label className="block text-sm font-medium text-slate-900 mb-3">
                        Investment Goals <span className="text-red-500">*</span>
                    </label>
                    <p className="text-xs text-slate-600 mb-3">
                        Select all that apply
                    </p>
                    <div className="space-y-2">
                        {INVESTMENT_GOALS.map((goal) => (
                            <button
                                key={goal}
                                onClick={() => toggleGoal(goal)}
                                className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${goals.includes(goal)
                                    ? "border-orange-500 bg-orange-50 text-orange-900"
                                    : "border-slate-200 hover:border-orange-300 text-slate-900"
                                    }`}
                            >
                                <div className="flex items-center gap-2">
                                    <div
                                        className={`w-5 h-5 rounded border-2 flex items-center justify-center ${goals.includes(goal)
                                            ? "border-orange-500 bg-orange-500"
                                            : "border-slate-300"
                                            }`}
                                    >
                                        {goals.includes(goal) && (
                                            <svg
                                                className="w-3 h-3 text-white"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke="currentColor"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={3}
                                                    d="M5 13l4 4L19 7"
                                                />
                                            </svg>
                                        )}
                                    </div>
                                    <span className="text-sm font-medium">{goal}</span>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Risk Tolerance */}
                <div>
                    <label className="block text-sm font-medium text-slate-900 mb-3">
                        Risk Tolerance <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {["low", "medium", "high"].map((risk) => (
                            <button
                                key={risk}
                                onClick={() => setRiskTolerance(risk)}
                                className={`p-4 rounded-lg border-2 transition-all ${riskTolerance === risk
                                    ? "border-orange-500 bg-orange-50"
                                    : "border-slate-200 hover:border-orange-300"
                                    }`}
                            >
                                <div className="text-center">
                                    <TrendingUp
                                        className={`w-8 h-8 mx-auto mb-2 ${riskTolerance === risk
                                            ? "text-orange-600"
                                            : "text-slate-400"
                                            }`}
                                    />
                                    <p
                                        className={`font-semibold capitalize ${riskTolerance === risk
                                            ? "text-orange-900"
                                            : "text-slate-900"
                                            }`}
                                    >
                                        {risk}
                                    </p>
                                    <p className="text-xs text-slate-600 mt-1">
                                        {risk === "low" && "Conservative, stable returns"}
                                        {risk === "medium" && "Balanced risk/reward"}
                                        {risk === "high" && "Higher risk, higher potential"}
                                    </p>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Submit Button */}
                <div className="flex justify-end pt-4">
                    <button
                        onClick={handleSubmit}
                        className="px-8 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors font-semibold"
                    >
                        Continue to Verification
                    </button>
                </div>
            </div>
        </div>
    );
}
