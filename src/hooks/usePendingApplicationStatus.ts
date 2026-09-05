"use client";

import { useState, useEffect } from "react";
import { getMyApplicationStatus } from "@/app/actions/my-data";
import { logger } from "@/lib/logger";

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
    /** #415. The poll could not answer — distinct from "the answer is pending". */
    const [checkFailed, setCheckFailed] = useState<boolean>(false);
    /** #415. The server had no session. The page cannot say anything useful. */
    const [sessionExpired, setSessionExpired] = useState<boolean>(false);

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

                //   #415 A NON-ANSWER MUST NOT OVERWRITE THE LAST REAL ONE.
                //
                //   The action now distinguishes "could not read" from
                //   "pending". Writing that into `status` would be the same
                //   defect wearing a different word: a screen showing
                //   "Approved" would flip back to the waiting page the moment
                //   one poll failed. The last known status stands; the failure
                //   is reported alongside it.
                if (result.status === "unknown" || result.status === "unauthenticated") {
                    setCheckFailed(true);
                    setSessionExpired(result.status === "unauthenticated");
                    return;
                }

                setCheckFailed(false);
                setSessionExpired(false);
                setStatus(result.status);
                if (result.createdAt) setCreatedAt(new Date(result.createdAt));
                // #415. Assigned rather than only ever set: a reapplication
                // that is later approved used to keep displaying the reason it
                // was rejected the first time.
                setRejectionReason(result.rejectionReason ?? null);
            } catch (err) {
                if (cancelled) return;
                setCheckFailed(true);
                logger.error("[usePendingApplicationStatus] status poll failed", { collectionName, err });
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

    return { status, isLoading, rejectionReason, createdAt, checkFailed, sessionExpired };
}
