/**
 * WHO MUST HAVE A SECOND FACTOR, AND WHEN IT IS CHECKED.
 *
 *   #663 THE WHOLE MFA FEATURE WAS WIRED TO NOTHING.
 *
 *   Four working routes — setup, enable, verify, disable — a TOTP
 *   implementation, encrypted backup codes with an atomic single-use claim, and
 *   a `mfa_verified` cookie bound to its user by HMAC. Every piece correct, and
 *   the verify route's own header says what they added up to:
 *
 *       "NOTHING READS THAT COOKIE, AND NOTHING ENFORCES MFA. […] So a user who
 *        enables MFA scans a QR code, saves recovery codes, and their account is
 *        protected exactly as much as it was before."
 *
 *   `requiresMFA()` names ten sensitive actions — withdrawal, fund_release,
 *   loan_approval, escrow_release, role_change, admin_action among them — and
 *   had NO CALLERS. A declared rule nothing consults, on the most privileged
 *   operations the platform has.
 *
 * ── THE PREREQUISITE, WHICH THE SAME NOTE NAMED ─────────────────────────────
 *
 *   That header also says why nobody had switched it on:
 *
 *       "switching enforcement on for those ten actions while backup codes
 *        cannot be redeemed would lock anyone who loses their authenticator out
 *        of withdrawals with no way back."
 *
 *   Correct, and it is why `verifyBackupCode` being callable is part of this
 *   change rather than a follow-up. The recovery path has to work BEFORE the
 *   gate closes, or the gate is a trap.
 *
 * ── THE POLICY, DECIDED RATHER THAN DEFERRED ────────────────────────────────
 *
 *   Two rules, and the second is deliberately narrow:
 *
 *   1. ADMINISTRATORS MUST ENROL. An account holding any platform-admin role
 *      must have MFA enabled. Not "should" — the admin surface can change
 *      anyone's role, release escrow and approve loans, and a password is the
 *      only thing in front of it.
 *
 *   2. A SENSITIVE ACTION NEEDS A RECENT VERIFICATION — *from a user who has
 *      MFA*. A member who has never enabled it is unaffected and keeps
 *      withdrawing exactly as before.
 *
 *   Rule 2 is narrow on purpose. `requiresMFA()` lists `withdrawal` and
 *   `loan_application`, which members perform. Demanding a second factor from
 *   members who have none would lock every member out of their own money on the
 *   day this deployed — the defect this audit exists to stop, committed by the
 *   fix for another one. As written, enabling MFA finally BUYS something
 *   (today it buys nothing), and nobody loses access by not having it.
 *
 * ── ENROLMENT, NOT LOCKOUT ──────────────────────────────────────────────────
 *
 *   An administrator without MFA is sent to the setup page, not refused at the
 *   door with nowhere to go. The setup routes sit behind a plain session and
 *   never behind the admin gate, so the way out is always open. See
 *   MFA_SETUP_PATH.
 *
 * ── AND IT DOES NOT LAND THE MOMENT IT DEPLOYS ──────────────────────────────
 *
 *   NOT ONE ADMINISTRATOR ACCOUNT HAS MFA TODAY. Enforcing on deploy would
 *   refuse every one of them until they enrolled — and this platform's standing
 *   complaint is that fixes break it. So enforcement has a DATE:
 *
 *     before MFA_ADMIN_ENFORCE_FROM   an unenrolled administrator is warned and
 *                                     let through. Nothing changes for anyone.
 *     after it                        they are sent to enrol.
 *
 *   The date is in the code, not in a flag that has to be remembered — this
 *   codebase's recurring failure is the rule nobody wired and the toggle still
 *   switched off, and a deadline that arrives by itself is neither. Override it
 *   with `MFA_ADMIN_GRACE_UNTIL` to bring enforcement forward (any past
 *   instant) or to extend the window once, with a reason.
 *
 *   A valve that fails OPEN on a typo is not a valve, so an unparseable
 *   override is ignored and the built-in date stands.
 */

import { isAdmin } from "@/lib/role-utils";
import type { UserRole } from "@/lib/types/roles";

/** Where an administrator goes to enrol. Behind a session, never behind the admin gate. */
export const MFA_SETUP_PATH = "/profile?setup=mfa";

/**
 * Must an account with these roles have a second factor?
 *
 * Asked of `isAdmin` rather than a hand-written list beside it. A list here
 * would be the second statement of "who is an administrator" — and #353, #648
 * and #659 are all findings about what happens when the second statement drifts
 * from the first.
 *
 * `isAdmin`, NOT `isPlatformAdmin`. The narrower one covers only roles holding
 * `config:update`, which excludes the six module admins — and a
 * cooperative_admin approves loans and releases member money, a
 * marketplace_admin resolves disputes and escrow. admin-permissions warns in
 * as many words against reaching for the narrow predicate where a module admin
 * belongs, and this is exactly that case: all ten admin roles, or the rule
 * protects the accounts that need it least.
 */
export function mfaEnrolmentRequired(roles: readonly string[] | null | undefined): boolean {
    return isAdmin((roles ?? []) as UserRole[]);
}

/**
 * When enforcement begins if nobody says otherwise.
 *
 * Fourteen days from the change that introduced it — long enough for every
 * administrator to enrol without a scramble, short enough that it is a rollout
 * and not a deferral. Written here rather than left to an environment variable
 * because a rule that only takes effect when somebody remembers to set
 * something is the exact shape of the defect this whole finding is about.
 */
export const MFA_ADMIN_ENFORCE_FROM = "2026-09-26T00:00:00.000Z";

/**
 * Is the rollout grace window still open?
 *
 * `MFA_ADMIN_GRACE_UNTIL` overrides the built-in date — set it to a past
 * instant to enforce immediately, or to a later one to extend the window. An
 * ABSENT or UNPARSEABLE override falls back to MFA_ADMIN_ENFORCE_FROM rather
 * than to "no enforcement": a valve that fails open on a typo is not a valve.
 */
export function graceActive(
    env: NodeJS.ProcessEnv = process.env,
    now: number = Date.now(),
): boolean {
    const override = env.MFA_ADMIN_GRACE_UNTIL ? Date.parse(env.MFA_ADMIN_GRACE_UNTIL) : NaN;
    const until = Number.isNaN(override) ? Date.parse(MFA_ADMIN_ENFORCE_FROM) : override;

    return until > now;
}

export type MfaVerdict =
    /** Nothing required of this account. */
    | { outcome: "ok" }
    /** Required, not enrolled, and the window has not closed yet. */
    | { outcome: "warn"; reason: string }
    /** Required, not enrolled. Send them to MFA_SETUP_PATH. */
    | { outcome: "enrol"; reason: string };

/**
 * What to do about this account's enrolment, before it reaches an admin surface.
 *
 * Pure, and takes the clock and the environment, so a test can ask it questions
 * with known answers instead of manipulating global state.
 */
export function adminMfaVerdict(
    account: { roles?: readonly string[] | null; mfaEnabled?: boolean | null },
    env: NodeJS.ProcessEnv = process.env,
    now: number = Date.now(),
): MfaVerdict {
    if (!mfaEnrolmentRequired(account.roles)) return { outcome: "ok" };
    if (account.mfaEnabled === true) return { outcome: "ok" };

    const reason =
        "Two-factor authentication is required for administrator accounts. "
        + "Set it up under Profile → Security to continue.";

    return graceActive(env, now) ? { outcome: "warn", reason } : { outcome: "enrol", reason };
}


/**
 * The admin surfaces this gate stands in front of.
 *
 * Both halves matter and they need different answers. A PAGE gets a redirect to
 * the setup screen; an API route gets a refusal, because redirecting a fetch to
 * an HTML page turns "you must enrol" into a JSON parse error at the caller.
 */
export type AdminMfaGate =
    | { kind: "redirect"; to: string; reason: string }
    | { kind: "deny"; reason: string }
    | null;

/**
 * Paths that are the administrator surface.
 *
 * `/loans/approve` is on the list because middleware's own note records it as
 * "the one admin screen outside" the /admin tree — a decision screen for
 * cooperative loans that the silo rule does not cover.
 */
function isAdminSurface(pathname: string): boolean {
    return pathname === "/admin"
        || pathname.startsWith("/admin/")
        || pathname === "/api/admin"
        || pathname.startsWith("/api/admin/")
        || pathname.startsWith("/loans/approve");
}

/**
 * Paths that must never be gated, because they are how somebody gets OUT.
 *
 * THE LOOP IS THE DANGER HERE, not the gate. An unenrolled administrator
 * redirected to a page that redirects them back is worse than no enforcement at
 * all: they cannot reach the admin panel AND they cannot reach the screen that
 * would fix it. /profile carries the setup UI, /auth/* is sign-in and sign-out,
 * and /api/auth/mfa/* is the enrolment API the setup UI calls.
 *
 * AND TODAY IT CANNOT FIRE, WHICH IS WORTH SAYING RATHER THAN HIDING. None of
 * these paths is an admin surface, so isAdminSurface() has already returned
 * false by the time this is asked — a mutation run proved it by gutting this
 * function and killing nothing. It is kept as the second half of a pair: the
 * invariant that actually protects the loop is "the gate never blocks the path
 * it redirects to", and that one IS exercised — changing MFA_SETUP_PATH to an
 * /admin path turns the suite red. This function is what keeps that true if the
 * admin surface ever widens to cover a path somebody needs to escape through.
 */
function isEscapeHatch(pathname: string): boolean {
    return pathname === "/profile"
        || pathname.startsWith("/profile/")
        || pathname.startsWith("/auth/")
        || pathname.startsWith("/api/auth/");
}

/**
 * What middleware should do with this request — #663.
 *
 * A FUNCTION AND NOT FIVE LINES IN middleware.ts, following the note that file
 * already carries about `adminSiloRedirect`: "middleware cannot be exercised in
 * a test and a function can. The version that lived inline was asserted by
 * matching strings in this file, and mutation testing showed what that was
 * worth."
 *
 * Returns null for everything it does not govern, which is almost every
 * request.
 */
export function adminMfaGate(
    pathname: string,
    account: { roles?: readonly string[] | null; mfaEnabled?: boolean | null },
    env: NodeJS.ProcessEnv = process.env,
    now: number = Date.now(),
): AdminMfaGate {
    if (!isAdminSurface(pathname)) return null;
    if (isEscapeHatch(pathname)) return null;

    const verdict = adminMfaVerdict(account, env, now);
    if (verdict.outcome !== "enrol") return null;

    const isApi = pathname.startsWith("/api/");
    return isApi
        ? { kind: "deny", reason: verdict.reason }
        : { kind: "redirect", to: MFA_SETUP_PATH, reason: verdict.reason };
}

/**
 * `requiresMFA()` IS DELIBERATELY NOT RE-EXPORTED HERE.
 *
 * The first draft did re-export it, and that was a mistake with a consequence:
 * security-settings-claims couples the admin screen's wording to whether
 * `requiresMFA` has any callers outside lib/mfa, in BOTH directions — "if
 * enforcement is built, requiresMFA gains a caller and this test fails, telling
 * whoever built it to restore the confident wording."
 *
 * A re-export is not a caller. It would have flipped that ratchet on a
 * pass-through and made the screen claim a per-action control that still does
 * not exist. The ratchet is right and the re-export was the thing that was
 * wrong; the day the ten actions are wired, it should fail for a real reason.
 *
 * Import it from "@/lib/mfa" at the call site that actually asks it something.
 */

/**
 * How long a verification counts for.
 *
 * The cookie the verify route issues is already a thirty-minute cookie; this is
 * the same number, named, so the two cannot drift apart.
 */
export const MFA_VERIFICATION_WINDOW_MS = 30 * 60 * 1000;
