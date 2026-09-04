"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { signOut, useSession } from "next-auth/react";
import { AlertTriangle, X } from "lucide-react";

/**
 * Session Activity Tracker
 *
 * Signs a member out of the BROWSER after a period with no interaction, and
 * warns them first.
 *
 *   - 10-minute inactivity timeout, warning at 60 seconds remaining
 *   - Cross-tab synchronisation through localStorage
 *   - Debounced activity tracking (at most one write per 30 seconds)
 *   - Listens for: mousemove, keydown, click, scroll, touchstart
 *
 *   #350 THE HEADER SAID "30-minute inactivity timeout" AND "Warning modal 2
 *        minutes before logout". The constants below are 10 minutes and 60
 *        seconds and always have been. Two of the three statements of this rule
 *        were wrong, which is what made the numbers worth reading rather than
 *        trusting.
 *
 *   #350 AND WHAT THIS CONTROL IS, PRECISELY. It is a convenience and a
 *        shoulder-surfing guard in the browser, NOT a session lifetime. The
 *        server's NextAuth session is `maxAge: 8 * 60 * 60` (lib/auth.ts) and
 *        this component cannot shorten it: the cookie remains valid for eight
 *        hours whatever happens here, and nothing server-side consults
 *        `lastActivity`. Stated so nobody mistakes it for the enforcement it
 *        resembles — the same correction #314 made to SessionGuard.
 *
 *   #240 CLOSING THE BROWSER DID NOT END THE SESSION, AND THIS COMPONENT ERASED
 *        THE EVIDENCE THAT IT HAD BEEN CLOSED.
 *
 *        @auth/core writes the session cookie with `expires = now + maxAge`
 *        unconditionally (lib/actions/callback/index.js), so it is a PERSISTENT
 *        cookie: closing the browser leaves a member signed in for up to eight
 *        hours. On a shared computer the next person to open the browser is
 *        signed in as them.
 *
 *        The mount effect used to run `writeLastActivity(Date.now())`
 *        unconditionally, so reopening the browser two hours later restarted
 *        the ten-minute clock instead of ending the session. The stored
 *        timestamp already said the member had been away far longer than the
 *        timeout, and this threw it away before the first tick could read it.
 *
 *        A stored timestamp is now HONOURED when it belongs to the session we
 *        are standing in, and the existing `remaining <= 0` branch signs the
 *        member out on the first tick. Nothing else changes.
 *
 *        WHY authAt AND NOT "CLEAR IT AT LOGIN". A stale timestamp signing
 *        somebody out immediately after they log in is a real loop —
 *        HardLogoutButton exists partly because of it — and clearing the key on
 *        the login path would only close it for the login paths somebody
 *        remembered. `session.user.authAt` is when THIS session was minted
 *        (#306), so a timestamp older than it belongs to a previous session and
 *        is ignored. That holds for every way in, including ones added later.
 *
 *        FAIL TOWARD THE MEMBER. No stored timestamp, an unreadable one, or a
 *        session with no authAt (minted before #306) all seed a fresh clock
 *        rather than signing anybody out — so deploying this cannot eject
 *        anybody who is mid-session.
 *
 *        WHAT THIS IS STILL NOT. It is the browser acting on its own state. The
 *        cookie is unchanged and remains valid for its eight hours; a client
 *        that never runs this component is not bound by it. The correct fix is
 *        a session-scoped cookie, which @auth/core 5.0.0-beta.32 does not let
 *        this app ask for — `expires` is applied after the spread of
 *        `cookies.sessionToken.options`, so it cannot be suppressed from config.
 */

const SESSION_TIMEOUT_MS = 10 * 60 * 1000;  // 10 minutes
const WARNING_THRESHOLD_MS = 60 * 1000;       // Show warning 60 seconds before timeout
const ACTIVITY_DEBOUNCE_MS = 30 * 1000;       // Update activity timestamp max once per 30 seconds

/**
 *   #350 EVERY localStorage CALL IN THIS FILE WAS UNGUARDED, and this
 *        component mounts in ClientLayout for EVERY authenticated page. In
 *        Safari private browsing and wherever site data is blocked, the accessor
 *        itself throws — so the first tick took down whatever page the member
 *        was on. Same class as #347, and with a wider blast radius than any of
 *        the three screens there.
 *
 *        A browser that cannot store the timestamp simply does not get the idle
 *        timeout. That is the honest degradation: the server session is what
 *        actually bounds access, and it is unaffected.
 */
function readLastActivity(): number {
    try {
        const raw = localStorage.getItem("lastActivity");
        return raw === null ? NaN : parseInt(raw, 10);
    } catch {
        return NaN;
    }
}

function writeLastActivity(at: number): void {
    try { localStorage.setItem("lastActivity", String(at)); } catch { /* no store */ }
}

function clearLastActivity(): void {
    try { localStorage.removeItem("lastActivity"); } catch { /* no store */ }
}

/**
 * #240 — does this stored timestamp belong to the session we are standing in?
 *
 * Exported because it is the whole of the decision and deserves to be tested as
 * a value rather than through a rendered component. `authAt` is when THIS
 * session was minted; anything recorded before that was recorded by a previous
 * one and must not be allowed to sign the current member out.
 *
 * Everything unknown answers false, which seeds a fresh clock: no stored value,
 * an unreadable one, or a session minted before authAt existed.
 */
export function belongsToThisSession(stored: number, authAt: unknown): boolean {
    return Number.isFinite(stored)
        && typeof authAt === "number"
        && Number.isFinite(authAt)
        && stored >= authAt;
}

export default function SessionActivityTracker() {
    const { data: session, status } = useSession();
    const authAt = session?.user?.authAt;
    const [showWarning, setShowWarning] = useState(false);
    const [timeRemaining, setTimeRemaining] = useState(0);
    const [lastActivityTime, setLastActivityTime] = useState(() => Date.now());

    /**
     *   #350 THIS FIRED ONCE A SECOND, FOREVER.
     *
     *        checkTimeout runs on a 1000ms interval and called handleLogout()
     *        whenever `remaining <= 0`. signOut() navigates, but the interval
     *        is not cleared and there was no in-flight guard, so every tick
     *        during the redirect started ANOTHER sign-out — a burst of
     *        concurrent /api/auth/signout requests from one idle tab, and the
     *        same again on the warning screen's "Logout Now" if it was clicked
     *        twice.
     */
    const loggingOut = useRef(false);

    async function handleLogout() {
        if (loggingOut.current) return;
        loggingOut.current = true;

        clearLastActivity();
        // Preserve current path so user resumes from where they left off
        const returnUrl = typeof window !== "undefined"
            ? window.location.pathname + window.location.search
            : "/dashboard";
        await signOut({ callbackUrl: `/auth/login?callbackUrl=${encodeURIComponent(returnUrl)}` });
    }

    // Update activity timestamp
    const updateActivity = useCallback(() => {
        const now = Date.now();
        const timeSinceLastUpdate = now - lastActivityTime;

        // Debounce: only update if > 30 seconds since last update
        if (timeSinceLastUpdate >= ACTIVITY_DEBOUNCE_MS) {
            setLastActivityTime(now);
            writeLastActivity(now);
            setShowWarning(false);
        }
    }, [lastActivityTime]);

    // Check session timeout
    useEffect(() => {
        /**
         *   #240 NOTHING IS SEEDED OR RESUMED UNTIL THE SESSION HAS RESOLVED.
         *
         *        The decision below needs `authAt`, and running it while the
         *        session is still loading would seed a fresh timestamp with no
         *        authAt to compare against — which is exactly the unconditional
         *        write this replaced. A cold entry would then look identical to
         *        a live one and the sign-out would never happen.
         */
        if (status === "loading") return;

        function checkTimeout() {
            /**
             *   #350 AN UNREADABLE TIMESTAMP DISARMED THE WHOLE CONTROL.
             *
             *        This read:
             *
             *            const lastActivity = parseInt(
             *                localStorage.getItem("lastActivity") || Date.now().toString(), 10);
             *
             *        The `||` covers null. It does not cover a value that is
             *        present and not a number — "abc", a truncated write, a
             *        value from an older build. parseInt returns NaN, so
             *        `remaining` is NaN, and BOTH branches below compare against
             *        it:
             *
             *            NaN <= WARNING_THRESHOLD_MS   false — no warning
             *            NaN <= 0                      false — no logout
             *
             *        The tracker went on ticking once a second, for as long as
             *        the tab was open, signing nobody out. A control that fails
             *        OPEN on a value anyone can put in their own localStorage.
             *
             *        An unusable timestamp is now treated as "no activity
             *        recorded", which restarts the clock rather than removing
             *        it — the same choice #347 made for the other three storage
             *        readers, and the safe one here because the alternative
             *        (treating it as infinitely old) would sign out a member
             *        mid-session over a corrupt string.
             */
            const raw = readLastActivity();
            const lastActivity = Number.isFinite(raw) ? raw : (writeLastActivity(Date.now()), Date.now());

            const timeSinceActivity = Date.now() - lastActivity;
            const remaining = SESSION_TIMEOUT_MS - timeSinceActivity;

            setTimeRemaining(remaining);

            // Show warning if close to timeout
            if (remaining <= WARNING_THRESHOLD_MS && remaining > 0) {
                setShowWarning(true);
            }

            // Auto-logout if timeout exceeded
            if (remaining <= 0) {
                handleLogout();
            }
        };

        /**
         *   #240 THIS USED TO BE AN UNCONDITIONAL `writeLastActivity(Date.now())`.
         *
         *        Its comment said it "prevents stale timestamps from a previous
         *        session triggering an immediate warning for a new login" —
         *        a real hazard, and HardLogoutButton's note describes the loop
         *        it causes. But it also erased the ONE case the timeout should
         *        act on: the member closed the browser, the session cookie
         *        outlived it, and the stored timestamp is the only record that
         *        they were away longer than the timeout.
         *
         *        Both are handled by asking whose timestamp it is rather than
         *        how old it is. A timestamp recorded during THIS session is
         *        honoured — including one that is already past the timeout, so
         *        the tick below signs the member out. Anything else seeds a
         *        fresh clock.
         *
         *        #350's cost note still holds for the honoured case and is now
         *        the point rather than a cost: a full page load no longer
         *        restarts the idle clock.
         */
        const stored = readLastActivity();
        const resume = belongsToThisSession(stored, authAt);
        if (!resume) writeLastActivity(Date.now());
        setTimeout(() => setLastActivityTime(resume ? stored : Date.now()), 0);

        // Check every second
        const interval = setInterval(checkTimeout, 1000);

        return () => clearInterval(interval);
    }, [status, authAt]);

    // Activity event listeners
    useEffect(() => {
        const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];

        events.forEach((event) => {
            window.addEventListener(event, updateActivity, { passive: true });
        });

        return () => {
            events.forEach((event) => {
                window.removeEventListener(event, updateActivity);
            });
        };
    }, [updateActivity]);

    // Cross-tab synchronization
    useEffect(() => {
        function handleStorageChange(e: StorageEvent) {
            if (e.key === "lastActivity" && e.newValue) {
                setLastActivityTime(parseInt(e.newValue, 10));
                setShowWarning(false);
            }
        };

        window.addEventListener("storage", handleStorageChange);
        return () => window.removeEventListener("storage", handleStorageChange);
    }, []);

    function handleExtendSession() {
        updateActivity();
        setShowWarning(false);
    };

    const formatTime = (ms: number) => {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    };

    if (!showWarning) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
                {/* Header */}
                <div className="bg-linear-to-r from-amber-500 to-orange-500 p-6 text-white">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                                <AlertTriangle className="w-6 h-6" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold">Session Timeout Warning</h2>
                                <p className="text-sm text-white/90">Your session is about to expire</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6">
                    <div className="mb-6">
                        <p className="text-slate-900 mb-4">
                            You've been inactive for a while. For your security, you'll be automatically
                            logged out soon.
                        </p>

                        <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded">
                            <p className="text-sm font-medium text-amber-800 mb-1">
                                Time Remaining
                            </p>
                            <p className="text-3xl font-bold text-amber-600 tabular-nums">
                                {formatTime(timeRemaining)}
                            </p>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="space-y-3">
                        <button
                            onClick={handleExtendSession}
                            className="w-full flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition"
                        >
                            <span>Continue Session</span>
                        </button>

                        <button
                            onClick={handleLogout}
                            className="w-full flex items-center justify-center space-x-2 bg-slate-200 hover:bg-slate-300 text-slate-900 font-medium py-3 px-4 rounded-lg transition"
                        >
                            <span>Logout Now</span>
                        </button>
                    </div>

                    <p className="text-xs text-slate-500 text-center mt-4">
                        Click anywhere or press any key to stay logged in
                    </p>
                </div>
            </div>
        </div>
    );
}
