"use client";

import { useState } from "react";
import { Calendar, X } from "lucide-react";

type DateRange = {
    from: Date | null;
    to: Date | null;
};

interface DateRangePickerProps {
    value: DateRange;
    onChange: (range: DateRange) => void;
    placeholder?: string;
}

export default function DateRangePicker({ value, onChange, placeholder = "Select date range" }: DateRangePickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [tempRange, setTempRange] = useState<DateRange>(value);

    const formatDate = (date: Date | null) => {
        if (!date) return "";
        return new Intl.DateTimeFormat("en-NG", {
            year: "numeric",
            month: "short",
            day: "numeric"
        }).format(date);
    };

    const handleApply = () => {
        onChange(tempRange);
        setIsOpen(false);
    };

    const handleClear = () => {
        const cleared = { from: null, to: null };
        setTempRange(cleared);
        onChange(cleared);
        setIsOpen(false);
    };

    const displayValue = value.from && value.to
        ? `${formatDate(value.from)} - ${formatDate(value.to)}`
        : value.from
            ? `From ${formatDate(value.from)}`
            : value.to
                ? `Until ${formatDate(value.to)}`
                : placeholder;

    const today = new Date().toISOString().split('T')[0];

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-left text-slate-900 dark:text-white hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary transition-all flex items-center justify-between gap-2"
            >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Calendar className="w-5 h-5 text-slate-400 shrink-0" />
                    <span className={`truncate ${!value.from && !value.to ? 'text-slate-400' : ''}`}>
                        {displayValue}
                    </span>
                </div>
                {(value.from || value.to) && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleClear();
                        }}
                        className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors shrink-0"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </button>

            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 z-40"
                        onClick={() => setIsOpen(false)}
                    />

                    {/* Dropdown */}
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl z-50 p-4">
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                    From Date
                                </label>
                                <input
                                    type="date"
                                    value={tempRange.from ? tempRange.from.toISOString().split('T')[0] : ""}
                                    onChange={(e) => setTempRange({
                                        ...tempRange,
                                        from: e.target.value ? new Date(e.target.value) : null
                                    })}
                                    max={tempRange.to ? tempRange.to.toISOString().split('T')[0] : undefined}
                                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                    To Date
                                </label>
                                <input
                                    type="date"
                                    value={tempRange.to ? tempRange.to.toISOString().split('T')[0] : ""}
                                    onChange={(e) => setTempRange({
                                        ...tempRange,
                                        to: e.target.value ? new Date(e.target.value) : null
                                    })}
                                    min={tempRange.from ? tempRange.from.toISOString().split('T')[0] : undefined}
                                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                />
                            </div>

                            {/* Quick Presets */}
                            <div>
                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Quick Select</p>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={() => {
                                            const today = new Date();
                                            const lastWeek = new Date(today);
                                            lastWeek.setDate(today.getDate() - 7);
                                            setTempRange({ from: lastWeek, to: today });
                                        }}
                                        className="px-3 py-2 text-xs font-semibold bg-slate-100 dark:bg-slate-700 hover:bg-primary/20 dark:hover:bg-primary/20 text-slate-900 dark:text-white rounded-lg transition-colors"
                                    >
                                        Last 7 Days
                                    </button>
                                    <button
                                        onClick={() => {
                                            const today = new Date();
                                            const lastMonth = new Date(today);
                                            lastMonth.setMonth(today.getMonth() - 1);
                                            setTempRange({ from: lastMonth, to: today });
                                        }}
                                        className="px-3 py-2 text-xs font-semibold bg-slate-100 dark:bg-slate-700 hover:bg-primary/20 dark:hover:bg-primary/20 text-slate-900 dark:text-white rounded-lg transition-colors"
                                    >
                                        Last 30 Days
                                    </button>
                                    <button
                                        onClick={() => {
                                            const today = new Date();
                                            const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
                                            setTempRange({ from: firstDayOfMonth, to: today });
                                        }}
                                        className="px-3 py-2 text-xs font-semibold bg-slate-100 dark:bg-slate-700 hover:bg-primary/20 dark:hover:bg-primary/20 text-slate-900 dark:text-white rounded-lg transition-colors"
                                    >
                                        This Month
                                    </button>
                                    <button
                                        onClick={() => {
                                            const today = new Date();
                                            const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                                            const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
                                            setTempRange({ from: lastMonthStart, to: lastMonthEnd });
                                        }}
                                        className="px-3 py-2 text-xs font-semibold bg-slate-100 dark:bg-slate-700 hover:bg-primary/20 dark:hover:bg-primary/20 text-slate-900 dark:text-white rounded-lg transition-colors"
                                    >
                                        Last Month
                                    </button>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                                <button
                                    onClick={handleClear}
                                    className="flex-1 px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-900 dark:text-white font-semibold rounded-lg transition-all"
                                >
                                    Clear
                                </button>
                                <button
                                    onClick={handleApply}
                                    className="flex-1 px-4 py-2 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-all"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
