/**
 * @jest-environment node
 */

/**
 *   #367 THREE lib MODULES HAVE NO IMPORTERS, AND ONE OF THEM WAS A SECOND
 *        MODULE DOMAIN MAP THAT HAD DRIFTED FROM THE ONE THE ROUTER USES.
 *
 *        Found by taking the zero-coverage list seriously rather than reading
 *        it as "components we have not got to yet". Three of the entries are
 *        not components and are not merely untested — nothing imports them:
 *
 *          src/lib/external-domains.ts     32 lines
 *          src/lib/auth-redirect.ts        90 lines
 *          src/lib/paystack-fulfillment.ts 13 lines
 *
 *        THE ONE THAT MATTERED
 *        ---------------------
 *        external-domains.ts wrote out the six federated module domains by
 *        hand. The domain the application actually routes on comes from
 *        HUB_MODULES in src/config/modules.config.ts: middleware.ts builds its
 *        DOMAIN_MAP by reducing over it, and auth.config.ts reads the same
 *        object for cookie scoping. Two of the six disagreed:
 *
 *          marketplace   marketplace.easysalesexport.com  vs  easysalesmarket.com
 *          farmNation    farmnation.ng                    vs  farmnation.easysalesexport.com
 *
 *        Nothing imports the file, so the drift has cost nothing yet. It is
 *        exactly the shape that costs something later: the obvious-looking
 *        module, exporting the obvious-looking constant, holding an answer two
 *        entries different from the live one. EXTERNAL_DOMAINS is derived from
 *        HUB_MODULES now, so the fallback cannot disagree with the router; the
 *        env overrides are kept.
 *
 *        Its six NEXT_PUBLIC_*_URL names appeared in this repository ONLY in
 *        that file. Six environment variables with no reader — RETIRED in #445
 *        by owner decision, so a module domain now has one source.
 *
 *        THE ONE THAT DESCRIBES A FEATURE THAT DOES NOT EXIST
 *        ----------------------------------------------------
 *        auth-redirect.ts builds `/auth/login?module=marketplace` so that
 *        "users see module-specific branding during authentication". Two
 *        independent facts make that absent from the product: nothing calls it,
 *        and NOTHING READS A `module` SEARCH PARAMETER — not the login page,
 *        not the register page, not a layout. Wiring it up would change
 *        nothing until the second half is built.
 *
 *        OWNER DECISION TAKEN (#445): RETIRE. The file is deleted; its absence
 *        and the missing reader half are pinned below.
 *
 *        THE HARMLESS ONE
 *        ----------------
 *        paystack-fulfillment.ts re-exports six payment handlers so that
 *        "existing imports do not break". There are none: every caller now
 *        imports from @/infrastructure/payments/service. Kept and labelled —
 *        it is a third name for the payment handlers in a codebase where "two
 *        doors onto one operation" has been the finding some twenty times.
 *
 *        WHAT #367 LEFT AND #445 SETTLED. #367 deleted nothing and put two
 *        questions to the owner. Both are answered now: auth-redirect.ts is
 *        deleted, and the six env overrides are gone. paystack-fulfillment.ts
 *        stays, labelled — it was never a question.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { EXTERNAL_DOMAINS, getModuleUrl, redirectToModule } from '@/lib/external-domains';
import { HUB_MODULES } from '@/config/modules.config';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();

/**
 * Comment-stripped, as every source sweep in this audit is.
 *
 * AN EQUIVALENT MUTANT, RECORDED RATHER THAN CHASED. Mutation M16 removed the
 * stripping and every test still passed, so on today's text it is not
 * load-bearing: none of the #367 notes added to the three modules happens to
 * contain an import specifier of the form this file searches for
 * (`from "@/lib/…"`), the literal `get("module")`, or one of the six env var
 * names outside the file that is excluded anyway.
 *
 * It stays. The tombstone trap — a sweep matching the write-up of the defect it
 * is checking for — has fired EIGHT times in this audit, including twice in the
 * last two findings, and it fires the moment someone quotes an import line in a
 * comment. A guard that is currently redundant is cheaper than the ninth
 * occurrence.
 */
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'));

function srcFiles(dir = 'src', out: string[] = []): string[] {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) {
            if (e.name === '__tests__' || e.name === 'node_modules') continue;
            srcFiles(rel, out);
        } else if (/\.(ts|tsx)$/.test(e.name) && !e.name.includes('.test.')) out.push(rel);
    }
    return out;
}

const SRC = srcFiles();

/** Files that import a module, by its @/lib/<name> or relative specifier. */
function importersOf(modulePath: string, basename: string): string[] {
    const spec = new RegExp(`from\\s+["'](?:@/lib/${basename}|\\.{1,2}(?:/[\\w.-]+)*/${basename})["']`);
    return SRC.filter((f) => f !== modulePath && spec.test(code(f)));
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#367 — the domain map is derived, so it cannot drift again', () => {
    it('EVERY EXTERNAL DOMAIN MATCHES HUB_MODULES, WHICH IS WHAT THE ROUTER USES', () => {
        const bySlug = Object.fromEntries(
            Object.values(HUB_MODULES).map((m) => [m.slug, `https://${m.domain}`]));

        expect({
            marketplace: EXTERNAL_DOMAINS.marketplace,
            cooperatives: EXTERNAL_DOMAINS.cooperatives,
            academy: EXTERNAL_DOMAINS.academy,
            wave: EXTERNAL_DOMAINS.wave,
            export: EXTERNAL_DOMAINS.export,
            farmNation: EXTERNAL_DOMAINS.farmNation,
        }).toEqual({
            marketplace: bySlug['marketplace'],
            cooperatives: bySlug['cooperatives'],
            academy: bySlug['academy'],
            wave: bySlug['wave'],
            export: bySlug['export'],
            farmNation: bySlug['farm-nation'],
        });
    });

    it('and the two that had drifted now name the routed domain', () => {
        // Stated as literals as well, so the test says WHICH answer is right
        // rather than only that two derivations agree.
        //
        //   #454 THIS PINNED farmnation.easysalesexport.com, AND THE OWNER HAS
        //   SINCE SETTLED IT THE OTHER WAY.
        //
        //   #367 found the two spellings disagreeing and made HUB_MODULES the
        //   source — correctly, because ONE answer beats two. It could not know
        //   which answer, so it kept the one already in the config.
        //
        //   Shown the live deployment, the owner confirmed easysalesmarket.com
        //   (which the config already had) and farmnation.ng (which it did not).
        //   modules.config.ts carries that now, and middleware.ts keeps both
        //   easysalesexport.com spellings as aliases so old links still land.
        expect(EXTERNAL_DOMAINS.marketplace).toBe('https://easysalesmarket.com');
        expect(EXTERNAL_DOMAINS.farmNation).toBe('https://farmnation.ng');
    });

    it('middleware routes on the same object, which is why that is the right answer', () => {
        const mw = code('src/middleware.ts');

        expect(mw).toContain('HUB_MODULES');
        expect(mw).toContain('DOMAIN_MAP');
        expect(code('src/lib/external-domains.ts')).toContain('HUB_MODULES');
    });

    it('getModuleUrl joins a path without inventing a slash', () => {
        expect(getModuleUrl('wave')).toBe('https://waveprogramme.com');
        expect(getModuleUrl('wave', '/apply')).toBe('https://waveprogramme.com/apply');
    });

    it('and a server-side call says what is wrong instead of a bare ReferenceError', () => {
        // `window` was touched unconditionally. In a node environment that is a
        // ReferenceError naming nothing useful.
        expect(() => redirectToModule('wave')).toThrow(/browser navigation/);
    });

    /**
     *   #445 THE SIX ENV OVERRIDES ARE RETIRED — OWNER DECISION.
     *
     *   #367 kept them so a deployment could point a module elsewhere. Nothing
     *   in the repository set them, nothing else read them, and the module that
     *   did has no importers: a second, silent answer to a question HUB_MODULES
     *   already answers. The owner chose to retire them rather than build on
     *   them, so a module's domain has exactly ONE source.
     *
     *   Asserted as absence, so the second source cannot come back quietly.
     */
    it('AN ENV OVERRIDE NO LONGER CHANGES A MODULE DOMAIN', async () => {
        const previous = process.env.NEXT_PUBLIC_WAVE_URL;
        process.env.NEXT_PUBLIC_WAVE_URL = 'https://wave.staging.example';
        jest.resetModules();
        try {
            const fresh = await import('@/lib/external-domains');

            // HUB_MODULES, not the environment.
            expect(fresh.EXTERNAL_DOMAINS.wave).toBe('https://waveprogramme.com');
            expect(fresh.EXTERNAL_DOMAINS.marketplace).toBe('https://easysalesmarket.com');
        } finally {
            if (previous === undefined) delete process.env.NEXT_PUBLIC_WAVE_URL;
            else process.env.NEXT_PUBLIC_WAVE_URL = previous;
            jest.resetModules();
        }
    });

    it('and the six names appear NOWHERE in src/', () => {
        const NAMES = [
            'NEXT_PUBLIC_MARKETPLACE_URL', 'NEXT_PUBLIC_COOPERATIVES_URL',
            'NEXT_PUBLIC_ACADEMY_URL', 'NEXT_PUBLIC_WAVE_URL',
            'NEXT_PUBLIC_EXPORT_URL', 'NEXT_PUBLIC_FARM_NATION_URL',
        ];

        for (const name of NAMES) {
            const readers = SRC.filter((f) => code(f).includes(name));
            expect({ name, readers }).toEqual({ name, readers: [] });
        }
    });

    it('and every module domain resolves from HUB_MODULES alone', () => {
        // The vacuity guard on the two tests above: they would both pass on an
        // EXTERNAL_DOMAINS that had stopped resolving anything at all.
        for (const [key, url] of Object.entries(EXTERNAL_DOMAINS)) {
            expect({ key, ok: /^https:\/\/[a-z0-9.-]+$/.test(url) }).toEqual({ key, ok: true });
        }
        expect(Object.keys(EXTERNAL_DOMAINS)).toHaveLength(6);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 *   #445 auth-redirect.ts IS DELETED — OWNER DECISION.
 *
 *   #367 measured it and put the choice to the owner: build module-branded auth,
 *   or retire the helper. The answer was retire.
 *
 *   It described a feature in two halves and only ever had one. It built
 *   `/auth/login?module=marketplace` "so users see module-specific branding
 *   during authentication"; nothing called it, and NOTHING READ a `module`
 *   search parameter — not the login page, not the register page, not a layout.
 *   Wiring it up would have changed nothing until the missing half was built.
 *   Generic branding on login is normal and nobody has missed it.
 *
 *   Pinned as absence in both directions, because dead code that reads like a
 *   working feature is how the next person loses an afternoon.
 */
describe('#445 — module-branded auth is retired, not half-built', () => {
    it('THE HELPER IS GONE', () => {
        expect(existsSync(join(ROOT, 'src/lib/auth-redirect.ts'))).toBe(false);
    });

    it('and nothing in src/ names it', () => {
        const mentions = SRC.filter((f) => /auth-redirect|getModuleAuthUrl|getRegisterUrl/.test(code(f)));
        expect(mentions).toEqual([]);
    });

    it('and NOTHING READS A `module` PARAMETER — the half that was never built', () => {
        // The independent reason the feature was absent. Recorded so that
        // rebuilding it starts from the right end: the reader first.
        const readers = SRC.filter((f) => /get\(\s*["']module["']\s*\)/.test(code(f)));

        expect(readers).toEqual([]);
    });

    it('and middleware still builds the login redirect it always did', () => {
        // The redirect a signed-out visitor actually gets. Unchanged by the
        // deletion, which is the point: nothing depended on the helper.
        const mw = code('src/middleware.ts');

        expect(mw).toContain('loginUrl.searchParams.set("callbackUrl"');
        expect(mw).not.toContain('getLoginUrl');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#367 — the compatibility layer has nothing to be compatible with', () => {
    it('nothing imports paystack-fulfillment', () => {
        expect(importersOf('src/lib/paystack-fulfillment.ts', 'paystack-fulfillment')).toEqual([]);
    });

    it('while the service it re-exports has real callers', () => {
        // Vacuity guard: the handlers are live; only this alias is not.
        const callers = SRC.filter((f) => code(f).includes('@/infrastructure/payments/service'));

        expect(callers.length).toBeGreaterThan(1);
    });

    it('the alias itself is one of those callers, and that is the point', () => {
        // It re-exports FROM the service, in code. So it appears in that list
        // legitimately — a fact worth stating, because it is why the count
        // above is `> 1` rather than an exact membership test.
        const callers = SRC.filter((f) => code(f).includes('@/infrastructure/payments/service'));

        expect(callers).toContain('src/lib/paystack-fulfillment.ts');
        expect(callers.filter((f) => f !== 'src/lib/paystack-fulfillment.ts').length)
            .toBeGreaterThan(0);
    });

    it('and it still re-exports every handler, so an outside import keeps working', () => {
        const src = code('src/lib/paystack-fulfillment.ts');

        for (const handler of [
            'processMarketplaceOrder', 'processExportInvestment',
            'processCooperativeRegistration', 'processAcademyRegistration',
            'processFarmNationRegistration', 'processWaveRegistration',
        ]) {
            expect({ handler, present: src.includes(handler) }).toEqual({ handler, present: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#367 — the importer sweep is not vacuous', () => {
    it('finds the source files', () => {
        expect(SRC.length).toBeGreaterThan(400);
    });

    it('and reports importers where they exist', () => {
        // If importersOf always returned [], the three claims above would pass
        // for the wrong reason.
        expect(importersOf('src/lib/admin-permissions.ts', 'admin-permissions').length)
            .toBeGreaterThan(20);
        expect(importersOf('src/lib/hub-guard.ts', 'hub-guard').length).toBe(16);
    });
});
