/**
 * @jest-environment node
 */

/**
 *   #877 #878 A SELLER COULD NOT REACH THE THINGS THEY HAD LISTED.
 *
 *   THE OWNER: "The seller couldn't see the properties they listed incase they
 *   want to make adjustments and this is applicable to other features that
 *   users list products."
 *
 *   Two different faults under one sentence, and neither was in the data or the
 *   actions — `getMyPropertiesAction` and `getSellerProductsAction` both filter
 *   correctly on the caller's own id and neither applies a status filter. The
 *   seller could not GET THERE.
 *
 * ── #877 THE MARKETPLACE ENTRY POINTED AT THE SHOP FLOOR ────────────────────
 *
 *       { name: "My Products", href: "/marketplace/products", … }
 *
 *   `/marketplace/products` is MarketplaceProductsPage — EVERYBODY's products,
 *   fed by getMarketplaceProductsAction. The seller's own list, with the edit
 *   and delete doors on it, is `/marketplace/seller/products`.
 *
 *   Their own list was reachable from three places, none of them navigation:
 *   the EMPTY STATE of the quotes page, a redirect after editing a product they
 *   had already opened, and marketplace/seller/MarketplaceSidebar.tsx — the
 *   component #384 already recorded as unrendered.
 *
 *   WHICH MAKES THIS #384 AGAIN. That finding is about entries lost when the
 *   seller nav moved out of MarketplaceSidebar into ModuleSidebar; it found
 *   Analytics missing and restored it. "My Products" made the move with its
 *   LABEL and the wrong href — so a grep for the route still found something
 *   and the entry still read as present. A half-migrated line hides better than
 *   a missing one.
 *
 * ── #878 THE FARM NATION ENTRY WAS GATED ON A TOKEN ─────────────────────────
 *
 *       { name: "My Properties", …, rolesAny: ["farmer"] }
 *
 *   Two things wrong with one gate.
 *
 *   It is a LIST OF YOUR OWN THINGS. Scoped server-side by `ownerId ==
 *   session.user.id`, so to a buyer it is an empty page and to a seller it is
 *   their inventory. ModuleSidebar states the rule twice in its own comments —
 *   "hiding a screen from somebody who has used it is a worse failure than
 *   showing one that is empty" — and this was the entry that did not follow it.
 *
 *   And `roles` there comes from useSession(), which is the JWT. #532 is the
 *   finding that a JWT goes stale: a seller who has just onboarded holds
 *   `farmer` in the users table and not yet in their token, so the screens that
 *   manage their land stayed hidden until they signed out and back in.
 *
 *   The FORM keeps its gate — a buyer cannot complete it — but not the narrow
 *   spelling: `land_owner` is a Farm Nation role in APP_TO_ROLES, permissions,
 *   schema-normalizer, role-app-mapping and DashboardNav, and the sidebar was
 *   the one place that said `farmer` alone.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const SIDEBAR = 'src/components/layout/ModuleSidebar.tsx';

const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });

/** Every `{ name: "…", href: "…", …flags }` entry in the sidebar's nav tables. */
interface NavEntry { name: string; href: string; rest: string }

function navEntries(): NavEntry[] {
    const src = code(SIDEBAR);
    const out: NavEntry[] = [];
    const re = /\{\s*name:\s*"([^"]+)"\s*,\s*href:\s*"([^"]+)"\s*,([^}]*)\}/g;
    for (const m of src.matchAll(re)) {
        out.push({ name: m[1], href: m[2], rest: m[3] });
    }
    return out;
}

/**
 * The page file a route resolves to, route groups included.
 *
 *   `/farm-nation/my-properties` lives at
 *   `src/app/farm-nation/(member)/my-properties/page.tsx`, and a resolver that
 *   did not know that would report every member screen as missing — which is
 *   the shape of a sweep that passes for the wrong reason.
 */
function pageFor(href: string): string | null {
    const segments = href.replace(/^\//, '').split('/').filter(Boolean);

    const walk = (dir: string, rest: string[]): string | null => {
        if (rest.length === 0) {
            const page = join(dir, 'page.tsx');
            return existsSync(page) ? page : null;
        }
        const [head, ...tail] = rest;

        const direct = join(dir, head);
        if (existsSync(direct) && statSync(direct).isDirectory()) {
            const found = walk(direct, tail);
            if (found) return found;
        }

        //   Route groups are invisible in the URL.
        for (const entry of readdirSync(dir)) {
            if (!entry.startsWith('(') || !entry.endsWith(')')) continue;
            const grouped = join(dir, entry);
            if (!statSync(grouped).isDirectory()) continue;
            const found = walk(grouped, rest);
            if (found) return found;
        }
        return null;
    };

    return walk(join(ROOT, 'src/app'), segments);
}

/**
 * The server actions a page and its client reach for.
 *
 *   TAKEN FROM THE IMPORTS, not from a name pattern. My first draft collected
 *   identifiers ending in "Action" and missed `getMyLandListings` — which is the
 *   action behind the very screen the owner reported, so the sweep accused the
 *   one page it most needed to read correctly. A convention is not an interface.
 */
function actionsBehind(pageFile: string): string[] {
    const dir = pageFile.slice(0, pageFile.lastIndexOf('/'));
    const names = new Set<string>();

    for (const entry of readdirSync(dir)) {
        if (!entry.endsWith('.tsx') && !entry.endsWith('.ts')) continue;
        const src = stripComments(readFileSync(join(dir, entry), 'utf8'), { label: entry });

        for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']@\/app\/actions\/[^"']*["']/g)) {
            for (const raw of m[1].split(',')) {
                const name = raw.replace(/\btype\b/, '').split(/\s+as\s+/)[0].trim();
                if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
            }
        }
    }
    return [...names];
}

/** Does any action of that name filter on the CALLER's own id? */
function filtersBySession(actionNames: string[]): boolean {
    const files: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                if (!full.includes('__tests__')) walk(full);
            } else if (/\.ts$/.test(full)) files.push(full);
        }
    };
    walk(join(ROOT, 'src/app/actions'));

    for (const file of files) {
        const src = stripComments(readFileSync(file, 'utf8'), { label: file });
        for (const name of actionNames) {
            const at = src.indexOf(`function _${name}`);
            const plain = at < 0 ? src.indexOf(`function ${name}`) : at;
            if (plain < 0) continue;

            //   The body, generously bounded — these actions carry long
            //   comments and fallback branches.
            const body = src.slice(plain, plain + 4000);
            const knowsTheCaller = /session\.user\.id|sessionResult\.session\.user\.id|\buserId\b/.test(body);
            if (!knowsTheCaller) continue;

            /*
             *   AND REACHES THE DATABASE WITH IT. THREE shapes, all real and all
             *   correct — a `.where("ownerId", "==", …)`, a collection PATH that
             *   contains the id, which is how the academy stores per-member
             *   progress (`user_progress/${userId}/courses`), and
             *   `filterByOwner(...)`. Checking only for `.where(` reported the
             *   academy screen as unscoped, which it is not.
             *
             *   #904 ADDED THE THIRD, and it is a widening of the FILTER rather
             *   than a loss of one. A listing filed under a profile its owner no
             *   longer signs in as was invisible to them, so these screens now
             *   filter on every id that resolves to the caller instead of on the
             *   session id alone — lib/owned-profile-ids.ts. Still scoped to the
             *   caller, and this sweep must keep saying so: without this line it
             *   reported My Properties, the very screen #878 is about, as
             *   showing everybody's land.
             */
            const filtered = /\.where\(|\bfilterByOwner\(/.test(body);
            const scopedPath = /collection\(\s*`[^`]*\$\{\s*userId\s*\}/.test(body);
            if (filtered || scopedPath) return true;
        }
    }
    return false;
}

/**
 * Entries that show a member THEIR OWN records.
 *
 *   By label, because that is the promise the sidebar makes to the person
 *   reading it. "My Products" that lists everybody's products is a lie told in
 *   two words, and it is the one that shipped.
 */
const MINE = (e: NavEntry) => /^My\b/.test(e.name);

// ─────────────────────────────────────────────────────────────────────────────
describe('#877 #878 — an entry called "My …" shows you yours', () => {
    it('THE SWEEP IS READING THE NAV — the control', () => {
        const all = navEntries();
        const mine = all.filter(MINE);

        expect(all.length).toBeGreaterThan(30);
        expect(mine.length).toBeGreaterThan(5);
    });

    it('EVERY "My …" ENTRY RESOLVES TO A PAGE THAT EXISTS', () => {
        const missing = navEntries().filter(MINE)
            .filter((e) => pageFor(e.href) === null)
            .map((e) => `${e.name} → ${e.href}`);

        expect(missing).toEqual([]);
    });

    it('THE REPORTED DEFECT: and that page is scoped to the caller', () => {
        /*
         *   `/marketplace/products` fails this and `/marketplace/seller/products`
         *   passes it, which is the whole of #877: the action behind the public
         *   catalogue filters by category and search, and never by who is
         *   asking.
         */
        const offenders = navEntries().filter(MINE)
            .filter((e) => {
                const page = pageFor(e.href);
                if (!page) return false;   //   reported by the test above
                return !filtersBySession(actionsBehind(page));
            })
            .map((e) => `${e.name} → ${e.href}`);

        expect(offenders).toEqual([]);
    });

    it('AND THE SWEEP CAN STILL TELL THE TWO APART — the guard zero needs', () => {
        /*
         *   Vacuity. "No offenders" is also what a resolver that finds nothing
         *   and a session check that always answers yes would produce, and this
         *   codebase has met both shapes.
         */
        const own = pageFor('/marketplace/seller/products');
        const shop = pageFor('/marketplace/products');

        expect(own).toBeTruthy();
        expect(shop).toBeTruthy();

        expect(filtersBySession(actionsBehind(own!))).toBe(true);
        //   The public catalogue is NOT scoped to the caller — which is correct
        //   for what it is, and wrong for what the entry was calling it.
        expect(filtersBySession(actionsBehind(shop!))).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#878 — and a list of your own things is not hidden behind a role', () => {
    it('NO "My …" ENTRY IS GATED ON A STALE CLAIM — which is what this was about', () => {
        /*
         *   THE RULE MOVED, AND THIS IS WHY.
         *
         *   #878 had two legs. The first was a MECHANISM: the gate read the JWT
         *   rather than the database (#532), so a seller whose role had just
         *   been granted was locked out of their own inventory until they signed
         *   in again. The second was a JUDGEMENT: a list of your own things is
         *   scoped by the session on the server, so the worst a wrong audience
         *   sees is an empty page.
         *
         *   The owner has overruled the judgement, for marketplace, after being
         *   shown it: "A buyer can only see the buyers features and the seller
         *   can only see sellers features and when users sign up as both seller
         *   and buyer then they can see all the features on the sidebar."
         *
         *   The MECHANISM was not overruled, and is the part that could actually
         *   hurt somebody — so it is fixed rather than waived: ModuleSidebar
         *   reads roles LIVE (getMyLiveRoles) and uses the claim only as the
         *   initial value. That is what this test guards now. A gate is allowed;
         *   a gate fed by an 8-hour-old token is not.
         */
        const { readFileSync } = require('fs');
        const src = readFileSync('src/components/layout/ModuleSidebar.tsx', 'utf8');

        expect(src).toContain('getMyLiveRoles');
        expect(src).toContain('const roles = liveRoles ?? claimedRoles;');

        //   And the claim is not what any gate reads directly.
        expect(src).not.toMatch(/navItemAllowedForRoles\(item,\s*claimedRoles\)/);
    });

    it('AND FARM NATION\'S OWN LISTS STAY UNGATED, because that module cannot tell buyer from seller', () => {
        /*
         *   The owner's rule names MARKETPLACE. Farm Nation has ZERO occurrences
         *   of accountType — its onboarding never asks whether you are buying or
         *   selling land — and every approved member is granted "farmer", which
         *   IS a seller role. There is nothing there to gate on, so gating would
         *   hide these from everybody.
         */
        const farmLists = navEntries().filter(MINE)
            .filter((e) => /farm-nation/.test(e.rest))
            .filter((e) => /rolesAny/.test(e.rest))
            .map((e) => `${e.name} → ${e.rest.trim()}`);

        expect(farmLists).toEqual([]);
    });

    it('AND "My Properties" SPECIFICALLY IS UNGATED', () => {
        //   Named, because it is the entry the owner reported and a sweep that
        //   stopped matching would pass the test above in silence.
        const entry = navEntries().find((e) => e.name === 'My Properties');

        expect(entry).toBeTruthy();
        expect(entry!.href).toBe('/farm-nation/my-properties');
        expect(entry!.rest).not.toMatch(/rolesAny/);
    });

    it('AND THE FORM KEEPS ITS GATE, widened to what the platform means', () => {
        /*
         *   "List Land" is a form a buyer cannot complete, so the asymmetry is
         *   deliberate — but `farmer` alone was narrower than every other place
         *   that answers this question.
         */
        const { LAND_SELLER_ROLES } = require('@/lib/role-app-mapping');

        expect([...LAND_SELLER_ROLES].sort()).toEqual(['farmer', 'land_owner']);

        const entry = navEntries().find((e) => e.name === 'List Land');
        expect(entry!.rest).toMatch(/rolesAny:\s*LAND_SELLER_ROLES/);
    });

    it('AND IT LIVES IN A CLIENT-SAFE MODULE, which a ratchet insisted on', () => {
        /*
         *   My first draft put it beside APP_TO_ROLES in module-access-check,
         *   and `the-app-can-still-be-built` refused it: that module imports
         *   cache-invalidation and therefore next/cache, so a CLIENT component
         *   importing a constant from it drags a server-only module into the
         *   browser bundle. #382's ratchet, doing exactly its job on a one-line
         *   import.
         *
         *   role-app-mapping is pure and ModuleSidebar already depends on it for
         *   hasAppAccess, so the constant is reachable without pulling anything
         *   new into the client.
         */
        expect(code('src/lib/role-app-mapping.ts')).toContain('LAND_SELLER_ROLES');
        expect(code(SIDEBAR)).toContain('from "@/lib/role-app-mapping"');

        //   And the old home re-exports it, so nothing that already imported it
        //   from there breaks.
        expect(code('src/lib/module-access-check.ts'))
            .toContain('export { LAND_SELLER_ROLES }');
    });

    it('and the map it must agree with still says all three — the premise', () => {
        /*
         *   The constant is the SELLER SUBSET of Farm Nation's roles. If
         *   APP_TO_ROLES ever stopped naming land_owner, this constant would be
         *   the drift rather than the fix.
         */
        //   Anchored to APP_TO_ROLES: the file has a SECOND "farm-nation" key
        //   above it (the module-name map), and a bare indexOf found that one.
        const src = code('src/lib/module-access-check.ts');
        const table = src.indexOf('APP_TO_ROLES');
        const at = src.indexOf('"farm-nation":', table);

        expect(at).toBeGreaterThan(table);
        expect(src.slice(at, at + 80)).toContain('land_owner');
        expect(src.slice(at, at + 80)).toContain('farmer');
    });

    it('and the platform really does treat land_owner as Farm Nation — the premise', () => {
        //   If this were false the widening would be wrong rather than right.
        for (const rel of [
            'src/lib/module-access-check.ts',
            'src/lib/permissions.ts',
            'src/lib/role-app-mapping.ts',
            'src/lib/schema-normalizer.ts',
        ]) {
            expect({ rel, names: code(rel).includes('land_owner') })
                .toEqual({ rel, names: true });
        }
    });
});
