/**
 * Who the caller actually is, as far as our own infrastructure can tell.
 *
 *   #260 THE CLIENT IP WAS WHATEVER THE CLIENT SAID IT WAS.
 *
 *        Four copies of one rule, all taking the LEFTMOST entry:
 *
 *          rate-limiter.ts  getClientIp        forwarded.split(',')[0]
 *          rate-limiter.ts  getActionClientIp  forwarded.split(',')[0]
 *          rate-limit.ts    apiRateLimit       ...split(',')[0] || 'anonymous'
 *          audit-log.ts     getSecurityContext ...split(',')[0]
 *
 *        `X-Forwarded-For` is an APPEND-ONLY list. Each proxy appends the
 *        address it received the connection from, so what reaches the app is
 *
 *            <whatever the client sent>, <what our proxy actually saw>
 *
 *        The leftmost entry is the one the ORIGINAL CALLER wrote, and it is not
 *        evidence of anything. A request carrying `X-Forwarded-For: 1.2.3.4`
 *        arrives as `1.2.3.4, <their real address>` and all four readers
 *        returned `1.2.3.4`.
 *
 *        So every IP-based rate limit was a formality — change the header per
 *        request and each attempt gets its own bucket. That covers the login
 *        limiter, the contact form, the academy payment verifier, and the
 *        bank-account oracle metered in #243, which exists to stop somebody
 *        enumerating account numbers. And the ADMIN AUDIT LOG wrote that
 *        address down, which is worse than having no IP field at all: it reads
 *        as evidence. The same shape as #129, where the dispute audit row named
 *        whichever admin the caller passed.
 *
 *        rate-limit.ts even said so in a comment — "platform-verified
 *        X-Real-IP, or client-controlled X-Forwarded-For" — and then keyed on
 *        the client-controlled one anyway.
 *
 * THE RULE
 * --------
 * Count from the RIGHT. The rightmost entry was written by the proxy nearest to
 * us, which is the only one our own infrastructure put there. TRUSTED_PROXY_HOPS
 * says how many proxies sit in front of the app when that is not one (a CDN in
 * front of the platform makes it two), and the count is never allowed to walk
 * past the left edge into caller-supplied territory — it returns null instead.
 *
 * A value that is not an IP address is also null. A rate-limit key built from
 * arbitrary caller text is a bucket the caller names, which is the same bypass
 * by a different route.
 */

/** The default: one proxy (the hosting platform) in front of the app. */
const DEFAULT_TRUSTED_HOPS = 1;

function trustedHops(): number {
    const raw = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "", 10);
    // A nonsensical value is ignored rather than obeyed — obeying "0" would
    // hand back the caller's own entry.
    return Number.isFinite(raw) && raw >= 1 ? raw : DEFAULT_TRUSTED_HOPS;
}

/**
 * Is this an address, rather than something a caller typed?
 *
 * Deliberately shape-only: the job here is to refuse free text, not to decide
 * whether an address is routable. A private or loopback address is legitimate
 * (local development, a health check from inside the network) and rate-limiting
 * it is correct.
 */
export function looksLikeIpAddress(value: string): boolean {
    const v = value.trim();
    if (!v) return false;

    // IPv4, with each octet in range — "999.999.999.999" is not an address.
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) {
        return v.split(".").every((octet) => Number(octet) <= 255);
    }

    // IPv6, including the compressed forms and IPv4-mapped addresses. A loose
    // shape check: hex groups and colons, at least one colon, nothing else.
    // Strips a zone index (fe80::1%eth0) and brackets ([::1]:443 style hosts).
    const bare = v.replace(/^\[|\]$/g, "").split("%")[0];
    return bare.includes(":") && /^[0-9a-fA-F:.]+$/.test(bare);
}

/**
 * The caller's address, or null when it cannot be established.
 *
 * Null rather than a placeholder on purpose: the caller decides what an unknown
 * address means for its own job. A rate limiter buckets them together (which
 * over-limits, the safe direction); the audit log leaves the field empty rather
 * than recording something false.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
    const forwarded = headers.get("x-forwarded-for");

    if (forwarded) {
        const entries = forwarded.split(",").map((e) => e.trim()).filter(Boolean);
        const index = entries.length - trustedHops();

        // Fewer entries than configured hops: the header is shorter than the
        // topology says it should be, so the entry at [0] is the caller's own.
        // Refusing beats trusting it.
        if (index < 0) return null;

        const candidate = entries[index];
        if (candidate && looksLikeIpAddress(candidate)) return candidate;
        return null;
    }

    // Only when there is nothing structured to read. A proxy that SETS
    // x-real-ip overwrites any caller value and makes it trustworthy; one that
    // merely forwards it does not, and from here the two are indistinguishable
    // — so it is a last resort rather than the first choice the old readers
    // made it.
    const realIp = headers.get("x-real-ip");
    if (realIp && looksLikeIpAddress(realIp)) return realIp.trim();

    return null;
}
