/**
 * Session stub for @easy-sales/auth
 *
 * In Phase 2+, this will contain the full requireSession implementation.
 * For now it re-exports the type contract.
 */

export type SessionResult =
    | { session: { user: { id: string; email: string; roles: string[] } }; error: null }
    | { session: null; error: { error: string } };

/**
 * Stub — actual implementation lives in src/lib/session-guard.ts
 * This type export allows packages to reference the contract.
 */
export declare function requireSession(): Promise<SessionResult>;
