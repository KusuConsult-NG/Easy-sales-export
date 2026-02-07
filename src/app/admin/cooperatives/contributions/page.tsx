"use client";

import { useState, useEffect } from "react";
import {
    TrendingUp,
    Users,
    Award,
    Calendar,
    Loader2,
    Download,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { getContributionReportsAction } from "@/app/actions/cooperative-admin";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

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
            if (result.success && result.data) {
                setReports(result.data);
            }
        } catch (error) {
            console.error("Failed to load reports:", error);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-green-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                            Contribution Reports
                        </h1>
                        <p className="text-gray-600 dark:text-gray-400">
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
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                                <TrendingUp className="w-6 h-6 text-green-600 dark:text-green-400" />
                            </div>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                            Total Contributions
                        </p>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">
                            {formatCurrency(reports?.totalContributions || 0)}
                        </p>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                                <Users className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                            </div>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                            Contributing Members
                        </p>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">
                            {reports?.memberCount || 0}
                        </p>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center">
                                <Award className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                            </div>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                            Average Contribution
                        </p>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">
                            {formatCurrency(reports?.averageContribution || 0)}
                        </p>
                    </div>
                </div>

                {/* Monthly Trend Chart */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg mb-8">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">
                        6-Month Contribution Trend
                    </h2>
                    {reports?.monthlyTrend && reports.monthlyTrend.length > 0 ? (
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={reports.monthlyTrend}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                <XAxis dataKey="month" stroke="#9CA3AF" />
                                <YAxis stroke="#9CA3AF" />
                                <Tooltip
                                    contentStyle={{
                                        backgroundColor: "#1F2937",
                                        border: "none",
                                        borderRadius: "0.5rem",
                                        color: "#fff",
                                    }}
                                    formatter={(value: any) => formatCurrency(value)}
                                />
                                <Bar dataKey="amount" fill="#10B981" radius={[8, 8, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <p className="text-center text-gray-500 py-8">No trend data available</p>
                    )}
                </div>

                {/* Top Contributors */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">
                        Top 10 Contributors
                    </h2>
                    {reports?.topContributors && reports.topContributors.length > 0 ? (
                        <div className="space-y-4">
                            {reports.topContributors.map((contributor: any, index: number) => (
                                <div
                                    key={contributor.userId}
                                    className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-xl"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-linear-to-br from-green-600 to-emerald-600 text-white rounded-full flex items-center justify-center font-bold">
                                            #{index + 1}
                                        </div>
                                        <div>
                                            <p className="font-semibold text-gray-900 dark:text-white">
                                                User ID: {contributor.userId}
                                            </p>
                                            <p className="text-sm text-gray-600 dark:text-gray-400">
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
