"use client";

import { useState, useCallback, useEffect } from "react";
import { Calendar, X, ChevronDown } from "lucide-react";

export interface DateRange {
    from: string; // "YYYY-MM-DD"
    to: string;   // "YYYY-MM-DD"
}

interface DateRangeFilterProps {
    value: DateRange;
    onChange: (range: DateRange) => void;
    /** Extra className applied to the outer wrapper */
    className?: string;
    /** Label prefix shown in the toggle button when a range is active */
    label?: string;
}

const PRESETS: Array<{ label: string; getDates: () => DateRange }> = [
    {
        label: "Today",
        getDates: () => {
            const d = new Date().toISOString().slice(0, 10);
            return { from: d, to: d };
        },
    },
    {
        label: "Last 7 days",
        getDates: () => {
            const to = new Date().toISOString().slice(0, 10);
            const from = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
            return { from, to };
        },
    },
    {
        label: "Last 30 days",
        getDates: () => {
            const to = new Date().toISOString().slice(0, 10);
            const from = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
            return { from, to };
        },
    },
    {
        label: "Last 90 days",
        getDates: () => {
            const to = new Date().toISOString().slice(0, 10);
            const from = new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10);
            return { from, to };
        },
    },
    {
        label: "This year",
        getDates: () => {
            const year = new Date().getFullYear();
            return { from: `${year}-01-01`, to: new Date().toISOString().slice(0, 10) };
        },
    },
    {
        label: "All time",
        getDates: () => ({ from: "", to: "" }),
    },
];

export default function DateRangeFilter({
    value,
    onChange,
    className = "",
    label = "Date range",
}: DateRangeFilterProps) {
    const [open, setOpen] = useState(false);

    // Internal draft state — only committed to parent on "Apply"
    const [draft, setDraft] = useState<DateRange>({ from: value.from, to: value.to });

    // Sync draft when the dropdown opens so it always reflects the current committed value
    useEffect(() => {
        if (open) {
            setDraft({ from: value.from, to: value.to });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const hasFilter = Boolean(value.from || value.to);
    const draftHasValue = Boolean(draft.from || draft.to);

    // Preset buttons apply immediately and close the panel
    const handlePreset = useCallback(
        (preset: (typeof PRESETS)[number]) => {
            const dates = preset.getDates();
            onChange(dates);
            setDraft(dates);
            setOpen(false);
        },
        [onChange]
    );

    // Apply commits the draft to the parent (triggering the data fetch)
    const handleApply = useCallback(() => {
        onChange(draft);
        setOpen(false);
    }, [onChange, draft]);

    const handleClear = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            const empty = { from: "", to: "" };
            setDraft(empty);
            onChange(empty);
            setOpen(false);
        },
        [onChange]
    );

    const formatDisplay = () => {
        if (!hasFilter) return label;
        if (value.from && value.to) {
            if (value.from === value.to)
                return new Date(value.from + "T00:00:00").toLocaleDateString("en-NG", {
                    day: "numeric", month: "short", year: "numeric",
                });
            return `${new Date(value.from + "T00:00:00").toLocaleDateString("en-NG", { day: "numeric", month: "short" })} → ${new Date(value.to + "T00:00:00").toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}`;
        }
        if (value.from) return `From ${new Date(value.from + "T00:00:00").toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}`;
        return `To ${new Date(value.to + "T00:00:00").toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}`;
    };

    return (
        <div className={`relative ${className}`}>
            {/* Toggle button */}
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all
                    ${hasFilter
                        ? "bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-200"
                        : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                    }`}
            >
                <Calendar className="w-4 h-4 shrink-0" />
                <span className="max-w-[180px] truncate">{formatDisplay()}</span>
                {hasFilter ? (
                    <span
                        role="button"
                        onClick={handleClear}
                        className="ml-1 p-0.5 rounded-full hover:bg-blue-500 transition"
                        title="Clear date filter"
                    >
                        <X className="w-3.5 h-3.5" />
                    </span>
                ) : (
                    <ChevronDown
                        className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
                    />
                )}
            </button>

            {/* Dropdown panel */}
            {open && (
                <>
                    {/* Backdrop — closing without applying does NOT commit the draft */}
                    <div
                        className="fixed inset-0 z-20"
                        onClick={() => setOpen(false)}
                        aria-hidden
                    />
                    <div className="absolute top-full mt-2 left-0 z-30 bg-white rounded-2xl shadow-xl border border-slate-200 w-80 p-4">
                        {/* Preset buttons */}
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                            Quick select
                        </p>
                        <div className="grid grid-cols-2 gap-1.5 mb-4">
                            {PRESETS.map((preset) => (
                                <button
                                    key={preset.label}
                                    type="button"
                                    onClick={() => handlePreset(preset)}
                                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-blue-600 hover:text-white transition"
                                >
                                    {preset.label}
                                </button>
                            ))}
                        </div>

                        {/* Custom range */}
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                            Custom range
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="block text-xs text-slate-500 mb-1 font-medium">From</label>
                                <input
                                    type="date"
                                    value={draft.from}
                                    max={draft.to || undefined}
                                    onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-500 mb-1 font-medium">To</label>
                                <input
                                    type="date"
                                    value={draft.to}
                                    min={draft.from || undefined}
                                    onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                            </div>
                        </div>

                        {/* Apply / clear buttons */}
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
                            <button
                                type="button"
                                onClick={handleClear}
                                className="flex-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 transition"
                            >
                                Clear
                            </button>
                            <button
                                type="button"
                                onClick={handleApply}
                                disabled={!draftHasValue}
                                className="flex-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Apply
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
