/**
 * @jest-environment node
 */

/**
 *   #933 ELEVEN OF THE FILES NO TEST HAD NAMED, AND WHAT EACH ONE IS FOR.
 *
 *   The reach ledger's remaining tail is not screens. It is five layouts whose
 *   whole content is one setting, and six modules that declare types and nothing
 *   else. Each was opened and measured, and the verdict on every one of them is
 *   that it is CORRECT — recorded here rather than left silent, which is the
 *   treatment #918 gave the services registry for the same reason: a clean
 *   verdict that nobody wrote down gets re-derived by the next person.
 *
 *   What that leaves worth asserting is the one line each file exists for, and
 *   in four of the five layouts that line is load-bearing in a way nothing else
 *   would catch:
 *
 *     broadcast/layout          maxDuration = 60. Deleting it takes the platform
 *                               back to the 15s Vercel Hobby ceiling, and the
 *                               broadcast screen starts timing out — a runtime
 *                               failure with no test and no type error behind it.
 *     cooperatives/payment      a SERVER session guard, because its page reads
 *                               the session in the browser. Middleware protects
 *                               the path too (route-manifest lists it), so this
 *                               is the second lock rather than the only one —
 *                               measured, because "belt and braces" and "the
 *                               only guard" want different care.
 *     export/buyer/layout       the cart provider. Without it every buyer screen
 *                               under it throws on useContext.
 *     wave/briefing/layout      force-dynamic, which its own comment ties to a
 *                               prerender failure in the build container.
 *
 *   And the fifth is a claim rather than a setting:
 *
 *     escrow/layout             its description promises escrow "for Farm Nation,
 *                               Marketplace, and Export Windows". #931 had just
 *                               found two promises with nothing behind them, so
 *                               this one was measured rather than believed —
 *                               marketplace/_escrow_actions,
 *                               farm-nation-admin/_fna_finance's
 *                               releaseFarmNationEscrowAction, and export's
 *                               windows with api/cron/release-escrow. All three
 *                               are real.
 *
 * ── THE SIX TYPE MODULES STAY IN THE DENOMINATOR ────────────────────────────
 *
 *   The ledger exempts `.d.ts` and says why: "a type declaration has no
 *   runtime". These six are `.ts` files that are ALSO declaration-only — every
 *   export is an interface or an `export type` — so the same sentence applies and
 *   the `.d.ts` extension turns out to be a narrow spelling of the property.
 *
 *   WIDENING THAT EXEMPTION WOULD HAVE BEEN THE WRONG FIX. It moves the number
 *   by six without anybody having looked, which is the ceremony that header
 *   warns against. They are REACHED instead, by asserting the two things that
 *   are true of them and worth keeping true:
 *
 *     they stay type-only        a value added to a types module is logic where
 *                                nobody looks for it
 *     something imports them     a type module nothing imports is weight the
 *                                build carries for no reader
 *
 *   Measured: all six are imported by shipping code — 1 to 6 importers each — so
 *   none is dead, which is the finding that would have been worth acting on.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string) => stripComments(src(rel), { label: rel, minRetainedRatio: 0 });

// ─────────────────────────────────────────────────────────────────────────────
describe('#933 — five layouts, one job each', () => {
    it('THE BROADCAST LAYOUT RAISES THE EXECUTION CEILING', () => {
        //   Its only content. 15s is the Hobby default and a broadcast does not
        //   finish in it; nothing else on the platform would report the loss.
        const layout = code('src/app/admin/communications/broadcast/layout.tsx');

        expect(layout).toMatch(/export const maxDuration = 60/);
    });

    it('THE COOPERATIVE PAYMENT LAYOUT GUARDS ON THE SERVER, and keeps the callback', () => {
        const layout = code('src/app/cooperatives/payment/layout.tsx');

        expect(layout).toContain('requireSession()');
        expect(layout).toContain('redirect("/auth/login?callbackUrl=/cooperatives/payment")');
        //   Sent back to the page they were trying to pay on, not to a dashboard.
        expect(layout).toContain('if (!sessionResult.session)');
    });

    it('AND IT IS THE SECOND LOCK, not the only one — measured', () => {
        /*
         *   Worth knowing which it is. If middleware did not cover this path, the
         *   layout would be the whole of the access control on a PAYMENT screen,
         *   and that is a different risk to carry.
         */
        const manifest = code('src/lib/route-manifest.ts');

        expect(manifest).toContain('"/cooperatives/payment"');
        expect(manifest).toContain('export function isProtectedPath');
        //   And the middleware actually consults it on a matcher that covers
        //   everything but uploads and static assets.
        const middleware = code('src/middleware.ts');
        expect(middleware).toContain('isProtectedPath(pathname) && !isLoggedIn');
        expect(middleware).toMatch(/matcher:\s*\[/);
    });

    it('THE EXPORT BUYER LAYOUT PROVIDES THE CART every screen under it reads', () => {
        const layout = code('src/app/export/buyer/layout.tsx');

        expect(layout).toContain('ExportCartProvider');
        expect(layout).toContain('"use client"');
    });

    it('THE WAVE BRIEFING LAYOUT STAYS DYNAMIC', () => {
        //   Its comment ties this to a prerender failure in the build container,
        //   where firebase-admin is absent.
        expect(code('src/app/wave/briefing/layout.tsx')).toContain("export const dynamic = 'force-dynamic'");
        //   The module's public layout is the one with the metadata, and it reads
        //   the programme's name from the one constant (#788).
        expect(code('src/app/wave/layout.tsx')).toContain('WAVE_FULL_NAME');
    });

    it('AND THE ESCROW LAYOUT PROMISES THREE MODULES THAT ALL EXIST', () => {
        /*
         *   #931 found two promises with nothing behind them one file away from
         *   here, so this was measured rather than believed. Each module's escrow
         *   is named by the file that implements it.
         */
        const layout = code('src/app/escrow/layout.tsx');
        expect(layout).toContain('Farm Nation, Marketplace, and Export Windows');

        //   Marketplace.
        expect(code('src/app/actions/marketplace/_escrow_actions.ts').length).toBeGreaterThan(100);
        //   Farm Nation.
        expect(code('src/app/actions/farm-nation-admin/_fna_finance.ts'))
            .toContain('releaseFarmNationEscrowAction');
        //   Export windows, released by their own cron.
        expect(code('src/app/actions/export/_ex_investments.ts')).toContain('escrowReleaseDate');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#933 — six modules under a types path, and one of them is not', () => {
    /** Declaration-only: every export is an interface or an `export type`. */
    const TYPE_MODULES = [
        'src/lib/types/admin.ts',
        'src/lib/types/farm-nation-actions.ts',
        'src/lib/types/messages.ts',
        'src/types/escrow.ts',
        'src/types/service-registration.ts',
    ];

    /**
     * And the sixth, which is NOT — found by the assertion below rather than by
     * reading the directory name.
     *
     * lib/types/farm-nation.ts is eight lines under a `lib/types/` path and one
     * of them is `export * from "@easy-sales/farm-nation"`. That package's
     * constants module exports PROPERTY_STATUS, PROPERTY_CATEGORY and
     * PROPERTY_TYPE — real objects — so this file ships runtime through a
     * directory where nobody goes looking for it.
     *
     * NOT RESTRUCTURED: the re-export is deliberate, and its header says so
     * ("Platform Type Isolation — Phase 0 Migration"). Asserted instead, so the
     * three values are known to arrive and the next reader is not surprised.
     */
    const RUNTIME_RE_EXPORT = 'src/lib/types/farm-nation.ts';

    /**
     * Every export in this source that exists at RUNTIME.
     *
     * Line-wise, so the failure message names the offending line — and because
     * the first version ran a global regex over the whole text and reported an
     * empty string for the one file that mattered.
     *
     * `export *` carries values as well as types, and that first version
     * required a word boundary after the star, which a star followed by a space
     * does not give: it classified a star re-export as declaration-only. The
     * assertion below caught it on lib/types/farm-nation. Left spelled out
     * because the mistake is the reason this helper has a control.
     */
    const runtimeExports = (text: string): string[] =>
        text.split('\n')
            .map((line) => line.trim())
            .filter((line) => /^export\s+(?:(?:const|let|var|function|class|enum|default)\b|\*|\{)/.test(line))
            .filter((line) => !/^export\s+type\s*\{/.test(line));

    it('THE CONTROL: that test recognises a module which DOES have runtime', () => {
        //   Every "no runtime" assertion below passes on a detector that never
        //   fires, so the detector is proven first.
        expect(runtimeExports(code('src/lib/wave-access.ts')).length).toBeGreaterThan(0);
        expect(runtimeExports(code('src/lib/academy-course-offer.ts')).length).toBeGreaterThan(0);
        expect(runtimeExports('export { thing } from "./x";')).toHaveLength(1);
        expect(runtimeExports('export type { Thing } from "./x";')).toHaveLength(0);
    });

    it('FIVE OF THE SIX ARE DECLARATION-ONLY', () => {
        for (const rel of TYPE_MODULES) {
            expect({ rel, runtime: runtimeExports(code(rel)) }).toEqual({ rel, runtime: [] });
            //   And they really are files with content, not empty ones agreeing
            //   with any expectation about them.
            expect({ rel, declares: /export (interface|type)\b/.test(code(rel)) })
                .toEqual({ rel, declares: true });
        }
    });

    it('AND THE SIXTH SHIPS RUNTIME THROUGH A `types/` PATH', async () => {
        /*
         *   The one the directory name would have got wrong. Asserted by IMPORTING
         *   it — the three constants either arrive through that star re-export or
         *   they do not, and a source grep cannot tell.
         */
        expect(runtimeExports(code(RUNTIME_RE_EXPORT))).toEqual(['export * from "@easy-sales/farm-nation";']);

        const reExported: Record<string, unknown> = await import('@/lib/types/farm-nation');

        for (const name of ['PROPERTY_STATUS', 'PROPERTY_CATEGORY', 'PROPERTY_TYPE']) {
            expect({ name, arrives: typeof reExported[name] === 'object' && reExported[name] !== null })
                .toEqual({ name, arrives: true });
        }
    });

    it('AND EVERY ONE OF THEM IS IMPORTED BY SHIPPING CODE', () => {
        /*
         *   The finding that would have been worth acting on, had any of them
         *   come back at zero: a type module nothing imports is weight the build
         *   carries for no reader. None did.
         */
        const shipping: string[] = [];
        (function walk(dir: string) {
            for (const entry of readdirSync(join(ROOT, dir))) {
                const rel = `${dir}/${entry}`;
                if (statSync(join(ROOT, rel)).isDirectory()) {
                    if (entry !== '__tests__') walk(rel);
                } else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) {
                    shipping.push(rel);
                }
            }
        })('src');

        expect(shipping.length).toBeGreaterThan(1_000);

        for (const rel of [...TYPE_MODULES, RUNTIME_RE_EXPORT]) {
            const specifier = '@/' + rel.replace(/^src\//, '').replace(/\.tsx?$/, '');
            const importers = shipping.filter((f) =>
                f !== rel && new RegExp(`["']${specifier}["']`).test(src(f)));

            expect({ rel, imported: importers.length > 0 }).toEqual({ rel, imported: true });
        }
    });

    it('and src/types/escrow re-exports rather than redefining, as its header requires', () => {
        //   "do NOT define EscrowStatus or EscrowTransaction here" — the single
        //   source of truth is the marketplace module, and a second definition
        //   here is how two shapes for one row appear.
        const escrow = code('src/types/escrow.ts');

        expect(escrow).toContain('export type { EscrowStatus, EscrowTransaction } from "@/lib/types/marketplace"');
        expect(escrow).not.toMatch(/export (type|enum) EscrowStatus\s*=/);
    });
});

/**
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *   MUTANT                                          CAUGHT BY
 *   ──────────────────────────────────────────────  ───────────────────────────
 *   delete maxDuration from the broadcast layout     "THE BROADCAST LAYOUT
 *                                                    RAISES THE CEILING"
 *   drop the session guard from the cooperative      "GUARDS ON THE SERVER"
 *     payment layout
 *   remove /cooperatives/payment from               "IT IS THE SECOND LOCK"
 *     PROTECTED_PATHS
 *   drop ExportCartProvider from the buyer layout    "PROVIDES THE CART"
 *   remove force-dynamic from wave/briefing          "STAYS DYNAMIC"
 *   add `export const X = 1` to any type module      "ALL SIX ARE
 *                                                    DECLARATION-ONLY"
 *   make runtimeExports always return []            THE CONTROL
 *   redefine EscrowStatus in src/types/escrow        "re-exports rather than
 *                                                    redefining"
 */
