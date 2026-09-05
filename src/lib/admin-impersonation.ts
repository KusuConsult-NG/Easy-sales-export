/**
 *   #396 AN IMPERSONATION TOKEN WITH A PRODUCER AND NO CONSUMER.
 *
 *   createImpersonationTokenAction writes a row to `impersonation_tokens` and
 *   returns its id to the caller as `{ token, expiresAt }`. Counting readers of
 *   that collection across all of src/:
 *
 *        writers   1   (createImpersonationTokenAction)
 *        readers   0
 *
 *   Nothing exchanges the id for a session. Nothing signs anybody in as anybody
 *   else. The only other mention of the collection is its name in the
 *   COLLECTIONS map. So the action reports success, hands back a token, and the
 *   token does nothing — success reported for an operation that did not happen,
 *   which is the same class as #337 and #102.
 *
 *   THE FIELDS THAT LOOK LIKE THE SAFETY STORY ARE NOT ENFORCED
 *   -----------------------------------------------------------
 *   The row carries `active: true`, `expiresAt`, and `usedAt: null`. Those are
 *   the three fields a reader would check to make a token single-use and
 *   time-limited. Nothing reads any of them, and nothing ever sets `usedAt`.
 *   They are written, and they are enforced by nothing.
 *
 *   That is the hazard, and it is specific: the mint side looks finished. It
 *   validates the reason, bounds the duration to 5–120 minutes, refuses an
 *   admin target, is super_admin-only, and writes a critical audit row. Someone
 *   building the redemption half would reasonably read all that and conclude
 *   the expiry and single-use rules are already handled somewhere. They are
 *   not. A redeemer that trusts the row would grant an unlimited number of
 *   logins as the target user, for ever.
 *
 *   THE SURROUNDING SCAFFOLDING ASSERTS THE CAPABILITY EXISTS
 *   ---------------------------------------------------------
 *   PERMISSION_MATRIX grants "users:impersonate" to super_admin and documents
 *   that `admin` is denied it — "no deletion, no impersonation, no config
 *   rollback". audit-log.ts declares a 'user_impersonate' action type. Read
 *   together, those say the platform can impersonate a user. It cannot. This is
 *   the same shape as #314's SessionGuard and #331's forensic checks: a
 *   security-shaped mechanism that gates nothing because the half that would
 *   use it was never built.
 *
 *   RETIRED, NOT DELETED — the #379/#386/#395 pattern
 *   -------------------------------------------------
 *   The action refuses as its first statement, before the session lookup. The
 *   implementation stays whole behind ADMIN_IMPERSONATION_ACTION, off unless set
 *   to the exact word "enabled" — matching GDPR_PURGE_DELETE_AUTH,
 *   SEED_ALLOW_REMOTE, CLEANUP_ALLOW_REMOTE, MARKETPLACE_OFFLINE_CHECKOUT,
 *   ACADEMY_QUIZ_API and ADMIN_BULK_EMAIL_ACTION. A specific word rather than a
 *   truthy value, so a stray "1" cannot arm the minting of session tokens.
 *
 *   Nothing is lost by retiring it, because nothing was gained by calling it:
 *   there is no behaviour here for a live path to have to carry (#384's rule).
 *   The audit trail is the one thing the action did produce, and a
 *   'user_impersonate' row recording an impersonation that could not occur is
 *   worse than no row.
 *
 *   TURNING IT ON IS NOT A WIRING CHANGE. It arms the mint. The redemption half
 *   — exchanging the id for a session, enforcing expiresAt, and burning usedAt
 *   so the token works once — does not exist and must be written first.
 */

/** The environment variable that arms the impersonation token mint. */
export const ADMIN_IMPERSONATION_ENV = "ADMIN_IMPERSONATION_ACTION";

/** The one value that arms it. Anything else, including "1" and "true", does not. */
export const ADMIN_IMPERSONATION_ENABLED_VALUE = "enabled";

/** Is the retired impersonation token mint switched on? */
export function isAdminImpersonationEnabled(): boolean {
    return process.env[ADMIN_IMPERSONATION_ENV] === ADMIN_IMPERSONATION_ENABLED_VALUE;
}

/**
 * What a caller is told, and what whoever enables this needs to know.
 *
 * Names the missing half explicitly, and names the three fields that look
 * enforced and are not, so a developer meeting this refusal does not have to
 * rediscover either.
 */
export const ADMIN_IMPERSONATION_REFUSAL =
    "Admin impersonation is retired: it has no redemption path. The token it "
    + "returns is an impersonation_tokens row id, and nothing in this codebase "
    + "reads that collection or exchanges the id for a session, so the caller "
    + "receives a token that cannot be used. The row's active, expiresAt and "
    + "usedAt fields are written and enforced by nothing — anything built to "
    + "redeem a token must implement expiry and single-use itself rather than "
    + "assume the mint already did.";
