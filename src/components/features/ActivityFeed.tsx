"use client";

import { formatDistanceToNow } from "date-fns";
import { TrendingUp, DollarSign, GraduationCap, Package, ArrowUpRight } from "lucide-react";

interface Activity {
    id: string;
    type: "investment" | "withdrawal" | "enrollment" | "order";
    title: string;
    amount?: number;
    timestamp: Date;
    link?: string;
}

const mockActivities: Activity[] = [
    {
        id: "1",
        type: "investment",
        title: "Invested in Yam Tubers Export - Phase 2",
        amount: 500000,
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        link: "/export",
    },
    {
        id: "2",
        type: "order",
        title: "Placed order for 200kg Sesame Seeds",
        amount: 80000,
        timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 hours ago
        link: "/marketplace",
    },
    {
        id: "3",
        type: "enrollment",
        title: "Enrolled in Export Documentation Mastery",
        timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
        link: "/academy",
    },
    {
        id: "4",
        type: "withdrawal",
        title: "Withdrew from cooperative savings",
        amount: 150000,
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        link: "/cooperatives",
    },
    {
        id: "5",
        type: "investment",
        title: "Invested in Hibiscus Export Window",
        amount: 300000,
        timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
        link: "/export",
    },
];

const getActivityIcon = (type: Activity["type"]) => {
    switch (type) {
        case "investment":
            return <TrendingUp className="w-5 h-5" />;
        case "withdrawal":
            return <DollarSign className="w-5 h-5" />;
        case "enrollment":
            return <GraduationCap className="w-5 h-5" />;
        case "order":
            return <Package className="w-5 h-5" />;
    }
};

const getActivityColor = (type: Activity["type"]) => {
    switch (type) {
        case "investment":
            return "bg-green-100 text-green-600";
        case "withdrawal":
            return "bg-purple-100 text-purple-600";
        case "enrollment":
            return "bg-blue-100 text-blue-600";
        case "order":
            return "bg-orange-100 text-orange-600";
    }
};

export default function ActivityFeed() {
    return (
        <div className="bg-white rounded-2xl p-6 elevation-2">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-slate-900">
                    Recent Activity
                </h3>
                <a
                    href="/activity"
                    className="text-sm font-semibold text-primary hover:underline flex items-center gap-1"
                >
                    View All
                    <ArrowUpRight className="w-4 h-4" />
                </a>
            </div>

            <div className="space-y-4">
                {mockActivities.map((activity, index) => (
                    <div
                        key={activity.id}
                        className="relative flex items-start gap-4 pb-4 last:pb-0 border-b border-slate-100 last:border-0 animate-[slideInUp_0.5s_ease-out]"
                        style={{ animationDelay: `${index * 50}ms` }}
                    >
                        {/* Timeline Connector */}
                        {index < mockActivities.length - 1 && (
                            <div className="absolute left-5 top-12 w-0.5 h-full bg-slate-200" />
                        )}

                        {/* Icon */}
                        <div
                            className={`relative z-10 w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${getActivityColor(
                                activity.type
                            )}`}
                        >
                            {getActivityIcon(activity.type)}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                            <p className="font-semibold text-slate-900 text-sm">
                                {activity.title}
                            </p>
                            {activity.amount && (
                                <p className="text-sm font-semibold text-primary mt-1">
                                    ₦{activity.amount.toLocaleString()}
                                </p>
                            )}
                            <p className="text-xs text-slate-500 mt-1">
                                {formatDistanceToNow(activity.timestamp, { addSuffix: true })}
                            </p>
                        </div>

                        {/* Link Arrow */}
                        {activity.link && (
                            <a
                                href={activity.link}
                                className="text-slate-400 hover:text-primary transition-colors"
                            >
                                <ArrowUpRight className="w-4 h-4" />
                            </a>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
