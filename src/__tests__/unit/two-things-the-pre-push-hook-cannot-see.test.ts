/**
 * @jest-environment node
 */

/**
 *   #910 TWO FAILURES CI FOUND THAT THE PRE-PUSH HOOK CANNOT, BOTH MINE.
 *
 *   Commits d5d779ec and df233574 were pushed on a green pre-push run — the
 *   whole unit suite, tsc and eslint — and CI failed both. Neither failure was a
 *   flake and neither was reachable from the hook. Recorded here as ratchets
 *   because the next instance is somebody repeating exactly what I did.
 *
 * ── 1. A PAGE MODULE MAY EXPORT ONLY WHAT NEXT ALLOWS ───────────────────────
 *
 *   #901 and #908 each retired a screen to a redirect and each put the
 *   destination in an exported const:
 *
 *       export const LAND_LISTING_FORM = "/farm-nation/list-land";
 *       export const MARKETPLACE_PAYMENT_CALLBACK = "/marketplace/payment/callback";
 *
 *   Next generates a type file per route under `.next/types` that constrains a
 *   page module's exports to the names it allows and everything else to `never`:
 *
 *       Property 'LAND_LISTING_FORM' is incompatible with index signature.
 *         Type '"/farm-nation/list-land"' is not assignable to type 'never'.
 *
 *   `tsc --noEmit` cannot see it, because those files exist only after a
 *   `next build`. The suite that does — maintenance-scripts-are-inside-the-gates
 *   — typechecks the whole program including them, and in CI it caught the first
 *   one. The second had not reached CI yet and would have failed the next run.
 *
 * ── 2. A POSITIONAL LOCATOR BREAKS WHEN A FIELD IS ADDED ────────────────────
 *
 *   #901 added Soil type and Water source to the land listing form, in the
 *   Description section — ABOVE Location. Two e2e specs addressed the state
 *   dropdown as `page.locator('select').first()`, so `.first()` became the soil
 *   dropdown:
 *
 *       platform-flows      selectOption('Kano') threw — no such option
 *       verify-screenshots  the same call is `.catch`ed, so it silently chose no
 *                           state and photographed a form nobody had filled in
 *
 *   afa38593 already met this trap on the marketplace buyer journey and amended
 *   its own note to say a positional locator "breaks the next time anybody adds
 *   OR REMOVES a field". The lesson was written down and had not reached these
 *   two specs. Both address the label now, which is what the LGA beside them was
 *   already doing.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ledgerVerdict, LEDGER_HELD } from '@/lib/testing/ledger';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();

/**
 * The names Next permits a route module to export.
 *
 * Taken from Next's own generated checks rather than invented: the route-segment
 * config keys, the metadata pair, the params generator, and the HTTP verbs a
 * route handler exports.
 */
const ALLOWED_ROUTE_EXPORTS = new Set([
    'default',
    'metadata', 'generateMetadata', 'viewport', 'generateViewport',
    'dynamic', 'dynamicParams', 'revalidate', 'fetchCache', 'runtime',
    'preferredRegion', 'maxDuration', 'experimental_ppr', 'config',
    'generateStaticParams',
    'alt', 'size', 'contentType',
    'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
]);

const IS_ROUTE_FILE =
    /^(page|layout|route|template|default|error|loading|not-found|global-error)\.tsx?$/;

function routeFiles(dir = join(ROOT, 'src/app'), out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) routeFiles(full, out);
        else if (IS_ROUTE_FILE.test(entry)) out.push(full);
    }
    return out;
}

describe('a route module exports only what Next allows', () => {
    const files = routeFiles();

    it('THE SWEEP FINDS THE ROUTE FILES (control)', () => {
        //   THE control on a "nothing offends" assertion.
        expect(files.length).toBeGreaterThan(200);
        expect(files.map((f) => relative(ROOT, f))).toContain('src/app/land/submit/page.tsx');
        expect(files.map((f) => relative(ROOT, f))).toContain('src/app/marketplace/success/page.tsx');
    });

    it('AND NONE OF THEM EXPORTS ANYTHING ELSE', () => {
        /*
         *   THE ratchet. This is the failure the pre-push hook cannot see, so it
         *   has to be a unit test or it is nothing.
         */
        const offenders: string[] = [];

        for (const file of files) {
            const src = readFileSync(file, 'utf8');
            const names = [...src.matchAll(
                /^export\s+(?:async\s+)?(?:const|function|class|let|var)\s+([A-Za-z0-9_]+)/gm,
            )].map((m) => m[1]);

            for (const name of names) {
                if (!ALLOWED_ROUTE_EXPORTS.has(name)) {
                    offenders.push(`${relative(ROOT, file)} exports ${name}`);
                }
            }
        }

        expect(offenders).toEqual([]);
    });

    it('AND THE SWEEP WOULD CATCH IT — the canary on its own fault', () => {
        //   A ratchet that cannot fail is not one. `export const dynamic` is
        //   allowed and `export const LAND_LISTING_FORM` is not, and the rule
        //   must tell them apart.
        expect(ALLOWED_ROUTE_EXPORTS.has('dynamic')).toBe(true);
        expect(ALLOWED_ROUTE_EXPORTS.has('generateMetadata')).toBe(true);
        expect(ALLOWED_ROUTE_EXPORTS.has('LAND_LISTING_FORM')).toBe(false);
        expect(ALLOWED_ROUTE_EXPORTS.has('MARKETPLACE_PAYMENT_CALLBACK')).toBe(false);
    });

    it('AND THE TWO REDIRECTS STILL KNOW WHERE THEY GO', () => {
        //   The vacuity guard: deleting the consts would satisfy the ratchet and
        //   break both redirects.
        const submit = readFileSync(join(ROOT, 'src/app/land/submit/page.tsx'), 'utf8');
        const success = readFileSync(join(ROOT, 'src/app/marketplace/success/page.tsx'), 'utf8');

        expect(submit).toContain('const LAND_LISTING_FORM = "/farm-nation/list-land"');
        expect(submit).toContain('redirect(LAND_LISTING_FORM)');
        expect(success).toContain('const MARKETPLACE_PAYMENT_CALLBACK = "/marketplace/payment/callback"');
        expect(success).toContain('redirect(');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('positional select locators in the e2e specs', () => {
    function specs(dir = join(ROOT, 'e2e'), out: string[] = []): string[] {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) specs(full, out);
            else if (/\.spec\.ts$/.test(entry)) out.push(full);
        }
        return out;
    }

    /** `page.locator('select').first()` / `.last()` — the shape that broke. */
    const POSITIONAL = /locator\(\s*['"]select['"]\s*\)\s*\.\s*(?:first|last|nth)\s*\(/g;

    /*
     *   COMMENTS STRIPPED, and the first version did not — it counted THREE,
     *   because the note I wrote in platform-flows quotes the very expression it
     *   is explaining. That is the trap this repo already records for every
     *   "this spelling is gone" assertion: without stripComments the explanation
     *   satisfies the pattern. Caught by the ledger refusing 3 against 2.
     */
    const found = specs().flatMap((file) => {
        const src = stripComments(readFileSync(file, 'utf8'), { label: relative(ROOT, file) });
        return [...src.matchAll(POSITIONAL)].map(() => relative(ROOT, file));
    });

    it('THE SWEEP FINDS THEM (control)', () => {
        expect(specs().length).toBeGreaterThan(3);
        //   And the pattern matches the shape it is about.
        expect("page.locator('select').first().selectOption('Lagos')").toMatch(POSITIONAL);
    });

    it('THE LEDGER — two remain, on a form this change did not touch', () => {
        /*
         *   This may only go DOWN.
         *
         *   Both are in marketplace-critical-flows, on the checkout shipping
         *   form: `select.first()` for the state and `.last()` for the LGA. They
         *   PASS today, because nothing in this work changed that form.
         *
         *   DELIBERATELY NOT FIXED HERE, and that is a judgement rather than an
         *   oversight: the e2e stack binds a port this environment is not to
         *   use, so I cannot run those specs, and rewriting a passing e2e locator
         *   blind is how a green suite becomes a red one. They are recorded
         *   instead, so the next person who adds a field to marketplace checkout
         *   finds this note rather than the failure.
         *
         *   The two on the land listing form ARE fixed — they broke, so the fix
         *   is verified by the thing that broke.
         */
        expect(ledgerVerdict(found.length, 2)).toBe(LEDGER_HELD);
    });

    it('AND NEITHER LAND-LISTING SPEC USES ONE ANY MORE', () => {
        for (const rel of ['e2e/platform-flows.spec.ts', 'e2e/verify-screenshots.spec.ts']) {
            const src = readFileSync(join(ROOT, rel), 'utf8');

            //   The code, not the note explaining why it is gone — see above.
            const code = stripComments(src, { label: rel });
            expect({ rel, positional: new RegExp(POSITIONAL.source).test(code) })
                .toEqual({ rel, positional: false });

            //   And they address the state by its label, as the LGA already did.
            expect({ rel, byLabel: src.includes('label:has-text("State")') })
                .toEqual({ rel, byLabel: true });
        }
    });
});
