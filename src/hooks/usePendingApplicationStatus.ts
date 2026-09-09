"use client";

import { useState, useEffect } from "react";
import { usePolling } from "@/hooks/usePolling";
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

        return () => {
            cancelled = true;
        };
    }, [userId, collectionName, statusField]);

    //   #538 The 10s repeat, paused while the tab is hidden.
    //
    //   This one matters more than the badges: it is the hook behind every
    //   "your application is being reviewed" waiting screen, which is exactly
    //   the page a user leaves open in a background tab for hours while they
    //   wait. It kept polling the whole time.
    usePolling(async () => {
        if (!userId) return;
        try {
            const result = await getMyApplicationStatus(collectionName, statusField);

            //   #415 A NON-ANSWER MUST NOT OVERWRITE THE LAST REAL ONE.
            if (result.status === "unknown" || result.status === "unauthenticated") {
                setCheckFailed(true);
                setSessionExpired(result.status === "unauthenticated");
                return;
            }

            setCheckFailed(false);
            setSessionExpired(false);
            setStatus(result.status);
            if (result.createdAt) setCreatedAt(new Date(result.createdAt));
            setRejectionReason(result.rejectionReason ?? null);
        } catch (err) {
            setCheckFailed(true);
            logger.error("[usePendingApplicationStatus] status poll failed", { collectionName, err });
        } finally {
            setIsLoading(false);
        }
    }, 10000, { enabled: !!userId, immediate: false, restartKey: `${userId ?? ""}:${collectionName}:${statusField}` });

    return { status, isLoading, rejectionReason, createdAt, checkFailed, sessionExpired };
}
