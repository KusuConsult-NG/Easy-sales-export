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

export default function AnalyticsCharts({ revenueByMonth, userGrowthByMonth }: AnalyticsChartsProps) {
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
        </div>
    );
}
