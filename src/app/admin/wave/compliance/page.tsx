"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import { Users, TrendingUp, DollarSign, CheckCircle, XCircle, Clock, Download, BarChart3 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { recordExport } from "@/lib/record-export";

type ComplianceStats = {
    totalApplications: number;
    approved: number;
    rejected: number;
    pending: number;
    totalDisbursed: number;
    averageLoanSize: number;
    // Nullable, because it is now only present when it was actually measured.
    // The API used to return a hardcoded 85 when there were no loans at all.
    repaymentRate: number | null;
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
    /**
     * Which figures above were actually measured.
     *
     * The API returned 0 for disbursement — a field WAVE applications do not carry
     * — and a hardcoded 85 for the repayment rate when there were no loans at all.
     * Both rendered as ordinary numbers, so a compliance screen showed invented
     * data. This tells the tiles which of them to render as a figure.
     */
    const [dataAvailability, setDataAvailability] = useState<{
        disbursementTracked: boolean;
        disbursementNote: string | null;
        repaymentMeasured: boolean;
    } | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [timeframe, setTimeframe] = useState("all");

    useEffect(() => {
        fetchComplianceData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeframe]);

    async function fetchComplianceData() {
        setIsLoading(true);
        try {
            const response = await fetch(`/api/admin/wave/compliance?timeframe=${timeframe}`);
            const data = await response.json();

            if (data.success) {
                setStats(data.stats);
                setDemographics(data.demographics);
                setDataAvailability(data.dataAvailability ?? null);
            }
        } catch (error) {
            logger.error("Failed to fetch compliance data:", error);
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
                /**
                 * The extension follows what the SERVER actually sent.
                 *
                 * `format=pdf` does not produce a PDF: the route renders an HTML
                 * document and returns `Content-Type: text/html` with a `.html`
                 * filename. This line then saved those bytes as
                 * `wave_compliance_report_….pdf`, so the download was an HTML file
                 * wearing a PDF extension — no reader would open it.
                 *
                 * Naming it for its real type makes the file usable now. Producing
                 * a genuine PDF would mean adding a renderer, which is a feature
                 * rather than a fix, so it is not attempted here.
                 */
                const contentType = response.headers.get("Content-Type") || "";
                const extension = contentType.includes("text/csv")
                    ? "csv"
                    : contentType.includes("text/html")
                        ? "html"
                        : contentType.includes("application/pdf")
                            ? "pdf"
                            : format;

                a.download = `wave_compliance_report_${Date.now()}.${extension}`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                // #309 The download is recorded. Fourteen admin screens built a CSV
                // and two of them left a trace; several of these carry BVN, NIN and
                // bank details. recordExport never throws and never blocks.
                recordExport("wave_compliance");
                document.body.removeChild(a);
            }
        } catch (error) {
            logger.error("Failed to export report:", error);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-slate-600">Loading compliance data...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 mb-2">
                            WAVE Program Compliance
                        </h1>
                        <p className="text-slate-600">
                            Monitor application statistics and program metrics
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Timeframe Filter */}
                        <select
                            value={timeframe}
                            onChange={(e) => setTimeframe(e.target.value)}
                            className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            <option value="all">All Time</option>
                            <option value="month">This Month</option>
                            <option value="quarter">This Quarter</option>
                            <option value="year">This Year</option>
                        </select>

                        {/* Export Buttons */}
                        <button
                            onClick={() => exportReport("pdf")}
                            className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-900 font-semibold rounded-lg transition-all flex items-center gap-2"
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
                        <div className="bg-white rounded-xl shadow-lg p-6">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                                    <Users className="w-6 h-6 text-blue-600" />
                                </div>
                                <span className="text-2xl font-bold text-slate-900">
                                    {stats.totalApplications}
                                </span>
                            </div>
                            <p className="text-sm font-semibold text-slate-600">
                                Total Applications
                            </p>
                        </div>

                        <div className="bg-white rounded-xl shadow-lg p-6">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                                    <CheckCircle className="w-6 h-6 text-green-600" />
                                </div>
                                <span className="text-2xl font-bold text-slate-900">
                                    {stats.approved}
                                </span>
                            </div>
                            <p className="text-sm font-semibold text-slate-600">
                                Approved ({Math.round((stats.approved / stats.totalApplications) * 100)}%)
                            </p>
                        </div>

                        <div className="bg-white rounded-xl shadow-lg p-6">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                                    <Clock className="w-6 h-6 text-yellow-600" />
                                </div>
                                <span className="text-2xl font-bold text-slate-900">
                                    {stats.pending}
                                </span>
                            </div>
                            <p className="text-sm font-semibold text-slate-600">
                                Pending Review
                            </p>
                        </div>

                        <div className="bg-white rounded-xl shadow-lg p-6">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                                    <XCircle className="w-6 h-6 text-red-600" />
                                </div>
                                <span className="text-2xl font-bold text-slate-900">
                                    {stats.rejected}
                                </span>
                            </div>
                            <p className="text-sm font-semibold text-slate-600">
                                Rejected ({Math.round((stats.rejected / stats.totalApplications) * 100)}%)
                            </p>
                        </div>
                    </div>
                )}

                {/* Financial Metrics */}
                {stats && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                        <div className="bg-linear-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg p-6 text-white">
                            <div className="flex items-center gap-3 mb-4">
                                <DollarSign className="w-8 h-8 opacity-80" />
                                <div>
                                    <p className="text-sm opacity-90">Total Disbursed</p>
                                    {/* "Not tracked" rather than ₦0. WAVE applications carry no
                                        amountDisbursed field, so zero here has never meant
                                        "nothing was disbursed" — it meant nobody records it. */}
                                    <p className="text-3xl font-bold">
                                        {dataAvailability && !dataAvailability.disbursementTracked
                                            ? "Not tracked"
                                            : formatCurrency(stats.totalDisbursed)}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-linear-to-br from-indigo-500 to-indigo-600 rounded-xl shadow-lg p-6 text-white">
                            <div className="flex items-center gap-3 mb-4">
                                <BarChart3 className="w-8 h-8 opacity-80" />
                                <div>
                                    <p className="text-sm opacity-90">Average Loan Size</p>
                                    <p className="text-3xl font-bold">
                                        {dataAvailability && !dataAvailability.disbursementTracked
                                            ? "Not tracked"
                                            : formatCurrency(stats.averageLoanSize)}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-linear-to-br from-teal-500 to-teal-600 rounded-xl shadow-lg p-6 text-white">
                            <div className="flex items-center gap-3 mb-4">
                                <TrendingUp className="w-8 h-8 opacity-80" />
                                <div>
                                    <p className="text-sm opacity-90">Repayment Rate</p>
                                    {/* No figure at all when it was not measured. This read
                                        `{stats.repaymentRate}%` against an API that defaulted to
                                        85 with zero loans on record — a fabricated compliance
                                        statistic, and the one somebody would quote. */}
                                    <p className="text-3xl font-bold">
                                        {stats.repaymentRate === null || stats.repaymentRate === undefined
                                            ? "No data"
                                            : `${stats.repaymentRate}%`}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Demographics */}
                {demographics && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Age Groups */}
                        <div className="bg-white rounded-xl shadow-lg p-6">
                            <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
                                <Users className="w-5 h-5 text-primary" />
                                Age Distribution
                            </h3>
                            <div className="space-y-4">
                                {Object.entries(demographics.ageGroups).map(([age, count]) => (
                                    <div key={age}>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-semibold text-slate-900">{age}</span>
                                            <span className="text-sm font-bold text-primary">{count}</span>
                                        </div>
                                        <div className="w-full bg-slate-200 rounded-full h-2">
                                            <div
                                                className="bg-primary h-2 rounded-full transition-all"
                                                style={{ width: `${(count / Math.max(stats?.totalApplications || 1, 1)) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* States */}
                        <div className="bg-white rounded-xl shadow-lg p-6">
                            <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
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
                                                <span className="text-sm font-semibold text-slate-900">{state}</span>
                                                <span className="text-sm font-bold text-primary">{count}</span>
                                            </div>
                                            <div className="w-full bg-slate-200 rounded-full h-2">
                                                <div
                                                    className="bg-primary h-2 rounded-full transition-all"
                                                    style={{ width: `${(count / Math.max(stats?.totalApplications || 1, 1)) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        </div>

                        {/* Business Types */}
                        <div className="bg-white rounded-xl shadow-lg p-6">
                            <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
                                <TrendingUp className="w-5 h-5 text-primary" />
                                Business Types
                            </h3>
                            <div className="space-y-4">
                                {Object.entries(demographics.businessTypes).map(([type, count]) => (
                                    <div key={type}>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-semibold text-slate-900 capitalize">{type}</span>
                                            <span className="text-sm font-bold text-primary">{count}</span>
                                        </div>
                                        <div className="w-full bg-slate-200 rounded-full h-2">
                                            <div
                                                className="bg-primary h-2 rounded-full transition-all"
                                                style={{ width: `${(count / Math.max(stats?.totalApplications || 1, 1)) * 100}%` }}
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
