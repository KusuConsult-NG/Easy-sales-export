"use client";

import { LucideIcon } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

interface ModuleCardProps {
    title: string;
    description: string;
    icon?: LucideIcon;
    iconImage?: string;
    iconSize?: "md" | "lg" | "xl";
    href: string;
    gradient: string;
    stats?: string;
    isNew?: boolean;
}

export default function ModuleCard({
    title,
    description,
    icon: Icon,
    iconImage,
    iconSize = "md",
    href,
    gradient,
    stats,
    isNew = false,
}: ModuleCardProps) {
    const sizeClasses = iconSize === "xl" ? "w-36 h-36" : iconSize === "lg" ? "w-24 h-24" : "w-20 h-20";
    const imgDim = iconSize === "xl" ? 144 : iconSize === "lg" ? 96 : 80;
    return (
        <Link href={href}>
            <div className="group relative bg-white rounded-2xl p-6 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 border border-slate-200 overflow-hidden">


                {/* Icon */}
                {iconImage ? (
                    <div className={`${sizeClasses} mb-4 group-hover:scale-110 transition-transform duration-300`}>
                        <Image
                            src={iconImage}
                            alt={title}
                            width={imgDim}
                            height={imgDim}
                            className="w-full h-full object-cover"
                        />
                    </div>
                ) : Icon ? (
                    <div className={`w-14 h-14 rounded-xl bg-linear-to-br ${gradient} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
                        <Icon className="w-7 h-7 text-white" />
                    </div>
                ) : null}

                {/* Content */}
                <h3 className="text-xl font-bold text-slate-900 mb-2 group-hover:text-primary transition-colors">
                    {title}
                </h3>
                <p className="text-slate-600 text-sm mb-4 line-clamp-2">
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
