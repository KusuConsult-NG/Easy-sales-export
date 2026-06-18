"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import type { Announcement } from "@/app/actions/cms";

import { db } from "@/lib/firebase";
import { collection, query, onSnapshot } from "firebase/firestore";

export default function AnnouncementBanner() {
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());

    useEffect(() => {
        // Load dismissed from localStorage
        const stored = localStorage.getItem("dismissed_announcements");
        if (stored) {
            setDismissed(new Set(JSON.parse(stored)));
        }

        // Real-time subscription to announcements in Firestore
        const q = query(collection(db, "announcements"));
        const unsub = onSnapshot(q, (snap) => {
            const list: Announcement[] = [];
            snap.forEach((doc) => {
                const data = doc.data();
                const isActive = data.active !== false;
                if (isActive) {
                    list.push({
                        id: doc.id,
                        title: data.title || "Announcement",
                        content: data.message || data.content || "",
                        type: data.type || "info",
                        targetAudience: data.targetAudience || "all",
                        priority: data.priority || "medium",
                        publishedAt: data.publishedAt || data.createdAt,
                        createdBy: data.createdBy || "admin",
                        createdAt: data.createdAt,
                        active: true
                    } as Announcement);
                }
            });

            // Sort by createdAt desc
            list.sort((a, b) => {
                const dateA = a.createdAt?.seconds 
                    ? a.createdAt.seconds * 1000 
                    : (a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime());
                const dateB = b.createdAt?.seconds 
                    ? b.createdAt.seconds * 1000 
                    : (b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime());
                return dateB - dateA;
            });

            setAnnouncements(list);
        }, (error) => {
            console.error("Announcements listener failed:", error);
        });

        return () => unsub();
    }, []);

    function handleDismiss(id: string) {
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
            info: "bg-blue-50 border-blue-200",
            warning: "bg-amber-50 border-amber-200",
            success: "bg-emerald-50 border-emerald-200",
            emergency: "bg-red-50 border-red-200",
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
                                <h3 className="font-semibold text-slate-900">
                                    {announcement.title}
                                </h3>
                                <p className="text-sm text-slate-600 mt-1">
                                    {announcement.content}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => handleDismiss(announcement.id!)}
                            className="p-1 hover:bg-black/5 rounded transition"
                        >
                            <X className="w-5 h-5 text-slate-500" />
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
