"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

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
