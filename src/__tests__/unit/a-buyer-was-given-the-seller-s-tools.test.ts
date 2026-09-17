/**
 * @jest-environment node
 */

/**
 *   #858 A FARM NATION BUYER WAS GIVEN THE SELLER'S TOOLS AND NO WAY TO HER OWN
 *   PURCHASES.
 *
 *   THE OWNER: "Ensure the buyer dashboard is properly wired."
 *
 *   The live navigation is ModuleSidebar's FARM_NATION_NAV — the member
 *   layout's own comment records the other one as gone: "Navigation is handled
 *   by the global ModuleSidebar. FarmNationSidebar removed". It held five
 *   entries with NO gating:
 *
 *       Properties · My Properties · My Inquiries · Map View · List Land
 *
 *   So a buyer was offered "List Land" (the seller's create form) and "My
 *   Properties" (her own listings, of which she has none by definition) — and
 *   NO "My Purchases", the one screen that is hers.
 *
 * ── THE RULE EXISTED ONE ARRAY AWAY, AND COULD NOT HAVE BEEN APPLIED ────────
 *
 *   MARKETPLACE_NAV, immediately below, marks four entries `sellerOnly`. That
 *   flag tests `roles.includes("seller")` — and Farm Nation grants `farmer` and
 *   `investor`, assigned at submit by _fn_onboarding: buyer → investor,
 *   seller → farmer. A flag named for one module's vocabulary cannot gate
 *   another's, so the mechanism was there, visible, and inapplicable.
 *
 *   `rolesAny` is the general form. `sellerOnly` is left exactly as it is —
 *   correct for marketplace, and rewriting four working entries to prove a
 *   point is not a fix.
 *
 * ── AND "MY PURCHASES" WAS LOST IN A MIGRATION, NOT NEVER BUILT ─────────────
 *
 *   The page exists, is server-rendered, and reads getMyPurchaseRequestsAction.
 *   FarmNationSidebar linked it; the global nav that replaced it did not. That
 *   is #384 exactly — "LOST IN A NAV MIGRATION, NOT NEVER-BUILT" — whose note
 *   sits in this same file, about Analytics, about this same migration.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const SIDEBAR = 'src/components/layout/ModuleSidebar.tsx';
const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });

/** The FARM_NATION_NAV array, as source. */
const farmNationNav = (): string => {
    const src = code(SIDEBAR);
    const at = src.indexOf('const FARM_NATION_NAV');
    expect(at).toBeGreaterThan(-1);
    return src.slice(at, src.indexOf('];', at));
};

/** One entry of that array, by its visible name. */
const navEntry = (name: string): string => {
    const nav = farmNationNav();
    const at = nav.indexOf(`name: "${name}"`);
    expect({ name, present: at > -1 }).toEqual({ name, present: true });
    return nav.slice(at, nav.indexOf('\n', at));
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#858 — the buyer gets her own screen', () => {
    it('THE REPORTED GAP: "My Purchases" is in the live navigation', () => {
        expect(farmNationNav()).toContain('/farm-nation/my-purchases');
    });

    it('AND IT IS NOT GATED, because a farmer may buy land too', () => {
        /*
         *   The asymmetry is deliberate and worth pinning: a SELLER tool in a
         *   buyer's hands is a dead end, a BUYER tool in a seller's hands is
         *   merely unused. Hiding a screen from somebody who has used it is the
         *   worse failure.
         */
        expect(navEntry('My Purchases')).not.toContain('rolesAny');
        expect(navEntry('My Inquiries')).not.toContain('rolesAny');
    });

    it('AND THE PAGE IT POINTS AT EXISTS — not a link to nothing', () => {
        //   #384's defect from the other end: a nav entry for a route nobody
        //   built. Asserted on the file, because a 404 in a sidebar is the same
        //   dead end as a missing entry.
        const page = readFileSync(
            join(process.cwd(), 'src/app/farm-nation/(member)/my-purchases/page.tsx'), 'utf-8');

        expect(page).toContain('getMyPurchaseRequestsAction');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#858 — and the seller tools are gated on a Farm Nation role', () => {
    it('BOTH SELLER ENTRIES NAME `farmer`', () => {
        for (const name of ['List Land', 'My Properties']) {
            expect({ name, gated: navEntry(name).includes('rolesAny: ["farmer"]') })
                .toEqual({ name, gated: true });
        }
    });

    it('AND THE FILTER ACTUALLY ENFORCES rolesAny', () => {
        /*
         *   A flag nothing reads is #624's defect — "a declared rule that
         *   nothing consulted", which that finding measured at fifteen sites.
         *   The gate is asserted next to the one it was modelled on.
         */
        const src = code(SIDEBAR);

        expect(src).toContain('item.rolesAny');
        expect(src).toContain('return false');
        //   The marketplace gate is untouched.
        expect(src).toContain('item.sellerOnly && !isSeller');
    });

    it('AND `farmer`/`investor` ARE THE ROLES ONBOARDING REALLY GRANTS', () => {
        /*
         *   The check that makes the gate real rather than decorative. Gating on
         *   a role nobody is granted would hide the seller's tools from the
         *   seller — a worse defect than the one being fixed, and this audit's
         *   most common false positive is a rule that reads a field nobody
         *   writes.
         */
        const onboarding = code('src/app/actions/farm-nation/_fn_onboarding.ts');

        expect(onboarding).toContain('roles.push("farmer")');
        expect(onboarding).toContain('roles.push("investor")');
    });

    it('AND THE DEAD SIDEBAR IS NOT WHAT SHIPS', () => {
        /*
         *   FarmNationSidebar still exists on disk and still lists "My
         *   Purchases" — which is why the entry looked present to anybody
         *   reading that file. The member layout says it was removed; this is
         *   the assertion that keeps the two from disagreeing again.
         */
        /*
         *   ASSERTED AS "NOTHING RENDERS IT", not as "the layout names
         *   ModuleSidebar". The first version checked the layout for that
         *   string and failed against correct code: the only mention there is a
         *   COMMENT saying navigation moved, and stripComments removes
         *   comments — so the assertion was reading prose, which is the trap
         *   an-admin-screen-wearing-the-wrong-chrome records. ClientLayout
         *   renders the sidebar, not this layout.
         */
        const { execSync } = require('child_process') as typeof import('child_process');
        const renderers = execSync(
            'grep -rl "FarmNationSidebar" src/app src/components || true',
            { cwd: process.cwd(), encoding: 'utf-8' },
        ).split('\n').filter(Boolean)
            //   Its own definition is allowed to mention itself.
            .filter((f) => !f.endsWith('FarmNationSidebar.tsx'))
            /*
             *   STRIPPED, because grep cannot tell code from prose. Both
             *   remaining mentions are COMMENTS — the layout's note that
             *   navigation moved, and this finding's own note in ModuleSidebar —
             *   and a sweep that counted those would fail on the documentation
             *   written to explain it. Same trap as the assertion above, one
             *   level out.
             */
            .filter((f) => code(f).includes('FarmNationSidebar'));

        expect(renderers).toEqual([]);
    });
});
