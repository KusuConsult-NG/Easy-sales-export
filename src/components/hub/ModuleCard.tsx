"use client";

import { LucideIcon } from "lucide-react";
import Link from "next/link";

interface ModuleCardProps {
    title: string;
    description: string;
    icon: LucideIcon;
    href: string;
    gradient: string;
    stats?: string;
    isNew?: boolean;
}

export default function ModuleCard({
    title,
    description,
    icon: Icon,
    href,
    gradient,
    stats,
    isNew = false,
}: ModuleCardProps) {
    return (
        <Link href={href}>
            <div className="group relative bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 border border-slate-200 dark:border-slate-700 overflow-hidden">
                {/* Gradient overlay on hover */}
                <div className={`absolute inset-0 bg-linear-to-br ${gradient} opacity-0 group-hover:opacity-10 transition-opacity duration-300`} />

                {/* New Badge */}
                {isNew && (
                    <div className="absolute top-4 right-4 px-3 py-1 bg-primary rounded-full text-xs font-bold text-white">
                        NEW
                    </div>
                )}

                {/* Icon */}
                <div className={`w-14 h-14 rounded-xl bg-linear-to-br ${gradient} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
                    <Icon className="w-7 h-7 text-white" />
                </div>

                {/* Content */}
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2 group-hover:text-primary transition-colors">
                    {title}
                </h3>
                <p className="text-slate-600 dark:text-slate-400 text-sm mb-4 line-clamp-2">
                    {description}
                </p>

                {/* Stats */}
                {stats && (
                    <div className="text-xs font-semibold text-primary mb-4">
                        {stats}
                    </div>
                )}

                {/* CTA */}
                <div className="flex items-center text-sm font-semibold text-primary group-hover:gap-2 transition-all">
                    Explore
                    <span className="inline-block group-hover:translate-x-1 transition-transform ml-1">→</span>
                </div>
            </div>
        </Link>
    );
}
