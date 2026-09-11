/**
 * @jest-environment jsdom
 */

/**
 *   #620 EVERY CLIENT SCREEN IN THE APP, RENDERED, WITH ITS DATA READ FAILING.
 *
 *   The second half of the sweep asked for after the reported sidebar bug: "test
 *   all the UI of both the admin and the Users so we don't leave any of them to
 *   the users to discover, since we have users that are more than 30k."
 *
 *   #619 asked what each route is DRESSED in. This asks what each screen DOES
 *   when its read does not come back — which is the state every one of these
 *   pages reaches in this environment, because nothing here answers a query.
 *
 * ── THE PROPERTY ────────────────────────────────────────────────────────────
 *
 *   EITHER THE SCREEN SHOWS SOMETHING, OR IT SENDS THE USER SOMEWHERE. Never
 *   neither.
 *
 *   That is stronger than "it renders" and weaker than "it renders correctly",
 *   and it is deliberately both. A screen that navigates away on a failure is
 *   behaving; a screen that renders an error panel is behaving; a screen that
 *   renders NOTHING is a white page, and a user on a white page cannot tell a
 *   missing record from a broken application. They report the application.
 *
 * ── WHAT IT FOUND ───────────────────────────────────────────────────────────
 *
 *   admin/academy/[courseId] — the course manager. Its read has two failure
 *   paths and only one of them was finished:
 *
 *     "course not found"   toast, then redirect to the course list. An ANSWER,
 *                          delivered properly.
 *     the read THREW       a toast that fades in seconds, no redirect, and then
 *                          `if (!course) return null`. A WHITE PAGE.
 *
 *   Its sibling admin/marketplace/disputes/[id] has the identical `if (!x)
 *   return null` line and is safe, because its catch redirects too. Same shape,
 *   one door weaker — the pattern this audit keeps finding, and the reason this
 *   file sweeps all of them rather than the one that was reported.
 *
 * ── THE INSTRUMENT LIED FOUR TIMES BEFORE IT MEASURED ANYTHING ──────────────
 *
 *   Recorded because every one of them would have been reported as a defect in
 *   the application, and three of the four read as "all clear" rather than as an
 *   error:
 *
 *     1. 47 pages "failed to load" — @upstash/redis is ESM and jest does not
 *        transform it. Nothing to do with any page.
 *     2. The client/server split was decided by looking for "use client" in the
 *        first 200 characters, which matched those words inside a COMMENT on an
 *        async SERVER component. Rendering a Promise left React's root broken
 *        for every page measured after it — 121 "empty" screens from one
 *        mis-sorted file. This is the third time in this audit a check has
 *        matched prose instead of code (#605, #617), so the directive is now
 *        read from the source with comments stripped.
 *     3. Pages were rendered with no ToastProvider and with `params` as a plain
 *        object, so 57 "crashed" for want of a context and a promise the real
 *        app always supplies.
 *     4. `useRouter()` returned a NEW OBJECT on every call, so every effect with
 *        `router` in its dependency list re-ran for ever and one page span until
 *        the timeout. The real router is stable; the mock now is too.
 *
 *   Each page also gets its OWN test. One suspended or looping render used to
 *   corrupt every measurement after it in the same file, which is how a sweep
 *   reports a hundred failures and none of them real.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import React from 'react';
import { render, act } from '@testing-library/react';
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';

jest.mock('@/lib/redis', () => ({ redis: null, getRedis: () => null, isRedisConfigured: () => false }));
jest.mock('@upstash/redis', () => ({ Redis: class {} }));

jest.mock('next-auth/react', () => ({
    useSession: () => ({
        data: { user: { id: 'u1', name: 'Test Admin', email: 'admin@example.com', roles: ['admin'] } },
        status: 'authenticated',
    }),
    SessionProvider: ({ children }: any) => children,
    signIn: jest.fn(),
    signOut: jest.fn(),
}));

/*
 *   STABLE across calls, like the real hooks. A fresh object per call re-runs
 *   every effect that lists `router` in its dependencies, which is a render
 *   loop, not a finding.
 */
const ROUTER = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() };
const SEARCH_PARAMS = new URLSearchParams();
const PARAMS = {
    id: 'sample', courseId: 'sample', quizId: 'sample', sessionId: 'sample',
    eventId: 'sample', certificateId: 'sample', sellerId: 'sample', docId: 'sample',
};

jest.mock('next/navigation', () => ({
    usePathname: () => '/',
    useRouter: () => ROUTER,
    useSearchParams: () => SEARCH_PARAMS,
    useParams: () => PARAMS,
    redirect: jest.fn(),
    notFound: jest.fn(),
}));

//   The live classroom mounts a third-party video SDK. Stubbed because this file
//   asks what the PAGE does, and a page whose test depends on an SDK loading is
//   a test that gets deleted the first time the SDK changes.
jest.mock('@/components/VideoClassroom', () => ({ __esModule: true, default: () => null }));

(global as any).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
};
(global as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const ROOT = process.cwd();
const APP = join(ROOT, 'src/app');

/**
 * Is this page a CLIENT component?
 *
 * The directive has to be the first statement of the file with comments
 * stripped. Reading the raw opening characters instead matched the words
 * "use client" inside a comment on an async server component — see the header.
 */
function isClientPage(file: string): boolean {
    const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
        .trim();
    return /^["']use client["']/.test(code);
}

function clientPages(): string[] {
    const out: string[] = [];
    (function walk(dir: string) {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) walk(full);
            else if (entry === 'page.tsx' && isClientPage(full)) out.push(full);
        }
    })(APP);
    return out.sort();
}

const PAGES = clientPages().map(p => [relative(ROOT, p), p] as [string, string]);

/**
 * The verdict, named once so it can be tested rather than only applied.
 *
 * Written inline in the sweep, a mutant that added 'BLANK SCREEN' to it survived
 * untouched — no page produces one today, so nothing distinguished the RULE from
 * the corpus it happened to be run over.
 */
const ACCEPTABLE_OUTCOME = expect.stringMatching(/^(rendered|redirected)$/);

beforeAll(() => {
    //   These pages log their failed reads on purpose. Silenced so the sweep's
    //   own output is readable; nothing is asserted about them here.
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
    ROUTER.push.mockClear();
    ROUTER.replace.mockClear();
});

describe('#620 — the sweep reaches the whole client app', () => {
    it('THERE ARE PAGES TO SWEEP, so a green run means something', () => {
        //   Vacuity guard. Every assertion below is "nothing was wrong", and an
        //   empty list satisfies all of them at once.
        expect(PAGES.length).toBeGreaterThan(120);

        const urls = PAGES.map(([rel]) => rel);
        expect(urls).toContain('src/app/admin/academy/[courseId]/page.tsx');
        expect(urls).toContain('src/app/admin/marketplace/disputes/[id]/page.tsx');
    });

    it('AND SERVER COMPONENTS ARE NOT IN IT, however they talk about themselves', () => {
        //   The mis-sort that produced 121 false failures. This page is an async
        //   server component whose COMMENT contains the words "use client", and
        //   it must stay out of a list of things to render in jsdom.
        const server = join(APP, 'academy/verify/[certificateId]/page.tsx');
        expect(readFileSync(server, 'utf8')).toContain('"use client" page that fetched');  // the prose
        expect(isClientPage(server)).toBe(false);                                          // the verdict

        //   POSITIVE CONTROL: the check still recognises a real client page.
        expect(isClientPage(join(APP, 'admin/analytics/page.tsx'))).toBe(true);
    });
});

/**
 * Mount a component the way the app does and report which of the three things
 * happened.
 *
 *   A NAMED FUNCTION, not an assertion written inline 127 times, because it can
 *   then be asked questions with KNOWN ANSWERS — see the canary below. The
 *   inline version passed a mutant that accepted 'BLANK SCREEN' as a valid
 *   outcome, because no page in the app produces one today, so nothing in the
 *   file distinguished the rule from the corpus it was run over.
 */
async function outcomeOf(Page: React.ComponentType<any>): Promise<'rendered' | 'redirected' | 'BLANK SCREEN'> {
    ROUTER.push.mockClear();
    ROUTER.replace.mockClear();

    const props = {
        params: Promise.resolve(PARAMS),
        searchParams: Promise.resolve({}),
    };

    const { ToastProvider } = require('@/contexts/ToastContext');
    const tree = React.createElement(
        ToastProvider,
        null,
        React.createElement(
            React.Suspense,
            { fallback: React.createElement('div', null, 'loading') },
            React.createElement(Page, props as any),
        ),
    );

    let container!: HTMLElement;
    await act(async () => { container = render(tree).container; });

    if (container.innerHTML.trim().length > 0) return 'rendered';
    if (ROUTER.push.mock.calls.length > 0 || ROUTER.replace.mock.calls.length > 0) return 'redirected';
    return 'BLANK SCREEN';
}

describe('#620 — the rule itself, asked with known answers', () => {
    /*
     *   THE CANARY. Without it this file asserts only that no page happens to be
     *   blank today, and a mutant that accepted blank screens outright survived
     *   the sweep untouched — a rule that cannot fail is not a rule.
     */
    it('A SCREEN THAT RENDERS NOTHING AND GOES NOWHERE IS CAUGHT', async () => {
        const WhitePage = () => null;
        await expect(outcomeOf(WhitePage)).resolves.toBe('BLANK SCREEN');
    });

    it('AND THE VERDICT THE SWEEP APPLIES REFUSES IT', () => {
        //   The other half. outcomeOf can SAY 'BLANK SCREEN' — tested above —
        //   and the rule the sweep measures it against has to REJECT that word.
        expect(() => expect({ o: 'BLANK SCREEN' }).toEqual({ o: ACCEPTABLE_OUTCOME })).toThrow();
        expect(() => expect({ o: 'rendered' }).toEqual({ o: ACCEPTABLE_OUTCOME })).not.toThrow();
        expect(() => expect({ o: 'redirected' }).toEqual({ o: ACCEPTABLE_OUTCOME })).not.toThrow();
    });

    it('A SCREEN THAT RENDERS SOMETHING PASSES', async () => {
        const Real = () => React.createElement('h1', null, 'Something');
        await expect(outcomeOf(Real)).resolves.toBe('rendered');
    });

    it('AND SO DOES ONE THAT SENDS THE USER SOMEWHERE INSTEAD', async () => {
        //   Redirecting on a failed read is behaving, not failing: the user ends
        //   up on a screen that can explain itself. Only "neither" is the defect.
        const Redirecting = () => {
            React.useEffect(() => { ROUTER.push('/somewhere'); }, []);
            return null;
        };
        await expect(outcomeOf(Redirecting)).resolves.toBe('redirected');
    });
});

describe('#620 — every client screen shows something or goes somewhere', () => {
    it.each(PAGES)('%s', async (rel, abs) => {
        const Page = require(abs).default;
        expect(typeof Page).toBe('function');

        //   Reported as the page's own path so a failure names the screen to
        //   open, rather than "expected true, received false" at a line number.
        expect({ page: rel, outcome: await outcomeOf(Page) })
            .toEqual({ page: rel, outcome: ACCEPTABLE_OUTCOME });
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *   Run together with a-course-that-could-not-be-read-was-a-white-page, because
 *   the two files divide one finding between them.
 *
 *     MUTANT                                                        RESULT
 *     outcomeOf calls every blank screen "rendered"                  KILLED
 *     the verdict accepts "BLANK SCREEN" as a pass                   KILLED
 *     the client/server filter goes back to reading prose            KILLED
 *     the router mock returns a fresh object per call                KILLED
 *     the page list is emptied                                       KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword a header                                                SURVIVED ✓
 *
 * ── THE TWO THAT SURVIVED FIRST, AND WHY THEY MATTERED ──────────────────────
 *
 *   Restoring the defect this sweep FOUND — `return null` on the course
 *   manager — SURVIVED all 127 pages. In this environment that read resolves,
 *   so the page takes its not-found branch and redirects, and the throw path is
 *   never entered. The net could not catch the fish it was woven for. That is
 *   what the separate file is for, and it is why this table says so instead of
 *   listing a kill it did not earn.
 *
 *   And a mutant that added "BLANK SCREEN" to the list of acceptable outcomes
 *   survived, because no page produces one today: nothing distinguished the
 *   RULE from the corpus it happened to run over. The verdict is a named
 *   constant now and is asserted directly, and outcomeOf is asked about a
 *   component known to render nothing. Both die.
 */
