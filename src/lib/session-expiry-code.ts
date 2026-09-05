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
 *   #411 THE COMMENT SAID "IDENTICAL" AND IT WAS NOT.
 *
 *   This claimed to be "identical to the one in session-guard.ts" while
 *   omitting that guard's `success === false` clause, so it matched any object
 *   carrying the code — including a SUCCESSFUL result that happened to have
 *   one. Six call sites on /messages take an early return on it, so a false
 *   positive is a screen that silently does nothing.
 *
 *   There were THREE statements of this one rule: here, in session-guard.ts,
 *   and a third private copy inside useSessionExpiry.ts that the hook used
 *   instead of importing either. #390's class — and the comment asserting a
 *   sameness that was not there is what made it invisible.
 *
 *   THIS IS NOW THE ONLY DEFINITION. session-guard.ts re-exports it, and the
 *   hook imports it. Nothing changes for live callers: every emitter in
 *   session-guard sets `success: false` alongside the code, checked at all four
 *   sites, so the added clause rejects nothing that is produced today. It
 *   closes the gap between what this file says and what it does.
 *
 *   Client-safe: no server-only imports, so client components can use the same
 *   rule the server writes.
 */
export function isSessionExpired(result: unknown): result is SessionExpiredResult {
    return (
        typeof result === "object" &&
        result !== null &&
        (result as any).success === false &&
        (result as any).code === SESSION_EXPIRED_CODE
    );
}
