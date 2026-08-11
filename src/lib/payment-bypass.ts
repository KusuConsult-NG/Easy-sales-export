/**
 * Accounts that skip payment gating.
 *
 * WHAT THIS REPLACES
 * ------------------
 * The literal string "zeredogo@gmail.com" appeared **seventeen times** across
 * eight files — cooperative onboarding, academy payment, module access, and two
 * layouts — each granting `paymentStatus = "completed"` or equivalent. The code
 * calls it a "Unified Bypass"; it was unified in name only.
 *
 * IS IT A VULNERABILITY?
 * ----------------------
 * No, and that was checked rather than assumed:
 *
 *   - there is no self-service action that changes a user's email
 *   - registration rejects a duplicate via adminAuth.getUserByEmail
 *   - /api/auth/register returns 404 in production anyway
 *
 * So an attacker cannot obtain the address, and the bypass is not reachable by
 * anyone else. It is a deliberate owner/test account.
 *
 * WHY CONSOLIDATE IT ANYWAY
 * -------------------------
 * A security-relevant rule that exists seventeen times is a rule that will
 * eventually differ in one of them — the defect this codebase has produced
 * repeatedly. Seventeen copies also cannot be turned off: removing the bypass
 * before a launch, or auditing who has it, means finding every one.
 *
 * BEHAVIOUR IS DELIBERATELY UNCHANGED
 * -----------------------------------
 * The default is exactly the address that was hard-coded, so today this does
 * the same thing in the same places. What changes is that it can now be altered
 * or switched off with an environment variable instead of a deploy, and that
 * there is one place to look.
 *
 * To disable entirely in production, set PAYMENT_BYPASS_EMAILS to an empty
 * string.
 */

import { logger } from "@/lib/logger";

/** The address that was hard-coded in all seventeen places. */
const DEFAULT_BYPASS_EMAILS = "zeredogo@gmail.com";

function bypassList(): string[] {
    const raw = process.env.PAYMENT_BYPASS_EMAILS ?? DEFAULT_BYPASS_EMAILS;
    return raw
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
}

/**
 * Does this account skip payment gating?
 *
 * Compared case-insensitively. The original comparisons were exact-match, so
 * `Zeredogo@gmail.com` did not match — which meant the bypass silently failed
 * for the very account it exists for, depending on how the address was typed at
 * sign-up. Normalising is a fix, not a widening: an attacker still cannot hold
 * the address in any casing.
 */
export function isPaymentBypassAccount(email: string | null | undefined): boolean {
    if (!email) return false;

    const normalised = email.trim().toLowerCase();
    const allowed = bypassList();
    const match = allowed.includes(normalised);

    if (match) {
        // Logged every time, so a bypass in production is visible rather than
        // silent. Seventeen scattered copies logged in three of them.
        logger.info("[payment-bypass] payment gating skipped", { email: normalised });
    }

    return match;
}

/** True when any bypass is configured at all — useful for a startup warning. */
export function paymentBypassEnabled(): boolean {
    return bypassList().length > 0;
}
