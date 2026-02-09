/**
 * Export Portfolio Page
 * 
 * Comprehensive portfolio view with analytics and performance tracking
 */

"use client";

import { useState } from "react";
import { PieChart, TrendingUp, Calendar, DollarSign } from "lucide-react";

export default function ExportPortfolioPage() {
    const portfolioData = {
        totalValue: 2500000,
        totalReturns: 450000,
        roi: 18,
        investments: [
            {
                id: "1",
                commodity: "Yam Tubers",
                amount: 1000000,
                returns: 220000,
                roi: 22,
                status: "active",
                startDate: "2026-01-15",
                endDate: "2026-07-15",
            },
            {
                id: "2",
                commodity: "Sesame Seeds",
                amount: 750000,
                returns: 150000,
                roi: 20,
                status: "active",
                startDate: "2026-02-01",
                endDate: "2026-06-01",
            },
            {
                id: "3",
                commodity: "Hibiscus",
                amount: 750000,
                returns: 135000,
                roi: 18,
                status: "active",
                startDate: "2026-01-20",
                endDate: "2026-06-20",
            },
        ],
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
            <div className="max-w-7xl mx-auto px-4 py-8">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        Investment Portfolio
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Track your export investments and performance
                    </p>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-4">
                            <div className="text-sm text-slate-600 dark:text-slate-400">
                                Total Portfolio Value
                            </div>
                            <DollarSign className="w-5 h-5 text-orange-600" />
                        </div>
                        <div className="text-3xl font-bold text-slate-900 dark:text-white">
                            ₦{portfolioData.totalValue.toLocaleString()}
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-4">
                            <div className="text-sm text-slate-600 dark:text-slate-400">
                                Total Returns
                            </div>
                            <TrendingUp className="w-5 h-5 text-green-600" />
                        </div>
                        <div className="text-3xl font-bold text-green-600">
                            +₦{portfolioData.totalReturns.toLocaleString()}
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-4">
                            <div className="text-sm text-slate-600 dark:text-slate-400">
                                Average ROI
                            </div>
                            <PieChart className="w-5 h-5 text-blue-600" />
                        </div>
                        <div className="text-3xl font-bold text-blue-600">
                            {portfolioData.roi}%
                        </div>
                    </div>
                </div>

                {/* Investments Table */}
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                            All Investments
                        </h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-700">
                                    <th className="text-left p-4 text-sm font-semibold text-slate-700 dark:text-slate-300">
                                        Commodity
                                    </th>
                                    <th className="text-left p-4 text-sm font-semibold text-slate-700 dark:text-slate-300">
                                        Investment
                                    </th>
                                    <th className="text-left p-4 text-sm font-semibold text-slate-700 dark:text-slate-300">
                                        Expected Returns
                                    </th>
                                    <th className="text-left p-4 text-sm font-semibold text-slate-700 dark:text-slate-300">
                                        ROI
                                    </th>
                                    <th className="text-left p-4 text-sm font-semibold text-slate-700 dark:text-slate-300">
                                        Period
                                    </th>
                                    <th className="text-left p-4 text-sm font-semibold text-slate-700 dark:text-slate-300">
                                        Status
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {portfolioData.investments.map((investment) => (
                                    <tr
                                        key={investment.id}
                                        className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                                    >
                                        <td className="p-4">
                                            <div className="font-medium text-slate-900 dark:text-white">
                                                {investment.commodity}
                                            </div>
                                        </td>
                                        <td className="p-4 text-slate-700 dark:text-slate-300">
                                            ₦{investment.amount.toLocaleString()}
                                        </td>
                                        <td className="p-4 text-green-600 font-medium">
                                            +₦{investment.returns.toLocaleString()}
                                        </td>
                                        <td className="p-4">
                                            <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm font-medium">
                                                {investment.roi}%
                                            </span>
                                        </td>
                                        <td className="p-4 text-sm text-slate-600 dark:text-slate-400">
                                            <div className="flex items-center gap-1">
                                                <Calendar className="w-4 h-4" />
                                                {new Date(investment.startDate).toLocaleDateString()} -{" "}
                                                {new Date(investment.endDate).toLocaleDateString()}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <span className="px-3 py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 rounded-full text-sm font-medium capitalize">
                                                {investment.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
