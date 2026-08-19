/**
 * @jest-environment node
 */

/**
 * Four module member areas were never protected paths, because two of them were
 * named after a folder that does not exist in any URL.
 *
 * The member areas of WAVE, Cooperatives, Farm Nation and Export live under
 * Next.js ROUTE GROUPS — src/app/wave/(member), /cooperatives/(member),
 * /farm-nation/(member), /export/(app). A route group is a folder convention
 * for sharing a layout; the parenthesised segment NEVER appears in the URL.
 * src/app/cooperatives/(member)/withdraw/page.tsx is served at
 * /cooperatives/withdraw.
 *
 * PROTECTED_PATHS listed two of them by their FOLDER name:
 *
 *     "/farm-nation/(member)",
 *     "/export/(app)",
 *
 * and did not list WAVE's or Cooperatives' at all. isProtectedPath() does a
 * prefix match on the real pathname, so all four returned false for every page
 * beneath them — 32 pages including /cooperatives/withdraw, /wave/earnings and
 * /export/portfolio. Academy's (learner) group was listed correctly, by real
 * URL, which is what made the inconsistency visible.
 *
 * THIS IS NOT AN AUTH BYPASS, AND SAYING SO PRECISELY MATTERS
 * ----------------------------------------------------------
 * Each route group's layout calls requireHubRegistration() and redirects when
 * there is no session. A signed-out visitor never saw member data. The tests
 * below assert that, because it is the reason this is a defect worth fixing
 * carefully rather than an emergency.
 *
 * WHAT IT ACTUALLY COST
 * ---------------------
 * The middleware gate is the thing that attaches `?callbackUrl=<path>`:
 *
 *     loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
 *
 * The layouts do not — they redirect to a bare /auth/login?module=X. LoginForm
 * reads callbackUrl and falls back to "/dashboard". So a signed-out visitor
 * following a link to /cooperatives/withdraw, or a member whose 8-hour session
 * lapsed while they were on /wave/earnings, logged back in and landed on
 * /dashboard instead of where they were. The page was protected; the way back
 * to it was lost.
 *
 * It also meant every signed-out hit on those 32 pages paid a full Node render
 * plus requireHubRegistration() and checkModuleAccess() — database reads — to
 * produce a redirect the edge could have returned without touching anything.
 *
 * WHY THE FIX IS A LIST AND NOT A PATTERN
 * ---------------------------------------
 * There is no prefix that separates these from their public siblings:
 * /wave/dashboard is a member page and /wave/landing is a marketing page, one
 * segment apart. So the manifest stays explicit — and this test derives the
 * list from the filesystem instead, so a member page added tomorrow fails here
 * until it is named. That is the part that keeps the fix from rotting.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { isProtectedPath, isPublicPath } from '@/lib/route-manifest';
import * as manifest from '@/lib/route-manifest';

const ROOT = process.cwd();
const APP = join(ROOT, 'src/app');

function source(rel: string): string {
    return readFileSync(join(ROOT, rel), 'utf-8');
}

/** Source with comments removed — the manifest explains the old entries in prose. */
function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

/** The route groups whose layout authenticates. Each maps to its module prefix. */
const MEMBER_GROUPS: { dir: string; prefix: string }[] = [
    { dir: 'src/app/wave/(member)', prefix: '/wave' },
    { dir: 'src/app/cooperatives/(member)', prefix: '/cooperatives' },
    { dir: 'src/app/farm-nation/(member)', prefix: '/farm-nation' },
    { dir: 'src/app/export/(app)', prefix: '/export' },
    { dir: 'src/app/academy/(learner)', prefix: '/academy' },
];

function pagesUnder(dir: string): string[] {
    const abs = join(ROOT, dir);
    const out: string[] = [];
    (function walk(d: string) {
        for (const e of readdirSync(d)) {
            const full = join(d, e);
            if (statSync(full).isDirectory()) walk(full);
            else if (e === 'page.tsx') out.push(full);
        }
    })(abs);
    return out;
}

/** The URL Next.js serves a page file at: route groups dropped, params filled. */
function urlFor(pageFile: string): string {
    return (
        pageFile
            .slice(APP.length)
            .replace(/\/page\.tsx$/, '')
            .split('/')
            .filter((s) => !/^\(.*\)$/.test(s))
            .map((s) => (s.startsWith('[') ? 'sample-id' : s))
            .join('/') || '/'
    );
}

const MEMBER_URLS = MEMBER_GROUPS.flatMap((g) => pagesUnder(g.dir).map((f) => ({ url: urlFor(f), ...g })));

describe('the premise: these really are route groups, and they really do guard', () => {
    it('every group has a layout that authenticates', () => {
        // Vacuity guard, and the reason this was never a data leak.
        for (const { dir } of MEMBER_GROUPS) {
            const layout = join(dir, 'layout.tsx');
            expect(existsSync(join(ROOT, layout))).toBe(true);
            expect(source(layout)).toContain('requireHubRegistration()');
            expect(source(layout)).toContain('redirect(');
        }
    });

    it('and none of those layouts preserves where the visitor was going', () => {
        // THE cost. If a layout ever starts setting callbackUrl this assertion
        // fails and the reasoning above has to be revisited — that is intended.
        for (const { dir } of MEMBER_GROUPS) {
            expect(source(join(dir, 'layout.tsx'))).not.toContain('callbackUrl');
        }
    });

    it('while the middleware gate does', () => {
        expect(source('src/middleware.ts'))
            .toContain('loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);');
        // And it reaches that line only through isProtectedPath.
        expect(source('src/middleware.ts')).toContain('if (isProtectedPath(pathname) && !isLoggedIn) {');
    });

    it('and the login form honours it, falling back to /dashboard', () => {
        // Without this the lost callbackUrl would cost nothing.
        const form = source('src/components/auth/LoginForm.tsx');
        expect(form).toContain('defaultCallbackUrl = "/dashboard"');
        expect(form).toContain("searchParams.get(\"callbackUrl\")");
        expect(form).toContain('router.replace(callbackUrl);');
    });

    it('the route groups really do contain the member pages, and a fair number', () => {
        // Guards against this whole file passing because a rename emptied the
        // directories and MEMBER_URLS became [].
        expect(MEMBER_URLS.length).toBeGreaterThan(25);
        const urls = MEMBER_URLS.map((m) => m.url);
        expect(urls).toContain('/cooperatives/withdraw');
        expect(urls).toContain('/wave/earnings');
        expect(urls).toContain('/export/portfolio');
        expect(urls).toContain('/farm-nation/my-properties');
        expect(urls).toContain('/academy/my-courses');
    });

    it('and no URL keeps the parenthesised segment', () => {
        for (const { url } of MEMBER_URLS) expect(url).not.toMatch(/[()]/);
    });
});

describe('every member page is a protected path', () => {
    it.each(MEMBER_URLS.map((m) => [m.url] as [string]))('%s', (url) => {
        // THE test. Before the fix this was false for all four non-academy
        // groups — 32 pages.
        expect(isProtectedPath(url)).toBe(true);
    });
});

describe('no entry is written as a route group', () => {
    it('because such an entry can never match a URL', () => {
        // THE second test, and the one that stops the original mistake
        // returning in a different module.
        for (const p of manifest.PROTECTED_PATHS) expect(p).not.toMatch(/[()]/);
        for (const p of manifest.PUBLIC_PATHS) expect(p).not.toMatch(/[()]/);
        for (const p of manifest.SHARED_DOMAIN_PATHS) expect(p).not.toMatch(/[()]/);
    });

    it('and the two that were are gone by name', () => {
        // Comments stripped: the manifest now explains the old entries in prose
        // above the block that replaced them, and that prose quotes them.
        const src = code('src/lib/route-manifest.ts');
        expect(src).not.toContain('"/farm-nation/(member)"');
        expect(src).not.toContain('"/export/(app)"');
        // But the explanation is still there to be read.
        expect(source('src/lib/route-manifest.ts'))
            .toContain('route group is a folder convention that NEVER appears in the URL.');
    });

    it('proven by the matcher: a route-group path matches nothing real', () => {
        // Why the old entries were inert, exercised rather than asserted.
        const groupStyle = (p: string) =>
            ['/farm-nation/(member)', '/export/(app)'].some(
                (x) => p === x || p.startsWith(x + '/'),
            );
        expect(groupStyle('/farm-nation/dashboard')).toBe(false);
        expect(groupStyle('/export/portfolio')).toBe(false);
    });
});

describe('the dedicated-domain short forms', () => {
    // On easysalescooperative.com the member page is /withdraw; middleware
    // applies the module prefix AFTER the protection gate, so the gate sees the
    // short path. Same convention the file already used for /briefing and /sell.
    const OMITTED_ON_PURPOSE = new Set(['/products']);

    const shortForms = [
        ...new Set(
            MEMBER_URLS
                .filter((m) => m.prefix !== '/academy')
                .map((m) => '/' + m.url.slice(m.prefix.length + 1).split('/')[0])
                .filter((s) => s !== '/'),
        ),
    ].sort();

    it('cover every member area except the one documented exception', () => {
        const missing = shortForms.filter((s) => !OMITTED_ON_PURPOSE.has(s) && !isProtectedPath(s));
        expect(missing).toEqual([]);
    });

    it('and /products is left out because it is a public page on another domain', () => {
        // PROTECTED_PATHS is global. easysalesmarket.com serves the public
        // catalogue at /products, so adding it to cover Export's
        // /export/(app)/products would gate marketplace browsing for
        // signed-out shoppers. Recorded, not silently taken.
        expect(shortForms).toContain('/products');
        expect(isProtectedPath('/products')).toBe(false);
        expect(source('src/lib/route-manifest.ts')).toContain('"/products" is deliberately ABSENT');
        expect(source('src/config/modules.config.ts')).toContain("domain: 'easysalesmarket.com'");
    });

    it('the full-length form of that page is still protected on the hub domain', () => {
        expect(isProtectedPath('/export/products')).toBe(true);
        expect(isProtectedPath('/export/products/create')).toBe(true);
    });
});

describe('member and admin pages sitting under a public prefix', () => {
    // /marketplace and /land are public and isPublicPath prefix-matches, so
    // everything beneath them was public unless named.
    it.each([
        ['/marketplace/dashboard'],
        ['/marketplace/orders/sample-id'],
        ['/marketplace/products/add'],
        ['/marketplace/village-market/seller'],
        ['/land/submit'],
        ['/land/verify'],
    ])('%s is protected', (url) => {
        expect(isProtectedPath(url)).toBe(true);
    });

    it('and their server actions already checked the caller, so this is the navigation half', () => {
        // Vacuity guard on "not a data leak": the data half was already right.
        expect(source('src/app/actions/orders.ts')).toContain('orderData?.buyerId !== session.user.id');
        expect(source('src/app/actions/land-actions.ts')).toContain('return { success: false, error: "Unauthorized", data: null };');
        expect(source('src/app/api/marketplace/create-product/route.ts'))
            .toContain('userData.sellerVerificationStatus !== "approved"');
    });
});

describe('nothing that was public stopped being public', () => {
    // The half of this change that could break the live site. Protected is
    // tested first in auth.config's authorized(), so an overlap silences a
    // public page rather than the other way round.
    it.each([
        ['/'],
        ['/marketplace'],
        ['/marketplace/products'],
        ['/marketplace/products/sample-id'],
        ['/marketplace/village-market'],
        ['/wave/landing'],
        ['/wave/access-denied'],
        ['/cooperatives/landing'],
        ['/academy'],
        ['/farm-nation'],
        ['/farm-nation/properties'],
        ['/farm-nation/property/sample-id'],
        ['/export'],
        ['/export/windows'],
        ['/export/windows/sample-id'],
        ['/land'],
        ['/auth/login'],
        ['/auth/register'],
        ['/help'],
        ['/about'],
        ['/terms'],
    ])('%s is still reachable signed out', (url) => {
        expect(isProtectedPath(url)).toBe(false);
        expect(isPublicPath(url)).toBe(true);
    });

    it('payment callbacks are deliberately untouched', () => {
        // These pages finish a Paystack round trip. Redirecting one to login
        // because a session lapsed mid-payment would lose the confirmation, so
        // they keep their existing page-level handling.
        expect(isProtectedPath('/export/payment/callback')).toBe(false);
        expect(isProtectedPath('/farm-nation/payment/callback')).toBe(false);
        expect(isProtectedPath('/marketplace/payment/callback')).toBe(false);
    });
});

describe('the dead segment list is gone', () => {
    it('GATED_SEGMENTS and isGatedSegment are no longer exported', () => {
        // 22 entries and a matcher that NOTHING imported — security-shaped
        // config that gated nothing, so adding a segment to it gated nothing.
        expect((manifest as Record<string, unknown>).GATED_SEGMENTS).toBeUndefined();
        expect((manifest as Record<string, unknown>).isGatedSegment).toBeUndefined();
    });

    it('and only the two known files read this manifest at all', () => {
        // The premise for calling it dead. If a third importer appears, this
        // fails and the claim has to be re-checked rather than assumed.
        expect(source('src/middleware.ts'))
            .toContain('import { isSharedDomainPath, isProtectedPath } from "@/lib/route-manifest";');
        expect(source('src/lib/auth.config.ts'))
            .toContain('import { isPublicPath, isProtectedPath } from "@/lib/route-manifest";');
    });

    it('every segment it carried is in PROTECTED_PATHS, which is the list that runs', () => {
        // This assertion is why the removal is safe, and writing it is what
        // showed the removal was NOT initially safe: /checkout and /buyer were
        // in the dead list and in no live one, so on easysalesmarket.com the
        // checkout page and on easysalesexportng.com the buyer area had no
        // middleware gate at all. They are in PROTECTED_PATHS now. The other
        // nineteen were already covered.
        const CARRIED = [
            '/onboarding', '/checkout', '/payment', '/verify-payment', '/briefing',
            '/application', '/setup', '/buyer', '/seller', '/sell', '/list-land',
            '/dashboard', '/profile', '/settings', '/messages', '/escrow', '/loans',
            '/admin', '/verify-id', '/verify-status', '/vendor',
        ];
        expect(CARRIED.filter((s) => !isProtectedPath(s))).toEqual([]);
    });

    it('and the two that were only ever in the dead list are named in PROTECTED_PATHS', () => {
        // Pinned separately so a later tidy-up cannot drop them back out on the
        // grounds that "the full-length forms are already there" — the whole
        // point is that the short form is what a dedicated module domain serves.
        const src = code('src/lib/route-manifest.ts');
        expect(src).toContain('"/checkout",');
        expect(src).toContain('"/buyer",');
        expect(isProtectedPath('/checkout')).toBe(true);
        expect(isProtectedPath('/buyer')).toBe(true);
    });

    it('their full-length forms being protected already, on every module that has one', () => {
        // Vacuity guard: the short forms are not inventing a new policy, they
        // are extending the existing one to the domain where the prefix is gone.
        for (const p of ['/marketplace/checkout', '/farm-nation/checkout', '/marketplace/buyer', '/export/buyer']) {
            expect(isProtectedPath(p)).toBe(true);
        }
    });
});
