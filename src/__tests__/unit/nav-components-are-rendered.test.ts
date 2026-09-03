/**
 * @jest-environment node
 */

/**
 *   #361 SEVEN NAVIGATION AND CHROME COMPONENTS ARE NEVER RENDERED, INCLUDING
 *        THE FILE THAT READS AS THE APPLICATION'S NAVIGATION CONFIGURATION —
 *        AND ONE ADMIN SCREEN HAD NO REACHABLE LINK AT ALL.
 *
 *        A CORRECTION TO #359 FIRST, BECAUSE IT IS THE REASON I FOUND THIS.
 *
 *        #359 repaired six navigation links that pointed at pages which do not
 *        exist, and its commit message said the two on WebsiteFooter were "the
 *        worst of the six: any visitor to the marketing site could click them".
 *        THAT WAS WRONG. WebsiteFooter.tsx has no importers. Neither does
 *        Sidebar.tsx, which is the only reader of lib/sidebar-config.ts, where
 *        the /settings link lived. All four files holding those six links are
 *        unrendered, so nobody could click any of them.
 *
 *        I checked that the DESTINATIONS did not exist and never checked that
 *        the SOURCES were rendered — against my own standing rule to establish
 *        reachability first, which #355 was entirely about. The repairs stand:
 *        each of those files is one import away from being live, and a nav
 *        table should be correct either way. The severity claim does not.
 *
 *        WHAT IS ACTUALLY RENDERED. app/layout.tsx → ClientLayout →
 *        ModuleSidebar for the member area; app/admin/layout.tsx →
 *        AdminSidebar for the admin area; DashboardNav and HubNavigation for
 *        their own screens. Everything else in the nav layer is dead:
 *
 *          components/layout/Sidebar.tsx        and with it the whole of
 *                                               lib/sidebar-config.ts —
 *                                               GLOBAL_NAV_ITEMS and
 *                                               MODULE_NAVIGATION, ~57 links.
 *          components/layout/WebsiteFooter.tsx  the public footer.
 *          components/layout/WebsiteNav.tsx     the public header.
 *          components/ai/AISidebar.tsx          the ONLY consumer of
 *                                               actions/ai-actions.ts. The AI
 *                                               assistant has no front door,
 *                                               which is why that action file
 *                                               and the chatbot service sat at
 *                                               0% coverage.
 *          export/(app)/ExportSidebar.tsx       all three say so themselves:
 *          farm-nation/(member)/FarmNation…     their layouts carry the note
 *          marketplace/seller/Marketplace…      "… removed — global
 *                                               ModuleSidebar renders …", and
 *                                               the component file was left.
 *
 *        THE ONE THING THAT COST SOMETHING. /admin/system-health exists, runs
 *        runSystemHealthDiagnostic, and gates itself on isAdmin — and the only
 *        file naming it was lib/sidebar-config.ts, which is unrendered. So the
 *        platform diagnostic was reachable only by typing the URL. It is in
 *        AdminSidebar now, the table app/admin/layout.tsx actually renders.
 *
 *        I checked the rest before claiming anything: /terms, /privacy,
 *        /contact, /about, /help and /refund-policy all have reachable
 *        linkers, so the dead footer costs no legal-page reachability. Only
 *        system-health was orphaned.
 *
 *        Everything is KEPT, per the standing instruction. Each dead component
 *        now carries a #361 note saying it is not rendered, so the next reader
 *        does not repair a table nobody sees — which is exactly what I did.
 *
 *        OWNER DECISION: the AI assistant is built end to end — action file,
 *        rate-limited GPT-4 service, admin screen (#246–#248), chat history —
 *        and has no UI. Render AISidebar, or retire the feature.
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

/** Resolve an import specifier against the importing file's own directory. */
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
        /**
         * BOTH import forms. `import x from "y"` and `import "y"` — the
         * side-effect form has no `from`, and a first version of this matched
         * only the first, so a component rendered through a bare
         * `import "@/components/…"` would have read as dead. Mutation testing
         * found it: making AISidebar reachable that way did not register.
         */
        const specs = [
            ...[...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]),
            ...[...code.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)].map((m) => m[1]),
            ...[...code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
        ];
        for (const spec of specs.map((s) => [null, s] as [null, string])) {
            const m = spec;
            const target = resolveSpecifier(file, m[1]);
            if (!target || target === file) continue;
            if (!map.has(target)) map.set(target, new Set());
            map.get(target)!.add(file);
        }
    }
    return map;
})();

/**
 * An app-router entry point. THIS PATTERN IS THE MEASUREMENT.
 *
 * My first version required a directory before the filename, so it missed
 * src/app/layout.tsx — the root layout — and reported ClientLayout and
 * ModuleSidebar as unreachable, which would have made this finding four times
 * larger and wrong. The `(.*\/)?` is what makes the root layout a root.
 */
const APP_ROOT = /^src\/app\/(.*\/)?(page|layout|route|template|error|loading|not-found|global-error|sitemap|robots)\.tsx?$/;

/**
 * Call this as `xs.filter((f) => isRendered(f))`, never `xs.filter(isRendered)`.
 * Array.filter passes (value, index, array), so the bare reference hands the
 * INDEX in as `seen` and the function throws "seen.has is not a function".
 * Two call sites here did exactly that on the first run.
 */
function isRendered(file: string, seen: Set<string> = new Set()): boolean {
    if (APP_ROOT.test(file)) return true;
    if (seen.has(file)) return false;
    seen.add(file);
    for (const importer of IMPORTERS.get(file) ?? []) {
        if (isRendered(importer, seen)) return true;
    }
    return false;
}

const DEAD_NAV = [
    'src/app/export/(app)/ExportSidebar.tsx',
    'src/app/farm-nation/(member)/FarmNationSidebar.tsx',
    'src/app/marketplace/seller/MarketplaceSidebar.tsx',
    'src/components/ai/AISidebar.tsx',
    'src/components/layout/Sidebar.tsx',
    'src/components/layout/WebsiteFooter.tsx',
    'src/components/layout/WebsiteNav.tsx',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#361 — the measurement itself', () => {
    it('THE ROOT PATTERN INCLUDES src/app/layout.tsx', () => {
        // The bug in my first version. Without this, the root layout is not a
        // root, and everything it renders reads as dead.
        expect(APP_ROOT.test('src/app/layout.tsx')).toBe(true);
        expect(APP_ROOT.test('src/app/admin/layout.tsx')).toBe(true);
        expect(APP_ROOT.test('src/app/export/windows/[id]/page.tsx')).toBe(true);
        expect(APP_ROOT.test('src/components/layout/Sidebar.tsx')).toBe(false);
    });

    it('and it finds a real number of entry points', () => {
        expect(FILES.filter((f) => APP_ROOT.test(f)).length).toBeGreaterThan(300);
    });

    it('THE NAVIGATION THAT IS RENDERED, MEASURED', () => {
        // Vacuity guard on the whole finding: if these were also unreachable,
        // the measurement would be broken rather than the app.
        for (const f of [
            'src/components/layout/ClientLayout.tsx',
            'src/components/layout/ModuleSidebar.tsx',
            'src/components/admin/AdminSidebar.tsx',
            'src/components/dashboard/DashboardNav.tsx',
            'src/components/hub/HubNavigation.tsx',
        ]) {
            expect(isRendered(f)).toBe(true);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#361 — /admin/system-health is reachable now', () => {
    it('IT IS IN THE NAV TABLE THE ADMIN LAYOUT RENDERS', () => {
        // THE test. The screen existed and nothing linked to it.
        const admin = source('src/components/admin/AdminSidebar.tsx');

        expect(admin).toContain('href: "/admin/system-health"');
        expect(isRendered('src/components/admin/AdminSidebar.tsx')).toBe(true);
    });

    it('and app/admin/layout.tsx really is what renders that table', () => {
        expect(source('src/app/admin/layout.tsx'))
            .toContain('from "@/components/admin/AdminSidebar"');
    });

    it('THE PAGE IT POINTS AT EXISTS AND GUARDS ITSELF', () => {
        // Linking to it would be worse than not, if it were ungated.
        expect(existsSync(join(ROOT, 'src/app/admin/system-health/page.tsx'))).toBe(true);
        expect(source('src/app/actions/health.ts')).toContain('isAdmin(session.user.roles)');
    });

    it('SOME RENDERED FILE NOW LINKS TO IT — the finding, closed', () => {
        const linkers = FILES.filter((f) => source(f).includes('"/admin/system-health"'));
        const live = linkers.filter((f) => isRendered(f));

        expect(live).toContain('src/components/admin/AdminSidebar.tsx');
        expect(live.length).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#361 — the dead nav components are labelled, not deleted', () => {
    it('ALL SEVEN ARE STILL UNRENDERED', () => {
        for (const f of DEAD_NAV) {
            expect({ file: f, rendered: isRendered(f) }).toEqual({ file: f, rendered: false });
        }
    });

    it('AND EACH ONE SAYS SO', () => {
        // The point of keeping them. The next reader must not repair a table
        // nobody sees, which is what #359 did.
        for (const f of DEAD_NAV) {
            expect(readFileSync(join(ROOT, f), 'utf-8')).toMatch(/#361 THIS FILE IS NOT RENDERED/);
        }
    });

    it('lib/sidebar-config.ts is dead WITH Sidebar.tsx, and carries the correction', () => {
        // ~57 links in a file that reads as the app's navigation config.
        expect(isRendered('src/lib/sidebar-config.ts')).toBe(false);
        expect(IMPORTERS.get('src/lib/sidebar-config.ts')).toEqual(
            new Set(['src/components/layout/Sidebar.tsx']),
        );
        expect(readFileSync(join(ROOT, 'src/lib/sidebar-config.ts'), 'utf-8'))
            .toMatch(/#361 CORRECTION TO THE ABOVE: NOBODY EVER SAW THIS LINK/);
    });

    it('the three module sidebars say in their LAYOUTS that they were removed', () => {
        // Not my inference — the layouts state it.
        for (const [layout, name] of [
            ['src/app/export/(app)/layout.tsx', 'ExportSidebar'],
            ['src/app/farm-nation/(member)/layout.tsx', 'FarmNationSidebar'],
            ['src/app/marketplace/seller/layout.tsx', 'MarketplaceSidebar'],
        ]) {
            expect(readFileSync(join(ROOT, layout), 'utf-8'))
                .toMatch(new RegExp(`${name} removed`));
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#361 — what the dead chrome does NOT cost, checked before claiming', () => {
    it('EVERY LEGAL AND MARKETING PAGE STILL HAS A RENDERED LINKER', () => {
        // The claim I did NOT make. An unrendered public footer sounds like
        // "the terms of service are unreachable"; it is not, and saying so
        // would have been the same overstatement as #359's.
        for (const path of ['/terms', '/privacy', '/refund-policy', '/contact', '/about', '/help']) {
            const live = FILES.filter((f) => source(f).includes(`"${path}"`)).filter((f) => isRendered(f));

            expect({ path, hasRenderedLinker: live.length > 0 })
                .toEqual({ path, hasRenderedLinker: true });
        }
    });

    it('and /admin/chatbot is reachable through ModuleSidebar, so it is not orphaned', () => {
        const live = FILES.filter((f) => source(f).includes('"/admin/chatbot"')).filter((f) => isRendered(f));

        expect(live).toContain('src/components/layout/ModuleSidebar.tsx');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#361 — THE RATCHET: a nav table that is not rendered must say so', () => {
    it('NO UNRENDERED NAVIGATION COMPONENT IS SILENT ABOUT IT', () => {
        // Derived from the seven. A nav table is a thing people trust and edit;
        // one that renders nowhere will absorb repairs that change nothing —
        // which is the trap #359 walked into.
        const navFiles = FILES.filter((f) =>
            /(Sidebar|Footer|Navigation|WebsiteNav)\.tsx$/.test(f) && !f.includes('/ui/'));

        expect(navFiles.length).toBeGreaterThanOrEqual(10);      // vacuity guard

        const silent = navFiles.filter((f) =>
            !isRendered(f) && !/#361 THIS FILE IS NOT RENDERED/.test(readFileSync(join(ROOT, f), 'utf-8')));

        expect(silent).toEqual([]);
    });

    it('and the AI assistant is recorded as built-without-a-front-door', () => {
        // Its action file, its rate-limited service and its admin screen all
        // exist and are tested; the panel that would call them is not rendered.
        expect(isRendered('src/components/ai/AISidebar.tsx')).toBe(false);
        expect(IMPORTERS.get('src/app/actions/ai-actions.ts'))
            .toEqual(new Set(['src/components/ai/AISidebar.tsx']));
        expect(readFileSync('src/__tests__/unit/nav-components-are-rendered.test.ts', 'utf-8'))
            .toMatch(/OWNER DECISION: the AI assistant is built end to end/);
    });
});
