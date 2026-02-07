"use client";

import { Calendar as CalendarIcon, MapPin, Package } from "lucide-react";
import { useState } from "react";

type ExportWindow = {
    id: string;
    orderId: string;
    commodity: string;
    quantity: string;
    amount: number;
    status: "pending" | "in_transit" | "delivered" | "completed";
    deliveryDate?: Date;
    createdAt: Date;
};

interface ExportCalendarProps {
    exportWindows: ExportWindow[];
    onDateClick?: (date: Date) => void;
}

export default function ExportCalendar({ exportWindows, onDateClick }: ExportCalendarProps) {
    const [currentDate, setCurrentDate] = useState(new Date());

    const getDaysInMonth = (date: Date) => {
        const year = date.getFullYear();
        const month = date.getMonth();
        return new Date(year, month + 1, 0).getDate();
    };

    const getFirstDayOfMonth = (date: Date) => {
        const year = date.getFullYear();
        const month = date.getMonth();
        return new Date(year, month, 1).getDay();
    };

    const previousMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
    };

    const nextMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));
    };

    const getExportsForDate = (day: number) => {
        const dateToCheck = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
        return exportWindows.filter(exp => {
            const expDate = exp.deliveryDate || exp.createdAt;
            return (
                expDate.getDate() === day &&
                expDate.getMonth() === currentDate.getMonth() &&
                expDate.getFullYear() === currentDate.getFullYear()
            );
        });
    };

    const daysInMonth = getDaysInMonth(currentDate);
    const firstDay = getFirstDayOfMonth(currentDate);
    const monthName = currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

    const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6">
            {/* Calendar Header */}
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <CalendarIcon className="w-6 h-6 text-primary" />
                    Export Calendar
                </h3>
                <div className="flex items-center gap-2">
                    <button
                        onClick={previousMonth}
                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                    >
                        ←
                    </button>
                    <span className="text-sm font-semibold text-slate-900 dark:text-white min-w-[140px] text-center">
                        {monthName}
                    </span>
                    <button
                        onClick={nextMonth}
                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                    >
                        →
                    </button>
                </div>
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-2">
                {/* Week day headers */}
                {weekDays.map(day => (
                    <div
                        key={day}
                        className="text-center text-xs font-semibold text-slate-500 dark:text-slate-400 py-2"
                    >
                        {day}
                    </div>
                ))}

                {/* Empty cells for days before month starts */}
                {Array.from({ length: firstDay }).map((_, index) => (
                    <div key={`empty-${index}`} className="aspect-square" />
                ))}

                {/* Calendar days */}
                {Array.from({ length: daysInMonth }).map((_, index) => {
                    const day = index + 1;
                    const exportsOnDay = getExportsForDate(day);
                    const isToday =
                        day === new Date().getDate() &&
                        currentDate.getMonth() === new Date().getMonth() &&
                        currentDate.getFullYear() === new Date().getFullYear();

                    return (
                        <button
                            key={day}
                            onClick={() => onDateClick?.(new Date(currentDate.getFullYear(), currentDate.getMonth(), day))}
                            className={`aspect-square rounded-lg p-1 relative transition-all hover:ring-2 hover:ring-primary ${isToday
                                    ? "bg-primary text-white font-bold"
                                    : exportsOnDay.length > 0
                                        ? "bg-slate-100 dark:bg-slate-700 font-semibold"
                                        : "hover:bg-slate-50 dark:hover:bg-slate-700"
                                }`}
                        >
                            <div className={`text-sm ${isToday ? "text-white" : "text-slate-900 dark:text-white"}`}>
                                {day}
                            </div>
                            {exportsOnDay.length > 0 && (
                                <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
                                    {exportsOnDay.slice(0, 3).map((exp, idx) => (
                                        <div
                                            key={idx}
                                            className={`w-1.5 h-1.5 rounded-full ${exp.status === "delivered"
                                                    ? "bg-green-500"
                                                    : exp.status === "in_transit"
                                                        ? "bg-blue-500"
                                                        : exp.status === "completed"
                                                            ? "bg-purple-500"
                                                            : "bg-yellow-500"
                                                }`}
                                        />
                                    ))}
                                    {exportsOnDay.length > 3 && (
                                        <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                                    )}
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Legend */}
            <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3">Status Legend:</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-yellow-500" />
                        <span className="text-slate-600 dark:text-slate-400">Pending</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-blue-500" />
                        <span className="text-slate-600 dark:text-slate-400">In Transit</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-green-500" />
                        <span className="text-slate-600 dark:text-slate-400">Delivered</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-purple-500" />
                        <span className="text-slate-600 dark:text-slate-400">Completed</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
