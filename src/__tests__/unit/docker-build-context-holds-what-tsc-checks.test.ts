/**
 * @jest-environment node
 */

/**
 *   #402 THE BUILD DELETED THE FILES ITS OWN TYPE-CHECK COMPILES.
 *
 *   The production Docker build failed with thirteen errors, none of which was
 *   a type error:
 *
 *     playwright.config.ts(5,32): error TS2307: Cannot find module
 *       './e2e/helpers/chromium' or its corresponding type declarations.
 *     src/scripts/mark-unpaid.ts(46,60): error TS2307: Cannot find module
 *       '../../scripts/_maintenance-guard' ...
 *
 *   TWO CONFIG FILES DISAGREEING ABOUT WHAT THIS REPOSITORY IS
 *   -----------------------------------------------------------
 *   .dockerignore and .railwayignore both removed the root e2e/ and scripts/
 *   directories from the build context. The Dockerfile's builder stage runs
 *   `npx tsc --noEmit` — the type-check gate, the one tsconfig.json's header
 *   argues for at length — and that gate compiles src/scripts/*.ts,
 *   playwright.config.ts and src/__tests__/**, every one of which imports from
 *   the two directories that had just been deleted.
 *
 *   #328 is where the two configs parted company. It removed "scripts" from
 *   tsconfig's exclude list on purpose: those files import the same `db` the
 *   application does and write to the live database by hand, and one of them
 *   had been crashing on its ninth line since it was written. From that commit
 *   the gate compiled them — and the ignore files, unchanged, kept deleting
 *   them. The build could not pass from that moment on.
 *
 *   WHY CI NEVER SAW IT
 *   --------------------
 *   ci.yml runs tsc on a full checkout. There is no build context there and
 *   nothing is missing, so the gate that exists to catch this exact class of
 *   problem was green for every commit while the deploy failed. A check that
 *   runs somewhere the fault cannot occur is not a check — #331, #372, #373.
 *
 *   WHAT THIS SUITE PINS
 *   ---------------------
 *   The invariant the two configs must agree on: EVERY FILE THE TYPE-CHECK
 *   COMPILES MUST BE ABLE TO RESOLVE ITS IMPORTS INSIDE THE BUILD CONTEXT.
 *   Adding a directory to either ignore file, or adding an import that reaches
 *   into one already there, fails here rather than in a deploy.
 *
 *   It also pins the reason the fix is cheap: the runner stage copies exactly
 *   .next/standalone, .next/static and public, so nothing the builder holds
 *   reaches the shipped image.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     re-add "scripts" to .dockerignore              KILLED
 *     re-add "e2e" to .railwayignore                 KILLED
 *     drop the runner-stage assertion's path         KILLED
 *     reword the header prose                        SURVIVED, as intended
 *
 *   And the checker carries its own control: forced to treat scripts/ and e2e/
 *   as excluded, it must name the eight files that actually broke. Without that,
 *   a resolver that silently matched nothing would pass this suite forever.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, relative, resolve, dirname, sep } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

/**
 * Root-level names an ignore file removes from the build context.
 *
 * Docker and the Railway CLI both match these patterns against paths relative
 * to the context root, and neither recurses unless the pattern says `**`. So a
 * bare `scripts` deletes ./scripts and nothing else — which is the whole reason
 * `__tests__` in .dockerignore never touched src/__tests__, and why those three
 * suites were among the thirteen failures.
 */
function excludedRoots(file: string): Set<string> {
    const out = new Set<string>();
    for (const raw of readFileSync(join(ROOT, file), 'utf-8').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith('!')) continue;
        if (line.includes('*') || line.includes('/')) continue; // not a bare root directory
        out.add(line);
    }
    return out;
}

// Directories tsconfig.json excludes. Same non-recursive rule: "e2e" is ./e2e,
// which is why src/__tests__ IS compiled and root __tests__/ is not.
const TSC_EXCLUDED_ROOTS = new Set(['node_modules', 'tests', '__tests__', 'e2e', 'functions', 'scratch']);

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(ts|tsx|mts)$/.test(entry)) out.push(full);
    }
    return out;
}

const firstSegment = (p: string) => relative(ROOT, p).split(sep)[0];

/** Every file `npx tsc --noEmit` compiles, as tsconfig.json's include/exclude define it. */
function compiledFiles(): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(ROOT)) {
        if (entry.startsWith('.') || entry === 'node_modules') continue;
        const full = join(ROOT, entry);
        if (statSync(full).isDirectory()) {
            if (TSC_EXCLUDED_ROOTS.has(entry)) continue;
            walk(full, out);
        } else if (/\.(ts|tsx|mts)$/.test(entry) && !/^test-.*\.ts$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

const COMPILED = compiledFiles();

const cache = new Map<string, string>();
const code = (p: string) => {
    if (!cache.has(p)) cache.set(p, stripComments(readFileSync(p, 'utf-8'), { label: relative(ROOT, p) }));
    return cache.get(p)!;
};

/**
 * Relative module specifiers in a file — comments stripped.
 *
 * Stripped because this codebase annotates heavily and a header quoting an
 * import path would otherwise be read as one. That trap has fired in #383,
 * #392, #394 and #399, and this file's own header quotes two of the exact
 * specifiers that broke the build.
 */
function relativeImports(file: string): string[] {
    const src = code(file);
    const out: string[] = [];
    for (const re of [/\bfrom\s+['"](\.[^'"]*)['"]/g, /\bimport\s*\(\s*['"](\.[^'"]*)['"]\s*\)/g]) {
        for (const m of src.matchAll(re)) out.push(m[1]);
    }
    return out;
}

/**
 * Compiled files whose relative imports land in a directory the context drops.
 *
 * `pretend` lets the control re-run this against the configuration that failed,
 * which is what stops the checker from being one that cannot fail — #331's
 * class, and the reason every ratchet here carries a control.
 */
function violations(excluded: Set<string>, pretend: string[] = []): string[] {
    const drops = new Set([...excluded, ...pretend]);
    const out = new Set<string>();
    for (const file of COMPILED) {
        if (drops.has(firstSegment(file))) continue; // the file itself never arrives; not this test's finding
        for (const spec of relativeImports(file)) {
            const target = resolve(dirname(file), spec);
            if (drops.has(firstSegment(target))) out.add(relative(ROOT, file));
        }
    }
    return [...out].sort();
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#402 — the build context holds every file the type-check compiles', () => {
    it('NO COMPILED FILE IMPORTS INTO A DIRECTORY .dockerignore REMOVES', () => {
        expect(violations(excludedRoots('.dockerignore'))).toEqual([]);
    });

    it('and none imports into a directory .railwayignore removes either', () => {
        // .railwayignore runs FIRST — the CLI uploads the directory, and what it
        // drops never reaches the Docker context at all. Fixing only one of the
        // two files leaves the deploy failing identically.
        expect(violations(excludedRoots('.railwayignore'))).toEqual([]);
    });

    it('and the checker names the eight files that actually broke, when asked to', () => {
        /**
         * THE CONTROL. Run against the configuration that failed — scripts/ and
         * e2e/ dropped — the checker must produce the list of files that would
         * break under it.
         *
         * The deploy log that prompted #402 carried thirteen TS2307s across
         * EIGHT distinct files, and those eight are still every entry below
         * except one. The ninth,
         * src/__tests__/unit/academy-enrolment-tally.test.ts, was written later
         * (#427) and imports scripts/academy-enrolment-tally.ts exactly as its
         * sibling export-window-kind-and-goal.test.ts imports the export
         * backfill's arithmetic — so it belongs to the same set and would have
         * been the ninth entry in that log had it existed.
         *
         * Growing this list is expected when a new test reaches into scripts/.
         * What must not happen is an entry DISAPPEARING, which would mean the
         * checker had stopped seeing a real import.
         */
        expect(violations(new Set(), ['scripts', 'e2e'])).toEqual([
            'playwright.config.ts',
            'src/__tests__/unit/academy-enrolment-tally.test.ts',
            'src/__tests__/unit/export-window-kind-and-goal.test.ts',
            'src/__tests__/unit/maintenance-scripts-are-inside-the-gates.test.ts',
            'src/__tests__/unit/maintenance-scripts-do-not-overstate.test.ts',
            'src/scripts/backfill_academy_plans.ts',
            'src/scripts/backfill_versions.ts',
            'src/scripts/mark-unpaid.ts',
            'src/scripts/repair-orphaned-user.ts',
        ]);
    });

    it('and the compiled set is the real one, not an empty scan', () => {
        // Positive control for the two assertions above: "no violations" has to
        // mean the files were read, not that none were found.
        expect(COMPILED.length).toBeGreaterThan(800);
        expect(COMPILED.map((p) => relative(ROOT, p))).toContain('playwright.config.ts');
        expect(COMPILED.map((p) => relative(ROOT, p))).toContain('src/scripts/mark-unpaid.ts');
        // And the files those import are present to be resolved.
        expect(existsSync(join(ROOT, 'scripts/_maintenance-guard.ts'))).toBe(true);
        expect(existsSync(join(ROOT, 'e2e/helpers/chromium.ts'))).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#402 — keeping them costs the shipped image nothing', () => {
    it('THE RUNNER STAGE COPIES ONLY THE BUILD OUTPUT', () => {
        /**
         * The reason the fix is to complete the context rather than to shrink
         * what tsc checks. The builder is thrown away; only these three paths
         * are carried into the image, so scripts/ and e2e/ never ship.
         *
         * If a future change starts copying the whole tree into the runner, this
         * fails and the size argument above has to be made again rather than
         * assumed.
         */
        const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf-8');
        const runner = dockerfile.slice(dockerfile.indexOf('AS runner'));
        const copies = [...runner.matchAll(/COPY --from=builder[^\n]*?(\/app\/\S+)/g)].map((m) => m[1]).sort();
        expect(copies).toEqual(['/app/.next/standalone', '/app/.next/static', '/app/public']);
    });

    it('and the type-check still runs before the build, not after it', () => {
        // The gate only gates if it comes first. If `npm run build` moved above
        // it, a broken type would reach the image and the check would be a
        // report rather than a barrier.
        const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf-8');
        const typecheck = dockerfile.indexOf('RUN npx tsc --noEmit');
        const build = dockerfile.indexOf('RUN npm run build');
        expect(typecheck).toBeGreaterThan(-1);
        expect({ typecheckFirst: typecheck < build }).toEqual({ typecheckFirst: true });
    });
});
