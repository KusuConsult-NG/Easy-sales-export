import { logger } from "@/lib/logger";

/**
 * The Paystack API host, in one place, and the reason that was dangerous.
 *
 * "https://api.paystack.co" was written out 24 times across 15 files. That is
 * the kind of duplication an audit normally centralises without thinking about
 * it, and this one was deliberately LEFT ALONE for two passes, because the
 * obvious centralisation opens a hole that is worse than the duplication:
 *
 *     const BASE = process.env.PAYSTACK_API_BASE_URL ?? "https://api.paystack.co";
 *
 * Every payment on this platform is confirmed by asking Paystack whether a
 * reference was really paid. Point that question at a host somebody else
 * controls and it answers yes. paystack-verify-no-mock.test.ts exists because
 * an earlier version of this codebase accepted fabricated payments, and a bare
 * env override would reopen exactly that: one variable in a deploy config, and
 * every verification in the platform can be answered by a stub.
 *
 * So the override exists — a local stub is genuinely useful for development —
 * and it is refused where it would matter.
 *
 * TWO GATES, NOT ONE
 * ------------------
 * 1. NODE_ENV === "production" ignores the override outright and logs loudly.
 *    A production deploy always talks to Paystack, whatever its environment
 *    says.
 * 2. Outside production the override must be a LOOPBACK host. A staging deploy
 *    pointed at an attacker's domain is the same attack with a smaller
 *    audience, and "it's only staging" is how a test key ends up confirming a
 *    real order.
 *
 * Both gates fail CLOSED: anything not understood falls back to the live host,
 * which is the value every one of those 24 sites had hardcoded. The worst case
 * of this module misbehaving is the behaviour the codebase had before it.
 *
 * lib/csp.ts is NOT a caller. The Content-Security-Policy has to allow the real
 * Paystack host regardless of what any environment says, and pointing the CSP
 * at an override would let a stub's origin into the policy. It keeps its
 * literal, and paystack-host-cannot-be-redirected.test.ts asserts that it does.
 */

export const PAYSTACK_LIVE_HOST = "https://api.paystack.co";

/** Hosts an override may name outside production. */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function refusalReason(raw: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        return "it is not a URL";
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return `its protocol is ${parsed.protocol}`;
    }

    if (!LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
        return `${parsed.hostname} is not a loopback host`;
    }

    return null;
}

/**
 * The base URL every Paystack call should use.
 *
 * Returns PAYSTACK_LIVE_HOST unless a development environment has named a
 * loopback stub, and never returns anything else in production.
 */
export function paystackBaseUrl(): string {
    const raw = (process.env.PAYSTACK_API_BASE_URL ?? "").trim();
    if (!raw) return PAYSTACK_LIVE_HOST;

    if (process.env.NODE_ENV === "production") {
        logger.error(
            "[paystack] PAYSTACK_API_BASE_URL is set on a PRODUCTION deploy and is being IGNORED. "
            + "Payment verification always talks to the real Paystack. Remove it from the deploy config.",
            undefined,
        );
        return PAYSTACK_LIVE_HOST;
    }

    const refused = refusalReason(raw);
    if (refused) {
        logger.error(
            `[paystack] PAYSTACK_API_BASE_URL is being IGNORED because ${refused}. `
            + "Only a loopback stub is honoured, and only outside production.",
            undefined,
        );
        return PAYSTACK_LIVE_HOST;
    }

    logger.warn(
        `[paystack] Using the local stub at ${raw}. Payment verification is NOT talking to Paystack.`,
    );
    return raw.replace(/\/+$/, "");
}
