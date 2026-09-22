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
    it('THE FORM IS GATED — and the LIST is not, which #878 corrected', () => {
        /*
         *   THIS ASSERTED BOTH, AND ONE OF THEM WAS WRONG.
         *
         *   #858's reasoning covers "List Land": it is the seller's create form
         *   and a buyer cannot complete it. For "My Properties" the whole
         *   argument above is "her own listings, of which she has none by
         *   definition" — tidiness, not safety, and it contradicts the rule this
         *   same suite pins four tests up: "hiding a screen from somebody who
         *   has used it is the worse failure".
         *
         *   THE OWNER, on #878: "The seller couldn't see the properties they
         *   listed incase they want to make adjustments." That is the cost of
         *   the over-application, and this suite had already named the hazard —
         *   "gating on a role nobody is granted would hide the seller's tools
         *   from the seller" — one test below. The role IS granted; the token
         *   is what lags, because `roles` there is the JWT (#532), so a seller
         *   who had just onboarded was locked out until re-login.
         *
         *   The list is scoped by `ownerId == session.user.id` on the server, so
         *   ungating it shows a buyer an empty page and shows a seller their
         *   inventory.
         */
        expect(navEntry('My Properties')).not.toContain('rolesAny');

        /*
         *   And the form keeps its gate, in the spelling the rest of the
         *   platform uses — `land_owner` is a Farm Nation role in APP_TO_ROLES,
         *   permissions, schema-normalizer, role-app-mapping and DashboardNav,
         *   and this file's header names only farmer and investor.
         */
        expect(navEntry('List Land')).toContain('rolesAny: LAND_SELLER_ROLES');

        const { LAND_SELLER_ROLES } = require('@/lib/role-app-mapping');
        expect([...LAND_SELLER_ROLES].sort()).toEqual(['farmer', 'land_owner']);
    });

    it('AND THE FILTER ACTUALLY ENFORCES rolesAny', () => {
        /*
         *   A flag nothing reads is #624's defect — "a declared rule that
         *   nothing consulted", which that finding measured at fifteen sites.
         *
         *   #908 RUN, NOT READ. This asserted three substrings of the filter
         *   callback, including `item.sellerOnly && !isSeller`. That proves a
         *   line exists; it does not prove the line decides anything, and it
         *   broke the moment the predicate was extracted — while the behaviour
         *   it was guarding was unchanged. The predicate is exported now, so
         *   the gate is exercised instead of quoted.
         */
        const { navItemAllowedForRoles } = require('@/lib/nav-visibility');
        const { LAND_SELLER_ROLES } = require('@/lib/role-app-mapping');

        const listLand = { name: 'List Land', rolesAny: LAND_SELLER_ROLES };

        expect({
            farmer: navItemAllowedForRoles(listLand, ['farmer']),
            landOwner: navItemAllowedForRoles(listLand, ['land_owner']),
            investor: navItemAllowedForRoles(listLand, ['investor']),
            nobody: navItemAllowedForRoles(listLand, []),
        }).toEqual({ farmer: true, landOwner: true, investor: false, nobody: false });

        //   The marketplace gate, in the same call. An ungated entry is visible
        //   to everybody — the control that stops a predicate returning false
        //   everywhere from passing the four assertions above.
        expect({
            sellerOnlyForInvestor: navItemAllowedForRoles({ sellerOnly: true }, ['investor']),
            sellerOnlyForSeller: navItemAllowedForRoles({ sellerOnly: true }, ['seller']),
            ungated: navItemAllowedForRoles({ name: 'Escrow' }, []),
        }).toEqual({ sellerOnlyForInvestor: false, sellerOnlyForSeller: true, ungated: true });
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
