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

    it('AND IT IS GATED TO THE BUYER SIDE — the owner overruled the asymmetry', () => {
        /*
         *   THIS ASSERTED THE OPPOSITE, and the reasoning was: a SELLER tool in
         *   a buyer's hands is a dead end, a BUYER tool in a seller's hands is
         *   merely unused, so hiding a screen from somebody who has used it is
         *   the worse failure.
         *
         *   THE OWNER: "A buyer can only see the buyers features and the seller
         *   can only see sellers features and when users sign up as both seller
         *   and buyer then they can see all the features on the sidebar."
         *
         *   Which answers the "a farmer may buy land too" case directly: a
         *   farmer who also buys signs up as BOTH, and Farm Nation's onboarding
         *   has asked that question all along — `role: z.enum(["buyer",
         *   "seller", "both"])`. The asymmetry was a reasonable default while
         *   nobody had decided; somebody has now.
         *
         *   The hazard behind the old reasoning was never the gate, it was the
         *   STALE CLAIM the gate read — and that is fixed separately:
         *   ModuleSidebar reads roles live from the document now, so a member
         *   approved five minutes ago is not hidden from their own screens.
         */
        expect(navEntry('My Purchases')).toContain('LAND_BUYER_ROLES');
        expect(navEntry('My Inquiries')).toContain('LAND_BUYER_ROLES');
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
        /*
         *   GATED NOW, and the sentence above is why it safely can be: "the
         *   token is what lags". That was the real hazard, and it is fixed —
         *   ModuleSidebar reads roles LIVE from the document, so a seller who
         *   has just onboarded is not locked out until re-login. With the stale
         *   claim gone, the gate costs nothing and the owner's rule applies:
         *   "the seller can only see sellers features".
         */
        expect(navEntry('My Properties')).toContain('rolesAny: LAND_SELLER_ROLES');

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
        /*
         *   #908's lesson applied to this test: RUN, NOT READ. It asserted
         *   `roles.push("farmer")` and `roles.push("investor")` as substrings of
         *   the onboarding, which proved two lines existed. It broke the moment
         *   both doors started sharing one rule — while the behaviour it guards
         *   was not merely unchanged but strictly better, because the ADMIN
         *   APPROVAL had been granting `farmer` unconditionally and now asks the
         *   same question.
         *
         *   So the grant and the gate are both executed here, and compared. That
         *   is the property that matters: every role the nav gates on is a role
         *   somebody is actually granted.
         */
        const { rolesForFarmNationRole } = require('@/lib/farm-nation-roles');
        const { LAND_SELLER_ROLES, LAND_BUYER_ROLES } = require('@/lib/role-app-mapping');

        //   What each answer grants.
        const granted = {
            seller: rolesForFarmNationRole('seller'),
            buyer: rolesForFarmNationRole('buyer'),
            both: rolesForFarmNationRole('both'),
        };

        //   A seller holds a role the SELLING entries gate on, and none of the
        //   buying ones — and the mirror.
        expect(LAND_SELLER_ROLES.some((r: string) => granted.seller.includes(r))).toBe(true);
        expect(LAND_BUYER_ROLES.some((r: string) => granted.seller.includes(r))).toBe(false);

        expect(LAND_BUYER_ROLES.some((r: string) => granted.buyer.includes(r))).toBe(true);
        expect(LAND_SELLER_ROLES.some((r: string) => granted.buyer.includes(r))).toBe(false);

        //   And "both" reaches both sides, which is the whole point of the
        //   answer existing.
        expect(LAND_SELLER_ROLES.some((r: string) => granted.both.includes(r))).toBe(true);
        expect(LAND_BUYER_ROLES.some((r: string) => granted.both.includes(r))).toBe(true);

        //   The ADMIN APPROVAL asks it too. That door used to write
        //   `arrayUnion("farmer")` whatever the applicant had answered.
        expect(code('src/app/actions/farm-nation/_fn_admin.ts'))
            .toContain('rolesForFarmNationRole');
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

/**
 *   THE OWNER: "I still have switch to seller button on the buyers dashboard
 *   which i clearly said you should remove that button. A buyer should be a
 *   buyer and a seller should be a seller."
 *
 *   The buyer dashboard's header carried an UNCONDITIONAL link to
 *   /marketplace/seller/dashboard — shown to every buyer, including the ones
 *   with no seller registration of any kind, for whom the only possible outcome
 *   of clicking it was the seller guard turning them away. It was never a
 *   permission and never granted one; it advertised a door that is not theirs.
 *
 *   THE SELLER'S MIRROR IMAGE IS GONE TOO, and this block used to pin the
 *   opposite. It was wrapped in `canBuy` — a live role read — so it appeared
 *   only for an account that genuinely held both, and on that ground it was
 *   kept and pinned here as a control. Put to the owner as the one open
 *   question on the pair ("say if it should go too"), the answer was the rule
 *   they had already given twice: a buyer is a buyer and a seller is a seller.
 *
 *   The gate was never the point. Who MAY click it is decided by the server
 *   guards and is unchanged; what a dashboard should ADVERTISE is a different
 *   question, and the answer is the same on both sides. An account holding
 *   both roles reaches either dashboard from the nav, where every other
 *   destination lives.
 *
 *   Its live-role read went with it — `canBuy` existed only to draw that link,
 *   so keeping it would have been a round trip on every seller dashboard load
 *   to answer a question nobody asks.
 */
describe('neither dashboard advertises the other', () => {
    const BUYER_DASH = 'src/app/marketplace/buyer/dashboard/BuyerDashboardClient.tsx';
    const SELLER_DASH = 'src/app/marketplace/seller/dashboard/SellerDashboardClient.tsx';

    const read = (rel: string) =>
        readFileSync(join(process.cwd(), rel), 'utf-8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n')
            .filter((l) => !l.trim().startsWith('//'))
            .join('\n');

    it('THE BUYER DASHBOARD DOES NOT LINK TO THE SELLER DASHBOARD', () => {
        expect(read(BUYER_DASH)).not.toContain('/marketplace/seller/dashboard');
    });

    it('and says nothing about switching', () => {
        expect(read(BUYER_DASH)).not.toMatch(/Switch to Seller/i);
    });

    it('AND THE SELLER DASHBOARD DOES NOT LINK TO THE BUYER DASHBOARD EITHER', () => {
        //   The symmetry is the rule. Asserted on the comment-stripped source,
        //   so the note explaining the removal cannot satisfy the assertion.
        expect(read(SELLER_DASH)).not.toContain('/marketplace/buyer/dashboard');
    });

    it('and says nothing about switching either', () => {
        expect(read(SELLER_DASH)).not.toMatch(/Switch to Buyer/i);
    });

    it('AND THE LIVE-ROLE READ THAT ONLY FED IT IS GONE', () => {
        //   A request every seller dashboard made to decide whether to draw a
        //   link that no longer exists.
        const src = read(SELLER_DASH);
        expect(src).not.toContain('canBuy');
        expect(src).not.toContain('getMyLiveRoles');
    });

    it('BOTH DASHBOARDS STILL EXIST AND ARE REACHABLE (vacuity guard)', () => {
        /*
         *   The assertions above are all "not present", and every one of them
         *   would pass if the two screens were deleted. What replaced the
         *   buttons is the nav, so the nav is what has to carry both.
         */
        for (const rel of [BUYER_DASH, SELLER_DASH]) {
            expect({ rel, exists: readFileSync(join(process.cwd(), rel), 'utf-8').length > 0 })
                .toEqual({ rel, exists: true });
        }
        const nav = readFileSync(join(process.cwd(), 'src/components/layout/ModuleSidebar.tsx'), 'utf-8');
        expect(nav).toMatch(/name: "Buyer Dashboard",\s+href: "\/marketplace\/buyer\/dashboard"/);
        //   The seller entry points at /marketplace/seller, which is a page
        //   whose whole body is a redirect. Following it is the difference
        //   between "the nav has a link" and "the nav reaches the screen" —
        //   the first assertion I wrote here matched a literal and failed,
        //   which is what a vacuity guard is for.
        expect(nav).toMatch(/name: "Seller Dashboard",\s+href: "\/marketplace\/seller"/);
        const sellerRoot = readFileSync(join(process.cwd(), 'src/app/marketplace/seller/page.tsx'), 'utf-8');
        expect(sellerRoot).toContain('router.replace("/marketplace/seller/dashboard")');
    });
});
