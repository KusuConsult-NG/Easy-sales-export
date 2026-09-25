/**
 * What the login screen can be told, and in what words.
 *
 *   #927 FOUR OF THE PLATFORM'S OWN EMITTERS WROTE A SPECIFIC EXPLANATION AND
 *   THE LOGIN SCREEN THREW IT AWAY.
 *
 *   LoginForm decides what to show from
 *
 *       const message = errorParam in errorMap ? errorMap[errorParam] : errorMap["Default"];
 *
 *   and `errorMap["Default"]` is "Authentication failed." Measured against every
 *   emitter of `/auth/login?error=`:
 *
 *       middleware.ts:442        error=SessionError        not a key → generic
 *       lib/hub-guard.ts:26      the PROSE, url-encoded    not a key → generic
 *       components/admin/AdminShell.tsx:44    ditto        not a key → generic
 *       app/hub/register/page.tsx:16          ditto        not a key → generic
 *
 *   The three prose emitters all send `sessionResult.error?.error`, and
 *   requireSession produces exactly five of those strings — including "Your
 *   account has been suspended." So a suspended member was told "Authentication
 *   failed.", which reads as a typo in their password. They would try it again,
 *   and again, and never learn the real reason. Same for "Account not found" and
 *   for the admin-access check that asks them to retry.
 *
 * ── AND THE GENERIC FALLBACK IS *RIGHT*, WHICH DECIDES THE FIX ──────────────
 *
 *   The tempting repair is to display the text when it is not a known key. That
 *   would be a phishing hole: `/auth/login?error=Your%20account%20is%20closed,
 *   %20call%20%2B234...` would print an attacker's sentence, in the platform's
 *   own voice, on the screen where people type their password. LoginForm's
 *   refusal to render unknown text is a feature.
 *
 *   So the EMITTERS are the defect: they must send a CODE the screen knows, not
 *   prose it must decide whether to trust. This module holds the one list of
 *   codes and their words, and the prose→code bridge for callers that only have
 *   requireSession's message in hand.
 *
 *   NOTHING IS CHANGED about `sessionResult.error.error` itself — 283 places read
 *   that contract, and the prose is still exactly right for a server response or
 *   an API body. What changes is what goes in a URL.
 */

/** The codes the login screen knows, and what it says for each. */
export const AUTH_ERROR_MESSAGES: Record<string, string> = {
    CredentialsSignin: "Invalid email or password",
    MissingCSRF: "Session expired — please refresh the page and try again.",
    session_expired: "Your session has expired. Please log in again.",
    security_refresh: "For your security, please sign in again to continue.",
    access_denied: "You do not have permission to access that resource.",
    AccessDenied: "You do not have permission to access that resource.",
    //   Empty on purpose: the standard "you are not logged in" redirect should
    //   not shout at somebody who simply arrived at a guarded page.
    SessionRequired: "",

    //   #927 ADDED. middleware.ts sends this when NextAuth itself crashes
    //   decrypting a session — a real state with a real remedy, and it was
    //   landing on "Authentication failed."
    SessionError: "We could not read your session. Please sign in again.",

    //   #927 ADDED — the three prose emitters send these now. The words are
    //   requireSession's own, so the person reads the same sentence whether the
    //   refusal reached them through a URL or an API response.
    account_not_found: "Account not found. Please log in again.",
    account_suspended: "Your account has been suspended.",
    admin_check_failed:
        "We could not confirm your administrator access just now. Please try again.",
    auth_required: "Please sign in to continue.",

    Default: "Authentication failed.",
};

/**
 * requireSession's prose → the code to put in the URL.
 *
 *   Keyed on the exact strings lib/session-guard returns. A wording change there
 *   would fall through to `auth_required` rather than to something wrong, and the
 *   test for this module asserts that every string session-guard can return is a
 *   key here — so the fall-through is a failing test, not a silent regression.
 */
const PROSE_TO_CODE: Record<string, string> = {
    "Your session has expired. Please log in again.": "session_expired",
    "Account not found. Please log in again.": "account_not_found",
    "Your account has been suspended.": "account_suspended",
    "We could not confirm your administrator access just now. Please try again.":
        "admin_check_failed",
    "Authentication required": "auth_required",
};

/**
 * The code to send for a refusal, given whatever requireSession said.
 *
 * Never returns prose, so a caller cannot accidentally put an arbitrary sentence
 * into a URL that the login screen would then have to decide about.
 */
export function authErrorCodeFor(message: string | null | undefined): string {
    if (!message) return "auth_required";
    return PROSE_TO_CODE[message] ?? "auth_required";
}

/** What to show for a code, or the generic refusal for one we do not know. */
export function authErrorMessageFor(code: string | null | undefined): string {
    if (!code) return "";
    return code in AUTH_ERROR_MESSAGES
        ? AUTH_ERROR_MESSAGES[code]
        : AUTH_ERROR_MESSAGES.Default;
}
