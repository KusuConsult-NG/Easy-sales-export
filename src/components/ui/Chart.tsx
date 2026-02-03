"use client";

import {
    LineChart,
    Line,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";

interface ChartData {
    name: string;
    value: number;
    [key: string]: string | number;
}

interface LineChartComponentProps {
    data: ChartData[];
    dataKey: string;
    xAxisKey?: string;
    color?: string;
    showGrid?: boolean;
    height?: number;
}

export function LineChartComponent({
    data,
    dataKey,
    xAxisKey = "name",
    color = "#2E519F",
    showGrid = true,
    height = 300,
}: LineChartComponentProps) {
    return (
        <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data}>
                {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />}
                <XAxis
                    dataKey={xAxisKey}
                    tick={{ fontSize: 12 }}
                    stroke="#94a3b8"
                />
                <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <Tooltip
                    contentStyle={{
                        backgroundColor: "#1e293b",
                        border: "none",
                        borderRadius: "8px",
                        color: "#fff",
                    }}
                />
                <Line
                    type="monotone"
                    dataKey={dataKey}
                    stroke={color}
                    strokeWidth={3}
                    dot={{ fill: color, r: 4 }}
                    activeDot={{ r: 6 }}
                />
            </LineChart>
        </ResponsiveContainer>
    );
}

export function AreaChartComponent({
    data,
    dataKey,
    xAxisKey = "name",
    color = "#2E519F",
    showGrid = true,
    height = 300,
}: LineChartComponentProps) {
    return (
        <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data}>
                {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />}
                <XAxis
                    dataKey={xAxisKey}
                    tick={{ fontSize: 12 }}
                    stroke="#94a3b8"
                />
                <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <Tooltip
                    contentStyle={{
                        backgroundColor: "#1e293b",
                        border: "none",
                        borderRadius: "8px",
                        color: "#fff",
                    }}
                />
                <Area
                    type="monotone"
                    dataKey={dataKey}
                    stroke={color}
                    strokeWidth={2}
                    fill={color}
                    fillOpacity={0.2}
                />
            </AreaChart>
        </ResponsiveContainer>
    );
}
