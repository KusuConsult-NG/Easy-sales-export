"use client";

import { useState, useEffect } from "react";
import { Clock, TrendingUp } from "lucide-react";

interface CountdownTimerProps {
    endDate: Date;
    onExpire?: () => void;
}

export default function CountdownTimer({ endDate, onExpire }: CountdownTimerProps) {
    const [timeRemaining, setTimeRemaining] = useState({
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        expired: false,
    });

    useEffect(() => {
        const calculateTime = () => {
            const now = new Date().getTime();
            const end = new Date(endDate).getTime();
            const diff = end - now;

            if (diff <= 0) {
                setTimeRemaining({ days: 0, hours: 0, minutes: 0, seconds: 0, expired: true });
                if (onExpire) onExpire();
                return;
            }

            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);

            setTimeRemaining({ days, hours, minutes, seconds, expired: false });
        };

        calculateTime();
        const interval = setInterval(calculateTime, 1000);

        return () => clearInterval(interval);
    }, [endDate, onExpire]);

    if (timeRemaining.expired) {
        return (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-center">
                <p className="text-red-800 dark:text-red-200 font-semibold">Window Expired</p>
            </div>
        );
    }

    return (
        <div className="bg-linear-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
            <div className="flex items-center justify-center space-x-2 mb-4">
                <Clock className="w-5 h-5 text-blue-600" />
                <p className="text-sm font-medium text-blue-900 dark:text-blue-100">Time Remaining</p>
            </div>

            <div className="grid grid-cols-4 gap-4">
                <div className="text-center">
                    <div className="bg-white dark:bg-slate-800 rounded-lg p-3 shadow-sm">
                        <p className="text-3xl font-bold text-blue-600">{timeRemaining.days}</p>
                    </div>
                    <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">Days</p>
                </div>

                <div className="text-center">
                    <div className="bg-white dark:bg-slate-800 rounded-lg p-3 shadow-sm">
                        <p className="text-3xl font-bold text-blue-600">{String(timeRemaining.hours).padStart(2, "0")}</p>
                    </div>
                    <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">Hours</p>
                </div>

                <div className="text-center">
                    <div className="bg-white dark:bg-slate-800 rounded-lg p-3 shadow-sm">
                        <p className="text-3xl font-bold text-blue-600">{String(timeRemaining.minutes).padStart(2, "0")}</p>
                    </div>
                    <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">Minutes</p>
                </div>

                <div className="text-center">
                    <div className="bg-white dark:bg-slate-800 rounded-lg p-3 shadow-sm">
                        <p className="text-3xl font-bold text-blue-600">{String(timeRemaining.seconds).padStart(2, "0")}</p>
                    </div>
                    <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">Seconds</p>
                </div>
            </div>
        </div>
    );
}
