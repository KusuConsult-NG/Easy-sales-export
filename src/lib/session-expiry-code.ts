/**
 * session-expiry-code.ts
 *
 * Client-safe module — NO server-only imports.
 * Exports the SESSION_EXPIRED sentinel constant that both server
 * (session-guard.ts) and client (useSessionExpiry.ts) can import.
 */

export const SESSION_EXPIRED_CODE = "SESSION_EXPIRED" as const;

export type SessionExpiredCode = typeof SESSION_EXPIRED_CODE;

export type SessionExpiredResult = {
    success: false;
    code: SessionExpiredCode;
    error: string;
};

/**
 * Client-safe type guard — identical to the one in session-guard.ts but
 * importable by client components without pulling in 'server-only'.
 */
export function isSessionExpired(result: unknown): result is SessionExpiredResult {
    return (
        typeof result === "object" &&
        result !== null &&
        (result as any).code === SESSION_EXPIRED_CODE
    );
}
