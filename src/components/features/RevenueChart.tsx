"use client";

import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";
import { formatCurrency } from "@/lib/utils";

interface RevenueDataPoint {
    month: string;
    revenue: number;
}

const data: RevenueDataPoint[] = [
    { month: "Sep", revenue: 1200000 },
    { month: "Oct", revenue: 1850000 },
    { month: "Nov", revenue: 2100000 },
    { month: "Dec", revenue: 1900000 },
    { month: "Jan", revenue: 2450000 },
    { month: "Feb", revenue: 2800000 },
];

export default function RevenueChart() {
    return (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6">
                Revenue Trends
            </h3>
            <ResponsiveContainer width="100%" height={280}>
                <LineChart data={data}>
                    <defs>
                        <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#e2e8f0"
                        className="dark:stroke-slate-700"
                    />
                    <XAxis
                        dataKey="month"
                        stroke="#64748b"
                        className="dark:stroke-slate-400"
                        style={{ fontSize: "12px" }}
                    />
                    <YAxis
                        stroke="#64748b"
                        className="dark:stroke-slate-400"
                        style={{ fontSize: "12px" }}
                        tickFormatter={(value) => `₦${(value / 1000000).toFixed(1)}M`}
                    />
                    <Tooltip
                        contentStyle={{
                            backgroundColor: "rgba(255, 255, 255, 0.95)",
                            border: "1px solid #e2e8f0",
                            borderRadius: "8px",
                            boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                        }}
                        labelStyle={{ color: "#0f172a", fontWeight: "600" }}
                        formatter={(value: number | undefined) =>
                            value !== undefined ? [formatCurrency(value), "Revenue"] : ["N/A", "Revenue"]
                        }
                    />
                    <Line
                        type="monotone"
                        dataKey="revenue"
                        stroke="#10b981"
                        strokeWidth={3}
                        dot={{ fill: "#10b981", r: 4 }}
                        activeDot={{ r: 6, fill: "#059669" }}
                        fill="url(#revenueGradient)"
                    />
                </LineChart>
            </ResponsiveContainer>
            <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">
                    Last 6 months performance
                </span>
                <span className="text-green-600 dark:text-green-400 font-semibold">
                    +133% growth
                </span>
            </div>
        </div>
    );
}
