/**
 * @jest-environment jsdom
 */

/**
 *   #619 EVERY ROUTE IN THE APP, RENDERED THROUGH THE LAYOUT IT ACTUALLY GETS.
 *
 *   Asked for after the reported bug: "because of bugs like this I told you to
 *   test all the UI of both the admin and the users so we don't leave any of
 *   them to the users to discover, since we have users that are more than 30k."
 *
 *   THE REASON NO EXISTING PROBE COULD HAVE CAUGHT IT. Every render test in this
 *   suite mounts a COMPONENT — a page, a form, a table — on its own. The bug was
 *   not in any component. It was in which CHROME the route was wrapped in, and a
 *   component mounted by itself has no chrome at all, so no amount of that kind
 *   of testing could ever have found it. This file renders the wrapper and asks
 *   what a route is dressed in.
 *
 * ── WHAT IT FOUND, AND IT WAS MINE ──────────────────────────────────────────
 *
 *   #617 fixed the reported bug by giving /loans/approve a layout that renders
 *   AdminShell. It did not ask what ELSE was wrapping that route.
 *
 *   The root layout renders ClientLayout, which decides from the pathname alone
 *   whether to add the global ModuleSidebar. /loans/approve matches none of its
 *   exclusions, so it answered "module" — and the global sidebar stayed wrapped
 *   around the admin one. THE FIX REACHED ONE OF TWO DOORS, the defect this
 *   audit keeps finding, in the commit that had just finished finding it again.
 *
 *   Worse, it is the same screen the user reported, so the report would have
 *   come back: detectModuleKey() has never heard of /loans, so it falls through
 *   to "dashboard", whose nav list is EMPTY. What remains is Messages, Profile,
 *   Back to Hub and the user's own email — the exact chrome that was reported as
 *   wrong, still there, now with the admin sidebar beside it.
 *
 * ── WHAT IS MEASURED ────────────────────────────────────────────────────────
 *
 *   All 247 routes. For each: the app-router layout that governs it, walked up
 *   from the page's own directory the way the framework does (so route groups
 *   like /wave/(member) resolve correctly, which a walk over the URL cannot do),
 *   and what ClientLayout renders at that pathname for a signed-in user.
 *
 *   ONE route may not have TWO navigations. That is the whole rule, and it is
 *   the rule the reported bug broke.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';

let pathname = '/';

jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: { user: { id: 'u1', name: 'Test', roles: ['admin'] } }, status: 'authenticated' }),
    SessionProvider: ({ children }: any) => <>{children}</>,
}));
jest.mock('next/navigation', () => ({
    usePathname: () => pathname,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));

/*
 *   ModuleSidebar is STUBBED, and that is the point rather than a shortcut: the
 *   question here is whether the global chrome is MOUNTED at this route, not
 *   what it draws once it is. Rendering the real one would make this file fail
 *   for reasons that have nothing to do with layout composition — which is how a
 *   sweep like this stops being run.
 */
jest.mock('@/components/layout/ModuleSidebar', () => ({ ModuleSidebar: () => <nav data-testid="global-sidebar" /> }));
jest.mock('@/components/auth/SessionActivityTracker', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/providers/FirebaseAuthProvider', () => ({ FirebaseAuthProvider: ({ children }: any) => <>{children}</> }));
jest.mock('@/components/notifications/PushNotificationBanner', () => ({ PushNotificationBanner: () => null }));
jest.mock('@/components/ai/AiChatWidget', () => ({ AiChatWidget: () => null }));
jest.mock('@/hooks/useFCMRegistration', () => ({ useFCMRegistration: () => undefined }));
jest.mock('@/contexts/ToastContext', () => ({ ToastProvider: ({ children }: any) => <>{children}</>, useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('sonner', () => ({ Toaster: () => null }));

const ROOT = process.cwd();
const APP = join(ROOT, 'src/app');

interface Route {
    /** The URL a user would be on, with dynamic segments filled in. */
    url: string;
    /** The directory the page.tsx lives in — what the layout walk starts from. */
    dir: string;
}

/** Every page in the app router, with the URL it answers on. */
function allRoutes(): Route[] {
    const out: Route[] = [];
    (function walk(dir: string) {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) walk(full);
            else if (entry === 'page.tsx') {
                const rel = relative(APP, dir);
                const segments = rel === '' ? [] : rel.split('/');
                const url = '/' + segments
                    //   Route groups are organisational and contribute no URL
                    //   segment — the reason the layout walk below has to run
                    //   over directories and not over the URL.
                    .filter(s => !(s.startsWith('(') && s.endsWith(')')))
                    .map(s => (s.startsWith('[') ? 'sample' : s))
                    .join('/');
                out.push({ url: url.length > 1 ? url.replace(/\/$/, '') : '/', dir });
            }
        }
    })(APP);
    return out.sort((a, b) => a.url.localeCompare(b.url));
}

/**
 * The chrome the app-router layout above this page draws, walking up from the
 * page's own directory exactly as the framework does: nearest layout wins.
 */
function ownChrome(route: Route): 'ADMIN' | 'DASHBOARD' | 'NONE' {
    let dir = route.dir;
    for (;;) {
        const layout = join(dir, 'layout.tsx');
        if (existsSync(layout)) {
            const src = readFileSync(layout, 'utf8');
            if (src.includes('<AdminShell')) return 'ADMIN';
            if (src.includes('DashboardNav')) return 'DASHBOARD';
            //   A layout that draws no navigation of its own does not stop the
            //   walk: the framework nests them, so an outer one may still.
        }
        if (dir === APP) return 'NONE';
        const parent = dirname(dir);
        if (parent === dir) return 'NONE';
        dir = parent;
    }
}

/** Does the root layout put the global ModuleSidebar around this route? */
function hasGlobalChrome(url: string): boolean {
    const { ClientLayout } = require('@/components/layout/ClientLayout');
    pathname = url;
    const { unmount } = render(<ClientLayout><div /></ClientLayout>);
    const present = !!screen.queryByTestId('global-sidebar');
    unmount();
    return present;
}

const ROUTES = allRoutes();

describe('#619 — no screen wears two sets of chrome', () => {
    it('THE SWEEP REACHES THE WHOLE APP, so a green result means something', () => {
        //   Vacuity guard. Every assertion below is "nothing was wrong"; if the
        //   route list were empty they would all pass while measuring nothing —
        //   the shape #598 exists to prevent.
        expect(ROUTES.length).toBeGreaterThan(200);
        expect(ROUTES.map(r => r.url)).toContain('/admin');
        expect(ROUTES.map(r => r.url)).toContain('/dashboard');
        expect(ROUTES.map(r => r.url)).toContain('/loans/approve');

        //   And route groups really are resolved, or ownChrome would be walking
        //   a tree it cannot see into.
        expect(ROUTES.map(r => r.url)).toContain('/wave/dashboard');
        expect(ROUTES.find(r => r.url === '/wave/dashboard')!.dir).toContain('(member)');
    });

    it('THE INSTRUMENT CAN SAY BOTH THINGS — a positive control on each half', () => {
        //   Without this, ownChrome returning NONE for everything and
        //   hasGlobalChrome returning false for everything would satisfy the
        //   whole file. Both have to be able to answer either way.
        expect(ownChrome(ROUTES.find(r => r.url === '/admin/users')!)).toBe('ADMIN');
        expect(ownChrome(ROUTES.find(r => r.url === '/dashboard/wallet')!)).toBe('DASHBOARD');
        expect(ownChrome(ROUTES.find(r => r.url === '/about')!)).toBe('NONE');

        expect(hasGlobalChrome('/wave/dashboard')).toBe(true);
        expect(hasGlobalChrome('/admin/users')).toBe(false);
    });

    it('NO ROUTE IN THE APP IS WRAPPED IN TWO NAVIGATIONS', () => {
        /*
         *   THE RULE, and the one /loans/approve broke. Reported as a list of
         *   URLs rather than a count, because the next failure of this kind will
         *   be a route somebody adds, and a number tells them nothing.
         */
        const doubled = ROUTES
            .filter(r => ownChrome(r) !== 'NONE' && hasGlobalChrome(r.url))
            .map(r => `${r.url} (own: ${ownChrome(r)} + global ModuleSidebar)`);

        expect(doubled).toEqual([]);
    });

    it('AND THE ADMIN PORTAL IS DRESSED AS THE ADMIN PORTAL, EVERY SCREEN OF IT', () => {
        //   The reported bug, stated as the property rather than as the one
        //   route: an admin screen shows the admin sidebar and NOT the member
        //   one. /loans/approve is included here by construction — it is an
        //   ADMIN route by ownChrome — which is what makes this cover the screen
        //   that was reported without naming it.
        const admin = ROUTES.filter(r => ownChrome(r) === 'ADMIN');
        expect(admin.length).toBeGreaterThan(70);           // vacuity guard
        expect(admin.map(r => r.url)).toContain('/loans/approve');

        expect(admin.filter(r => hasGlobalChrome(r.url)).map(r => r.url)).toEqual([]);
    });

    it('AND THE HUB AND ITS INBOX KEEP THEIR OWN NAVIGATION ALONE', () => {
        const hub = ROUTES.filter(r => ownChrome(r) === 'DASHBOARD');
        expect(hub.length).toBeGreaterThan(5);              // vacuity guard
        expect(hub.map(r => r.url)).toContain('/messages');

        expect(hub.filter(r => hasGlobalChrome(r.url)).map(r => r.url)).toEqual([]);
    });

    it('AND THE MEMBER MODULES STILL HAVE A SIDEBAR — this is not a fix by deletion', () => {
        /*
         *   The other way a chrome sweep goes wrong, and the more expensive one:
         *   removing chrome until nothing is doubled. A member signed in to a
         *   module screen must still get the module sidebar, or the fix is an
         *   outage across six modules.
         */
        for (const url of [
            '/wave/dashboard', '/academy/dashboard', '/cooperatives/dashboard',
            '/marketplace/seller', '/farm-nation/dashboard', '/export/dashboard',
        ]) {
            expect(ROUTES.map(r => r.url)).toContain(url);  // the route exists
            expect(hasGlobalChrome(url)).toBe(true);
        }
    });

    it('AND THE PUBLIC AND ONBOARDING SCREENS STILL HAVE NONE', () => {
        //   Signed-out marketing, the auth pages and every onboarding flow are
        //   deliberately bare. Pinned so "nothing is doubled" cannot be reached
        //   by quietly putting a sidebar on a sign-up form.
        for (const url of [
            '/', '/auth/login', '/wave/landing', '/wave/application',
            '/marketplace/onboarding', '/export/onboarding', '/cooperatives/landing',
        ]) {
            expect(ROUTES.map(r => r.url)).toContain(url);
            expect(hasGlobalChrome(url)).toBe(false);
        }
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     ClientLayout: drop /loans/approve from the exclusions          KILLED
 *     ClientLayout: drop /admin from the exclusions                  KILLED
 *     ClientLayout: drop /dashboard from the exclusions              KILLED
 *     ClientLayout: return "none" for everything                     KILLED
 *     ClientLayout: return "module" for everything                   KILLED
 *     the loans layout stops rendering AdminShell                    KILLED
 *     ownChrome: stop walking up (only the page's own directory)     KILLED
 *     allRoutes: keep route groups as URL segments                   KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   THE TWO WORTH NAMING ARE THE ONES THAT TURN A FIX INTO AN OUTAGE. "Return
 *   none for everything" satisfies the headline rule perfectly — nothing is
 *   doubled when nothing has chrome — and is caught only by the member-module
 *   and public-page assertions. That is why those exist: on a platform with tens
 *   of thousands of accounts, a sweep that can be passed by removing navigation
 *   is worse than no sweep.
 */
