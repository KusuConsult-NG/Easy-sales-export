"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { getMyMembershipStatus } from "@/app/actions/my-data";

const MODULE_TO_REG_KEY: Record<string, string> = {
    wave: "wave",
    academy: "academy",
    export: "export",
    cooperative: "cooperatives",
    cooperatives: "cooperatives",
    "farm-nation": "farmNation",
    farmNation: "farmNation",
    marketplace: "marketplace",
};

/**
 * Membership status guard.
 *
 * The lookup runs server-side and is scoped to the session user; `userId` here
 * only gates whether to poll. When the server finds no record it returns
 * "unknown" and the session value is used instead, matching the previous
 * behaviour of falling back rather than locking a member out.
 */
export function useMembershipStatus(userId: string | undefined, moduleType: string, userEmail?: string) {
    const { data: session } = useSession();
    const regKey = MODULE_TO_REG_KEY[moduleType];
    const sessionStatus = session?.user
        ? (session.user as any)?.serviceRegistrations?.[regKey]?.status
        : undefined;

    const [status, setStatus] = useState<string>(() => sessionStatus || "loading");
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        if (!userId) {
            setStatus("unauthenticated");
            return;
        }

        let cancelled = false;

        async function checkStatus() {
            try {
                const result = await getMyMembershipStatus(moduleType);
                if (cancelled) return;

                if (result.status === "unknown") {
                    setStatus(sessionStatus || "not_found");
                    return;
                }

                if (result.data) setData(result.data);
                setStatus(result.status);
            } catch (err) {
                console.error(`[useMembershipStatus] Error checking status for ${moduleType}:`, err);
                if (!cancelled) setStatus("error");
            }
        }

        checkStatus();

        // Poll every 8 seconds
        const interval = setInterval(checkStatus, 8000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [userId, moduleType, userEmail, regKey, sessionStatus]);

    return { status, data, isLoading: status === "loading" };
}
