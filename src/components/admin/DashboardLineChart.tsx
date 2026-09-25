"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { formatCurrency } from "@/lib/utils";

interface DashboardLineChartProps {
    monthlyTrend: any[];
}

export default function DashboardLineChart({ monthlyTrend }: DashboardLineChartProps) {
    return (
        <ResponsiveContainer width="100%" height={250}>
            <LineChart data={monthlyTrend}>
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
                    /*
                     *   #925 THIS IS NAIRA, AND IT WAS SHOWN AS A BARE NUMBER.
                     *
                     *   This chart and ContributionTrendChart read the SAME series
                     *   — `reports.monthlyTrend` from getCooperativeReportsAction,
                     *   `{ month, amount }` where amount is money. The bar chart on
                     *   /admin/cooperatives/contributions formats it; this line
                     *   chart on /admin/cooperatives/dashboard did not, so one
                     *   admin looking at two screens saw "₦1,240,000" on one and
                     *   "1240000" on the other, with nothing on the second to say
                     *   it was currency rather than a count of contributions.
                     *
                     *   AnalyticsCharts states the rule the platform already goes
                     *   by: a money series gets formatCurrency, a count series does
                     *   not. Its revenue chart formats and its user-growth chart
                     *   deliberately does not. This is a money series.
                     */
                    formatter={(value: any) => formatCurrency(value)}
                />
                <Line
                    type="monotone"
                    dataKey="amount"
                    stroke="#10B981"
                    strokeWidth={3}
                    dot={{ fill: "#10B981", r: 4 }}
                />
            </LineChart>
        </ResponsiveContainer>
    );
}
