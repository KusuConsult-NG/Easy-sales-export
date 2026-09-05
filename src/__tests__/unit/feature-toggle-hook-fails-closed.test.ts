/**
 * @jest-environment node
 */

/**
 *   #410 THE KILL SWITCH FAILED CLOSED ON THE SERVER AND OPEN IN THE BROWSER.
 *
 *   From the untested-module sweep: src/hooks/useFeatureToggle.ts was one of
 *   the files never named in any test.
 *
 *   WHAT #245 ESTABLISHED
 *   ----------------------
 *   getFeatureToggle returned DEFAULT_TOGGLES on a database error, and seven of
 *   those default to TRUE — farm_nation_purchases, escrow_messaging,
 *   cooperative_loans, land_verification, academy_courses, wave_program,
 *   digital_id_system. A transient read failure therefore re-enabled a feature
 *   an admin had deliberately killed. #245's own sentence: "A kill switch exists
 *   for the moment something is going wrong. A database error is that moment."
 *   The server was changed to fail CLOSED through resolveToggle().
 *
 *   WHAT WAS LEFT
 *   --------------
 *   The browser hook. `useFeatureToggle` caught the error and did nothing —
 *   the comment read "Keep default value on error" — and `useFeatureToggles`
 *   wrote `DEFAULT_TOGGLES[name] ?? false` in its catch, which is the exact
 *   expression #245 deleted from the server, one layer up.
 *
 *   AND IT IS LIVE, in six places, all of them navigation: AdminSidebar,
 *   HubNavigation, WebsiteNav, Sidebar, DashboardNav, and the WAVE earnings
 *   screen. An admin kills a module; the server answers false correctly; one
 *   failed call from the browser and the killed module stays in the menu until
 *   the page is reloaded. #297's class — a repair landing on one of two copies
 *   — carrying the same defect number as the half that was fixed.
 *
 *   FIXED through resolveToggle, the same helper the server calls, so the rule
 *   is stated once rather than twice (#390's lesson).
 *
 *   WHAT WAS DELIBERATELY NOT CHANGED. The initial value stays the configured
 *   default. "Not read yet" is not "read and failed": treating it as off would
 *   blank every navigation on first paint and fill it in a moment later, and
 *   that window is brief and self-correcting. The error is neither.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the singular hook stops failing closed        KILLED
 *     the plural hook returns DEFAULT_TOGGLES again KILLED
 *     resolveToggle stops honouring readFailed      KILLED
 *     reword the header prose                       SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { DEFAULT_TOGGLES, resolveToggle } from '@/lib/feature-toggles';

const ROOT = process.cwd();
const HOOK = 'src/hooks/useFeatureToggle.ts';
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: relative(ROOT, p) });

/** The seven #245 named: killable features whose configured default is ON. */
const KILLABLE = [
    'farm_nation_purchases',
    'escrow_messaging',
    'cooperative_loans',
    'land_verification',
    'academy_courses',
    'wave_program',
    'digital_id_system',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#410 — the premise: these seven default to ON', () => {
    it('WITHOUT THAT, FAILING TO THE DEFAULT WOULD BE HARMLESS', () => {
        /**
         * The finding only bites because the defaults are true. Asserted so the
         * story stays checkable: if somebody flips these to false, the header
         * above stops being the reason and this test says so.
         */
        for (const name of KILLABLE) {
            expect({ name, default: DEFAULT_TOGGLES[name] }).toEqual({ name, default: true });
        }
    });

    it('and resolveToggle turns a READ FAILURE into off, whatever the default', () => {
        for (const name of KILLABLE) {
            expect({ name, onFailure: resolveToggle(name, { readFailed: true }) })
                .toEqual({ name, onFailure: false });
            // …while a stored value is still honoured in both directions, so
            // this is a failure rule and not a blanket "everything off".
            expect(resolveToggle(name, { stored: true })).toBe(true);
            expect(resolveToggle(name, { stored: false })).toBe(false);
        }
        // And with no stored value and no failure, the default stands.
        expect(resolveToggle('wave_program', {})).toBe(true);
        expect(resolveToggle('advanced_analytics', {})).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#410 — the browser hook fails closed, like the server', () => {
    it('NEITHER HOOK FALLS BACK TO DEFAULT_TOGGLES IN A CATCH', () => {
        const src = code(HOOK);
        // The expression #245 removed from the server must not survive here.
        expect(src).not.toMatch(/catch[\s\S]{0,120}?DEFAULT_TOGGLES\[\w+\]\s*\?\?\s*false/);
    });

    it('and both catches route through resolveToggle with readFailed', () => {
        const src = code(HOOK);
        const uses = src.match(/resolveToggle\(\w+,\s*\{\s*readFailed:\s*true\s*\}\)/g) ?? [];
        // One for the singular hook, one for the plural.
        expect(uses.length).toBe(2);
    });

    it('and the LOADING default is still the configured one, on purpose', () => {
        /**
         * The distinction the fix rests on. If this ever becomes `false`, every
         * navigation blanks on first paint — so it is pinned as a deliberate
         * choice rather than left to be "tidied" into matching the catch.
         */
        const src = code(HOOK);
        expect(src).toMatch(/useState\(DEFAULT_TOGGLES\[featureName\] \?\? false\)/);
        expect(src).toMatch(/initial\[name\] = DEFAULT_TOGGLES\[name\] \?\? false/);
    });

    it('and the server half still fails closed too', () => {
        // The comparison that makes this a pair. If the server regresses, the
        // hook alone is not enough and this says so.
        const server = code('src/app/actions/feature-toggles.ts');
        expect(server).toMatch(/resolveToggle\(featureName,\s*\{\s*readFailed:\s*true\s*\}\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#410 — and it matters because every caller is a way in', () => {
    it('THE HOOK DECIDES WHAT THE NAVIGATION OFFERS', () => {
        /**
         * Recorded so the severity is not re-argued from scratch later: this is
         * not a cosmetic toggle, it is the list of modules a user can reach.
         */
        const callers = [
            'src/components/admin/AdminSidebar.tsx',
            'src/components/hub/HubNavigation.tsx',
            'src/components/layout/WebsiteNav.tsx',
            'src/components/layout/Sidebar.tsx',
            'src/components/dashboard/DashboardNav.tsx',
            'src/app/wave/(member)/earnings/page.tsx',
        ];
        for (const c of callers) {
            expect({ caller: c, uses: code(c).includes('useFeatureToggle') })
                .toEqual({ caller: c, uses: true });
        }
    });
});
