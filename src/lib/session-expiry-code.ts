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
