/**
 * How stale a signed-in session is allowed to be. ONE STATEMENT OF IT.
 *
 *   #922 This was a local `const SYNC_INTERVAL` inside the NextAuth jwt
 *   callback, and the callback's own prose treats it as the platform's answer to
 *   a security question, not a tuning knob:
 *
 *       "Revocation lands within SYNC_INTERVAL rather than instantly — the same
 *        latency the ban check has, and for the same reason: this is the only
 *        place the profile is re-read."
 *
 *   So two minutes is the stated bound on how long a banned account, or a
 *   session minted before a password reset, may keep acting. Anything that
 *   refreshes MORE often than this buys nothing the platform claims to need.
 *
 *   SessionRefreshListener was refreshing on every path change and every window
 *   focus, and `trigger === "update"` bypasses the interval by design — so the
 *   bound was opted out of on every navigation. It shares the constant now
 *   rather than picking its own number, because a second number is how the two
 *   start disagreeing about what "fresh enough" means.
 *
 *   A DELIBERATE update() IS NOT THROTTLED AND MUST NOT BE. LoginForm,
 *   ProfileClient, the cooperative onboarding client and the academy dashboard
 *   all call `update()` after they change something that the session carries;
 *   there the bypass is the point. This constant bounds the BACKGROUND refresh,
 *   which knows of no change at all.
 */
export const SESSION_SYNC_INTERVAL_MS = 2 * 60 * 1000;
