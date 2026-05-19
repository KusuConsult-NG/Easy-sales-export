"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import {
    TrendingUp,
    Users,
    Award,
    Calendar,
    Loader2,
    Download,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { getContributionReportsAction } from "@/app/actions/cooperative";
import dynamic from "next/dynamic";

const ContributionTrendChart = dynamic(() => import("@/components/admin/ContributionTrendChart"), {
    ssr: false,
    loading: () => (
        <div className="flex items-center justify-center p-12 text-gray-400">
            <Loader2 className="w-8 h-8 animate-spin" />
            <span className="ml-2">Loading chart...</span>
        </div>
    )
});

export default function AdminContributionsPage() {
    const [loading, setLoading] = useState(true);
    const [reports, setReports] = useState<any>(null);

    useEffect(() => {
        loadReports();
    }, []);

    async function loadReports() {
        setLoading(true);
        try {
            const result = await getContributionReportsAction();
            if (result.success && result.data?.reports) {
                setReports(result.data.reports);
            }
        } catch (error) {
            logger.error("Failed to load reports:", error);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-green-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 mb-2">
                            Contribution Reports
                        </h1>
                        <p className="text-gray-600">
                            Track and analyze member contributions
                        </p>
                    </div>
                    <button className="px-6 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition flex items-center gap-2">
                        <Download className="w-5 h-5" />
                        Export Report
                    </button>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                                <TrendingUp className="w-6 h-6 text-green-600" />
                            </div>
                        </div>
                        <p className="text-sm text-gray-600 mb-1">
                            Total Contributions
                        </p>
                        <p className="text-3xl font-bold text-gray-900">
                            {formatCurrency(reports?.totalContributions || 0)}
                        </p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                                <Users className="w-6 h-6 text-blue-600" />
                            </div>
                        </div>
                        <p className="text-sm text-gray-600 mb-1">
                            Contributing Members
                        </p>
                        <p className="text-3xl font-bold text-gray-900">
                            {reports?.memberCount || 0}
                        </p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                                <Award className="w-6 h-6 text-purple-600" />
                            </div>
                        </div>
                        <p className="text-sm text-gray-600 mb-1">
                            Average Contribution
                        </p>
                        <p className="text-3xl font-bold text-gray-900">
                            {formatCurrency(reports?.averageContribution || 0)}
                        </p>
                    </div>
                </div>

                {/* Monthly Trend Chart */}
                <div className="bg-white rounded-2xl p-6 shadow-lg mb-8">
                    <h2 className="text-xl font-bold text-gray-900 mb-6">
                        6-Month Contribution Trend
                    </h2>
                    <ContributionTrendChart monthlyTrend={reports?.monthlyTrend} />
                </div>

                {/* Top Contributors */}
                <div className="bg-white rounded-2xl p-6 shadow-lg">
                    <h2 className="text-xl font-bold text-gray-900 mb-6">
                        Top 10 Contributors
                    </h2>
                    {reports?.topContributors && reports.topContributors.length > 0 ? (
                        <div className="space-y-4">
                            {reports.topContributors.map((contributor: any, index: number) => (
                                <div
                                    key={contributor.userId}
                                    className="flex items-center justify-between p-4 bg-gray-50 rounded-xl"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-linear-to-br from-green-600 to-emerald-600 text-white rounded-full flex items-center justify-center font-bold">
                                            #{index + 1}
                                        </div>
                                        <div>
                                            <p className="font-semibold text-gray-900">
                                                User ID: {contributor.userId}
                                            </p>
                                            <p className="text-sm text-gray-600">
                                                {contributor.name}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-lg font-bold text-green-600">
                                            {formatCurrency(contributor.total)}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-center text-gray-500 py-8">No contributors data available</p>
                    )}
                </div>
            </div>
        </div>
    );
}
