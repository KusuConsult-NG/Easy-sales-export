"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import type { Announcement } from "@/app/actions/cms";
import { getActiveAnnouncementsAction } from "@/app/actions/cms";

export default function AnnouncementBanner() {
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());

    useEffect(() => {
        /**
         *   #347 THIS TOOK THE WHOLE DASHBOARD DOWN.
         *
         *        The original was three unguarded lines inside an effect:
         *
         *            const stored = localStorage.getItem("dismissed_announcements");
         *            if (stored) {
         *                setDismissed(new Set(JSON.parse(stored)));
         *            }
         *
         *        This component renders on /dashboard, the screen every signed-in
         *        member lands on. Three separate throws are possible, and a throw
         *        in a "use client" effect is not a missing banner — it unmounts
         *        the tree to the nearest error boundary, so the member sees the
         *        error page instead of their dashboard:
         *
         *          localStorage itself   throws in Safari private browsing and
         *                                wherever site data is blocked. The
         *                                getItem call was the FIRST statement in
         *                                the effect, so nothing below it ran.
         *          JSON.parse            throws on any malformed value — a
         *                                truncated write, an extension, a
         *                                half-finished quota-exceeded set.
         *          new Set(x)            throws on a non-iterable. `"5"` parses
         *                                fine and `new Set(5)` is a TypeError, so
         *                                a value that is valid JSON still breaks
         *                                it.
         *
         *        And the state is a list of dismissed banner ids. The worst
         *        honest outcome of failing to read it is that a member sees a
         *        banner they had dismissed. That is the behaviour on any fault
         *        now, and the bad value is cleared so the next visit is clean.
         */
        try {
            const stored = localStorage.getItem("dismissed_announcements");
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    setDismissed(new Set(parsed.filter((id): id is string => typeof id === "string")));
                } else {
                    localStorage.removeItem("dismissed_announcements");
                }
            }
        } catch {
            // Unreadable, unparseable or unusable. Start from "nothing
            // dismissed" and drop the value rather than failing every render.
            try { localStorage.removeItem("dismissed_announcements"); } catch { /* storage is gone entirely */ }
        }

        async function fetchAnnouncements() {
            try {
                const list = await getActiveAnnouncementsAction();
                // Sort by createdAt desc
                list.sort((a, b) => {
                    const dateA = new Date(a.createdAt || 0).getTime();
                    const dateB = new Date(b.createdAt || 0).getTime();
                    return dateB - dateA;
                });
                setAnnouncements(list);
            } catch (error) {
                console.error("Failed to fetch announcements:", error);
            }
        }

        fetchAnnouncements();
    }, []);

    function handleDismiss(id: string) {
        const newDismissed = new Set(dismissed);
        newDismissed.add(id);
        setDismissed(newDismissed);
        // #347 The write can throw too — a blocked store, or the quota. The
        // banner is dismissed for this page view either way; only the
        // remembering is lost.
        try {
            localStorage.setItem("dismissed_announcements", JSON.stringify(Array.from(newDismissed)));
        } catch { /* the dismissal does not survive a reload; the page does */ }
    }

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
