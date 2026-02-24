"use client";

/**
 * useSessionExpiry
 *
 * Drop-in wrapper around server actions that automatically detects a SESSION_EXPIRED
 * sentinel and signs the user out, redirecting them to /auth/login?callbackUrl=<current page>.
 *
 * Usage:
 *   const { run } = useSessionExpiry();
 *   const result = await run(someServerAction(args));
 *
 * Or wrap a specific action:
 *   const { wrap } = useSessionExpiry();
 *   const safeAction = wrap(someServerAction);
 *   const result = await safeAction(args);
 */

import { useCallback } from "react";
import { signOut } from "next-auth/react";
// ⚠️ Import ONLY from the client-safe constants file — never from session-guard.ts
import { SESSION_EXPIRED_CODE } from "@/lib/session-expiry-code";

function isSessionExpiredResult(result: unknown): boolean {
    return (
        typeof result === "object" &&
        result !== null &&
        (result as any).success === false &&
        (result as any).code === SESSION_EXPIRED_CODE
    );
}

export function useSessionExpiry() {
    const handleExpiry = useCallback(() => {
        const callbackUrl =
            typeof window !== "undefined"
                ? window.location.pathname + window.location.search
                : "/";
        signOut({
            callbackUrl: `/auth/login?callbackUrl=${encodeURIComponent(callbackUrl)}`,
        });
    }, []);

    const run = useCallback(
        async <T>(promise: Promise<T>): Promise<T> => {
            const result = await promise;
            if (isSessionExpiredResult(result)) {
                handleExpiry();
            }
            return result;
        },
        [handleExpiry]
    );

    const wrap = useCallback(
        <TArgs extends unknown[], TReturn>(
            actionFn: (...args: TArgs) => Promise<TReturn>
        ) =>
            async (...args: TArgs): Promise<TReturn> => {
                return run(actionFn(...args));
            },
        [run]
    );

    return { run, wrap, handleExpiry };
}
