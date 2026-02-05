"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { formatCurrency } from "@/lib/utils";

interface CommodityData {
    name: string;
    value: number;
    icon: string;
}

const data: CommodityData[] = [
    { name: "Yam Tubers", value: 12500000, icon: "🌾" },
    { name: "Sesame Seeds", value: 8200000, icon: "🌰" },
    { name: "Dried Hibiscus", value: 5300000, icon: "🌺" },
];

const COLORS = ["#10b981", "#f59e0b", "#ef4444"];

export default function CommodityPieChart() {
    const total = data.reduce((sum, item) => sum + item.value, 0);

    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            const percentage = ((data.value / total) * 100).toFixed(1);
            return (
                <div className="bg-white dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700 shadow-lg">
                    <p className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        <span className="text-xl">{data.icon}</span>
                        {data.name}
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                        {formatCurrency(data.value)} ({percentage}%)
                    </p>
                </div>
            );
        }
        return null;
    };

    const renderCustomLabel = (entry: any) => {
        const percentage = ((entry.value / total) * 100).toFixed(0);
        return `${percentage}%`;
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6">
                Commodity Distribution
            </h3>
            <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                    <Pie
                        data={data}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={renderCustomLabel}
                        outerRadius={90}
                        fill="#8884d8"
                        dataKey="value"
                    >
                        {data.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                </PieChart>
            </ResponsiveContainer>
            <div className="mt-4 space-y-2">
                {data.map((commodity, index) => (
                    <div key={commodity.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: COLORS[index] }}
                            />
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                <span>{commodity.icon}</span>
                                {commodity.name}
                            </span>
                        </div>
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">
                            {formatCurrency(commodity.value)}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
