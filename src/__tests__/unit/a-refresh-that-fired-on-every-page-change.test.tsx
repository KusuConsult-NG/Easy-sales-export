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
 *   below: 24 effects across 21 client components listed the whole `session` in
 *   their dependency array, and most opened with a server action. All 24 are
 *   re-keyed now — #944, in three passes, and the ledger is closed at zero.
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
 *   THE 24 SESSION-KEYED EFFECTS WERE NOT RE-KEYED IN THE SAME PASS, and the
 *   reason is the one recorded when the ledger opened: two dozen effects across
 *   six modules, each watching for something slightly different, is not a change
 *   to make on a hunch — it is how a working screen stops loading. So they were
 *   counted and pinned first, then read one at a time: seven, then seventeen.
 *
 *   #944 CLOSED IT AT ZERO. Twelve key on `session?.user?.id`, five name the
 *   further fields their bodies actually read, and two of those five key on
 *   `roles?.join(",")` rather than on `roles` — an array dependency is re-created
 *   by every re-mint, so keying on it would have looked like the fix and bought
 *   nothing. The ledger stays, at zero, because the twenty-first file is how the
 *   count starts growing back.
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
     * The dependency arrays in ONE file's source that name the whole `session`
     * object rather than the fields the body reads.
     *
     * Split out from the walk below so the positive control can hand it a fixture.
     * #943's sweep taught that lesson the hard way: its control asserted the sweep
     * found two named FILES, and closing the ledger fixed both, so a control
     * proving the sweep worked failed for the best possible reason — "a control
     * that rots as the ledger closes is a control that will be deleted at exactly
     * the wrong moment". A fixture cannot rot, because nobody can repair it.
     */
    function sessionKeyedDepsIn(src: string): string[] {
        if (!src.includes('useSession(')) return [];

        const found: string[] = [];
        for (const m of src.matchAll(/\}, \[([^\]]*)\]\)/g)) {
            //   Member accesses are stripped FIRST so `session?.user?.id` cannot be
            //   mistaken for the whole object.
            const deps = m[1].replace(/session\?\.[A-Za-z.?]+/g, '');
            if (/\bsession\b/.test(deps)) found.push(m[1].replace(/\s+/g, ' ').trim());
        }

        return found;
    }

    /** Every such effect in shipping code, as `path  [deps]`. */
    function sessionKeyedEffects(): { effects: string[]; filesRead: number } {
        const effects: string[] = [];
        let filesRead = 0;

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
                filesRead++;

                for (const deps of sessionKeyedDepsIn(src)) effects.push(`${rel}  [${deps}]`);
            }
        };
        walk('src');

        return { effects: [...new Set(effects)].sort(), filesRead };
    }

    it('THE LEDGER — how many effects a re-minted session still re-runs', () => {
        /*
         *   #944 24 -> 17 -> 0. CLOSED, and the seventeen were read one at a time
         *   rather than swept, because this file's own note said why not: "two dozen
         *   effects across six modules, each watching for something slightly
         *   different, is not a change to make on a hunch — it is how a working
         *   screen stops loading."
         *
         *   EVERY ONE NOW DEPENDS ON PRIMITIVES HOISTED ABOVE THE HOOK — `userId`,
         *   `userEmail`, `isSignedIn`, a joined role key — rather than on a member
         *   chain written into the dependency array. That is not tidying. It is what
         *   makes the dependency something react-hooks/exhaustive-deps can check,
         *   and the rule then caught three of my own re-keys being WRONG.
         *
         *   ── THE THREE I GOT WRONG, AND THE ONE THING THEY SHARE ─────────────
         *
         *     CourseDetailClient   Keyed on `session?.user?.id`. The effect also
         *                          reads the ACADEMY PLAN off the session and
         *                          decides `mustPurchase` from it, so a grant an
         *                          administrator makes mid-session would not have
         *                          re-run the access check.
         *
         *     ProfileClient        Keyed on id + email + name. The form also seeds
         *                          `gender` from the session.
         *
         *     wave/landing         Keyed on the roles. The redirect also reads the
         *                          WAVE REGISTRATION STATUS, so an approval would
         *                          not have moved the applicant off a page whose
         *                          button still says "Begin Here - Apply Now!".
         *
         *   ALL THREE READS WERE BEHIND AN `as any` CAST. That is why the rule could
         *   only say "missing dependency: session.user" instead of naming the field,
         *   and why my own reading of each body missed them: the cast is exactly
         *   what #937 found in middleware — `(req.auth?.user as {...})?.mfaEnabled` —
         *   a check that existed and was talked out of. Each is a named primitive
         *   with a real type now, so the rule states the dependency rather than
         *   shrugging at it.
         *
         *   Under-specifying a dependency is the quieter failure of the two. An
         *   effect that re-runs too often is slow; one that re-runs too rarely shows
         *   somebody a stale answer about their own account.
         *
         *   ── AND TWO MORE DEFECTS FELL OUT OF READING THE BODIES ─────────────
         *
         *     CertificateClient    `if (!session) router.push("/auth/login")` fires
         *                          while the session is still LOADING — `session` is
         *                          null and `status` is "loading" until next-auth
         *                          answers — so a learner on a slow connection was
         *                          bounced to a login page that bounced them back.
         *                          It asks `status === "unauthenticated"` now.
         *
         *     ModuleRegisterPage   `platforms` was in the dependency array and the
         *                          effect body never reads it. The same noise as
         *                          Farm Nation my-purchases, one pass earlier.
         *
         *   ── THE TRAP, RECORDED BECAUSE IT NEARLY COST TWO SCREENS ──────────
         *
         *   My first scan asked for `session.` followed by a member, so it missed a
         *   bare `if (session)` and reported marketplace/checkout and
         *   ModuleRegisterPage as not using the session AT ALL. Sweeping on that
         *   reading would have pulled the dependency out from under two working
         *   screens. The scan above strips member accesses and then looks for a bare
         *   `session` token, which is the opposite question and the right one.
         */
        const { effects } = sessionKeyedEffects();

        expect(ledgerVerdict(effects.length, 0)).toBe(LEDGER_HELD);
    });

    it('POSITIVE CONTROL: the sweep finds the shapes it is looking for', () => {
        //   On a FIXTURE, not on files — see sessionKeyedDepsIn's note. A ledger at
        //   zero over a sweep that matched nothing would also read as closed.
        const offending = `
            const { data: session } = useSession();
            useEffect(() => { void load(session); }, [session, router]);
            useEffect(() => { if (session) go(); }, [status, session]);
        `;

        expect(sessionKeyedDepsIn(offending)).toEqual(['session, router', 'status, session']);
    });

    it('AND NEGATIVE CONTROL: it does not flag the spellings the repair uses', () => {
        //   Every form the seventeen were re-keyed to. If the sweep counted any of
        //   these, the ledger above would be held by a matcher that cannot fail.
        const repaired = `
            const { data: session } = useSession();
            useEffect(() => { void load(); }, [session?.user?.id]);
            useEffect(() => { void load(); }, [session?.user?.email, session?.user?.name]);
            useEffect(() => { void load(); }, [status, session?.user?.roles?.join(",")]);
            useEffect(() => { void load(); }, [propertyId, router]);
        `;

        expect(sessionKeyedDepsIn(repaired)).toEqual([]);
        //   And a file with no useSession at all is not scanned for `session`,
        //   which would otherwise match an unrelated local of that name.
        expect(sessionKeyedDepsIn('useEffect(() => {}, [session]);')).toEqual([]);
    });

    it('AND THE WALK ACTUALLY REACHES THE FILES, which the fixtures cannot prove', () => {
        //   The fixture controls prove the matcher works. This proves the matcher is
        //   being pointed at shipping code: a walk that silently read nothing —
        //   a renamed directory, a changed extension — would hold the ledger too.
        const { filesRead } = sessionKeyedEffects();

        expect(filesRead).toBeGreaterThan(80);
    });

    it('AND ALL TWENTY-FOUR STAY RE-KEYED, BY NAME', () => {
        //   Named as well as counted, so putting the whole object back into one of
        //   them fails HERE with the file in the message, rather than as an
        //   off-by-one in a total.
        const files = sessionKeyedEffects().effects.map((e) => e.split('  ')[0]);

        for (const rel of [
            //   #944's first seven.
            'src/app/academy/(learner)/progress/ProgressClient.tsx',
            'src/app/farm-nation/(member)/inquiries/InquiriesClient.tsx',
            'src/app/farm-nation/(member)/inquiries/[id]/InquiryDetailsClient.tsx',
            'src/app/farm-nation/(member)/my-purchases/MyPurchasesClient.tsx',
            'src/app/wave/(member)/earnings/WaveEarningsClient.tsx',
            'src/app/wave/(member)/resources/WaveResourcesClient.tsx',
            'src/app/wave/(member)/shipments/WaveShipmentsClient.tsx',
            //   And the seventeen that closed it.
            'src/app/academy/[courseId]/CourseDetailClient.tsx',
            'src/app/academy/[courseId]/lesson/[lessonId]/LessonClient.tsx',
            'src/app/academy/[courseId]/quiz/[moduleId]/QuizClient.tsx',
            'src/app/academy/certificate/[certificateId]/CertificateClient.tsx',
            'src/app/escrow/[id]/chat/EscrowChatClient.tsx',
            'src/app/escrow/[id]/dispute/CreateDisputeClient.tsx',
            'src/app/farm-nation/(member)/edit-property/[id]/EditPropertyClient.tsx',
            'src/app/farm-nation/checkout/[propertyId]/CheckoutClient.tsx',
            'src/app/marketplace/buyer/quotes/BuyerQuotesClient.tsx',
            'src/app/marketplace/checkout/page.tsx',
            'src/app/marketplace/onboarding/MarketplaceOnboardingClient.tsx',
            'src/app/profile/ProfileClient.tsx',
            'src/app/wave/landing/page.tsx',
            'src/components/auth/ModuleRegisterPage.tsx',
            //   And the one that was repaired before this suite existed.
            'src/app/wave/application/WaveApplicationClient.tsx',
        ]) {
            expect({ rel, onLedger: files.includes(rel) }).toEqual({ rel, onLedger: false });
        }
    });

    /**
     * Dependency arrays in one file's source that name a `session…roles` chain.
     *
     * A member chain is what a scan can actually see; a bare local called `roles`
     * cannot be told apart from a memoised one, which is why the memoised case is
     * asserted by name in the next test instead of inferred here.
     */
    function rolesChainDepsIn(src: string): string[] {
        const found: string[] = [];
        for (const m of src.matchAll(/\}, \[([^\]]*)\]\)/g)) {
            for (const dep of m[1].split(',')) {
                //   `session?.user?.roles` as a dependency, with nothing after it.
                //   `roles?.join(",")` and `roles?.[0]` are not this.
                if (/^\s*session[?.\w]*\.roles\s*$/.test(dep)) {
                    found.push(m[1].replace(/\s+/g, ' ').trim());
                }
            }
        }
        return found;
    }

    it('AND NO EFFECT ANYWHERE DEPENDS ON A session.roles CHAIN', () => {
        /*
         *   The part of this repair that is easiest to undo while looking correct.
         *   `[session?.user?.roles]` reads like a narrowing and is not one: a
         *   re-minted session builds a NEW array, React compares dependencies by
         *   identity, and the effect fires exactly as often as it did keyed on the
         *   whole object.
         *
         *   Swept rather than named, because the two files that had this are not
         *   the interesting ones — the twenty-first file is.
         */
        const offenders: string[] = [];
        const walk = (dir: string): void => {
            for (const entry of readdirSync(join(ROOT, dir))) {
                const rel = `${dir}/${entry}`;
                if (statSync(join(ROOT, rel)).isDirectory()) {
                    if (!['node_modules', '.next', '__tests__'].includes(entry)) walk(rel);
                    continue;
                }
                if (!entry.endsWith('.tsx')) continue;

                const src = readFileSync(join(ROOT, rel), 'utf8');
                for (const deps of rolesChainDepsIn(src)) offenders.push(`${rel}  [${deps}]`);
            }
        };
        walk('src');

        expect(offenders).toEqual([]);
    });

    it('POSITIVE CONTROL for that sweep, on a fixture', () => {
        //   It found nothing above, so it has to be shown finding something. On a
        //   fixture rather than a file, for the reason sessionKeyedDepsIn records.
        expect(rolesChainDepsIn('useEffect(() => {}, [status, session?.user?.roles, router]);'))
            .toEqual(['status, session?.user?.roles, router']);
        expect(rolesChainDepsIn('useEffect(() => {}, [session.user.roles]);'))
            .toEqual(['session.user.roles']);

        //   And the spellings that are NOT the defect. The middle one is the trap
        //   my own first sweep fell into: a memoised local beside `sessionStatus`.
        for (const ok of [
            'useEffect(() => {}, [session?.user?.roles?.join(",")]);',
            'useEffect(() => {}, [sessionStatus, roles, waveRegStatus, router]);',
            'useEffect(() => {}, [isAdminViewer, userId]);',
        ]) {
            expect({ ok, found: rolesChainDepsIn(ok) }).toEqual({ ok, found: [] });
        }
    });

    it('AND THE TWO THAT READ ROLES HOIST A VALUE THE RULE CAN CHECK', () => {
        //   Named, because each chose a different right answer and both are worth
        //   keeping: a memoised array keyed on the joined string, and a boolean.
        const landing = code('src/app/wave/landing/page.tsx');

        expect(landing).toContain('const roleKey = session?.user?.roles?.join(",") ?? "";');
        expect(landing).toContain('useMemo(() => (roleKey ? roleKey.split(",") : []), [roleKey])');
        //   And the WAVE status, which keying on the roles alone missed.
        expect(landing).toContain('waveRegStatus');
        expect(landing).toMatch(/\}, \[sessionStatus, roles, waveRegStatus, router\]\)/);

        const chat = code('src/app/escrow/[id]/chat/EscrowChatClient.tsx');

        expect(chat).toContain('const isAdminViewer =');
        expect(chat).toMatch(/\}, \[status, userId, isAdminViewer, escrowId, router, showToast, takeEscrow\]\)/);
        //   #364 holds this file on STILL_HAND_WRITTEN at exactly its recorded
        //   size, so collapsing the roles to a boolean must not have quietly
        //   adopted isPlatformAdmin and changed that list from here.
        expect(chat).not.toContain('isPlatformAdmin(');
    });

    it('AND THE THREE READS A CAST HAD HIDDEN ARE NAMED DEPENDENCIES NOW', () => {
        /*
         *   The three re-keys the linter caught being under-specified. Each read
         *   was behind an `as any`, which is why `react-hooks/exhaustive-deps`
         *   could only ask for `session.user` — and why reading the body did not
         *   save me either.
         *
         *   Asserted as an ABSENCE of the cast as well as a presence of the
         *   dependency: putting `(session?.user as any)` back would satisfy the
         *   dependency assertion while restoring the thing that hid the read.
         */
        const plan = code('src/app/academy/[courseId]/CourseDetailClient.tsx');
        expect(plan).toContain('const academyPlan =');
        expect(plan).toMatch(/\}, \[courseId, userId, academyPlan, status, router, showToast, takeSeed\]\)/);
        expect(plan).not.toContain('(session.user as any)');

        const profile = code('src/app/profile/ProfileClient.tsx');
        expect(profile).toContain('const userGender =');
        expect(profile).toMatch(/\}, \[userId, userEmail, userName, userGender, takeSeed\]\)/);
        expect(profile).not.toContain('(session?.user as any)');

        const landing = code('src/app/wave/landing/page.tsx');
        expect(landing).not.toContain('(session.user as any)');
    });

    it('and the certificate screen no longer bounces a loading session to login', () => {
        //   Found while reading that effect's body for its dependencies. `session`
        //   is null and `status` is "loading" until next-auth answers, so
        //   `if (!session)` sent a learner on a slow connection to /auth/login —
        //   which, being authenticated, sent them back.
        const cert = code('src/app/academy/certificate/[certificateId]/CertificateClient.tsx');

        expect(cert).toContain('if (status === "unauthenticated") {');
        expect(cert).not.toMatch(/if \(!session\) \{/);
    });

    it('and the register page stopped depending on a value its body never reads', () => {
        //   `platforms` was in the dependency array; the effect only redirects.
        //   Farm Nation my-purchases had the identical defect one pass earlier.
        const reg = code('src/components/auth/ModuleRegisterPage.tsx');

        expect(reg).toContain('const isSignedIn = !!session;');
        expect(reg).toMatch(/\}, \[isSignedIn, router\]\)/);
    });

    it('and the fields each of the five names are fields its body actually reads', () => {
        //   A dependency list that names a field the body never touches is the
        //   my-purchases defect in miniature: a server action re-run for a value
        //   nobody looked at. Checked for the five that kept more than the id.
        const expectations: Array<[string, string[]]> = [
            ['src/app/farm-nation/checkout/[propertyId]/CheckoutClient.tsx', ['email', 'name']],
            ['src/app/marketplace/checkout/page.tsx', ['email', 'name']],
            ['src/app/profile/ProfileClient.tsx', ['email', 'name']],
        ];

        for (const [rel, fields] of expectations) {
            const src = code(rel);
            for (const field of fields) {
                expect({ rel, field, read: src.includes(`session?.user?.${field}`) })
                    .toEqual({ rel, field, read: true });
            }
        }
    });
});

/**
 * ── MUTATION LOG, the #944 sweep ────────────────────────────────────────────
 *
 *   MUTANT                                          CAUGHT BY
 *   ──────────────────────────────────────────────  ───────────────────────────
 *   the recorded count put back to 17                THE LEDGER (reports
 *     (a ratchet that never tightens)                IMPROVED, not held)
 *   the member-access strip removed, so              THE LEDGER, the NEGATIVE
 *     `session?.user?.id` counts as the object       CONTROL, and the named list
 *   the walk narrowed to src/components              THE WALK ACTUALLY REACHES
 *     (reads 8 files, ledger still "0")              THE FILES
 *   EscrowChatClient reverted to `[.., session, ..]`  THE LEDGER and the named
 *                                                    list
 *   wave/landing keyed on the roles CHAIN             NO EFFECT DEPENDS ON A
 *     (looks narrowed, fires just as often)          session.roles CHAIN, and
 *                                                    THE TWO THAT READ ROLES
 *   the sweep's `session` test forced false           POSITIVE CONTROL
 *     (matches nothing; every count reads 0)
 *   the dep-array pattern broken to `}, [[`           POSITIVE CONTROL
 *   filesRead never incremented                       THE WALK ACTUALLY REACHES
 *                                                    THE FILES
 *   the roles sweep forced false                      ITS POSITIVE CONTROL
 *   the roles sweep widened to /roles/, which is      ITS POSITIVE CONTROL (the
 *     the mistake I made first — it flags a          memoised-local case) and the
 *     memoised local beside `sessionStatus`          sweep itself
 *   the academy plan read back behind `as any`,       THE THREE READS A CAST HAD
 *     dropping it from the dependencies              HIDDEN
 *   ProfileClient loses the gender dependency         THE THREE READS A CAST HAD
 *                                                    HIDDEN
 *   ModuleRegisterPage depends on `platforms` again   THE REGISTER PAGE STOPPED
 *     (a value its body never reads)                 DEPENDING ON A VALUE …
 *   CertificateClient bounces a loading session       THE CERTIFICATE SCREEN NO
 *     to login again                                 LONGER BOUNCES …
 *
 *   ALL THIRTEEN CAUGHT. Six of them are ways this ledger could read "closed"
 *   while measuring nothing, which is the failure mode a ledger at zero invites —
 *   and four are ways a dependency could look narrowed while buying nothing,
 *   which is the failure mode this particular repair invites.
 */
