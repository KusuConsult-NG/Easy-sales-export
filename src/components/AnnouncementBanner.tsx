"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import type { Announcement } from "@/app/actions/cms";

export default function AnnouncementBanner() {
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());

    useEffect(() => {
        // Load dismissed from localStorage
        const stored = localStorage.getItem("dismissed_announcements");
        if (stored) {
            setDismissed(new Set(JSON.parse(stored)));
        }

        // Mock announcements - in real app, fetch from API
        setAnnouncements([
            {
                id: "1",
                title: "Platform Maintenance Notice",
                content: "Scheduled maintenance on Sunday 3AM - 6AM WAT",
                type: "warning",
                targetAudience: "all",
                priority: "high",
                publishedAt: { seconds: Date.now() / 1000 } as any,
                createdBy: "admin",
                createdAt: { seconds: Date.now() / 1000 } as any,
                active: true,
            },
        ]);
    }, []);

    const handleDismiss = (id: string) => {
        const newDismissed = new Set(dismissed);
        newDismissed.add(id);
        setDismissed(newDismissed);
        localStorage.setItem("dismissed_announcements", JSON.stringify(Array.from(newDismissed)));
    };

    const visibleAnnouncements = announcements.filter(
        (a) => !dismissed.has(a.id || "")
    );

    if (visibleAnnouncements.length === 0) {
        return null;
    }

    const getTypeStyles = (type: string) => {
        const styles = {
            info: "bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800",
            warning: "bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800",
            success: "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800",
            emergency: "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800",
        };
        return styles[type as keyof typeof styles] || styles.info;
    };

    const getIconColor = (type: string) => {
        const colors = {
            info: "text-blue-600",
            warning: "text-amber-600",
            success: "text-emerald-600",
            emergency: "text-red-600",
        };
        return colors[type as keyof typeof colors] || colors.info;
    };

    return (
        <div className="space-y-2">
            {visibleAnnouncements.map((announcement) => (
                <div
                    key={announcement.id}
                    className={`border rounded-lg p-4 ${getTypeStyles(announcement.type)}`}
                >
                    <div className="flex items-start justify-between">
                        <div className="flex items-start space-x-3 flex-1">
                            <Bell className={`w-5 h-5 mt-0.5 ${getIconColor(announcement.type)}`} />
                            <div className="flex-1">
                                <h3 className="font-semibold text-slate-900 dark:text-white">
                                    {announcement.title}
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                                    {announcement.content}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => handleDismiss(announcement.id!)}
                            className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded transition"
                        >
                            <X className="w-5 h-5 text-slate-500" />
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
