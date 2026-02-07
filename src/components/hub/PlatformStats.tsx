"use client";

import { useEffect, useState } from "react";
import { Users, Package, ShoppingCart, GraduationCap, TrendingUp } from "lucide-react";

interface Stat {
    label: string;
    value: number;
    icon: React.ElementType;
    suffix?: string;
}

export default function PlatformStats() {
    const [counts, setCounts] = useState({ users: 0, exports: 0, products: 0, courses: 0 });

    const stats: Stat[] = [
        { label: "Registered Users", value: 15420, icon: Users },
        { label: "Active Exports", value: 1247, icon: Package },
        { label: "Marketplace Products", value: 3856, icon: ShoppingCart },
        { label: "Courses Completed", value: 8932, icon: GraduationCap },
    ];

    // Animated counter effect
    useEffect(() => {
        const duration = 2000; // 2 seconds
        const steps = 60;
        const interval = duration / steps;

        let currentStep = 0;
        const timer = setInterval(() => {
            currentStep++;
            const progress = currentStep / steps;

            setCounts({
                users: Math.floor(stats[0].value * progress),
                exports: Math.floor(stats[1].value * progress),
                products: Math.floor(stats[2].value * progress),
                courses: Math.floor(stats[3].value * progress),
            });

            if (currentStep >= steps) {
                clearInterval(timer);
                setCounts({
                    users: stats[0].value,
                    exports: stats[1].value,
                    products: stats[2].value,
                    courses: stats[3].value,
                });
            }
        }, interval);

        return () => clearInterval(timer);
    }, []);

    const displayValues = [counts.users, counts.exports, counts.products, counts.courses];

    return (
        <div className="py-20 bg-slate-50 dark:bg-slate-900">
            <div className="max-w-7xl mx-auto px-4">
                <div className="text-center mb-12">
                    <h2 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-4">
                        Our Growing Community
                    </h2>
                    <p className="text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
                        Join thousands of farmers, traders, and learners transforming
                        agricultural commerce across Nigeria
                    </p>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                    {stats.map((stat, index) => {
                        const Icon = stat.icon;
                        return (
                            <div
                                key={stat.label}
                                className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg text-center animate-[slideInUp_0.6s_ease-out]"
                                style={{ animationDelay: `${index * 100}ms` }}
                            >
                                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-4">
                                    <Icon className="w-6 h-6 text-primary" />
                                </div>
                                <div className="text-4xl font-bold text-primary mb-2">
                                    {displayValues[index].toLocaleString()}
                                    {stat.suffix || ''}
                                </div>
                                <div className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                                    {stat.label}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Trust Badge */}
                <div className="mt-12 text-center">
                    <div className="inline-flex items-center gap-2 px-6 py-3 bg-green-500/10 border border-green-500/30 rounded-full">
                        <TrendingUp className="w-5 h-5 text-green-600 dark:text-green-400" />
                        <span className="text-sm font-semibold text-green-700 dark:text-green-400">
                            Growing 25% month-over-month
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
