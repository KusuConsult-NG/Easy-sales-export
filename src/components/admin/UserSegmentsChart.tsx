"use client";

import React from "react";
import { Users, Clock, CircleDashed, LoaderCircle, TrendingUp } from "lucide-react";
import { USER_SEGMENT_LABELS } from "@/lib/user-segments";
import type { UserSegments } from "@/app/actions/admin-analytics";
import { numberOrZero } from "@/lib/numbers";

interface UserSegmentsChartProps {
    segments: UserSegments;
}

export default function UserSegmentsChart({ segments }: UserSegmentsChartProps) {
    const total = segments.active + segments.pending + segments.stalled + segments.ghost;

    const segmentData = [
        {
            ...USER_SEGMENT_LABELS.active,
            value: segments.active,
            color: "#059669", // emerald-600
            bg: "bg-emerald-50",
            icon: TrendingUp,
        },
        {
            ...USER_SEGMENT_LABELS.pending,
            value: segments.pending,
            color: "#d97706", // amber-600
            bg: "bg-amber-50",
            icon: Clock,
        },
        {
            ...USER_SEGMENT_LABELS.stalled,
            value: segments.stalled,
            //   The app's own accent, --primary. The indigo here was a fifth
            //   hue this screen introduced on its own.
            color: "#2E519F",
            bg: "bg-blue-50",
            icon: LoaderCircle,
            //   #536's wording — "Profile complete but no module application"
            //   named a fact the classifier never checks — now lives with the
            //   label in lib/user-segments, so the two cannot drift apart.
        },
        {
            ...USER_SEGMENT_LABELS.ghost,
            value: segments.ghost,
            color: "#64748b", // slate-500 — legible on white, unlike slate-400
            bg: "bg-slate-50",
            //   #805 Was the `Ghost` icon. A dashed circle reads as "not begun"
            //   rather than as a joke about the person.
            icon: CircleDashed,
            //   #536 corrected this description from "Incomplete registrations
            //   / minimal data", which the owner read as a sync fault. It is
            //   not one: these are mostly imported member records that never
            //   went through a module onboarding. The wording lives in
            //   lib/user-segments now, beside the label #805 replaced.
        },
    ];

    return (
        <div className="bg-white rounded-2xl p-6 shadow-sm ring-1 ring-slate-200/50 h-full">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-lg font-bold text-slate-900">User Segmentation</h2>
                    <p className="text-xs text-slate-500">Where every registered account has got to</p>
                </div>
                <div className="p-2 rounded-lg" style={{ backgroundColor: "#2E519F14" }}>
                    <Users className="w-5 h-5" style={{ color: "#2E519F" }} />
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
                                    {/*
                                      *   #805 tabular-nums so the four figures
                                      *   line up as a column rather than
                                      *   shifting with each digit — the one
                                      *   typographic thing a stat panel needs
                                      *   and this did not have.
                                      */}
                                    <span className="text-base font-bold text-slate-900 tabular-nums">
                                        {numberOrZero(seg.value).toLocaleString()}
                                    </span>
                                    <span className="text-xs text-slate-500 ml-1.5 font-medium tabular-nums">
                                        {percentage.toFixed(1)}%
                                    </span>
                                </div>
                            </div>
                            
                            {/* Progress Bar Container */}
                            <div
                                className="h-2 w-full bg-slate-100 rounded-full overflow-hidden"
                                role="img"
                                aria-label={`${seg.label}: ${numberOrZero(seg.value).toLocaleString()}, ${percentage.toFixed(1)} per cent`}
                            >
                                {/*
                                  *   #805 The neon `boxShadow` glow is gone. It
                                  *   was the one flourish here that did not
                                  *   appear anywhere else in the admin surface,
                                  *   and a stats panel reads as more considered
                                  *   without it, not less.
                                  */}
                                <div
                                    className="h-full rounded-full transition-all duration-700 ease-out motion-reduce:transition-none"
                                    style={{ width: `${percentage}%`, backgroundColor: seg.color }}
                                />
                            </div>
                            
                            {/*   slate-500, not slate-400: the description is
                              *   what stops a reader inferring something the
                              *   number does not support (#536), so it has to
                              *   be legible rather than decorative. */}
                            <p className="mt-1.5 text-[11px] text-slate-500">
                                {seg.description}
                            </p>
                        </div>
                    );
                })}
            </div>

            <div className="mt-8 pt-6 border-t border-slate-100">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-500">Registered accounts</span>
                    <span className="text-sm font-bold text-slate-900 tabular-nums">{total.toLocaleString()}</span>
                </div>
            </div>
        </div>
    );
}
