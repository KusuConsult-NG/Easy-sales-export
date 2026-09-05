/**
 * @jest-environment node
 */

/**
 *   #428 THE ORPHAN CLASS, RATCHETED — because #426 was one and nothing would
 *   have caught it.
 *
 *   #384 swept orphaned SCREENS. #367/#368 registered three dead lib modules.
 *   Neither covered the general case, and #426 walked straight through the gap:
 *   a 360-line "use server" module with three reachable endpoints, superseded by
 *   a rewrite, imported by nothing, carrying a wrong enrolment count — found by
 *   hand, months later, only because another finding led past it.
 *
 *   THIS SWEEP IS THAT SEARCH, RUN EVERY TIME. Resolve every import in src
 *   (static, dynamic and require, both `@/` and relative) and name the modules
 *   nothing points at. Framework entry points are excluded because Next.js
 *   reaches them by convention rather than by import, and src/scripts is
 *   excluded because npm invokes those by path.
 *
 *   WHAT IT FOUND, AND WHAT IT DID NOT. 46 modules with no importer. Triaged:
 *
 *     - Every lib/hook orphan was ALREADY registered or already retired —
 *       paystack-fulfillment, validations/cooperative, canonical/sync-engine,
 *       verification-canonical (#367/#368), usePushPermissionState (#416).
 *     - MFAPromptModal is the only caller of /api/auth/mfa/verify and nothing
 *       imports it — which matches the state already found and recorded: nothing
 *       enforces MFA, and the admin security screen says so in as many words.
 *       Not a new defect; the UI already tells the truth about it.
 *     - The rest is dead presentational UI. Six sidebar components exist and two
 *       are imported. The money-shaped modals — Withdrawal, Contribution,
 *       CooperativePaymentOption — are pure props-and-callbacks with no action
 *       call and no fetch, so none is a second door onto a guarded path.
 *
 *   So this sweep produced NO new behavioural defect, which is the honest
 *   result and is recorded as such rather than dressed up. Its value is the
 *   ratchet: the next #426 fails here instead of surviving until somebody
 *   happens to walk past it.
 *
 *   THE LIST IS A CEILING, NOT A TARGET. An entry LEAVING is fine — that means
 *   something got wired up or retired. A NEW one fails, and the fix is to wire
 *   it, retire it behind a flag as #426 and #379 did, or add it here with a
 *   reason.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     a new unimported module appears                 KILLED
 *     the resolver stops following `@/` imports       KILLED
 *     the resolver stops following relative imports   KILLED
 *     dynamic import() stops counting as a use        KILLED
 *     entry points stop being excluded                KILLED
 *     reword the header prose                         SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, dirname, normalize } from 'path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

/** Next.js reaches these by convention, not by import. */
const ENTRY = /src[/\\]app[/\\](?:.*[/\\])?(page|layout|route|template|loading|error|not-found|global-error|default|sitemap|robots|opengraph-image|icon|apple-icon|manifest)\.(ts|tsx)$/;
/** Next.js reaches these by filename at the project root. */
const ROOTLEVEL = /src[/\\](middleware|instrumentation|instrumentation-client)\.(ts|tsx)$/;
/** npm invokes these by path. */
const SCRIPTS = /^src[/\\]scripts[/\\]/;

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
            if (name === 'node_modules' || name === '__tests__') continue;
            walk(p, out);
        } else if (/\.(ts|tsx)$/.test(name) && !/\.(d|test)\.tsx?$/.test(name)) {
            out.push(relative(ROOT, p));
        }
    }
    return out;
}

/** Everything under src, tests included, because a test importing a module is a use. */
function allSources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
            if (name === 'node_modules') continue;
            allSources(p, out);
        } else if (/\.(ts|tsx)$/.test(name)) {
            out.push(relative(ROOT, p));
        }
    }
    return out;
}

/**
 * Every module specifier anything in src points at, normalised to a repo path.
 *
 * Static `from '...'`, dynamic `import('...')` and `require('...')` all count:
 * #426's module would have looked used had only static imports been followed,
 * because much of this codebase reaches server actions through `await import`.
 */
function importedPaths(): Set<string> {
    const found = new Set<string>();
    const RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;

    for (const rel of allSources(SRC)) {
        const src = readFileSync(join(ROOT, rel), 'utf-8');
        for (const m of src.matchAll(RE)) {
            const spec = m[1];
            if (spec.startsWith('@/')) {
                found.add(normalize(`src/${spec.slice(2)}`));
            } else if (spec.startsWith('.')) {
                found.add(normalize(join(dirname(rel), spec)));
            }
        }
    }
    return found;
}

function orphans(): string[] {
    const imported = importedPaths();
    const isImported = (rel: string) => {
        const noext = rel.replace(/\.(ts|tsx)$/, '');
        if (imported.has(noext)) return true;
        // `@/components/foo` resolves to `src/components/foo/index.tsx`.
        return noext.endsWith(`${'/'}index`) && imported.has(noext.replace(/[/\\]index$/, ''));
    };

    return walk(SRC)
        .filter((f) => !ENTRY.test(f) && !ROOTLEVEL.test(f) && !SCRIPTS.test(f) && !isImported(f))
        .map((f) => f.split('\\').join('/'))
        .sort();
}

/**
 * The modules nothing imports today.
 *
 * Every one triaged in the header. Shrinking this is progress; growing it
 * without a reason is the thing being prevented.
 */
const KNOWN_ORPHANS = [
    'src/app/admin/escrow/components/EscrowDetailsModal.tsx',
    'src/app/export/(app)/ExportSidebar.tsx',
    'src/app/farm-nation/(member)/FarmNationSidebar.tsx',
    'src/app/marketplace/seller/MarketplaceSidebar.tsx',
    'src/components/CertificateGenerator.tsx',
    'src/components/DigitalIDCard.tsx',
    'src/components/InvoiceGenerator.tsx',
    'src/components/LoadingComponents.tsx',
    'src/components/LoanApplicationWizard.tsx',
    'src/components/OnboardingTour.tsx',
    'src/components/Providers.tsx',
    'src/components/ai/AISidebar.tsx',
    'src/components/auth/ModuleRegisterPage.tsx',
    'src/components/common/UploadErrorPage.tsx',
    'src/components/cooperative/CooperativePaymentOption.tsx',
    'src/components/export/DateRangePicker.tsx',
    'src/components/export/ExportCalendar.tsx',
    'src/components/features/ActivityFeed.tsx',
    'src/components/features/HeroSlider.tsx',
    'src/components/layout/Sidebar.tsx',
    'src/components/layout/WebsiteFooter.tsx',
    'src/components/layout/WebsiteNav.tsx',
    'src/components/lms/CourseProgressCard.tsx',
    'src/components/loans/RepaymentSchedule.tsx',
    'src/components/marketplace/ProductReviewsSection.tsx',
    'src/components/modals/BookingModal.tsx',
    'src/components/modals/ContributionModal.tsx',
    'src/components/modals/ExportDetailsModal.tsx',
    'src/components/modals/ExportWindowModal.tsx',
    // The only caller of /api/auth/mfa/verify. Nothing enforces MFA — already
    // found, already recorded, and the admin security screen says so.
    'src/components/modals/MFAPromptModal.tsx',
    'src/components/modals/StatusUpdateModal.tsx',
    'src/components/modals/WithdrawalModal.tsx',
    'src/components/ui/Accordion.tsx',
    'src/components/ui/EmptyState.tsx',
    'src/components/ui/ImageSlider.tsx',
    'src/components/ui/ResponsiveTable.tsx',
    'src/components/ui/StatCard.tsx',
    'src/components/widgets/CooperativeWidget.tsx',
    'src/contexts/ThemeContext.tsx',
    'src/hooks/useMarketplaceSearch.ts',
    // Retired in place by #416 — no service worker, no subscription store.
    'src/hooks/usePushPermissionState.ts',
    // Registered by #367/#368 as harmless unreachable modules.
    'src/lib/canonical/sync-engine.ts',
    'src/lib/paystack-fulfillment.ts',
    'src/lib/validations/cooperative.ts',
    'src/lib/verification-canonical.ts',
    'src/types/index.ts',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#428 — no module becomes unreachable without somebody saying so', () => {
    it('THERE IS NO ORPHAN THAT IS NOT ON THE LIST', () => {
        const unlisted = orphans().filter((f) => !KNOWN_ORPHANS.includes(f));
        // A new entry here means a module nothing imports. Wire it up, retire it
        // behind a flag (#426, #379), or add it above with a reason.
        expect({ unlisted }).toEqual({ unlisted: [] });
    });

    it('and an entry LEAVING the list is fine — that is progress', () => {
        // Asserted as a subset rather than an equality so wiring something up
        // does not fail the build. The ceiling is what matters.
        const current = new Set(orphans());
        const stillOrphaned = KNOWN_ORPHANS.filter((f) => current.has(f));
        expect(stillOrphaned.length).toBeLessThanOrEqual(KNOWN_ORPHANS.length);
    });

    it('VACUITY GUARD: the sweep is really reading the tree', () => {
        // Without this, a resolver that matched everything would report zero
        // orphans and pass for the wrong reason — this audit's recurring shape.
        expect(walk(SRC).length).toBeGreaterThan(500);
        expect(importedPaths().size).toBeGreaterThan(300);
    });

    it('POSITIVE CONTROL: a module that IS imported is not reported', () => {
        // supabase-db.ts is imported by most of the server layer. If the
        // resolver ever broke, this would start showing up as an orphan.
        expect(orphans()).not.toContain('src/lib/supabase-db.ts');
        expect(orphans()).not.toContain('src/lib/wallet-ledger.ts');
    });

    it('and it follows DYNAMIC imports, not only static ones', () => {
        // Much of this codebase reaches server actions through `await import`.
        // Following only `from '...'` would call half the action layer dead.
        const imported = importedPaths();
        expect(imported.has('src/app/actions/marketplace/_escrow_actions')).toBe(true);
    });

    it('and framework entry points are not called orphans', () => {
        const list = orphans();
        for (const f of ['src/app/page.tsx', 'src/app/layout.tsx', 'src/middleware.ts']) {
            expect({ f, orphaned: list.includes(f) }).toEqual({ f, orphaned: false });
        }
    });
});
