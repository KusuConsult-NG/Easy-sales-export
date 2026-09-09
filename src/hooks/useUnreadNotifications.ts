"use client";

import { useState, useEffect } from "react";
import { getMyUnreadNotificationCount } from "@/app/actions/my-data";
import { usePolling } from "@/hooks/usePolling";

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
        }
    }, [userId]);

    //   #538 Polls only while the tab is visible. See hooks/usePolling.
    usePolling(async () => {
        if (!userId) return;
        try {
            const count = await getMyUnreadNotificationCount();
            setUnreadCount(count);
        } catch (err) {
            console.error("Error fetching unread notification count:", err);
        } finally {
            setIsLoading(false);
        }
    }, 10000, { enabled: !!userId, restartKey: userId ?? "" });

    return { unreadCount, isLoading };
}
