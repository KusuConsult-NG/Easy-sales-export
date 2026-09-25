/**
 * @jest-environment node
 */

/**
 *   #913 EIGHT ACTION BARRELS, AND TWO OF THEM HAD A TEST.
 *
 *   src/app/actions/ holds eight domain folders, each a barrel over private
 *   `_`-prefixed files, each header claiming some version of the same three
 *   things:
 *
 *       "Single import point for ALL WAVE server actions"
 *       "The underscore-prefixed files … should never be imported directly"
 *       (and, in the two tested ones) every domain file carries "use server"
 *
 *   admin-barrel-parity and cooperative-barrel-parity check those claims — for
 *   admin and cooperative. The other six had nothing, and the claims are worth
 *   checking precisely because of what admin-barrel-parity's own header says:
 *
 *       "The one thing a move like this can silently lose is an export. A dropped
 *        action does not fail the type-checker at the barrel — it fails at
 *        whichever page imports it, which may be a page no test renders."
 *
 *   Both of those tests are a LIST: admin's is "admin.ts's exports at 3864c026",
 *   39 names typed into the file. A list records what was known at the moment it
 *   was written, which is the argument the-files-no-test-had-named makes about
 *   its denominator and #436 made before it. This is the sweep: it derives the
 *   domains from the filesystem and the actions from the sources, so a ninth
 *   domain is covered the day it is created.
 *
 * ── WHAT IT FOUND: NOTHING, AND THAT IS THE RESULT ──────────────────────────
 *
 *   All eight barrels are complete and every action-exporting domain file
 *   carries the directive. ONE file reaches past a barrel into another domain's
 *   private module — and it is right to: export/_ex_onboarding delegates its
 *   weaker approval endpoint to admin/_exports so the authorisation rule has one
 *   implementation, through a dynamic import tsc still type-checks. It is pinned
 *   as itself rather than fixed; see the note at that assertion.
 *
 *   So this test is coverage and a guard, not a defect fix, and saying otherwise
 *   would be the "reported a finding where there was none" failure this audit has
 *   tried hard to avoid. My bash version of the same sweep MISSED that one
 *   instance, which is the third false start below and the reason the check that
 *   ships is the one written in the test.
 *
 * ── TWO FALSE STARTS, BOTH MINE, BOTH THE SAME MISTAKE ──────────────────────
 *
 *   Worth writing down because each produced a confident wrong answer, and both
 *   are the lesson lib/data-export-record already records: A SWEEP IS ONLY AS
 *   WIDE AS ITS WALK.
 *
 *   1. The first completeness sweep looked for each action's NAME in the barrel
 *      text. It reported marketplace as 50 missing out of 50 — a whole domain
 *      apparently broken. marketplace re-exports through seventeen
 *      `export * from "./_mp_catalog"` lines and names nothing, so the sweep was
 *      blind to the one form it uses. 100% is not a finding, it is a bug in the
 *      instrument, and the size of the number is what gave it away.
 *
 *   2. The first directive check was `head -5 | grep "use server"`. It reported
 *      marketplace/_quote_offers.ts as missing the directive — which would make
 *      two price-moving endpoints not server actions at all. The directive is on
 *      line 15, under a thirteen-line comment explaining why the file exists.
 *      A prologue directive may follow comments; it may not follow a statement.
 *      The check below strips comments and looks at the first STATEMENT, which
 *      is the actual rule.
 *
 *   3. The privacy sweep, written in bash, reported zero instances. The version
 *      in this file found one on its first run. The bash one parsed the domain
 *      out of the matched specifier with `cut -d/ -f4` and compared it against a
 *      `case` on the file path — and got the comparison wrong for a file that is
 *      itself under src/app/actions, which is precisely the only place the
 *      interesting instances live. A sweep that cannot see the directory it
 *      cares most about reports a clean result, and a clean result is the
 *      hardest kind to doubt.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import { ledgerVerdict, LEDGER_HELD } from '@/lib/testing/ledger';

const ROOT = process.cwd();
const ACTIONS = join(ROOT, 'src/app/actions');

/** Every folder under actions/ that has a barrel. Derived, never listed. */
function domains(): string[] {
    return readdirSync(ACTIONS)
        .filter((entry) => {
            const full = join(ACTIONS, entry);
            return statSync(full).isDirectory() && existsSync(join(full, 'index.ts'));
        })
        .sort();
}

/** A domain's private sub-files — everything but the barrel. */
function subFiles(domain: string): string[] {
    return readdirSync(join(ACTIONS, domain))
        .filter((f) => f !== 'index.ts' && /\.tsx?$/.test(f))
        .sort();
}

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

interface Exported { domain: string; file: string; name: string }

/** Every `export const somethingAction` in every domain sub-file. */
function exportedActions(): Exported[] {
    const out: Exported[] = [];
    for (const domain of domains()) {
        for (const file of subFiles(domain)) {
            const src = read(`src/app/actions/${domain}/${file}`);
            for (const m of src.matchAll(/export\s+const\s+([A-Za-z0-9_]+Action)\b/g)) {
                out.push({ domain, file, name: m[1] });
            }
        }
    }
    return out;
}

/**
 * Whether a barrel re-exports `name` from `file` — BY EITHER FORM.
 *
 * The named form (`export { xAction } from "./_y"`, or a name in a long list) and
 * the star form (`export * from "./_y"`). Seven domains use the first and
 * marketplace uses the second; a check that knows only one of them is false
 * start 1 above.
 */
function barrelCovers(barrel: string, name: string, file: string): boolean {
    if (new RegExp(`\\b${name}\\b`).test(barrel)) return true;

    const base = file.replace(/\.tsx?$/, '');
    const stars = [...barrel.matchAll(/export\s+\*\s+from\s+["']\.\/([A-Za-z0-9_.-]+)["']/g)]
        .map((m) => m[1].replace(/\.js$/, ''));

    return stars.includes(base);
}

/** The first statement of a module, comments gone. */
function firstStatement(rel: string): string {
    const code = stripComments(read(rel), { label: rel });
    return code.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
}

let cachedActions: Exported[] | null = null;
const actions = () => (cachedActions ??= exportedActions());

describe('#913 — the sweep is reading the action surface', () => {
    it('THE CONTROL: it finds every domain and a realistic number of actions', () => {
        //   First, because each assertion below is "no offenders in this list"
        //   and an empty list satisfies all of them. Both false starts in the
        //   header produced a WRONG list rather than an empty one, which is the
        //   other reason to state the expected size out loud.
        const found = domains();

        expect(found.length).toBeGreaterThanOrEqual(8);
        expect(found).toContain('marketplace');
        expect(found).toContain('wave');
        expect(found).toContain('farm-nation');
        expect(found).toContain('farm-nation-admin');

        expect(actions().length).toBeGreaterThan(180);
    });

    it('and every domain has sub-files for the barrel to cover', () => {
        for (const domain of domains()) {
            expect(subFiles(domain).length).toBeGreaterThan(0);
        }
    });
});

describe('#913 — every barrel exports every action its domain defines', () => {
    it('THE LEDGER — actions unreachable from their own barrel', () => {
        const missing = actions().filter(({ domain, name, file }) =>
            !barrelCovers(read(`src/app/actions/${domain}/index.ts`), name, file));

        expect(
            missing.length === 0
                ? LEDGER_HELD
                : `${ledgerVerdict(missing.length, 0)} — `
                  + missing.map((m) => `${m.domain}/${m.file}:${m.name}`).join(', '),
        ).toBe(LEDGER_HELD);
    });

    it('POSITIVE CONTROL: the matcher finds an action a barrel does not export', () => {
        //   Without this the ledger reads zero whether or not the check works —
        //   and false start 1 was the opposite failure, a matcher that saw a gap
        //   everywhere. Both directions are asserted.
        const realBarrel = read('src/app/actions/wave/index.ts');

        expect(barrelCovers(realBarrel, 'noSuchInventedAction', '_nope.ts')).toBe(false);
        expect(barrelCovers('export * from "./_mine";', 'anyAction', '_mine.ts')).toBe(true);
        expect(barrelCovers('export { anyAction } from "./_mine";', 'anyAction', '_other.ts')).toBe(true);
        expect(barrelCovers('export * from "./_elsewhere";', 'anyAction', '_mine.ts')).toBe(false);
    });

    it('and it handles the star form marketplace actually uses', () => {
        //   Named explicitly, because this is the case that produced a confident
        //   "a whole domain is broken".
        const marketplace = read('src/app/actions/marketplace/index.ts');
        const theirs = actions().filter((a) => a.domain === 'marketplace');

        expect(theirs.length).toBeGreaterThan(40);
        expect(marketplace).toContain('export * from "./_mp_catalog"');
        //   It names almost none of them, and covers all of them.
        expect(theirs.filter((a) => new RegExp(`\\b${a.name}\\b`).test(marketplace)).length)
            .toBeLessThan(theirs.length);
        expect(theirs.every((a) => barrelCovers(marketplace, a.name, a.file))).toBe(true);
    });
});

describe('#913 — the privacy rule the barrels state about themselves', () => {
    /**
     * "The underscore-prefixed files … are private to this domain and should
     * never be imported directly." Checkable, and checked: an import that
     * bypasses the barrel is how a domain boundary stops meaning anything, and
     * it is also how a caller ends up holding a module the barrel has since
     * reorganised.
     */
    function walk(dir: string, out: string[] = []): string[] {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                if (entry !== 'node_modules') walk(full, out);
            } else if (/\.tsx?$/.test(full)) {
                out.push(full);
            }
        }
        return out;
    }

    function violations(): string[] {
        const out: string[] = [];
        for (const file of walk(join(ROOT, 'src'))) {
            const rel = relative(ROOT, file);
            if (/__tests__|\.test\./.test(rel)) continue;

            const code = stripComments(readFileSync(file, 'utf8'), { label: rel });
            for (const m of code.matchAll(/["']@\/app\/actions\/([a-z-]+)\/(_[A-Za-z0-9_]+)["']/g)) {
                const [, domain, sub] = m;
                //   A file inside the domain may of course import its siblings.
                if (rel.startsWith(`src/app/actions/${domain}/`)) continue;
                out.push(`${rel} -> @/app/actions/${domain}/${sub}`);
            }
        }
        return out;
    }

    it('THE LEDGER — imports that reach past a barrel into a private file', () => {
        const found = violations();

        //   ONE, AND IT IS NOT A VIOLATION. Recorded at 1 rather than 0 because
        //   the single instance is deliberate and explained at its line, and a
        //   ceiling of 0 would have had me "fix" it — see the note below.
        expect(found.length === 1 ? LEDGER_HELD : `${ledgerVerdict(found.length, 1)} — ${found.join('; ')}`)
            .toBe(LEDGER_HELD);
    });

    it('AND THE ONE IS THE DELEGATION, not a shortcut', () => {
        /*
         *   export/_ex_onboarding.ts reaches into admin/_exports.ts, and it
         *   should.
         *
         *   The platform has TWO export-approval endpoints over one collection.
         *   The weaker one — this file's — does not re-decide who may approve;
         *   it checks that the caller is signed in and then delegates:
         *
         *       const { approveExportOnboardingAction } =
         *           await import("@/app/actions/admin/_exports");
         *
         *   with the reason written above it: "the AUTHORISATION decision — which
         *   roles may approve — belongs to the canonical implementation alone, so
         *   there is still only one answer to it."
         *
         *   THAT IS THE OPPOSITE of the defect this ledger is for. The rule the
         *   barrels state exists so a caller does not hold a module the barrel
         *   may reorganise; here the specifier is inside `await import(...)`,
         *   which tsc type-checks, so a rename or a split fails the typechecker
         *   rather than production. `approveExportOnboardingAction` is on the
         *   admin barrel too (index.ts line 113), so this could import the
         *   barrel — but that means dynamically pulling forty-four admin actions
         *   in to call one, on a path that approves an export application.
         *
         *   Left as it is, pinned as itself. A SECOND instance has to justify
         *   itself rather than arrive under an allowance this one was granted,
         *   which is the whole of ledger.ts's argument against a ceiling.
         */
        const found = violations();

        expect(found).toEqual([
            'src/app/actions/export/_ex_onboarding.ts -> @/app/actions/admin/_exports',
        ]);

        //   And it really is the delegating dynamic import, with the session
        //   pre-check in front of it. If this file ever grows a static import of
        //   the same module, or delegates without checking anything, the shape
        //   the exemption was granted for is gone.
        const src = stripComments(read('src/app/actions/export/_ex_onboarding.ts'), {
            label: '_ex_onboarding',
        });

        expect(src).toContain('await import("@/app/actions/admin/_exports")');
        expect(src).not.toContain('from "@/app/actions/admin/_exports"');
        expect(src).toContain('requireSession()');
    });

    it('POSITIVE CONTROL: the pattern matches a real private specifier', () => {
        const pattern = /["']@\/app\/actions\/([a-z-]+)\/(_[A-Za-z0-9_]+)["']/;

        expect(pattern.test('from "@/app/actions/marketplace/_mp_catalog"')).toBe(true);
        //   The barrel itself is not a private file.
        expect(pattern.test('from "@/app/actions/marketplace"')).toBe(false);
    });
});

describe('#913 — every file that exports an action declares itself a server module', () => {
    it('THE LEDGER — action files whose first statement is not "use server"', () => {
        //   The one with teeth. Every export of a "use server" module is a
        //   reachable endpoint (marketplace/_quote_offers says so in its own
        //   header); a file that exports actions WITHOUT the directive is not
        //   serving endpoints at all, and its server imports become a client
        //   bundle's problem.
        const withActions = [...new Set(actions().map((a) => `src/app/actions/${a.domain}/${a.file}`))].sort();

        const undeclared = withActions.filter((rel) => !/^["']use server["'];?$/.test(firstStatement(rel)));

        expect(
            undeclared.length === 0 ? LEDGER_HELD : `${ledgerVerdict(undeclared.length, 0)} — ${undeclared.join(', ')}`,
        ).toBe(LEDGER_HELD);

        //   And the list being checked is not empty.
        expect(withActions.length).toBeGreaterThan(50);
    });

    it('reads the first STATEMENT, not the first line', () => {
        //   False start 2, pinned. _quote_offers carries a thirteen-line comment
        //   above its directive, which is legal — a prologue directive may follow
        //   comments and may not follow a statement. A line-based check called
        //   that file a missing directive on two price-moving endpoints.
        const rel = 'src/app/actions/marketplace/_quote_offers.ts';
        const raw = read(rel);

        expect(raw.split('\n').slice(0, 5).join('\n')).not.toContain('use server');
        expect(firstStatement(rel)).toBe('"use server";');
    });

    it('POSITIVE CONTROL: the check rejects a directive that follows a statement', () => {
        //   A directive after an import is an ordinary string expression and does
        //   nothing. The assertion is on the rule, so it is worth showing the
        //   rule can fail.
        expect(/^["']use server["'];?$/.test('"use server";')).toBe(true);
        expect(/^["']use server["'];?$/.test("'use server'")).toBe(true);
        expect(/^["']use server["'];?$/.test('import { z } from "zod";')).toBe(false);
        expect(/^["']use server["'];?$/.test('const x = "use server";')).toBe(false);
    });
});

describe('#913 — and the two per-domain tests it generalises', () => {
    it('both still exist and still pass on their own terms', () => {
        //   NOT deleted. admin-barrel-parity asserts more than parity — it pins
        //   the export surface at the commit before a 5,604-line split, which is
        //   a historical record this sweep cannot reproduce and should not
        //   replace. cooperative-barrel-parity is the same shape.
        //
        //   What this sweep adds is the other six domains and every domain
        //   created after today. Two tests and a sweep is the right answer here,
        //   not one or the other.
        expect(existsSync(join(ROOT, 'src/__tests__/unit/admin-barrel-parity.test.ts'))).toBe(true);
        expect(existsSync(join(ROOT, 'src/__tests__/unit/cooperative-barrel-parity.test.ts'))).toBe(true);
    });

    it('and the six that had nothing are covered now, by name', () => {
        //   Spelled out so the gap this closed is legible, and so that a domain
        //   silently disappearing from the walk fails here.
        const covered = new Set(actions().map((a) => a.domain));

        for (const domain of ['academy', 'export', 'farm-nation', 'farm-nation-admin', 'marketplace', 'wave']) {
            expect(domains()).toContain(domain);
        }
        //   `export` defines its actions in files the walk sees but declares none
        //   as `export const …Action` — it is a barrel over three modules that
        //   export differently. Asserted rather than glossed, because a domain
        //   contributing zero actions to the sweep is exactly how a domain would
        //   silently fall out of it.
        expect(covered.has('export')).toBe(false);
        expect(subFiles('export').length).toBeGreaterThan(0);
        for (const domain of ['academy', 'farm-nation', 'farm-nation-admin', 'marketplace', 'wave']) {
            expect(covered.has(domain)).toBe(true);
        }
    });
});

describe('#913 — the barrels state the rule they are held to', () => {
    /**
     *   MEASURED, and it is the finding this test nearly did not have.
     *
     *   All eight barrels call themselves the single import point for their
     *   domain. Only FOUR stated the other half — that the `_`-prefixed files
     *   are private and must not be imported directly: academy, cooperative,
     *   marketplace and wave. admin, export, farm-nation and farm-nation-admin
     *   obeyed it and never said it.
     *
     *   A rule enforced by a sweep nobody reads is not a rule a contributor can
     *   follow, and holding four domains to a contract written in the other four
     *   is how the sweep above becomes the only thing anybody argues with. The
     *   sentence is in all eight headers now, which is a comment-only change and
     *   the entire fix.
     */
    const BARRELS = [
        'src/app/actions/academy/index.ts',
        'src/app/actions/admin/index.ts',
        'src/app/actions/cooperative/index.ts',
        'src/app/actions/export/index.ts',
        'src/app/actions/farm-nation/index.ts',
        'src/app/actions/farm-nation-admin/index.ts',
        'src/app/actions/marketplace/index.ts',
        'src/app/actions/wave/index.ts',
    ];

    it('THE CONTROL: the list is the walk — no barrel is missing from it', () => {
        //   A hand-written list is what the header criticises, so it is checked
        //   against the derived walk rather than trusted.
        expect(BARRELS.map((b) => b.split('/')[3]).sort()).toEqual(domains());
    });

    it('every one calls itself the single import point for its domain', () => {
        const silent = BARRELS.filter((rel) =>
            !/single import point|public entry point|resolves here/i.test(read(rel)));

        expect(silent).toEqual([]);
    });

    it('AND EVERY ONE NOW STATES THAT ITS PRIVATE FILES ARE PRIVATE', () => {
        //   Four of these were silent. The sweep held them to the rule anyway.
        const silent = BARRELS.filter((rel) =>
            !/never be imported directly|private to this domain|private modules|private files are private/i.test(read(rel)));

        expect(silent).toEqual([]);
    });

    it('POSITIVE CONTROL: the matcher would notice a header that said neither', () => {
        const both = /single import point|public entry point|resolves here/i;
        const priv = /never be imported directly|private to this domain|private modules|private files are private/i;

        expect(both.test('/** Just a file. */')).toBe(false);
        expect(priv.test('/** Just a file. */')).toBe(false);
        expect(priv.test('/** its private files are private */')).toBe(true);
    });
});
