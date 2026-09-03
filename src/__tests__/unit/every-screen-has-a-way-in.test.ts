/**
 * @jest-environment node
 */

/**
 *   #362 FIFTEEN BUILT SCREENS HAD NO WAY IN — ABOUT 3,700 LINES OF WORKING,
 *        GUARDED UI THAT NO RENDERED NAVIGATION REACHES.
 *
 *        #361 established which navigation actually renders. Turning the same
 *        measurement around — for every page route, does ANY rendered file
 *        mention it? — found fifteen that nothing does.
 *
 *        THE ONES THIS COMMIT WIRES UP, because where they belong is not a
 *        product question:
 *
 *          /admin/wave/shipments               803  → AdminSidebar, Modules
 *          /admin/export/catalog               490  → AdminSidebar, Modules
 *          /admin/cooperatives/loan-products   409  → AdminSidebar, Modules
 *                                                   (#302 repaired its delete)
 *          /admin/system-health/diagnostics    204  → from system-health, whose
 *                                                   own link #361 added
 *          /admin/academy/create               184  → from /admin/academy,
 *                                                   whose subtitle already says
 *                                                   "Create and manage courses"
 *
 *        THE LAST ONE IS THE SHARPEST. #211–#216 was "the admin Create Course
 *        button had never created a course" — that form was repaired, tested,
 *        and shipped. The entrance to it was never added, so the repair was
 *        reachable only by typing the URL.
 *
 *        THE ONES LEFT FOR THE OWNER, because linking them is a product
 *        decision and inventing one is not this audit's job:
 *
 *          /admin/escrow                       197  a SECOND escrow admin
 *                                                   screen beside
 *                                                   /admin/marketplace/escrow
 *                                                   (448 lines), which IS in
 *                                                   the nav. #60's shape.
 *          /loans/approve                      263  a loan approval queue.
 *                                                   #213 and #286 both repaired
 *                                                   logic behind it.
 *          /dashboard/reviews/new              287  write a review — #122 and
 *                                                   #123 repaired its rules.
 *          /marketplace/seller/analytics       220  named only by the
 *                                                   unrendered MarketplaceSidebar.
 *          /verify-id/scan                     251  the sibling /verify-id
 *                                                   page's own comment says
 *                                                   this one "already does this
 *                                                   correctly".
 *          /cooperatives/onboarding/pending-payment 260
 *          /cooperatives/onboarding/success    151
 *          /academy/application/success         80  three flow-completion
 *                                                   screens with ZERO references
 *                                                   anywhere. Whatever those
 *                                                   flows do at the end, it is
 *                                                   not these.
 *          /academy/courses/[courseId]/quiz         a learner quiz under a
 *          /admin/academy/courses/[courseId]/quiz   /courses/ path, while the
 *                                                   linked routes are
 *                                                   /academy/[courseId] and
 *                                                   /admin/academy/[courseId]/quiz/[lessonId].
 *                                                   Two route trees, one linked.
 *
 *        WHAT IS NOT A FINDING, checked rather than assumed. Three of the
 *        twenty candidates are redirect stubs and belong unlinked:
 *        /admin/withdrawals → /admin/wave/withdrawals, /notifications →
 *        /dashboard/notifications, /marketplace/sell/orders →
 *        /marketplace/seller/orders. Two more are reached from outside the
 *        component tree: /export/onboarding/rejected from a rejection email's
 *        absolute URL, and /auth/login/admin from middleware.ts.
 *
 *        OWNER DECISION: ten screens above are built and unreachable. Link
 *        them, or retire them. /admin/escrow in particular duplicates
 *        /admin/marketplace/escrow and only one can be the escrow admin.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, dirname, resolve } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));
const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

const FILES = walk(join(ROOT, 'src'))
    .map((f) => relative(ROOT, f))
    .filter((f) => /\.tsx?$/.test(f) && !f.includes('__tests__') && !f.includes('/testing/'));

function resolveSpecifier(fromFile: string, spec: string): string | null {
    let base: string;
    if (spec.startsWith('@/')) base = join(ROOT, 'src', spec.slice(2));
    else if (spec.startsWith('.')) base = resolve(ROOT, dirname(fromFile), spec);
    else return null;
    for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
        if (existsSync(c) && statSync(c).isFile()) return relative(ROOT, c);
    }
    return null;
}

const IMPORTERS: Map<string, Set<string>> = (() => {
    const map = new Map<string, Set<string>>();
    for (const file of FILES) {
        const code = stripComments(readFileSync(join(ROOT, file), 'utf-8'));
        const specs = [
            ...[...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]),
            ...[...code.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)].map((m) => m[1]),
            ...[...code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
        ];
        for (const spec of specs) {
            const t = resolveSpecifier(file, spec);
            if (!t || t === file) continue;
            if (!map.has(t)) map.set(t, new Set());
            map.get(t)!.add(file);
        }
    }
    return map;
})();

const APP_ROOT = /^src\/app\/(.*\/)?(page|layout|route|template|error|loading|not-found|global-error|sitemap|robots)\.tsx?$/;

function isRendered(file: string, seen: Set<string> = new Set()): boolean {
    if (APP_ROOT.test(file)) return true;
    if (seen.has(file)) return false;
    seen.add(file);
    for (const importer of IMPORTERS.get(file) ?? []) {
        if (isRendered(importer, seen)) return true;
    }
    return false;
}

/** Every page route the app router serves. */
const ROUTES = FILES.filter((f) => /\/page\.tsx?$/.test(f))
    .map((p) => p.replace(/^src\/app/, '').replace(/\/page\.tsx?$/, '').replace(/\/\([^)]+\)/g, '') || '/');

/** The concatenated text of everything that is actually rendered. */
const LIVE_TEXT = FILES.filter((f) => isRendered(f)).map((f) => source(f)).join('\n@@@\n');

/** Is this route named anywhere a user could be sent from? */
function hasWayIn(route: string): boolean {
    if (route === '/') return true;
    if (route.includes('[')) {
        // Dynamic: a template literal names the static prefix.
        return LIVE_TEXT.includes(route.slice(0, route.indexOf('[')));
    }
    return LIVE_TEXT.includes(`"${route}"`) || LIVE_TEXT.includes(`'${route}'`)
        || LIVE_TEXT.includes(`\`${route}\``) || LIVE_TEXT.includes(`${route}?`)
        || LIVE_TEXT.includes(`${route}\``);
}

/** Screens this commit wired up. */
const WIRED = [
    '/admin/wave/shipments',
    '/admin/export/catalog',
    '/admin/cooperatives/loan-products',
    '/admin/system-health/diagnostics',
    '/admin/academy/create',
];

/** Screens left for the owner — recorded so they are not rediscovered. */
const STILL_ORPHANED = [
    '/academy/application/success',
    '/academy/courses/[courseId]/quiz',
    '/admin/academy/courses/[courseId]/quiz',
    '/admin/escrow',
    '/cooperatives/onboarding/pending-payment',
    '/cooperatives/onboarding/success',
    '/dashboard/reviews/new',
    '/export/onboarding/rejected',
    '/loans/approve',
    '/marketplace/seller/analytics',
    '/verify-id/scan',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#362 — the five this commit wired up', () => {
    it('EVERY ONE OF THEM IS REACHABLE NOW', () => {
        // THE test. All five were built, guarded and unreachable.
        for (const route of WIRED) {
            expect({ route, reachable: hasWayIn(route) }).toEqual({ route, reachable: true });
        }
    });

    it('and the three module screens are in the RENDERED admin nav', () => {
        const admin = source('src/components/admin/AdminSidebar.tsx');

        expect(admin).toContain('href: "/admin/wave/shipments"');
        expect(admin).toContain('href: "/admin/export/catalog"');
        expect(admin).toContain('href: "/admin/cooperatives/loan-products"');
        expect(isRendered('src/components/admin/AdminSidebar.tsx')).toBe(true);
    });

    it('THE CREATE-COURSE LINK IS ON THE PAGE THAT PROMISES IT', () => {
        // #211–#216 repaired that form. The entrance was never added.
        const academy = source('src/app/admin/academy/page.tsx');

        expect(academy).toContain('href="/admin/academy/create"');
        expect(readFileSync('src/app/admin/academy/page.tsx', 'utf-8'))
            .toMatch(/Create and manage courses/);
    });

    it('and the diagnostics sub-page is linked from its own parent', () => {
        expect(source('src/app/admin/system-health/page.tsx'))
            .toContain('href="/admin/system-health/diagnostics"');
    });

    it('all five pages sit behind the admin layout gate', () => {
        // Linking an ungated admin screen would be worse than leaving it
        // hidden. app/admin/layout.tsx is the gate all five inherit.
        const layout = source('src/app/admin/layout.tsx');

        expect(layout).toContain('isAdmin(roles)');
        expect(layout).toContain('redirect("/dashboard")');
        for (const route of WIRED) {
            expect(route.startsWith('/admin/')).toBe(true);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#362 — the ones left for the owner, recorded', () => {
    it('THEY ARE STILL UNREACHABLE, AND THAT IS THE OPEN DECISION', () => {
        // Named rather than left to the next sweep. If one is linked, this
        // fails and the list shrinks — which is the point of writing it here.
        const stillOut = STILL_ORPHANED.filter((r) => !hasWayIn(r));

        expect(stillOut.sort()).toEqual([...STILL_ORPHANED].sort());
    });

    it('and they are real screens, not stubs — measured by size', () => {
        // A five-line redirect being unlinked is correct. These are not that.
        for (const route of ['/loans/approve', '/dashboard/reviews/new', '/admin/escrow',
                             '/marketplace/seller/analytics', '/verify-id/scan']) {
            const lines = readFileSync(join(ROOT, `src/app${route}/page.tsx`), 'utf-8').split('\n').length;
            expect({ route, big: lines > 150 }).toEqual({ route, big: true });
        }
    });

    it('/admin/escrow REALLY IS A SECOND ESCROW ADMIN SCREEN', () => {
        // The duplicate that makes it a decision rather than a repair.
        expect(existsSync(join(ROOT, 'src/app/admin/escrow/page.tsx'))).toBe(true);
        expect(existsSync(join(ROOT, 'src/app/admin/marketplace/escrow/page.tsx'))).toBe(true);
        expect(hasWayIn('/admin/marketplace/escrow')).toBe(true);       // this one is linked
        expect(hasWayIn('/admin/escrow')).toBe(false);                  // this one is not
    });

    it('and the three flow-completion screens are named by NOTHING at all', () => {
        // Not merely unlinked — no file in the repository mentions them, so
        // whatever those flows do at the end, it is not these.
        for (const route of ['/academy/application/success', '/cooperatives/onboarding/success',
                             '/cooperatives/onboarding/pending-payment']) {
            const mentions = FILES.filter((f) => !f.startsWith(`src/app${route}/`))
                .filter((f) => source(f).includes(route));

            expect({ route, mentions }).toEqual({ route, mentions: [] });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#362 — what is NOT a finding, checked rather than assumed', () => {
    it('REDIRECT STUBS BELONG UNLINKED', () => {
        // Three of the twenty candidates. Counting them as orphans would have
        // inflated the finding by a sixth.
        for (const [route, target] of [
            ['/admin/withdrawals', '/admin/wave/withdrawals'],
            ['/notifications', '/dashboard/notifications'],
            ['/marketplace/sell/orders', '/marketplace/seller/orders'],
        ]) {
            const code = source(`src/app${route}/page.tsx`);

            // Quote style differs between these three files, so match either —
            // but anchor on the closing quote so a LONGER path cannot pass.
            expect(code).toMatch(new RegExp(`redirect\\(["']${target}["']\\)`));
            expect(code.split('\n').filter(Boolean).length).toBeLessThan(12);
        }
    });

    it('and two more are reached from OUTSIDE the component tree', () => {
        // A rejection email's absolute URL, and the middleware. Neither would
        // ever appear in a rendered component, and both are real ways in.
        //
        // Both assertions are QUOTE-ANCHORED, and that is load-bearing. A bare
        // toContain('/auth/login/admin') still passes when the middleware is
        // changed to name '/auth/login/adminX' — a longer string contains the
        // shorter one — so the exclusion would keep its stated reason while
        // the reason had in fact evaporated. Mutation M11 survived exactly
        // that, on the first draft of this file.
        expect(source('src/app/actions/admin/_exports.ts'))
            .toMatch(/\/export\/onboarding\/rejected["'`?]/);
        expect(source('src/middleware.ts')).toMatch(/["'`]\/auth\/login\/admin["'`]/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#362 — THE RATCHET: no NEW screen may be built without a way in', () => {
    it('finds the routes, so this is not vacuous', () => {
        expect(ROUTES.length).toBeGreaterThan(200);
        expect(LIVE_TEXT.length).toBeGreaterThan(500_000);
    });

    it('THE ORPHAN SET IS EXACTLY THE RECORDED ONE', () => {
        // Derived from the sweep. Anything new appearing here is a screen
        // somebody built and forgot to link — the whole class.
        //
        // The five redirect stubs and outside-the-tree routes are excluded by
        // name, each for a reason stated in the tests above.
        const EXCLUDED = new Set([
            '/admin/withdrawals', '/notifications', '/marketplace/sell/orders',   // redirect stubs
            '/export/onboarding/rejected', '/auth/login/admin',                   // reached externally
        ]);

        const orphans = ROUTES.filter((r) => !hasWayIn(r) && !EXCLUDED.has(r)).sort();

        expect(orphans).toEqual([...STILL_ORPHANED].filter((r) => !EXCLUDED.has(r)).sort());
    });

    it('and the ratchet can actually see an orphan', () => {
        // A ratchet that cannot fail is a comment.
        expect(hasWayIn('/loans/approve')).toBe(false);
        expect(hasWayIn('/admin/users')).toBe(true);
        expect(hasWayIn('/dashboard')).toBe(true);
    });
});
