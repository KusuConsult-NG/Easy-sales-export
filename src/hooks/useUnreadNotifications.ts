import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

export function useUnreadNotifications(userId: string | undefined) {
    const [unreadCount, setUnreadCount] = useState<number>(0);
    const [isLoading, setIsLoading] = useState<boolean>(true);

    useEffect(() => {
        if (!userId) {
            setUnreadCount(0);
            setIsLoading(false);
            return;
        }

        async function fetchCount() {
            try {
                const { count, error } = await supabase
                    .from('document_collections')
                    .select('*', { count: 'exact', head: true })
                    .eq('collection_name', 'notifications')
                    .eq('raw_data->>userId', userId)
                    .eq('raw_data->>read', 'false');

                if (error) throw error;
                setUnreadCount(count ?? 0);
            } catch (err) {
                console.error("Error fetching unread notifications count from Supabase:", err);
            } finally {
                setIsLoading(false);
            }
        }

        fetchCount();

        // Poll every 10 seconds
        const interval = setInterval(fetchCount, 10000);

        return () => clearInterval(interval);
    }, [userId]);

    return { unreadCount, isLoading };
}
