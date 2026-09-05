"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { getMyMembershipStatus } from "@/app/actions/my-data";

/**
 *   #418 THE BROWSER'S MAP WAS NARROWER THAN THE SERVER'S, ON THE TWO MODULES
 *   THAT HAVE TWO SPELLINGS.
 *
 *   This mapped each module to ONE registration key. The server's
 *   MEMBERSHIP_MODULES in my-data.ts maps the same two modules to a LIST —
 *   ["cooperatives", "cooperative"] and ["farmNation", "farm_nation"] — and
 *   lib/schema-normalizer.ts exists specifically to mirror those pairs, because
 *   both spellings are written: admin/_legacy.ts writes
 *   `serviceRegistrations.cooperative` and `serviceRegistrations.farm_nation`,
 *   and payments/service.ts writes `farm_nation`.
 *
 *   The browser session is where it bit. lib/auth.ts puts
 *   `profile.serviceRegistrations` into the token verbatim, with no mirroring,
 *   so a member whose registration is stored under the legacy spelling has a
 *   session that carries `cooperative` and not `cooperatives` — and this hook
 *   looked only at the second.
 *
 *   WHAT THAT DID, STATED EXACTLY. `sessionStatus` seeds the first render and is
 *   the fallback when the server answers "unknown". So for those members the
 *   first paint was "loading" instead of their real status, until the poll
 *   returned. It was NOT a lockout: the server's lookup reads both spellings and
 *   answers with the real status, so the "unknown" fallback is not reached for
 *   them. Recorded as the first-paint inconsistency it is, not dressed up.
 *
 *   Both spellings are read now, in the server's order, so the browser and the
 *   server answer from the same keys.
 */
const MODULE_TO_REG_KEYS: Record<string, string[]> = {
    wave: ["wave"],
    academy: ["academy"],
    export: ["export"],
    cooperative: ["cooperatives", "cooperative"],
    cooperatives: ["cooperatives", "cooperative"],
    "farm-nation": ["farmNation", "farm_nation"],
    farmNation: ["farmNation", "farm_nation"],
    marketplace: ["marketplace"],
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
    const regKeys = MODULE_TO_REG_KEYS[moduleType] ?? [];
    const registrations = session?.user
        ? (session.user as any)?.serviceRegistrations
        : undefined;
    // First spelling that carries a status wins — the server's order.
    const sessionStatus = regKeys
        .map((key) => registrations?.[key]?.status)
        .find((s) => s !== undefined);

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
    }, [userId, moduleType, userEmail, sessionStatus]);

    return { status, data, isLoading: status === "loading" };
}
