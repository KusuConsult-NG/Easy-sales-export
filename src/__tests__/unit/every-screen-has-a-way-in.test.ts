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
import { execSync } from 'child_process';
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
    // #266 — built for the forensic scan, which was 747 lines of integrity
    // checking with no caller. Listed here so it is held to the same rule as
    // the five above rather than becoming the next orphan.
    '/admin/forensics',
];

/**
 *   #384 THE ELEVEN #362 LEFT FOR THE OWNER — DECIDED, NONE LEFT.
 *
 *        The standing instruction on this audit is that no decision is the
 *        owner's, so each of the eleven was measured and settled rather than
 *        recorded again. Two needed an entrance; eight were duplicates or dead
 *        ends and now redirect to the screen that does the job; one was never an
 *        orphan.
 *
 *        WIRED — the entrance was the only thing missing:
 *
 *          /loans/approve                 → AdminSidebar, "Business Loans".
 *                                           LOAN_APPLICATIONS holds two products
 *                                           (#70) and this is the BUSINESS queue;
 *                                           getPendingLoanApplications filters on
 *                                           filterByLoanProduct(…, 'business')
 *                                           precisely so it and the cooperative
 *                                           queue do not show each other's rows.
 *                                           Not a duplicate of anything — the only
 *                                           screen that approves a business loan.
 *          /marketplace/seller/analytics  → ModuleSidebar, sellerOnly. The seller
 *                                           nav moved out of MarketplaceSidebar
 *                                           and this entry did not come with it.
 *
 *        RETIRED — kept as redirects, so no URL breaks and nothing is deleted:
 *
 *          /academy/application/success             → /academy/dashboard
 *          /cooperatives/onboarding/success         → /cooperatives/dashboard
 *          /cooperatives/onboarding/pending-payment → /cooperatives/onboarding
 *              The three flow-completion screens. Each flow ends with a push to
 *              a dashboard; no code has ever routed to these.
 *          /verify-id/scan          → /verify-id
 *              Was the correct scanner while /verify-id verified in the browser
 *              with a key that is undefined there. That is fixed; both now POST
 *              to /api/qr/verify, so this is a second copy of one screen.
 *          /admin/escrow            → /admin/marketplace/escrow
 *              197 lines beside 448, over the same actions. #60's shape, and
 *              #113, #133, #325 and #375 all landed on the linked one.
 *          /dashboard/reviews/new   → /marketplace/buyer/orders/[id]/review
 *              Both write PRODUCT_REVIEWS and both actions are now equally
 *              hardened, so this is a duplicate screen rather than a guard
 *              asymmetry. The order page is the right home: a review belongs to
 *              an order line, and that screen walks to the next unreviewed item.
 *        RETIRED TOO, BUT ONLY AFTER THE MEASUREMENT WAS FINISHED — #386.
 *
 *          /academy/courses/[courseId]/quiz       → /academy/[courseId]
 *          /admin/academy/courses/[courseId]/quiz → /admin/academy/[courseId]
 *
 *        This pass first decided to retire them, then reversed on finding that
 *        the unlinked pair sets five settings the linked pair does not and that
 *        only its submit route enforces maxAttempts — and recorded "the unwired
 *        pair is the COMPLETE, enforcing pair".
 *
 *        #386 finished the measurement and that conclusion was half wrong.
 *        COLLECTIONS.QUIZZES has one writer whose only caller is the unlinked
 *        admin screen, so the store is EMPTY: the attempt limit has only ever
 *        been enforced over nothing, and neither subsystem has applied a limit
 *        to a real quiz. Retired behind ACADEMY_QUIZ_API, with the one setting
 *        the live grading path reads — the pass mark — added to the editor that
 *        admins can reach.
 *
 *        Left here as a sequence rather than a tidy answer, because the lesson
 *        is the sequence: "which door is more featureful" is not the same
 *        question as "which door has ever run", and answering the first one and
 *        stopping produced a confident, wrong reversal.
 *
 *        NOT AN ORPHAN — corrected: /export/onboarding/rejected is reached from
 *        a rejection email's absolute URL, which #362's own prose already said
 *        while its list still counted it. It moves to EXCLUDED below.
 */
const STILL_ORPHANED: string[] = [];

/** Retired in #384: each still serves its URL, as a redirect to the live screen. */
const RETIRED: Array<[string, string]> = [
    ['/academy/application/success', '/academy/dashboard'],
    ['/cooperatives/onboarding/success', '/cooperatives/dashboard'],
    ['/cooperatives/onboarding/pending-payment', '/cooperatives/onboarding'],
    ['/verify-id/scan', '/verify-id'],
    ['/admin/escrow', '/admin/marketplace/escrow'],
];

/** Retired too, but their target is built from a route param. */
const RETIRED_DYNAMIC: Array<[string, string]> = [
    ['/dashboard/reviews/new', '/marketplace/buyer/orders/'],
    ['/academy/courses/[courseId]/quiz', '/academy/'],
    ['/admin/academy/courses/[courseId]/quiz', '/admin/academy/'],
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
describe('#362 — the ones left for the owner, now none', () => {
    it('ALL ELEVEN ARE SETTLED — the orphan list is empty', () => {
        // #384 wired two and retired six; #386 retired the last two once the
        // measurement behind them was finished. Kept as a named constant rather
        // than deleted so the ratchet has somewhere to put the next one, and so
        // "there were eleven" stays in the record.
        expect(STILL_ORPHANED).toEqual([]);
    });

    it('and every one of them WAS a real screen, not a stub — measured from git', () => {
        // The point #362 made: a five-line redirect being unlinked is correct,
        // and none of these was that. Measured against the commit before the
        // retirements, because five of the eleven ARE five-line redirects now —
        // asserting their current size would quietly invert the claim.
        const before = 'ccd38df0';   // the commit preceding #384
        for (const route of ['/loans/approve', '/dashboard/reviews/new', '/admin/escrow',
                             '/marketplace/seller/analytics', '/verify-id/scan']) {
            const lines = execSync(`git show ${before}:src/app${route}/page.tsx | wc -l`,
                { encoding: 'utf-8', cwd: ROOT }).trim();

            expect({ route, big: Number(lines) > 150 }).toEqual({ route, big: true });
        }
    });

    it('/admin/escrow REALLY WAS A SECOND ESCROW ADMIN SCREEN', () => {
        // The duplicate that made it a decision rather than a repair. Both files
        // still exist; the smaller one is now a redirect (see #384 below).
        expect(existsSync(join(ROOT, 'src/app/admin/escrow/page.tsx'))).toBe(true);
        expect(existsSync(join(ROOT, 'src/app/admin/marketplace/escrow/page.tsx'))).toBe(true);
        expect(hasWayIn('/admin/marketplace/escrow')).toBe(true);       // this one is linked
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#384 — the two that only needed an entrance', () => {
    it('THE BUSINESS LOAN QUEUE IS REACHABLE', () => {
        expect(hasWayIn('/loans/approve')).toBe(true);
        expect(source('src/components/admin/AdminSidebar.tsx')).toContain('href: "/loans/approve"');
    });

    it('and it is gated on the permission its own actions demand', () => {
        // The nav must not offer a link the action refuses. Both
        // getPendingLoanApplications and approveLoanApplication check
        // cooperatives:approve_loans, so the entry names the same one.
        const nav = source('src/components/admin/AdminSidebar.tsx');
        const entry = nav.slice(nav.indexOf('href: "/loans/approve"'));

        expect(entry.slice(0, entry.indexOf('},') + 2)).toContain('cooperatives:approve_loans');
        const action = source('src/app/actions/loan-actions.ts');
        expect(action).toContain('cooperatives:approve_loans');
    });

    it('and a refused read no longer renders as an empty queue', () => {
        // #307's shape on the sharpest possible screen: "No Pending
        // Applications — All loan applications have been reviewed" is the worst
        // wrong answer a loan approver can be given.
        const page = source('src/app/loans/approve/page.tsx');

        expect(page).toContain('setError(result.error || "Could not load loan applications")');
        expect(page).toContain('Could not load the queue');
        expect(page).toMatch(/!loading && !error && loans\.length === 0/);
    });

    it('SELLER ANALYTICS IS REACHABLE', () => {
        expect(hasWayIn('/marketplace/seller/analytics')).toBe(true);
        expect(source('src/components/layout/ModuleSidebar.tsx'))
            .toContain('href: "/marketplace/seller/analytics"');
    });

    it('and it is sellerOnly, like every other seller entry beside it', () => {
        const nav = source('src/components/layout/ModuleSidebar.tsx');
        const entry = nav.slice(nav.indexOf('href: "/marketplace/seller/analytics"'));

        expect(entry.slice(0, entry.indexOf('},') + 2)).toContain('sellerOnly: true');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#384 — the eight that were retired, and what they point at', () => {
    it('EVERY RETIRED SCREEN STILL SERVES ITS URL, AS A REDIRECT', () => {
        for (const [route, target] of RETIRED) {
            const code = source(`src/app${route}/page.tsx`);

            // Quote-anchored on the closing quote, so a LONGER path cannot pass
            // — the mutation that survived #362's first draft.
            expect({ route, ok: new RegExp(`redirect\\(["']${target}["']\\)`).test(code) })
                .toEqual({ route, ok: true });
        }
    });

    it('and the three that carry a route param redirect to a built path', () => {
        for (const [route, prefix] of RETIRED_DYNAMIC) {
            const file = `src/app${route.replace('[courseId]', '[courseId]')}/page.tsx`;
            const code = source(file);

            expect({ route, hasRedirect: code.includes('redirect(') }).toEqual({ route, hasRedirect: true });
            expect({ route, target: code.includes(prefix) }).toEqual({ route, target: true });
        }
    });

    it('none of them still holds the screen it duplicated — vacuity guard', () => {
        // Without this, a file that failed to be rewritten would pass the two
        // assertions above simply by mentioning redirect() somewhere.
        for (const [route] of [...RETIRED, ...RETIRED_DYNAMIC]) {
            const code = source(`src/app${route}/page.tsx`);

            expect({ route, lines: code.split('\n').filter((l) => l.trim()).length < 15 })
                .toEqual({ route, lines: true });
        }
    });

    it('and each says WHY, so the next reader does not have to re-derive it', () => {
        for (const [route] of [...RETIRED, ...RETIRED_DYNAMIC]) {
            const raw = readFileSync(join(ROOT, `src/app${route}/page.tsx`), 'utf-8');

            // #384 or #386 — the two quiz screens were retired by the later
            // pass, once the measurement behind them was finished.
            expect({ route, recorded: /#38[46] RETIRED/.test(raw) }).toEqual({ route, recorded: true });
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
            // #384 — retired to redirects. They keep serving their URL and are
            // unlinked BY DESIGN, exactly like the three stubs above, so they
            // belong in the same exclusion for the same stated reason.
            ...RETIRED.map(([r]) => r),
            ...RETIRED_DYNAMIC.map(([r]) => r),
        ]);

        const orphans = ROUTES.filter((r) => !hasWayIn(r) && !EXCLUDED.has(r)).sort();

        expect(orphans).toEqual([...STILL_ORPHANED].filter((r) => !EXCLUDED.has(r)).sort());
    });

    it('and the ratchet can actually see an orphan', () => {
        // A ratchet that cannot fail is a comment. #384 wired /loans/approve, so
        // the negative case is now a route that does not exist — which is what
        // an unlinked one looks like to hasWayIn, and the only honest example
        // left now that the orphan list is empty.
        expect(hasWayIn('/a-screen-nobody-built')).toBe(false);
        expect(hasWayIn('/admin/users')).toBe(true);
        expect(hasWayIn('/dashboard')).toBe(true);
    });
});
