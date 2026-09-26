/**
 * @jest-environment jsdom
 */

/**
 *   #922 A BACKGROUND SESSION REFRESH WITH NO INTERVAL, MOUNTED ON EVERY PAGE.
 *
 *   components/session-refresh-listener is one of the files no test had named. It
 *   is rendered by Providers, so it is on every screen, and it called next-auth's
 *   `update()` on EVERY path change and EVERY window focus.
 *
 * ── WHAT ONE update() COSTS, READ OFF THE CALLBACK IT TRIGGERS ──────────────
 *
 *   A POST to /api/auth/session, the jwt callback re-run, and a forced profile
 *   resync — because `trigger === "update"` is the FIRST term of
 *
 *       if (trigger === "update" || !lastSynced || (now - lastSynced) > SYNC_INTERVAL)
 *
 *   so it skips the two-minute interval entirely. That interval is not a tuning
 *   knob. The callback's own comment, beside the password-reset revocation check:
 *
 *       "Revocation lands within SYNC_INTERVAL rather than instantly — the same
 *        latency the ban check has, and for the same reason: this is the only
 *        place the profile is re-read."
 *
 *   So two minutes is the platform's STATED bound on how long a banned account
 *   may keep acting, and the background refresh was opting out of it on every
 *   navigation — paying for freshness the platform does not claim to need.
 *
 *   And then `useSession()` hands every consumer a new session OBJECT. Swept
 *   below: 24 effects across 21 client components still list the whole `session`
 *   in their dependency array, and most open with a server action.
 *
 * ── MEASURED IN PRODUCTION ONCE, AT ONE OF THOSE CONSUMERS ──────────────────
 *
 *   WaveApplicationClient fixed its own dependency list and named the cause
 *   without changing it:
 *
 *       "checkWaveStatusAction ran about fourteen times in forty seconds for one
 *        member, at 784ms to 2784ms a call. It was keyed on the whole `session`
 *        object. SessionRefreshListener calls next-auth's update() on EVERY path
 *        change and EVERY window focus; update() re-mints the session,
 *        useSession() hands back a new object, and this effect fires again."
 *
 *   One consumer repaired; the cause left running and the other 24 untouched.
 *
 * ── THE FIX, AND WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────
 *
 *   The triggers stay — a path change and a window focus are the right moments to
 *   notice that an admin has granted a role. They are throttled to
 *   SESSION_SYNC_INTERVAL_MS, the number the jwt callback already uses, shared
 *   from lib/session-staleness so there is one statement of "fresh enough"
 *   instead of two that can drift.
 *
 *   A DELIBERATE `update()` is untouched and must be: LoginForm, ProfileClient,
 *   the cooperative onboarding client and the academy dashboard each call it after
 *   changing something the session carries, and there the bypass is the point.
 *   This listener is the one caller that knows of no change at all.
 *
 *   The 24 session-keyed effects are NOT re-keyed here. Two dozen effects across
 *   six modules, each watching for something slightly different, is not a change
 *   to make on a hunch — it is how a working screen stops loading. They are
 *   counted and pinned so the number cannot grow quietly.
 *
 *   `jest` IS THE GLOBAL in this file, per #392 and the note in
 *   a-back-button-that-went-nowhere-and-a-step-you-could-not-see: taking it from
 *   '@jest/globals' defeats jest.mock hoisting, and a render suite has to import
 *   its subject statically.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render } from '@testing-library/react';
import { stripComments } from '@/lib/testing/strip-comments';
import { ledgerVerdict, LEDGER_HELD } from '@/lib/testing/ledger';
import { SESSION_SYNC_INTERVAL_MS } from '@/lib/session-staleness';

const update = jest.fn();
let sessionStatus = 'authenticated';
let pathname = '/dashboard';

jest.mock('next-auth/react', () => ({
    useSession: () => ({ update: (...a: unknown[]) => update(...a), status: sessionStatus }),
}));

jest.mock('next/navigation', () => ({
    usePathname: () => pathname,
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));

import { SessionRefreshListener } from '@/components/session-refresh-listener';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel, minRetainedRatio: 0.2 });

const LISTENER = 'src/components/session-refresh-listener.tsx';
const AUTH = 'src/lib/auth.ts';

beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-25T12:00:00Z'));
    sessionStatus = 'authenticated';
    pathname = '/dashboard';
});

afterEach(() => {
    jest.useRealTimers();
});

/** Mount the listener and return a way to navigate it. */
function mount() {
    const view = render(<SessionRefreshListener />);
    return {
        navigateTo(next: string) {
            pathname = next;
            act(() => { view.rerender(<SessionRefreshListener />); });
        },
        focus() {
            act(() => { fireEvent.focus(window); });
        },
        unmount: view.unmount,
    };
}

/** Advance the clock past the throttle window. */
function waitOutTheInterval() {
    act(() => { jest.setSystemTime(Date.now() + SESSION_SYNC_INTERVAL_MS + 1); });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#922 — the background refresh respects the interval it was skipping', () => {
    it('THE CONTROL: it still refreshes once on mount', () => {
        //   The feature is not removed. A member who has just landed gets the
        //   current roles, which is the whole reason this component exists.
        mount();

        expect(update).toHaveBeenCalledTimes(1);
    });

    it('does NOT refresh again on the next four navigations', () => {
        //   THE defect. Each of these was a POST, a forced profile resync, and a
        //   new session object handed to every consumer on the page.
        const app = mount();
        expect(update).toHaveBeenCalledTimes(1);

        for (const path of ['/marketplace', '/marketplace/seller', '/academy', '/profile']) {
            app.navigateTo(path);
        }

        expect(update).toHaveBeenCalledTimes(1);
    });

    it('nor on a window focus inside the same window', () => {
        const app = mount();
        app.focus();
        app.focus();

        expect(update).toHaveBeenCalledTimes(1);
    });

    it('and refreshes again once the interval has passed', () => {
        //   Without this the throttle would be a mute button: a role granted by an
        //   admin would never reach the member's session.
        const app = mount();
        waitOutTheInterval();
        app.navigateTo('/academy');

        expect(update).toHaveBeenCalledTimes(2);
    });

    it('a focus after the interval refreshes too, not only a navigation', () => {
        const app = mount();
        waitOutTheInterval();
        app.focus();

        expect(update).toHaveBeenCalledTimes(2);
    });

    it('and one interval buys exactly one refresh, however many triggers arrive', () => {
        const app = mount();

        for (let i = 0; i < 3; i++) {
            waitOutTheInterval();
            app.navigateTo(`/page-${i}`);
            app.focus();
            app.navigateTo(`/page-${i}-again`);
        }

        //   The mount, plus one per interval — not one per trigger.
        expect(update).toHaveBeenCalledTimes(4);
    });

    it('refreshes NOTHING while the session is unauthenticated', () => {
        sessionStatus = 'unauthenticated';
        const app = mount();
        app.navigateTo('/marketplace');
        app.focus();

        expect(update).not.toHaveBeenCalled();
    });

    it('and starts refreshing when a loading session becomes authenticated', () => {
        //   The real first-paint sequence: status is "loading" before it is
        //   "authenticated". A throttle stamped during the loading phase would
        //   swallow the first real refresh.
        sessionStatus = 'loading';
        const app = mount();
        expect(update).not.toHaveBeenCalled();

        sessionStatus = 'authenticated';
        app.navigateTo('/dashboard');

        expect(update).toHaveBeenCalledTimes(1);
    });

    it('stops listening when it unmounts', () => {
        const app = mount();
        app.unmount();
        waitOutTheInterval();
        act(() => { fireEvent.focus(window); });

        expect(update).toHaveBeenCalledTimes(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#922 — one statement of how stale a session may be', () => {
    it('the listener and the jwt callback use the same constant', () => {
        expect(code(LISTENER)).toContain('SESSION_SYNC_INTERVAL_MS');
        expect(code(AUTH)).toContain('SYNC_INTERVAL = SESSION_SYNC_INTERVAL_MS');
    });

    it('and neither of them spells the number out any more', () => {
        //   A second literal is how the two start disagreeing about "fresh
        //   enough" — which is exactly what had happened, the listener's own
        //   answer being "always".
        expect(code(AUTH)).not.toContain('2 * 60 * 1000');
        expect(code(LISTENER)).not.toContain('2 * 60 * 1000');
        expect(SESSION_SYNC_INTERVAL_MS).toBe(2 * 60 * 1000);
    });

    it('the bypass the listener was using is still there, for deliberate updates', () => {
        //   NOT removed, and the distinction matters: a caller that has just
        //   changed a role SHOULD skip the interval. Four do.
        expect(code(AUTH)).toContain('trigger === "update" ||');
    });

    it('and those four deliberate callers still call update directly', () => {
        const deliberate = [
            'src/components/auth/LoginForm.tsx',
            'src/app/profile/ProfileClient.tsx',
            'src/app/cooperatives/onboarding/OnboardingClient.tsx',
            'src/app/academy/dashboard/page.tsx',
        ];

        for (const rel of deliberate) {
            expect(code(rel)).toMatch(/update(?:\s*:\s*\w+)?\s*\}\s*=\s*useSession\(\)|update\s*\}\s*=\s*useSession\(\)/);
        }
    });

    it('the throttle is a ref, not state', () => {
        //   State would re-render on every write, and this component's whole
        //   problem is that it causes renders elsewhere.
        const src = code(LISTENER);

        expect(src).toContain('useRef(0)');
        expect(src).not.toContain('useState(0)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#922 — the consumers that re-run on a new session object', () => {
    /**
     * Counted, not re-keyed. Each of these watches for something slightly
     * different, and changing two dozen dependency arrays on one reading is how a
     * working screen stops loading. The number is pinned so it cannot grow.
     */
    function sessionKeyedEffects(): string[] {
        const found: string[] = [];

        const walk = (dir: string): void => {
            for (const entry of readdirSync(join(ROOT, dir))) {
                const rel = `${dir}/${entry}`;
                if (statSync(join(ROOT, rel)).isDirectory()) {
                    if (!['node_modules', '.next', '__tests__'].includes(entry)) walk(rel);
                    continue;
                }
                if (!entry.endsWith('.tsx')) continue;
                const src = readFileSync(join(ROOT, rel), 'utf8');
                if (!src.includes('useSession(')) continue;

                for (const m of src.matchAll(/\}, \[([^\]]*)\]\)/g)) {
                    //   The whole object, not `session?.user?.id`. Member accesses
                    //   are stripped first so they cannot be mistaken for it.
                    const deps = m[1].replace(/session\?\.[A-Za-z.?]+/g, '');
                    if (/\bsession\b/.test(deps)) found.push(`${rel}  [${m[1].replace(/\s+/g, ' ').trim()}]`);
                }
            }
        };
        walk('src');

        return [...new Set(found)].sort();
    }

    it('THE LEDGER — how many effects a re-minted session still re-runs', () => {
        /*
         *   #944 24 -> 17. Seven re-keyed, and the seven were chosen by reading
         *   each body rather than by pattern — this file's own note says why:
         *   "re-keying two dozen on a hunch is how a working screen stops
         *   loading".
         *
         *   SIX read nothing from the session but `user?.id`, so they key on that
         *   now: the academy progress screen, both Farm Nation inquiry screens,
         *   and the WAVE earnings, resources and shipments screens.
         *
         *   ONE — Farm Nation my-purchases — did not read the session AT ALL. Its
         *   body branches on `status` and `initial` and calls loadPurchases; the
         *   `session` in its dependency array was pure noise, re-running a server
         *   action on every refresh for a value it never looked at.
         *
         *   THE SEVENTEEN LEFT ARE NOT LEFT OUT OF LAZINESS. Each reads the whole
         *   `user` object or several of its fields, so each needs a decision about
         *   which fields it is actually watching — and two of them hold a BARE
         *   `if (session)` truthiness check, which is the trap: a scan that looks
         *   for `session.` followed by a member misses those entirely and reports
         *   them as not using the session at all. Mine did, on marketplace/checkout
         *   and ModuleRegisterPage, and sweeping on that reading would have pulled
         *   the dependency out from under two working screens.
         *
         *   So the remaining seventeen are per-file work with a per-file reading,
         *   which is what this note asked for in the first place.
         */
        const effects = sessionKeyedEffects();

        expect(ledgerVerdict(effects.length, 17)).toBe(LEDGER_HELD);
    });

    it('AND THE SEVEN THAT WERE RE-KEYED STAY RE-KEYED', () => {
        //   Named, so a later edit that puts the whole object back fails here
        //   rather than being absorbed by the count above.
        const files = sessionKeyedEffects().map((e) => e.split('  ')[0]);

        for (const rel of [
            'src/app/academy/(learner)/progress/ProgressClient.tsx',
            'src/app/farm-nation/(member)/inquiries/InquiriesClient.tsx',
            'src/app/farm-nation/(member)/inquiries/[id]/InquiryDetailsClient.tsx',
            'src/app/farm-nation/(member)/my-purchases/MyPurchasesClient.tsx',
            'src/app/wave/(member)/earnings/WaveEarningsClient.tsx',
            'src/app/wave/(member)/resources/WaveResourcesClient.tsx',
            'src/app/wave/(member)/shipments/WaveShipmentsClient.tsx',
        ]) {
            expect({ rel, onLedger: files.includes(rel) }).toEqual({ rel, onLedger: false });
        }
    });

    it('POSITIVE CONTROL: the sweep finds real ones, named', () => {
        //   A ledger over a sweep that matched nothing would also hold.
        const files = sessionKeyedEffects().map((e) => e.split('  ')[0]);

        expect(files).toContain('src/app/marketplace/checkout/page.tsx');
        expect(files).toContain('src/app/profile/ProfileClient.tsx');
    });

    it('and the one that was already repaired is NOT on it', () => {
        //   WaveApplicationClient re-keyed on `session?.user?.id`. If it comes
        //   back onto this list, the repair was undone.
        const files = sessionKeyedEffects().map((e) => e.split('  ')[0]);

        expect(files).not.toContain('src/app/wave/application/WaveApplicationClient.tsx');
        expect(code('src/app/wave/application/WaveApplicationClient.tsx'))
            .toContain('[session?.user?.id]');
    });
});
