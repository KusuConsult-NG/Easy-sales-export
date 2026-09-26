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

/*
 *   #887 FROM admin-permissions, NOT role-utils — and the comment on
 *   mfaEnrolmentRequired below has always said so.
 *
 *   It said "`isAdmin`, NOT `isPlatformAdmin` […] all ten admin roles, or the
 *   rule protects the accounts that need it least", and then imported the
 *   EIGHT-role `isAdmin` from role-utils, which lists the module admins and
 *   omits `moderator` and `support`. Two functions share the name; the file
 *   argued for one and called the other.
 *
 *   MEASURED across all ten roles: admin-permissions.isAdmin is true for every
 *   one, role-utils.isAdmin is false for `moderator` and `support`. So the two
 *   roles #353 had to rescue from a hand-written admin list were, once again,
 *   the two a rule about administrators did not cover — and this time the rule
 *   is a SECURITY control, exempting them from the second factor rather than
 *   locking them out of a page.
 */
import { isAdmin } from "@/lib/admin-permissions";
import type { UserRole } from "@/lib/types/roles";

/**
 * Where an administrator goes to enrol. Behind a session, never behind the
 * admin gate.
 *
 *   #887 THIS POINTED AT A PARAMETER NOTHING READS, AND THE SAME MISTAKE IS
 *        ALREADY WRITTEN UP TWENTY LINES INTO ProfileClient.
 *
 *        It was `/profile?setup=mfa`. The profile screen reads exactly two
 *        query parameters — `tab` (#359) and `notice` (#529) — and `setup` is
 *        neither. So the redirect landed an administrator on the GENERAL tab of
 *        an ordinary-looking profile page, with no statement of why they were
 *        sent there, no mention of MFA, and the enrolment toggle one unlabelled
 *        tab away.
 *
 *        #529 is that exact finding, on this exact screen, for the hub guard:
 *        "the member arrived at an ordinary-looking profile screen with no
 *        statement of why their dashboard had refused them or what to do about
 *        it." The lesson was learned for one gate and this gate, added later,
 *        repeated it.
 *
 *        IT HAS A DATE ON IT. Enforcement begins at MFA_ADMIN_ENFORCE_FROM and
 *        this file's own header records that NOT ONE ADMINISTRATOR ACCOUNT HAS
 *        MFA TODAY — so on that morning every administrator is bounced out of
 *        /admin onto a page that does not explain itself. Bounced, retried,
 *        bounced again is indistinguishable from "the admin login is broken",
 *        which is a sentence this platform's owner has had to write too often.
 *
 *        Now it names the tab that carries the toggle and a notice the screen
 *        renders.
 */
export const MFA_SETUP_PATH = "/profile?tab=security&notice=enrol-mfa";

/** The `notice` value MFA_SETUP_PATH carries, so the screen and the gate agree. */
export const MFA_ENROL_NOTICE = "enrol-mfa";

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
    return adminMfaEnforcementAt(env) > now;
}

/**
 * The instant enforcement begins, after the override has had its say.
 *
 *   #939 graceActive() answered "is the window open" and threw the DATE away,
 *   which is the one fact a warning has to carry. A banner that says "two-factor
 *   authentication will be required soon" is not a warning, it is a mood; the
 *   administrator needs to know whether they have a fortnight or an afternoon.
 *
 *   graceActive now asks THIS rather than keeping its own copy of the override
 *   rule. Two readings of `MFA_ADMIN_GRACE_UNTIL` that could disagree about when
 *   enforcement starts is the shape of #353, #648 and #659, and here the two
 *   would disagree about a security deadline: the gate closing on a day the
 *   banner never named.
 *
 *   The typo rule is unchanged and lives here now — an unparseable override
 *   falls back to the built-in date, because a valve that fails open on a typo
 *   is not a valve.
 */
export function adminMfaEnforcementAt(env: NodeJS.ProcessEnv = process.env): number {
    const override = env.MFA_ADMIN_GRACE_UNTIL ? Date.parse(env.MFA_ADMIN_GRACE_UNTIL) : NaN;

    return Number.isNaN(override) ? Date.parse(MFA_ADMIN_ENFORCE_FROM) : override;
}

export type MfaVerdict =
    /** Nothing required of this account. */
    | { outcome: "ok" }
    /**
     * Required, not enrolled, and the window has not closed yet.
     *
     *   #939 `enforcementAt` rides along because the warning is useless without
     *   it, and because a caller that re-derived it could name a different day
     *   than the gate enforces.
     */
    | { outcome: "warn"; reason: string; enforcementAt: number }
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

    const enforcementAt = adminMfaEnforcementAt(env);

    return enforcementAt > now
        ? { outcome: "warn", reason, enforcementAt }
        : { outcome: "enrol", reason };
}

/** Under this much left and the banner stops being furniture. */
export const MFA_GRACE_URGENT_MS = 48 * 60 * 60 * 1000;

/**
 * What the admin chrome should tell this account about the deadline, if anything.
 */
export type MfaGraceNotice = {
    /** When the gate closes. */
    enforcementAt: number;
    /** How long is left. Always positive — a notice with nothing left is `null`. */
    msLeft: number;
    /** Whole days left, floored: 0 on the final day. */
    daysLeft: number;
    /** Whole hours left, floored. What the banner says once `urgent`. */
    hoursLeft: number;
    /** Inside MFA_GRACE_URGENT_MS. The banner changes colour and wording. */
    urgent: boolean;
};

/**
 * The grace-window warning — #939.
 *
 *   #937 IS WHY THIS EXISTS, AND IT IS WORTH BEING PLAIN ABOUT THAT. The
 *   enforcement date passed at midnight and every administrator was redirected
 *   into the enrolment screen and back out of it, in a loop, because the session
 *   never carried `mfaEnabled`. That was one defect. The reason NOBODY SAW IT
 *   COMING was a second one:
 *
 *       adminMfaVerdict has returned `warn` for fourteen days, and
 *       adminMfaGate drops every verdict that is not `enrol`.
 *
 *   So the warning state was computed correctly, on every admin request, for a
 *   fortnight, and shown to no one. The rollout's whole safety mechanism — tell
 *   them before you lock them out — was wired to nothing, which is the same
 *   finding as #663 one layer up.
 *
 *   RETURNS null RATHER THAN A NOTICE WITH A FLAG. A caller that has to read
 *   `notice.shouldShow` is a caller that can forget to, and this is the second
 *   time that mistake would have cost an administrator their admin panel.
 *   Absent means nothing to say: not an administrator, already enrolled, or the
 *   window has closed and the gate is doing the talking now.
 */
export function adminMfaGraceNotice(
    account: { roles?: readonly string[] | null; mfaEnabled?: boolean | null },
    env: NodeJS.ProcessEnv = process.env,
    now: number = Date.now(),
): MfaGraceNotice | null {
    const verdict = adminMfaVerdict(account, env, now);
    //   Asked of the verdict rather than re-deciding it here. If this banner
    //   could appear for an account the gate does not govern, it would be
    //   telling somebody a deadline that will never apply to them.
    if (verdict.outcome !== "warn") return null;

    const msLeft = verdict.enforcementAt - now;

    return {
        enforcementAt: verdict.enforcementAt,
        msLeft,
        daysLeft: Math.floor(msLeft / (24 * 60 * 60 * 1000)),
        hoursLeft: Math.floor(msLeft / (60 * 60 * 1000)),
        urgent: msLeft <= MFA_GRACE_URGENT_MS,
    };
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
