import "server-only";

import { rateLimit } from "@/lib/rate-limiter";
import { rateLimitConfig } from "@/lib/rate-limits.config";

/**
 *   #642 THE ENUMERATION CONTROL REACHED ONE OF THE TWO DOORS.
 *
 *   Resolving a bank account turns any ten-digit NUBAN into the account
 *   holder's REAL NAME, through the platform's Paystack key. #243 recorded what
 *   that is — "a name-lookup oracle for whoever is signed in" — and built the
 *   `bankVerification` bucket as the control, because ownership cannot be
 *   checked before resolving: verifying your own account is the feature.
 *
 *       ten an hour absorbs mistyped digits and a wrong bank picked twice,
 *       and is useless for enumeration
 *
 *   It was applied to `actions/paystack.ts::verifyBankAccount`.
 *   `/api/kyc/verify-bank-account` asks Paystack's `/bank/resolve` for the same
 *   answer, is reachable by the same signed-in caller, and carried only
 *   `withRateLimit` — the generic wrapper in lib/rate-limit.ts, which is
 *   `RATE_LIMIT_MAX_REQUESTS` at a default of 200 PER MINUTE.
 *
 *   (The two doors reach that endpoint by different code — the route through
 *   lib/bank-account-resolve, the action through its own fetch. #346 built the
 *   shared resolver so callers would stop writing their own, and reached one of
 *   the two. Recorded here rather than repaired in the same change: the meter is
 *   what has a live consequence, and consolidating a resolver whose error
 *   strings are pinned by two suites is a separate read.)
 *
 *   Twelve thousand an hour against a control sized at ten. The oracle had a
 *   meter on one door and a turnstile on the other.
 *
 * ── ONE COUNTER, SHARED ─────────────────────────────────────────────────────
 *
 *   The limiter lives here rather than being built twice, for the reason #641
 *   found the hard way: `rateLimit()` constructs its own counter, so two
 *   instances of the same config are two budgets — ten through the action AND
 *   ten through the route, for one rule. Both doors import this instance.
 *
 * ── AND THE `kyc` BUCKET STILL HAS NO CONSUMER, DELIBERATELY ────────────────
 *
 *   `rateLimitConfig.kyc` — three per hour, "very strict (cost optimization)" —
 *   is consumed by nothing, and the `aiChat` entry beside it says "Same
 *   reasoning as the `kyc` entry above, which is throttled for cost rather than
 *   for security", so its author believed otherwise.
 *
 *   It is left unwired ON PURPOSE and pinned in a test instead.
 *   `IDENTITY_PROVIDER` is the constant `'none'`: verify-bvn and verify-nin
 *   perform no external lookup, verify-business answers 503, and verify-id is
 *   retired behind a 410. There is no per-call cost to throttle today, and
 *   three an hour applied to a format check would refuse a member who mistyped
 *   their BVN twice — a control with no benefit and a real cost.
 *
 *   The test asserts the conditional: the moment IDENTITY_PROVIDER stops being
 *   'none', the `kyc` bucket must have a consumer. That is the difference
 *   between a rule nobody wired and a rule deliberately waiting for the thing it
 *   governs.
 */
export const bankVerifyLimiter = rateLimit(rateLimitConfig.bankVerification);

/** What to tell somebody who has asked too often. */
export const BANK_VERIFY_RATE_LIMITED =
    "Too many account verification attempts. Please try again later.";
