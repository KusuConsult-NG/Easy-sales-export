"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { formatCurrency } from "@/lib/utils";

interface ContributionTrendChartProps {
    monthlyTrend: any[];
}

export default function ContributionTrendChart({ monthlyTrend }: ContributionTrendChartProps) {
    if (!monthlyTrend || monthlyTrend.length === 0) {
        return <p className="text-center text-gray-500 py-8">No trend data available</p>;
    }

    return (
        <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyTrend}>
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
    );
}
