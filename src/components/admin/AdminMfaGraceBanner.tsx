import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { adminMfaGraceNotice, MFA_SETUP_PATH } from "@/lib/mfa-policy";
import { formatDateOrDash } from "@/lib/date-utils";

/**
 * THE WARNING THE ROLLOUT ALWAYS CLAIMED TO GIVE — #939.
 *
 *   mfa-policy's header describes the rollout as "an administrator without MFA
 *   is warned and let through. Nothing changes for anyone." The "let through"
 *   half worked. The "warned" half did not exist: adminMfaVerdict returned
 *   `warn` on every admin request for fourteen days and adminMfaGate discards
 *   every verdict that is not `enrol`, so the warning went nowhere. Then the
 *   date passed and the gate closed on administrators who had never been told.
 *
 *   This is that missing half. It renders in AdminShell, which is the chrome for
 *   both /admin and /loans/approve — the same two surfaces isAdminSurface()
 *   governs — so the warning reaches exactly the screens the gate will later
 *   refuse.
 *
 * ── WHAT IT IS CAREFUL ABOUT ────────────────────────────────────────────────
 *
 *   IT NAMES THE DAY, NOT "SOON". An administrator deciding whether to stop and
 *   enrol now needs to know if they have a fortnight or an afternoon. The date
 *   comes from adminMfaEnforcementAt, the same function the gate's own
 *   `graceActive` asks, so the banner cannot name a day the gate does not
 *   enforce.
 *
 *   IT SAYS WHAT WILL HAPPEN, IN THE WORDS OF WHAT IT WILL LOOK LIKE. "Access
 *   will be restricted" is the sentence that gets read as boilerplate. What
 *   actually happens is that every admin page sends them to the setup screen
 *   until they enrol, and that is what it says — because an administrator who
 *   has read this sentence and then hits it will recognise it rather than
 *   reporting the admin panel as broken.
 *
 *   IT IS NOT DISMISSIBLE, AND THAT IS A DECISION. A dismiss button on a
 *   deadline notice lets somebody bury the one warning standing between them and
 *   a lockout, and the cost of being wrong is asymmetric: an irritating banner
 *   versus an administrator who cannot reach the admin panel. It clears itself
 *   the moment they enrol, which is the dismissal that should exist — there is
 *   no state to keep, nothing to remember per browser, and no way to be rid of
 *   it except the thing it is asking for.
 *
 *   IT IS A SERVER COMPONENT WITH NO CLOCK OF ITS OWN, AND THAT IS LITERAL. The
 *   countdown is computed once, on the server, from the session already in
 *   AdminShell's hand. A client component reading Date.now() on a force-dynamic
 *   page is a hydration mismatch waiting to be filed as a bug, and this needs no
 *   interactivity at all.
 *
 *   The clock is read by adminMfaGraceNotice, not here. Its `now` parameter
 *   already defaults to Date.now(), which is the pattern every function in
 *   mfa-policy follows — and reading it in this signature instead put an impure
 *   call in a render, which react-hooks/purity refused. Correctly: nothing else
 *   in this codebase reads the clock during a render, and the two places that
 *   come close do it in an event handler and a useState initialiser.
 */

/** Renders nothing at all unless this account is inside the grace window. */
export function AdminMfaGraceBanner({
    roles,
    mfaEnabled,
    now,
}: {
    roles: readonly string[] | null | undefined;
    mfaEnabled: boolean | null | undefined;
    /**
     * Injected in tests. Left undefined in production, where
     * adminMfaGraceNotice's own default supplies the server's clock — see the
     * note above for why the default does not live in this signature.
     */
    now?: number;
}) {
    const notice = adminMfaGraceNotice({ roles, mfaEnabled }, process.env, now);

    //   Not an administrator, already enrolled, or the window has closed and the
    //   gate is doing the talking. Nothing to say in any of those cases.
    if (!notice) return null;

    /*
     *   WAT, and said so. The platform's own default timezone is Africa/Lagos
     *   (admin/settings/localization), and a deadline printed in UTC is an hour
     *   off for every person reading it — which on the final day is the
     *   difference between "tomorrow" and "tonight".
     */
    const when = formatDateOrDash(
        new Date(notice.enforcementAt),
        { dateStyle: "full", timeStyle: "short", timeZone: "Africa/Lagos" },
        "",
    );

    /*
     *   THE NON-URGENT BRANCH IS ALWAYS PLURAL, AND THAT IS ARITHMETIC RATHER
     *   THAN AN ASSUMPTION. `urgent` is msLeft <= 48h, so anything reaching the
     *   day branch has more than two days on it and daysLeft is at least 2.
     *
     *   The first version of this carried a `daysLeft === 1 ? "1 day"` case. It
     *   could not execute — one day left is inside the urgent window and counts
     *   in hours — and a test written to exercise it is what found that. A
     *   singular case nothing can reach is a branch that will be maintained
     *   forever and read by nobody, so it is gone instead of guarded.
     */
    const remaining = notice.urgent
        ? (notice.hoursLeft <= 1 ? "less than an hour" : `about ${notice.hoursLeft} hours`)
        : `${notice.daysLeft} days`;

    const tone = notice.urgent
        ? { box: "border-red-300 bg-red-50", icon: "text-red-600", head: "text-red-900", body: "text-red-800", cta: "bg-red-600 hover:bg-red-700" }
        : { box: "border-amber-300 bg-amber-50", icon: "text-amber-600", head: "text-amber-900", body: "text-amber-800", cta: "bg-amber-600 hover:bg-amber-700" };

    return (
        <div
            role="alert"
            className={`mx-4 mt-4 rounded-xl border p-4 sm:mx-6 ${tone.box}`}
        >
            <div className="flex items-start gap-3">
                <ShieldAlert className={`mt-0.5 h-5 w-5 shrink-0 ${tone.icon}`} />
                <div className="min-w-0 flex-1">
                    <p className={`text-sm font-semibold ${tone.head}`}>
                        Set up two-factor authentication — {remaining} left
                    </p>
                    <p className={`mt-1 text-sm leading-relaxed ${tone.body}`}>
                        Administrator accounts must have two-factor authentication
                        {when ? <> from <strong>{when}</strong></> : null}. After that, every admin
                        page will send you to the setup screen until you have enrolled — including
                        this one.
                    </p>
                    <Link
                        href={MFA_SETUP_PATH}
                        className={`mt-3 inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium text-white ${tone.cta}`}
                    >
                        Set it up now
                    </Link>
                </div>
            </div>
        </div>
    );
}
