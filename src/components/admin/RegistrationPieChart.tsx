"use client";

import { useState } from "react";
import type { ModuleRegistrationStats } from "@/app/actions/admin-analytics";

interface Slice {
    label: string;
    value: number;
    color: string;
    shortLabel: string;
}

interface RegistrationPieChartProps {
    stats: ModuleRegistrationStats;
}

// ─── Colour palette (vibrant, distinct) ────────────────────────────────────
const COLORS = [
    "#3b82f6", // blue        – Hub
    "#10b981", // emerald     – WAVE Applications
    "#6ee7b7", // light-green – WAVE Briefing
    "#a855f7", // purple      – Academy
    "#f59e0b", // amber       – Cooperatives
    "#14b8a6", // teal        – Cooperative Onboarding
    "#ef4444", // red         – Farm Nation
    "#0ea5e9", // sky         – Export Hub
    "#6366f1", // indigo      – Export Onboarding
    "#f97316", // orange      – Marketplace
];

// ─── SVG donut helpers ──────────────────────────────────────────────────────
const CX = 100;
const CY = 100;
const R = 75;
const STROKE = 40; // donut thickness
const CIRCUMFERENCE = 2 * Math.PI * R;

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
    // Clamp arc to just-under 360 to prevent SVG from collapsing a full circle to nothing
    const swept = Math.min(endAngle - startAngle, 359.999);
    const start = polarToCartesian(cx, cy, r, startAngle);
    const end = polarToCartesian(cx, cy, r, startAngle + swept);
    const largeArc = swept > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

export default function RegistrationPieChart({ stats }: RegistrationPieChartProps) {
    const [hovered, setHovered] = useState<number | null>(null);

    const rawSlices: Slice[] = [
        { label: "WAVE Applications", shortLabel: "WAVE App", value: stats?.wave ?? 0, color: COLORS[1] },
        { label: "WAVE Briefings", shortLabel: "Briefings", value: stats?.waveBriefing ?? 0, color: COLORS[2] },
        { label: "Academy", shortLabel: "Academy", value: stats?.academy ?? 0, color: COLORS[3] },
        { label: "Cooperatives", shortLabel: "Co-ops", value: stats?.cooperatives ?? 0, color: COLORS[4] },
        { label: "Co-op Onboarding", shortLabel: "Co-op Onb.", value: stats?.cooperativeOnboarding ?? 0, color: COLORS[5] },
        { label: "Farm Nation", shortLabel: "Farm Nation", value: stats?.farmNation ?? 0, color: COLORS[6] },
        { label: "Export Hub", shortLabel: "Export Hub", value: stats?.exportHub ?? 0, color: COLORS[7] },
        { label: "Export Onboarding", shortLabel: "Export Onb.", value: stats?.exportOnboarding ?? 0, color: COLORS[8] },
        { label: "Marketplace", shortLabel: "Marketplace", value: stats?.marketplace ?? 0, color: COLORS[9] },
    ];

    const total = rawSlices.reduce((sum, s) => sum + s.value, 0);

    // If everything is 0, show an empty-state ring
    const isEmpty = total === 0;

    // ── Build arc angles ───────────────────────────────────────────────────
    let currentAngle = 0;
    const arcs = rawSlices.map((slice, i) => {
        const fraction = total > 0 ? slice.value / total : 1 / rawSlices.length;
        const sweep = fraction * 360;
        const startAngle = currentAngle;
        currentAngle += sweep;
        return { ...slice, startAngle, sweep, fraction, index: i };
    });

    return (
        <div
            style={{
                background: "#fff",
                borderRadius: 16,
                boxShadow: "0 1px 6px rgba(0,0,0,0.07)",
                padding: "28px 32px",
            }}
        >
            <h2
                style={{
                    margin: "0 0 4px 0",
                    fontSize: 18,
                    fontWeight: 700,
                    color: "#0f172a",
                    letterSpacing: "-0.02em",
                }}
            >
                Registrations by Module
            </h2>
            <p style={{ margin: "0 0 28px 0", fontSize: 13, color: "#64748b" }}>
                Breakdown of total participants across all platform modules.{" "}
                <span style={{ color: "#94a3b8", fontStyle: "italic" }}>
                    Note: one person may appear in multiple modules.
                </span>
                {!isEmpty && (
                    <span
                        style={{
                            marginLeft: 8,
                            background: "#eff6ff",
                            color: "#1d4ed8",
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: 99,
                            fontSize: 12,
                        }}
                    >
                        {total.toLocaleString()} total module registrations
                    </span>
                )}
                <span
                    style={{
                        marginLeft: 8,
                        background: "#f8fafc",
                        color: "#475569",
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 99,
                        fontSize: 12,
                        border: "1px solid #e2e8f0"
                    }}
                >
                    {(stats?.hub ?? 0).toLocaleString()} Unique Accounts
                </span>
            </p>

            <div
                style={{
                    display: "flex",
                    gap: 40,
                    alignItems: "center",
                    flexWrap: "wrap",
                }}
            >
                {/* ── Donut SVG ──────────────────────────────────────────────── */}
                <div style={{ position: "relative", flexShrink: 0 }}>
                    <svg width={220} height={220} viewBox="0 0 200 200">
                        {isEmpty ? (
                            <circle
                                cx={CX}
                                cy={CY}
                                r={R}
                                fill="none"
                                stroke="#e2e8f0"
                                strokeWidth={STROKE}
                            />
                        ) : (
                            arcs.map((arc) => {
                                const isHovered = hovered === arc.index;
                                return (
                                    <path
                                        key={arc.index}
                                        d={describeArc(CX, CY, R, arc.startAngle, arc.startAngle + arc.sweep)}
                                        fill="none"
                                        stroke={arc.color}
                                        strokeWidth={isHovered ? STROKE + 6 : STROKE}
                                        strokeLinecap="butt"
                                        style={{
                                            transition: "stroke-width 0.2s ease",
                                            cursor: "pointer",
                                            filter: isHovered
                                                ? "drop-shadow(0 0 6px rgba(0,0,0,0.25))"
                                                : "none",
                                        }}
                                        onMouseEnter={() => setHovered(arc.index)}
                                        onMouseLeave={() => setHovered(null)}
                                    />
                                );
                            })
                        )}

                        {/* Centre label */}
                        {hovered !== null && !isEmpty ? (
                            <>
                                <text
                                    x={CX}
                                    y={CY - 8}
                                    textAnchor="middle"
                                    fontSize="10"
                                    fontWeight="600"
                                    fill="#64748b"
                                >
                                    {arcs[hovered].shortLabel}
                                </text>
                                <text
                                    x={CX}
                                    y={CY + 10}
                                    textAnchor="middle"
                                    fontSize="18"
                                    fontWeight="800"
                                    fill="#0f172a"
                                >
                                    {arcs[hovered].value.toLocaleString()}
                                </text>
                                <text
                                    x={CX}
                                    y={CY + 26}
                                    textAnchor="middle"
                                    fontSize="9"
                                    fill="#94a3b8"
                                >
                                    {total > 0
                                        ? `${((arcs[hovered].value / total) * 100).toFixed(1)}%`
                                        : "0%"}
                                </text>
                            </>
                        ) : (
                            <>
                                <text
                                    x={CX}
                                    y={CY - 6}
                                    textAnchor="middle"
                                    fontSize="9"
                                    fill="#94a3b8"
                                >
                                    {isEmpty ? "No data yet" : "Total"}
                                </text>
                                {!isEmpty && (
                                    <text
                                        x={CX}
                                        y={CY + 14}
                                        textAnchor="middle"
                                        fontSize="22"
                                        fontWeight="800"
                                        fill="#0f172a"
                                    >
                                        {total.toLocaleString()}
                                    </text>
                                )}
                            </>
                        )}
                    </svg>
                </div>

                {/* ── Bar + Legend ────────────────────────────────────────────── */}
                <div style={{ flex: 1, minWidth: 200 }}>
                    {rawSlices.map((slice, i) => {
                        const pct = total > 0 ? (slice.value / total) * 100 : 0;
                        const isHov = hovered === i;
                        return (
                            <div
                                key={slice.label}
                                style={{
                                    marginBottom: 12,
                                    cursor: "pointer",
                                    borderRadius: 8,
                                    padding: "4px 6px",
                                    background: isHov ? "#f8fafc" : "transparent",
                                    transition: "background 0.15s",
                                }}
                                onMouseEnter={() => setHovered(i)}
                                onMouseLeave={() => setHovered(null)}
                            >
                                {/* Label row */}
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        marginBottom: 4,
                                    }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 7,
                                        }}
                                    >
                                        <span
                                            style={{
                                                width: 10,
                                                height: 10,
                                                borderRadius: "50%",
                                                background: slice.color,
                                                flexShrink: 0,
                                                display: "inline-block",
                                            }}
                                        />
                                        <span
                                            style={{
                                                fontSize: 13,
                                                fontWeight: isHov ? 700 : 500,
                                                color: "#334155",
                                                transition: "font-weight 0.1s",
                                            }}
                                        >
                                            {slice.label}
                                        </span>
                                    </div>
                                    <span
                                        style={{
                                            fontSize: 13,
                                            fontWeight: 700,
                                            color: "#0f172a",
                                            minWidth: 50,
                                            textAlign: "right",
                                        }}
                                    >
                                        {slice.value.toLocaleString()}
                                        <span
                                            style={{
                                                marginLeft: 5,
                                                fontSize: 11,
                                                color: "#94a3b8",
                                                fontWeight: 400,
                                            }}
                                        >
                                            ({pct.toFixed(1)}%)
                                        </span>
                                    </span>
                                </div>

                                {/* Progress bar */}
                                <div
                                    style={{
                                        height: 6,
                                        borderRadius: 99,
                                        background: "#f1f5f9",
                                        overflow: "hidden",
                                    }}
                                >
                                    <div
                                        style={{
                                            height: "100%",
                                            width: `${pct}%`,
                                            background: slice.color,
                                            borderRadius: 99,
                                            transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)",
                                            minWidth: slice.value > 0 ? 4 : 0,
                                        }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
