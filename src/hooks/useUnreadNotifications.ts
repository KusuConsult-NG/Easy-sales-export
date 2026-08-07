"use client";

import { useState, useEffect } from "react";
import { getMyUnreadNotificationCount } from "@/app/actions/my-data";

/**
 * Unread notification count for the signed-in user.
 *
 * `userId` only gates whether to poll — the count is always resolved from the
 * session on the server, so a browser-supplied id cannot widen what is read.
 */
export function useUnreadNotifications(userId: string | undefined) {
    const [unreadCount, setUnreadCount] = useState<number>(0);
    const [isLoading, setIsLoading] = useState<boolean>(true);

    useEffect(() => {
        if (!userId) {
            setUnreadCount(0);
            setIsLoading(false);
            return;
        }

        let cancelled = false;

        async function fetchCount() {
            try {
                const count = await getMyUnreadNotificationCount();
                if (!cancelled) setUnreadCount(count);
            } catch (err) {
                console.error("Error fetching unread notification count:", err);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        }

        fetchCount();

        // Poll every 10 seconds
        const interval = setInterval(fetchCount, 10000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [userId]);

    return { unreadCount, isLoading };
}
