"use client";

import { LucideIcon, TrendingUp, DollarSign, Package, ShoppingCart, Users, Activity, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// Icon mapping
const iconMap: Record<string, LucideIcon> = {
    TrendingUp,
    DollarSign,
    Package,
    ShoppingCart,
    Users,
    Activity,
    AlertCircle
};

interface StatCardProps {
    title: string;
    value: string | number;
    subtitle?: string;
    icon: string;
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
    const Icon = iconMap[icon] || Package; // Fallback to Package icon

    return (
        <div
            className={cn(
                //   #805 The admin surface's own card: the ring is what the
                //   dashboard's tiles already use, and without it this
                //   component sat a shade flatter than everything beside it.
                "bg-white rounded-2xl p-6 elevation-2 hover-lift ring-1 ring-slate-200/50",
                "animate-[slideInUp_0.6s_cubic-bezier(0.4,0,0.2,1)_both]",
                //   Respect a reader who has asked for less movement.
                "motion-reduce:animate-none motion-reduce:transition-none",
                className
            )}
            style={{ animationDelay: `${delay}ms` }}
        >
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                        {title}
                    </p>
                    {/*
                      *   #805 tabular-nums. Stat tiles sit in a row and their
                      *   figures are read DOWN the column as much as across —
                      *   proportional digits make the same number look like a
                      *   different length on every card.
                      */}
                    <h3 className="text-3xl font-bold text-slate-900 mb-1 tabular-nums">
                        {value}
                    </h3>
                    {subtitle && (
                        <p className="text-xs text-slate-600">
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
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Icon className="w-6 h-6 text-primary" />
                </div>
            </div>
        </div>
    );
}
