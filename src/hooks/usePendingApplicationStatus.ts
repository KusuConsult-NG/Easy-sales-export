"use client";

import { useState, useEffect } from "react";
import { getMyApplicationStatus } from "@/app/actions/my-data";

interface UsePendingApplicationStatusOptions {
    collectionName: string;
    userId: string | undefined;
    statusField: string; // e.g., 'status', or 'farmNation' for nested user check
}

/**
 * Polls the status of the caller's most recent application.
 *
 * The collection and status field are validated against an allowlist on the
 * server, which also scopes the lookup to the session user — `userId` here
 * only gates whether to poll at all.
 */
export function usePendingApplicationStatus({
    collectionName,
    userId,
    statusField,
}: UsePendingApplicationStatusOptions) {
    const [status, setStatus] = useState<string>("pending");
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [rejectionReason, setRejectionReason] = useState<string | null>(null);
    const [createdAt, setCreatedAt] = useState<Date | null>(null);

    useEffect(() => {
        if (!userId) {
            setIsLoading(false);
            return;
        }

        let cancelled = false;

        async function checkStatus() {
            try {
                const result = await getMyApplicationStatus(collectionName, statusField);
                if (cancelled) return;

                setStatus(result.status);
                if (result.createdAt) setCreatedAt(new Date(result.createdAt));
                if (result.rejectionReason) setRejectionReason(result.rejectionReason);
            } catch (err) {
                console.error("usePendingApplicationStatus error:", err);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        }

        checkStatus();

        // Poll every 10 seconds
        const interval = setInterval(checkStatus, 10000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [userId, collectionName, statusField]);

    return { status, isLoading, rejectionReason, createdAt };
}
