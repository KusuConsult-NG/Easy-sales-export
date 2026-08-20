/**
 * Rate Limit Configuration
 * 
 * Defines rate limits for different endpoints
 */

/**
 * The limits themselves. `rateLimitConfig` below stamps each one with its own
 * key as a `name`, which is what namespaces it in Redis.
 *
 * WHY A NAME IS NOT OPTIONAL
 * --------------------------
 * lib/rate-limiter.ts built every limiter with the same fixed Upstash prefix and
 * called limiter.limit(identifier) with the identifier alone. Eight of these
 * entries are passed to it across eighteen call sites, and twelve of those sites
 * key on session.user.id — six payment paths, cooperative/withdraw, three admin
 * routes, submit-verification and hub/telemetry. So for one member, all of them
 * read and wrote ONE counter while applying different windows and different
 * maximums to it.
 *
 * `withdrawal` is five per minute. Five requests of any of those kinds in a
 * minute — including hub/telemetry, which the app emits as a matter of course —
 * left the withdrawal limiter reading a spent counter and refusing a member
 * access to their own money. It runs the other way too: a payment burst
 * consumed the admin and contact budgets.
 *
 * The name is derived from the object key rather than written out beside it, so
 * the two cannot drift and a new entry cannot be added without one.
 */
const LIMITS = {
    /**
     * Public contact form — unauthenticated and it SENDS EMAIL through Resend,
     * so an unthrottled endpoint is a spam relay, a quota drain and a bill.
     *
     * Sized for CGNAT, deliberately. Nigerian mobile networks share IPs heavily,
     * so a limit tuned as though an IP were a person locks out real users. The
     * login config's 5-per-15-minutes would be actively harmful applied here:
     * one shared carrier IP could exhaust it for everyone behind it.
     *
     * 30 per hour per IP. Note that login's 5-per-15-minutes works out to the
     * same 20/hour sustained — so matching it would have delivered none of the
     * headroom this is for. The difference that matters is burst tolerance: the
     * login window refuses a sixth attempt in fifteen minutes, while a carrier
     * NAT can legitimately produce a cluster of submissions at once.
     *
     * 30 in an hour leaves room for an office or a NAT pool and still stops a
     * script cold — abuse means hundreds, not dozens. Nobody legitimately
     * submits a contact form thirty times an hour.
     */
    contactForm: {
        interval: 60 * 60 * 1000, // 1 hour
        maxRequests: 30,
    },

    // Authentication endpoints - strict limits
    login: {
        interval: 15 * 60 * 1000, // 15 minutes
        maxRequests: 5, // 5 attempts per 15 minutes
    },

    // API routes - moderate limits
    api: {
        interval: 60 * 1000, // 1 minute
        maxRequests: 100, // 100 requests per minute
    },

    // Webhooks - high limits (legitimate traffic)
    webhook: {
        interval: 60 * 1000, // 1 minute
        maxRequests: 1000, // 1000 per minute
    },

    // Server actions - moderate limits
    serverAction: {
        interval: 60 * 1000, // 1 minute
        maxRequests: 50, // 50 per minute
    },

    // File uploads - strict limits
    fileUpload: {
        interval: 60 * 60 * 1000, // 1 hour
        maxRequests: 20, // 20 uploads per hour
    },

    // Payment operations - strict (prevent double submission fraud)
    payment: {
        interval: 60 * 1000, // 1 minute
        maxRequests: 10,
    },

    // Cooperative withdrawals - very strict (financial security)
    withdrawal: {
        interval: 60 * 1000, // 1 minute
        maxRequests: 5,
    },

    // KYC lookups - very strict (cost optimization)
    kyc: {
        interval: 60 * 60 * 1000, // 1 hour
        maxRequests: 3, // 3 lookups per hour per user
    },

    /**
     * AI assistant messages — every call is a GPT-4 completion, billed per token.
     *
     * The endpoint requires a session and validates the message, and had no
     * limit at all: one authenticated account could loop it and run up an
     * unbounded bill against the platform's OpenAI key. Same reasoning as the
     * `kyc` entry above, which is throttled for cost rather than for security.
     *
     * Sized against a real conversation rather than against an attacker. Someone
     * typing to a support bot, waiting for a reply and typing again manages
     * perhaps two or three messages a minute at the very most, so 30 in ten
     * minutes is beyond anything a person does and still stops a script cold —
     * bounded at ~180/hour instead of as fast as the network allows.
     *
     * Keyed per USER, not per IP: the endpoint is authenticated, so the account
     * is the thing being billed for, and Nigerian carrier NAT would make an IP
     * key punish everyone behind it.
     */
    aiChat: {
        interval: 10 * 60 * 1000, // 10 minutes
        maxRequests: 30,
    },

    /**
     * Federated-module telemetry — writes to the AUDIT LOG.
     *
     * Every accepted call adds a row to the same collection the audit trail and
     * its statistics are read from, so an unthrottled endpoint lets one account
     * bury the record of what everybody else did. It had no limit at all.
     *
     * Generous, because this is machine traffic reporting real events rather
     * than a person clicking: a module doing genuine work can legitimately emit
     * a burst. 120 an hour per account stops a flood without getting in the way
     * of one.
     */
    telemetry: {
        interval: 60 * 60 * 1000, // 1 hour
        maxRequests: 120,
    },

    // Admin operations - generous (legitimate admin workload)
    admin: {
        interval: 60 * 1000, // 1 minute
        maxRequests: 100, // 100 admin actions per minute
    },
};

/**
 * Every limit, each carrying its own key as `name`.
 *
 * Endpoints that deliberately share a config share a bucket — the seven payment
 * paths should throttle together — and endpoints with different limits no longer
 * collide. See lib/rate-limiter.ts for where the name is applied.
 */
export const rateLimitConfig = Object.fromEntries(
    Object.entries(LIMITS).map(([name, limit]) => [name, { ...limit, name }]),
) as { [K in keyof typeof LIMITS]: (typeof LIMITS)[K] & { name: K } };
