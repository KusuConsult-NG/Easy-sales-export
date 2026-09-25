"use client";

import {
    LineChart,
    Line,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";
import { formatCurrency } from "@/lib/utils";

interface AnalyticsChartsProps {
    revenueByMonth: any[];
    userGrowthByMonth: any[];
    /**
     *   #925 DECLARED, PASSED, AND NEVER RENDERED.
     *
     *   This prop was in the interface and nowhere else: not destructured, not
     *   read, not drawn. /admin/analytics passes it, and the page's own comment
     *   two elements later says
     *
     *       {/* Spacer since Module Usage is now handled by AnalyticsCharts
     *           inside its own grid *\/}
     *
     *   — so the page DELETED its module-usage chart, left an empty div where it
     *   had been, and handed the data to a component that dropped it. The comment
     *   describes a move that only happened halfway.
     *
     *   The series is real and the service goes out of its way to keep it
     *   drawable: analytics.service builds nine `{ module, count }` rows from the
     *   canonical registration stats, filters the zeroes, and falls back to
     *   `[{ module: "No data yet", count: 1 }]` rather than an empty array — a
     *   deliberate "so the chart has something to show". Nothing showed it.
     *
     *   Optional, and rendered only when supplied: admin/DashboardClient passes
     *   the other two props and not this one, and must not gain a blank third
     *   card.
     */
    moduleUsage?: any[];
}

const tooltipStyle = {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
    color: "#0f172a",
    fontSize: "13px",
    fontWeight: 500,
    padding: "8px 14px",
};

export default function AnalyticsCharts({ revenueByMonth, userGrowthByMonth, moduleUsage }: AnalyticsChartsProps) {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Revenue Trend */}
            <div className="bg-white rounded-2xl p-6 shadow-sm ring-1 ring-slate-200/50">
                <h3 className="text-lg font-bold text-slate-900 mb-6">
                    Revenue Trend (6 Months)
                </h3>
                <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={revenueByMonth}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                        <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(val) => `₦${(val / 1000)}k`} />
                        <Tooltip
                            contentStyle={tooltipStyle}
                            formatter={(value: any) => formatCurrency(value)}
                        />
                        <Line
                            type="monotone"
                            dataKey="revenue"
                            stroke="#10b981"
                            strokeWidth={3}
                            dot={{ fill: "#10b981", r: 5 }}
                            activeDot={{ r: 7, stroke: "#10b981", strokeWidth: 2, fill: "#fff" }}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>

            {/* User Growth */}
            <div className="bg-white rounded-2xl p-6 shadow-sm ring-1 ring-slate-200/50">
                <h3 className="text-lg font-bold text-slate-900 mb-6">
                    User Growth (6 Months)
                </h3>
                <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={userGrowthByMonth}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                        <YAxis stroke="#94a3b8" fontSize={12} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Bar dataKey="users" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* Module Usage — the card the page had already made room for. */}
            {moduleUsage && moduleUsage.length > 0 && (
                <div className="bg-white rounded-2xl p-6 shadow-sm ring-1 ring-slate-200/50 lg:col-span-2">
                    <h3 className="text-lg font-bold text-slate-900 mb-6">
                        Module Usage
                    </h3>
                    {/*
                      *   The comment sits OUTSIDE ResponsiveContainer on purpose:
                      *   it takes exactly one child, and a JSX comment is a child.
                      *
                      *   HORIZONTAL BARS, because the categories are names and
                      *   there are up to nine of them — "Export Onboarding",
                      *   "Co-op Onboarding". On a vertical axis they read; along an
                      *   x-axis at 12px they overlap into nothing. Everything else
                      *   follows the User Growth card above: a count series, so the
                      *   plain tooltip and no currency formatter — which is the
                      *   distinction this file already draws between revenue and
                      *   users.
                      */}
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={moduleUsage} layout="vertical" margin={{ left: 40 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis type="number" stroke="#94a3b8" fontSize={12} allowDecimals={false} />
                            <YAxis
                                type="category"
                                dataKey="module"
                                stroke="#94a3b8"
                                fontSize={12}
                                width={140}
                            />
                            <Tooltip contentStyle={tooltipStyle} />
                            <Bar dataKey="count" fill="#8b5cf6" radius={[0, 8, 8, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}
