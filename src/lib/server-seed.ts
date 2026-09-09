import "server-only";

import { logger } from "@/lib/logger";

/**
 * Unwrap an action result for a server-rendered seed, and SAY SO when it fails.
 *
 *   #551 A FAILED SERVER SEED WAS COMPLETELY SILENT.
 *
 *   Every page converted in #546–#551 does the same thing:
 *
 *       const result = await someAction().catch(() => null);
 *       const initial = result?.success && result.data ? result.data : null;
 *
 *   That is correct behaviour — a null seed makes the client fetch exactly as
 *   it always did, so the screen still works and still shows its own error — and
 *   it reads `success` while never reading `error`. So a server-side read that
 *   FAILED left nothing anywhere: no log line, no metric, nothing. The symptom
 *   is a screen that is quietly slower than it should be, on every request,
 *   for a reason nobody can see.
 *
 *   #319's ratchet caught it. Three new sites pushed its "success checked,
 *   error never read" count from 87 to 90, and the temptation was to raise the
 *   number. Raising a ratchet to accommodate new code is precisely what
 *   ratchets exist to prevent, and the check was RIGHT: the error really was
 *   being dropped.
 *
 * ── WHY A HELPER AND NOT A LINE IN EACH PAGE ────────────────────────────────
 *
 *   Because there are twenty-five of these now and there will be more. Written
 *   out per page it is four lines of near-identical unwrapping, which is how
 *   this codebase grew most of the drift this audit keeps finding — the same
 *   contract, restated, until the restatements disagree.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────
 *
 *   It does not throw, and it does not turn a failure into an error page. The
 *   whole design of the seed is that it is an OPTIMISATION: when it works the
 *   screen arrives populated, and when it does not the client falls back to the
 *   behaviour it had before any of this. Making a seed failure fatal would take
 *   a working screen and break it to save a round trip.
 */
export function seedOrNull<T>(
    label: string,
    result: { success?: boolean; error?: unknown; data?: T | null } | null | undefined,
): T | null {
    if (!result) {
        //   `.catch(() => null)` upstream: the action threw rather than
        //   returning a refusal.
        logger.warn(`[server-seed] ${label}: the read threw; the client will fetch instead`);
        return null;
    }

    if (!result.success) {
        logger.warn(`[server-seed] ${label}: refused; the client will fetch instead`, {
            error: result.error ?? null,
        });
        return null;
    }

    return (result.data ?? null) as T | null;
}
