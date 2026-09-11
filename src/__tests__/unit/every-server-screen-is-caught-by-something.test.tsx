/**
 * @jest-environment jsdom
 */

/**
 *   #622 EVERY SERVER SCREEN IN THE APP, RUN WITH ITS READS FAILING.
 *
 *   The last third of the sweep asked for after the reported sidebar bug. #619
 *   asked what each route is DRESSED in. #620 asked what each of the 127 CLIENT
 *   screens does when its data does not arrive. This asks the same of the 120
 *   SERVER ones, which is the half no render probe could previously reach.
 *
 *   THEY CAN BE REACHED, AND THE REASON IS WORTH STATING, because "server
 *   components cannot be tested" was the assumption that left them uncovered: an
 *   async server component is a function that returns an element tree. It does
 *   not need a DOM. It can simply be CALLED, and what it returns — or throws —
 *   is the whole of its behaviour.
 *
 * ── THE PROPERTY ────────────────────────────────────────────────────────────
 *
 *   A server screen may do any of four things, and all four are fine:
 *
 *     return an element      it rendered.
 *     call redirect()        it sent the visitor somewhere that can explain.
 *     call notFound()        it gave a real answer, with the right HTTP status.
 *     throw                  an error boundary catches it and Next serves a 5xx.
 *
 *   THE FIFTH IS THE DEFECT: returning null. Nothing is shown, nothing is
 *   navigated to, no boundary fires, and the visitor gets a white page they
 *   cannot tell from a broken application. That is #620's finding, which was
 *   exactly this on the client side.
 *
 *   The fourth is only acceptable because a boundary exists, so that is asserted
 *   rather than assumed — for every route in the app, not only the server ones.
 *
 * ── WHAT IT FOUND ───────────────────────────────────────────────────────────
 *
 *   NO DEFECTS. 101 render, 17 redirect, 2 throw into a boundary, none return
 *   null. Recorded as a measurement rather than dressed up as a finding: a sweep
 *   that comes back clean is worth exactly as much as the assertions in it, and
 *   the mutation table at the foot is where that is demonstrated.
 *
 *   It did find one thing, in the sweeps themselves rather than the app — the
 *   stub list was accumulating a second hand-maintained copy. See sweep-stubs.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join, relative, dirname } from 'path';

jest.mock('@/lib/redis', () => require('@/lib/testing/sweep-stubs').libRedis());
jest.mock('@upstash/redis', () => require('@/lib/testing/sweep-stubs').upstashRedis());
jest.mock('next-auth/react', () => require('@/lib/testing/sweep-stubs').nextAuthReact());
jest.mock('isomorphic-dompurify', () => require('@/lib/testing/sweep-stubs').dompurify());

/*
 *   redirect() and notFound() are the two ways a server page legitimately
 *   declines to render, and both work by THROWING a tagged error that the
 *   framework catches. The global setup's next/navigation stub omits them
 *   entirely, so pages calling either came back as "(0, _navigation.redirect)
 *   is not a function" — 17 correct pages reported as crashes.
 */
class RedirectSignal extends Error { digest = 'NEXT_REDIRECT'; }
class NotFoundSignal extends Error { digest = 'NEXT_NOT_FOUND'; }

jest.mock('next/navigation', () => ({
    redirect: (url: string) => { throw new RedirectSignal(`NEXT_REDIRECT:${url}`); },
    notFound: () => { throw new NotFoundSignal('NEXT_NOT_FOUND'); },
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({}),
}));

const ROOT = process.cwd();
const APP = join(ROOT, 'src/app');

/** The directive has to be the first statement, comments stripped — #620. */
function isClientPage(file: string): boolean {
    const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
        .trim();
    return /^["']use client["']/.test(code);
}

function allPages(): string[] {
    const out: string[] = [];
    (function walk(dir: string) {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) walk(full);
            else if (entry === 'page.tsx') out.push(full);
        }
    })(APP);
    return out.sort();
}

/** The nearest error.tsx above a page, walking up as the framework does. */
function nearestBoundary(pageFile: string): string | null {
    let dir = dirname(pageFile);
    for (;;) {
        if (existsSync(join(dir, 'error.tsx'))) return relative(ROOT, dir);
        if (dir === APP) return existsSync(join(APP, 'global-error.tsx')) ? 'global-error' : null;
        const parent = dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

/** Every parameter any dynamic segment in this app asks for. */
const PARAMS = {
    id: 'sample', courseId: 'sample', lessonId: 'sample', moduleId: 'sample',
    propertyId: 'sample', certificateId: 'sample', sellerId: 'sample',
    quizId: 'sample', docId: 'sample', eventId: 'sample', sessionId: 'sample', token: 'sample',
};

type Outcome = 'rendered' | 'redirected' | 'not-found' | 'threw' | 'BLANK SCREEN' | 'WOULD NOT LOAD';

/**
 * Run one server page and report which of the outcomes it produced.
 *
 * A named function, so it can be asked questions with known answers — see the
 * canaries below. #620 learned that the hard way: an assertion written inline
 * over a corpus tests the corpus, not the rule.
 */
async function outcomeOf(Page: (props: any) => Promise<unknown>): Promise<Outcome> {
    try {
        const element = await Page({
            params: Promise.resolve(PARAMS),
            searchParams: Promise.resolve({}),
        });
        return element === null || element === undefined ? 'BLANK SCREEN' : 'rendered';
    } catch (error: any) {
        const digest = String(error?.digest ?? '');
        if (digest === 'NEXT_REDIRECT') return 'redirected';
        if (digest === 'NEXT_NOT_FOUND') return 'not-found';
        return 'threw';
    }
}

const SERVER_PAGES = allPages()
    .filter(p => !isClientPage(p))
    .map(p => [relative(ROOT, p), p] as [string, string]);

/** Everything except a white page. Named so the rule itself can be asserted. */
const ACCEPTABLE_OUTCOME = expect.stringMatching(/^(rendered|redirected|not-found|threw)$/);

beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('#622 — the sweep reaches the server half of the app', () => {
    it('THERE ARE SERVER PAGES TO SWEEP, so a green run means something', () => {
        expect(SERVER_PAGES.length).toBeGreaterThan(100);

        const names = SERVER_PAGES.map(([rel]) => rel);
        expect(names).toContain('src/app/marketplace/sellers/[sellerId]/page.tsx');
        //   And the client half is NOT in here, or the two sweeps would be
        //   measuring the same pages and neither would cover the other's.
        expect(names).not.toContain('src/app/admin/analytics/page.tsx');
    });

    it('AND THE CLIENT AND SERVER SWEEPS TOGETHER COVER EVERY PAGE', () => {
        //   The gap that let the server half go unmeasured was that nobody had
        //   added the two numbers up. 247 routes, and both halves are swept.
        const all = allPages();
        const client = all.filter(isClientPage);
        const server = all.filter(p => !isClientPage(p));

        expect(client.length + server.length).toBe(all.length);
        expect(all.length).toBeGreaterThan(240);
        expect(server.length).toBe(SERVER_PAGES.length);
    });
});

describe('#622 — the shared stubs really are what they say they are', () => {
    /*
     *   sweep-stubs is SHIPPED CODE that both sweeps depend on, and a mutation of
     *   it survived both: swapping its session for a signed-out visitor changed
     *   no outcome, because a signed-out page still renders a prompt or
     *   redirects. The property is insensitive to it, so the file's claim —
     *   "deliberately the most privileged caller, so a screen is not measured as
     *   rendering nothing when the real reason is that this visitor may not see
     *   it" — was unverified prose. It is asserted now.
     */
    it('THE SESSION IS A SIGNED-IN ADMINISTRATOR', () => {
        const { nextAuthReact } = require('@/lib/testing/sweep-stubs');
        const session = nextAuthReact().useSession();

        expect(session.status).toBe('authenticated');
        expect(session.data?.user?.roles).toContain('admin');
        expect(session.data?.user?.id).toBeTruthy();
    });

    it('AND THE REDIS STUB REPORTS ITSELF UNCONFIGURED, which lib/redis supports', () => {
        //   Not "a broken Redis" — the not-configured path the library already
        //   has, so the sweeps exercise a state production can genuinely be in.
        const { libRedis } = require('@/lib/testing/sweep-stubs');
        expect(libRedis().isRedisConfigured()).toBe(false);
        expect(libRedis().redis).toBeNull();
    });
});

describe('#622 — the rule itself, asked with known answers', () => {
    it('A SERVER PAGE THAT RETURNS NULL IS CAUGHT', async () => {
        await expect(outcomeOf(async () => null)).resolves.toBe('BLANK SCREEN');
    });

    it('AND THE VERDICT THE SWEEP APPLIES REFUSES IT', () => {
        expect(() => expect({ o: 'BLANK SCREEN' }).toEqual({ o: ACCEPTABLE_OUTCOME })).toThrow();
        for (const good of ['rendered', 'redirected', 'not-found', 'threw']) {
            expect(() => expect({ o: good }).toEqual({ o: ACCEPTABLE_OUTCOME })).not.toThrow();
        }
    });

    it('AND EACH OF THE FOUR GOOD OUTCOMES IS RECOGNISED', async () => {
        const { redirect, notFound } = require('next/navigation');

        await expect(outcomeOf(async () => ({ type: 'div' }) as any)).resolves.toBe('rendered');
        await expect(outcomeOf(async () => { redirect('/somewhere'); })).resolves.toBe('redirected');
        await expect(outcomeOf(async () => { notFound(); })).resolves.toBe('not-found');
        await expect(outcomeOf(async () => { throw new Error('read failed'); })).resolves.toBe('threw');
    });
});

describe('#622 — every server screen does one of the four, never nothing', () => {
    it.each(SERVER_PAGES)('%s', async (rel, abs) => {
        let Page: any;
        try {
            Page = require(abs).default;
        } catch (error: any) {
            //   Reported as its own outcome rather than as a crash. A page that
            //   will not even load is a real finding — and four times so far it
            //   has instead been an untransformed ESM dependency, which is why
            //   the message travels with it.
            expect({ page: rel, outcome: 'WOULD NOT LOAD', why: String(error?.message).split('\n')[0] })
                .toEqual({ page: rel, outcome: ACCEPTABLE_OUTCOME, why: expect.anything() });
            return;
        }

        expect(typeof Page).toBe('function');
        expect({ page: rel, outcome: await outcomeOf(Page) })
            .toEqual({ page: rel, outcome: ACCEPTABLE_OUTCOME });
    });
});

describe('#622 — and "it throws" is only acceptable because something catches it', () => {
    it('EVERY ROUTE IN THE APP HAS AN ERROR BOUNDARY ABOVE IT', () => {
        /*
         *   The assumption the outcome above rests on. A server page that throws
         *   with no boundary over it does not show the module's error screen; it
         *   shows whatever Next does with an uncaught render, which is the white
         *   page this sweep exists to prevent, arriving by another route.
         *
         *   Asserted for CLIENT pages too. They throw as readily, and the same
         *   boundary catches them.
         */
        const uncovered = allPages()
            .filter(p => nearestBoundary(p) === null)
            .map(p => relative(ROOT, p));

        expect(uncovered).toEqual([]);
    });

    it('AND THE BOUNDARY WALK CAN FAIL — a positive control', () => {
        //   Without this, nearestBoundary returning something for every input
        //   would satisfy the assertion above while measuring nothing.
        expect(nearestBoundary(join(APP, 'admin/users/page.tsx'))).toBe('src/app/admin');
        expect(nearestBoundary(join(APP, 'marketplace/sellers/[sellerId]/page.tsx'))).toBe('src/app/marketplace');
        //   A path outside the app tree has no boundary at all.
        expect(nearestBoundary(join(ROOT, 'src/lib/deep/nowhere/page.tsx'))).toBeNull();
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *   Run together with the client sweep, since both now load the same stubs.
 *
 *     MUTANT                                                        RESULT
 *     THE APP LOSES THE MARKETPLACE ERROR BOUNDARY                   KILLED
 *     outcomeOf calls a null return "rendered"                       KILLED
 *     the verdict accepts a blank screen                             KILLED
 *     a redirect is misread as a render                              KILLED
 *     notFound is misread as a plain throw                           KILLED
 *     the server page list is emptied                                KILLED
 *     isClientPage says nothing is a client page                     KILLED
 *     the boundary walk claims coverage for everything               KILLED
 *     the shared stub hands back a signed-out visitor                KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 * ── THREE OF THOSE SURVIVED FIRST, AND TWO WERE BAD MUTANTS ─────────────────
 *
 *   Recorded because the mistake is mine and it is one this audit has made
 *   before. Two of my first mutants deleted an ASSERTION FROM THIS FILE rather
 *   than changing any code — `.filter(() => false)` over the boundary list, and
 *   an assertion weakened to `toBeGreaterThan(-1)`. A mutant that removes the
 *   check it is meant to be tested by always survives, and proves nothing. This
 *   is the fifth time that lesson has had to be relearned here.
 *
 *   Rewritten against real code, both die: the boundary one by DELETING
 *   marketplace/error.tsx from the tree, which no string substitution can
 *   express, and the split one by making isClientPage answer false for
 *   everything.
 *
 *   THE THIRD SURVIVOR WAS REAL. Swapping sweep-stubs' session for a signed-out
 *   visitor changed no outcome in either sweep — a signed-out page still renders
 *   a prompt or redirects, so the property is insensitive to it. That made the
 *   stub's own claim about why it signs in as an administrator unverified prose
 *   in shipped code. It is asserted directly now.
 */
