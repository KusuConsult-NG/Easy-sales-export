"use client";

import {
    TrendingUp,
    DollarSign,
    Package,
    ShoppingCart,
    LucideIcon
} from "lucide-react";
import { cn } from "@/lib/utils";

// Icon mapping
const iconMap: Record<string, LucideIcon> = {
    TrendingUp,
    DollarSign,
    Package,
    ShoppingCart,
};

interface StatCardProps {
    title: string;
    value: string | number;
    subtitle?: string;
    icon: string; // Changed to string
    trend?: {
        value: string;
        isPositive: boolean;
    };
    className?: string;
    delay?: number;
}

export function StatCard({
    title,
    value,
    subtitle,
    icon,
    trend,
    className,
    delay = 0,
}: StatCardProps) {
    const Icon = iconMap[icon];

    return (
        <div
            className={cn(
                "bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 hover-lift",
                "animate-[slideInUp_0.6s_cubic-bezier(0.4,0,0.2,1)_both]",
                className
            )}
            style={{ animationDelay: `${delay}ms` }}
        >
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                        {title}
                    </p>
                    <h3 className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
                        {value}
                    </h3>
                    {subtitle && (
                        <p className="text-xs text-slate-600 dark:text-slate-300">
                            {subtitle}
                        </p>
                    )}
                    {trend && (
                        <div
                            className={cn(
                                "flex items-center gap-1 mt-2 text-xs font-semibold",
                                trend.isPositive ? "text-green-600" : "text-red-600"
                            )}
                        >
                            <span>{trend.isPositive ? "↑" : "↓"}</span>
                            <span>{trend.value}</span>
                        </div>
                    )}
                </div>
                {Icon && (
                    <div className="w-12 h-12 rounded-xl bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
                        <Icon className="w-6 h-6 text-primary" />
                    </div>
                )}
            </div>
        </div>
    );
}
