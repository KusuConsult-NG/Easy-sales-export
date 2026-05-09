"use client";

import React from "react";
import { Users, Clock, AlertTriangle, Ghost, TrendingUp } from "lucide-react";
import type { UserSegments } from "@/app/actions/admin-analytics";

interface UserSegmentsChartProps {
    segments: UserSegments;
}

export default function UserSegmentsChart({ segments }: UserSegmentsChartProps) {
    const total = segments.active + segments.pending + segments.stalled + segments.ghost;

    const segmentData = [
        {
            label: "Active",
            value: segments.active,
            color: "#10b981", // emerald
            bg: "bg-emerald-50",
            icon: TrendingUp,
            description: "Approved & active participants",
        },
        {
            label: "Pending",
            value: segments.pending,
            color: "#f59e0b", // amber
            bg: "bg-amber-50",
            icon: Clock,
            description: "Submitted applications awaiting review",
        },
        {
            label: "Stalled",
            value: segments.stalled,
            color: "#6366f1", // indigo
            bg: "bg-indigo-50",
            icon: AlertTriangle,
            description: "Profile complete but no module application",
        },
        {
            label: "Ghost",
            value: segments.ghost,
            color: "#94a3b8", // slate
            bg: "bg-slate-50",
            icon: Ghost,
            description: "Incomplete registrations / minimal data",
        },
    ];

    return (
        <div className="bg-white rounded-2xl p-6 shadow-sm ring-1 ring-slate-200/50 h-full">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-lg font-bold text-slate-900">User Segmentation</h2>
                    <p className="text-xs text-slate-500">Precision categorization for broadcast targeting</p>
                </div>
                <div className="p-2 bg-blue-50 rounded-lg">
                    <Users className="w-5 h-5 text-blue-600" />
                </div>
            </div>

            <div className="space-y-5">
                {segmentData.map((seg) => {
                    const percentage = total > 0 ? (seg.value / total) * 100 : 0;
                    const Icon = seg.icon;

                    return (
                        <div key={seg.label} className="group">
                            <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2.5">
                                    <div className={`p-1.5 rounded-md ${seg.bg}`}>
                                        <Icon className="w-3.5 h-3.5" style={{ color: seg.color }} />
                                    </div>
                                    <span className="text-sm font-semibold text-slate-700">{seg.label}</span>
                                </div>
                                <div className="text-right">
                                    <span className="text-sm font-bold text-slate-900">{seg.value.toLocaleString()}</span>
                                    <span className="text-[10px] text-slate-400 ml-1.5 font-medium">
                                        ({percentage.toFixed(1)}%)
                                    </span>
                                </div>
                            </div>
                            
                            {/* Progress Bar Container */}
                            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                <div 
                                    className="h-full rounded-full transition-all duration-1000 ease-out"
                                    style={{ 
                                        width: `${percentage}%`,
                                        backgroundColor: seg.color,
                                        boxShadow: `0 0 8px ${seg.color}40`
                                    }}
                                />
                            </div>
                            
                            <p className="mt-1.5 text-[11px] text-slate-400 group-hover:text-slate-500 transition-colors">
                                {seg.description}
                            </p>
                        </div>
                    );
                })}
            </div>

            <div className="mt-8 pt-6 border-t border-slate-100">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-500">Total Analyzed</span>
                    <span className="text-sm font-bold text-slate-900">{total.toLocaleString()}</span>
                </div>
            </div>
        </div>
    );
}
