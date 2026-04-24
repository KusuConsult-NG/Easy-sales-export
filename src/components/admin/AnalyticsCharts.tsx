"use client";

import {
    LineChart,
    Line,
    BarChart,
    Bar,
    PieChart,
    Pie,
    Cell,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
} from "recharts";
import { formatCurrency } from "@/lib/utils";

interface AnalyticsChartsProps {
    revenueByMonth: any[];
    userGrowthByMonth: any[];
    moduleUsage: any[];
}

const COLORS = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ef4444", "#06b6d4"];

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
        <>
            {/* Charts Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                {/* Revenue Trend */}
                <div className="bg-white rounded-2xl p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900 mb-6">
                        Revenue Trend (6 Months)
                    </h3>
                    <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={revenueByMonth}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                            <YAxis stroke="#94a3b8" fontSize={12} />
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
                <div className="bg-white rounded-2xl p-6 shadow-sm">
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

            {/* Charts Row 2 - Only the Pie Chart (Module Usage) */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
                <h3 className="text-lg font-bold text-slate-900 mb-6">
                    Module Usage
                </h3>
                <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                        <Pie
                            data={moduleUsage}
                            dataKey="count"
                            nameKey="module"
                            cx="50%"
                            cy="50%"
                            outerRadius={110}
                            label={false}
                        >
                            {(moduleUsage || []).map((_entry: any, index: number) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip
                            contentStyle={tooltipStyle}
                            formatter={(value: any, name: any) => [value, name]}
                        />
                        <Legend
                            iconType="circle"
                            formatter={(value) => (
                                <span style={{ color: "#475569", fontSize: 12 }}>{value}</span>
                            )}
                        />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </>
    );
}
