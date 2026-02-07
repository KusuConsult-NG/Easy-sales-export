"use client";

import { useState, useEffect } from "react";
import { Users, TrendingUp, DollarSign, CheckCircle, XCircle, Clock, Download, BarChart3 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

type ComplianceStats = {
    totalApplications: number;
    approved: number;
    rejected: number;
    pending: number;
    totalDisbursed: number;
    averageLoanSize: number;
    repaymentRate: number;
    activeMembers: number;
};

type DemographicBreakdown = {
    ageGroups: Record<string, number>;
    states: Record<string, number>;
    businessTypes: Record<string, number>;
};

export default function WAVECompliancePage() {
    const [stats, setStats] = useState<ComplianceStats | null>(null);
    const [demographics, setDemographics] = useState<DemographicBreakdown | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [timeframe, setTimeframe] = useState("all");

    useEffect(() => {
        fetchComplianceData();
    }, [timeframe]);

    const fetchComplianceData = async () => {
        setIsLoading(true);
        try {
            const response = await fetch(`/api/admin/wave/compliance?timeframe=${timeframe}`);
            const data = await response.json();

            if (data.success) {
                setStats(data.stats);
                setDemographics(data.demographics);
            }
        } catch (error) {
            console.error("Failed to fetch compliance data:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const exportReport = async (format: "pdf" | "csv") => {
        try {
            const response = await fetch(`/api/admin/wave/reports/export?format=${format}&timeframe=${timeframe}`, {
                method: "POST",
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `wave_compliance_report_${Date.now()}.${format}`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            }
        } catch (error) {
            console.error("Failed to export report:", error);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-slate-600 dark:text-slate-400">Loading compliance data...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                            WAVE Program Compliance
                        </h1>
                        <p className="text-slate-600 dark:text-slate-400">
                            Monitor application statistics and program metrics
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Timeframe Filter */}
                        <select
                            value={timeframe}
                            onChange={(e) => setTimeframe(e.target.value)}
                            className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            <option value="all">All Time</option>
                            <option value="month">This Month</option>
                            <option value="quarter">This Quarter</option>
                            <option value="year">This Year</option>
                        </select>

                        {/* Export Buttons */}
                        <button
                            onClick={() => exportReport("pdf")}
                            className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-900 dark:text-white font-semibold rounded-lg transition-all flex items-center gap-2"
                        >
                            <Download className="w-4 h-4" />
                            PDF
                        </button>
                        <button
                            onClick={() => exportReport("csv")}
                            className="px-4 py-2 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-all flex items-center gap-2"
                        >
                            <Download className="w-4 h-4" />
                            CSV
                        </button>
                    </div>
                </div>

                {/* Stats Cards */}
                {stats && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                                    <Users className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                                </div>
                                <span className="text-2xl font-bold text-slate-900 dark:text-white">
                                    {stats.totalApplications}
                                </span>
                            </div>
                            <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                                Total Applications
                            </p>
                        </div>

                        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                                    <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
                                </div>
                                <span className="text-2xl font-bold text-slate-900 dark:text-white">
                                    {stats.approved}
                                </span>
                            </div>
                            <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                                Approved ({Math.round((stats.approved / stats.totalApplications) * 100)}%)
                            </p>
                        </div>

                        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-12 h-12 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg flex items-center justify-center">
                                    <Clock className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
                                </div>
                                <span className="text-2xl font-bold text-slate-900 dark:text-white">
                                    {stats.pending}
                                </span>
                            </div>
                            <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                                Pending Review
                            </p>
                        </div>

                        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center">
                                    <XCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
                                </div>
                                <span className="text-2xl font-bold text-slate-900 dark:text-white">
                                    {stats.rejected}
                                </span>
                            </div>
                            <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                                Rejected ({Math.round((stats.rejected / stats.totalApplications) * 100)}%)
                            </p>
                        </div>
                    </div>
                )}

                {/* Financial Metrics */}
                {stats && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg p-6 text-white">
                            <div className="flex items-center gap-3 mb-4">
                                <DollarSign className="w-8 h-8 opacity-80" />
                                <div>
                                    <p className="text-sm opacity-90">Total Disbursed</p>
                                    <p className="text-3xl font-bold">{formatCurrency(stats.totalDisbursed)}</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl shadow-lg p-6 text-white">
                            <div className="flex items-center gap-3 mb-4">
                                <BarChart3 className="w-8 h-8 opacity-80" />
                                <div>
                                    <p className="text-sm opacity-90">Average Loan Size</p>
                                    <p className="text-3xl font-bold">{formatCurrency(stats.averageLoanSize)}</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl shadow-lg p-6 text-white">
                            <div className="flex items-center gap-3 mb-4">
                                <TrendingUp className="w-8 h-8 opacity-80" />
                                <div>
                                    <p className="text-sm opacity-90">Repayment Rate</p>
                                    <p className="text-3xl font-bold">{stats.repaymentRate}%</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Demographics */}
                {demographics && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Age Groups */}
                        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                                <Users className="w-5 h-5 text-primary" />
                                Age Distribution
                            </h3>
                            <div className="space-y-4">
                                {Object.entries(demographics.ageGroups).map(([age, count]) => (
                                    <div key={age}>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{age}</span>
                                            <span className="text-sm font-bold text-primary">{count}</span>
                                        </div>
                                        <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                                            <div
                                                className="bg-primary h-2 rounded-full transition-all"
                                                style={{ width: `${(count / stats!.totalApplications) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* States */}
                        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                                <BarChart3 className="w-5 h-5 text-primary" />
                                Top States
                            </h3>
                            <div className="space-y-4">
                                {Object.entries(demographics.states)
                                    .sort(([, a], [, b]) => b - a)
                                    .slice(0, 5)
                                    .map(([state, count]) => (
                                        <div key={state}>
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{state}</span>
                                                <span className="text-sm font-bold text-primary">{count}</span>
                                            </div>
                                            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                                                <div
                                                    className="bg-primary h-2 rounded-full transition-all"
                                                    style={{ width: `${(count / stats!.totalApplications) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        </div>

                        {/* Business Types */}
                        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                                <TrendingUp className="w-5 h-5 text-primary" />
                                Business Types
                            </h3>
                            <div className="space-y-4">
                                {Object.entries(demographics.businessTypes).map(([type, count]) => (
                                    <div key={type}>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 capitalize">{type}</span>
                                            <span className="text-sm font-bold text-primary">{count}</span>
                                        </div>
                                        <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                                            <div
                                                className="bg-primary h-2 rounded-full transition-all"
                                                style={{ width: `${(count / stats!.totalApplications) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
