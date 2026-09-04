/**
 * @jest-environment node
 */

/**
 *   #382 `npm run build` DID NOT BUILD, AND NOTHING IN THIS REPOSITORY COULD
 *        HAVE TOLD US.
 *
 *        Two separate faults, both fatal, both invisible to 490 test suites:
 *
 *        1. A SERVER-ONLY MODULE REACHED THE BROWSER BUNDLE.
 *
 *             ./src/lib/cache-map.ts
 *             You're importing a module that depends on "revalidatePath"...
 *             Import trace:
 *               ./src/lib/cache-map.ts
 *               ./src/lib/supabase-db.ts
 *               ./src/lib/system-settings.ts
 *               ./src/app/admin/settings/fees/page.tsx
 *
 *           The admin fees screen is a client component and needed three pure
 *           definitions out of lib/system-settings — which also holds the three
 *           database readers. Importing the definitions dragged the whole
 *           adapter across the boundary.
 *
 *        2. THREE `"use server"` MODULES EXPORTED VALUES.
 *
 *             A "use server" file can only export async functions, found string.
 *             at src/app/actions/cooperative/_coop_money.ts
 *
 *           Every export of such a module is REGISTERED as a server action —
 *           that is exactly why an unwired exported action is still a live
 *           endpoint, the reasoning #374 and #379 both turned on. A string, an
 *           array or an object is not callable, so Next refuses the module.
 *           _coop_money.ts, export-booking.ts and data-export-audit.ts each had
 *           one.
 *
 *   WHY NO TEST CAUGHT EITHER
 *   -------------------------
 *   Jest resolves modules; it never bundles and never applies the server-action
 *   transform. Every one of these files imported and executed correctly under
 *   test while the application could not compile. The CI workflow DOES run
 *   `npm run build` — but only on pull requests to main and on main itself, and
 *   this audit's work sits on a branch with no pull request open, so it had not
 *   run once. `npm run verify` now runs typecheck, lint, build and the suite
 *   together, and this file makes both fault classes fail in seconds rather
 *   than in a ten-minute build.
 *
 *   These are static checks by necessity. They cannot replace a build — only a
 *   build proves a build — but they catch the two shapes that actually broke it
 *   at the speed a developer will actually run.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

/** Every .ts/.tsx under src/, excluding the test tree. */
function sourceFiles(dir: string = SRC, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === '__tests__' || entry === 'node_modules') continue;
            sourceFiles(full, out);
        } else if (/\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

const FILES = sourceFiles();
const rel = (p: string) => p.slice(ROOT.length + 1);

const textCache = new Map<string, string>();
function text(p: string): string {
    if (!textCache.has(p)) textCache.set(p, readFileSync(p, 'utf-8'));
    return textCache.get(p)!;
}
const code = (p: string) => stripComments(text(p), { label: rel(p) });

function firstDirective(p: string): string | null {
    const head = code(p).trim();
    if (/^["']use server["']/.test(head)) return 'use server';
    if (/^["']use client["']/.test(head)) return 'use client';
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#382 — a "use server" module exports only async functions', () => {
    /**
     * Values exported from a "use server" module, by file.
     *
     * A const initialised to a call or an arrow is a function at runtime and is
     * fine; a literal, an array or an object is not.
     */
    function valueExports(p: string): string[] {
        const src = code(p);
        const found: string[] = [];

        for (const m of src.matchAll(/^export\s+(?:const|let|var)\s+(\w+)\s*(?::[^=\n]+)?=\s*/gm)) {
            const after = src.slice(m.index! + m[0].length).trimStart();
            const isFunctionValued =
                /^(async\s*)?\(/.test(after) ||          // (…) => … / async (…) => …
                /^(async\s+)?function\b/.test(after) ||  // function … / async function …
                /^\w+\s*=>/.test(after) ||               // x => …
                /^\w+\s*\(/.test(after) ||               // withSafeAction(…) — returns a function
                /^\w+\s*;/.test(after);                  // an alias of another action
            if (!isFunctionValued) found.push(m[1]);
        }

        // A re-export is still a value export from this module.
        for (const m of src.matchAll(/^export\s*\{([^}]*)\}\s*from\s*["']/gm)) {
            if (!/^\s*type\b/.test(m[1])) found.push(`re-export {${m[1].trim()}}`);
        }
        for (const m of src.matchAll(/^export\s+class\s+(\w+)/gm)) found.push(m[1]);

        return found;
    }

    const serverModules = FILES.filter((p) => firstDirective(p) === 'use server');

    it('there ARE server-action modules to check — vacuity guard', () => {
        // Without this the sweep below passes on an empty list, which is how a
        // broken detector reads exactly like a clean tree.
        expect(serverModules.length).toBeGreaterThan(30);
    });

    it('THE DETECTOR FINDS A VALUE EXPORT WHEN THERE IS ONE — positive control', () => {
        // The three real offenders are fixed, so the sweep's answer is now an
        // empty list; a control is the only thing separating "none" from "the
        // detector is inert". lib/server-action-values.ts is where the three
        // values went, and it is full of exactly what the sweep looks for.
        const shared = join(SRC, 'lib', 'server-action-values.ts');

        expect(existsSync(shared)).toBe(true);
        expect(valueExports(shared)).toEqual(
            expect.arrayContaining(['EXPORT_BOOKING_DECISIONS', 'EXPORTABLE_DATASETS', 'UNPAID_CONTRIBUTION_MESSAGE']),
        );
    });

    it('NO "use server" MODULE EXPORTS A NON-FUNCTION VALUE', () => {
        const offenders = serverModules
            .map((p) => [rel(p), valueExports(p)] as const)
            .filter(([, names]) => names.length > 0);

        expect(offenders).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#382 — no client component reaches a server-only module', () => {
    /** Modules a client bundle must never pull in, and why. */
    const SERVER_ONLY = [
        { pattern: /from\s+["']next\/cache["']/, why: 'next/cache' },
        { pattern: /from\s+["']next\/headers["']/, why: 'next/headers' },
        { pattern: /from\s+["']server-only["']/, why: 'server-only' },
        { pattern: /from\s+["']firebase-admin/, why: 'firebase-admin' },
    ];

    /** Resolve an `@/…` or relative import to a file under src/, or null. */
    function resolveImport(fromFile: string, spec: string): string | null {
        let base: string;
        if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
        else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
        else return null;                                   // a package, not our tree

        for (const cand of [
            `${base}.ts`, `${base}.tsx`,
            join(base, 'index.ts'), join(base, 'index.tsx'),
        ]) {
            if (existsSync(cand) && statSync(cand).isFile()) return cand;
        }
        return null;
    }

    /**
     * The specifiers `p` imports FOR THEIR VALUES.
     *
     * Type-only imports are erased before bundling, so they cross no boundary —
     * and skipping them is not a convenience, it is the difference between a
     * detector and a noise generator: the first run of this sweep reported six
     * client files as offenders and every one was an `import type` of a shape
     * declaration. Both spellings are excluded, `import type { X } from` and an
     * `import { type X, type Y } from` whose bindings are ALL type-prefixed. One
     * value binding among them is enough to follow the edge.
     */
    function importsOf(p: string): string[] {
        const src = code(p);
        const specs: string[] = [];

        for (const m of src.matchAll(/import\s+([\s\S]*?)\s*from\s*["']([^"']+)["']/g)) {
            const clause = m[1].trim();
            if (/^type\b/.test(clause)) continue;                       // import type X from
            const braced = clause.match(/^\{([\s\S]*)\}$/);
            if (braced) {
                const bindings = braced[1].split(',').map((b) => b.trim()).filter(Boolean);
                if (bindings.length > 0 && bindings.every((b) => /^type\s/.test(b))) continue;
            }
            specs.push(m[2]);
        }

        // Side-effect imports and dynamic ones, which are always value imports.
        for (const m of src.matchAll(/import\s*\(\s*["']([^"']+)["']/g)) specs.push(m[1]);
        for (const m of src.matchAll(/^import\s*["']([^"']+)["']/gm)) specs.push(m[1]);

        return specs;
    }

    /**
     * The first server-only reason reachable from `p`, with the trace, or null.
     *
     * A "use server" module met along the way is NOT followed: Next replaces
     * such an import with a network reference in a client bundle, so its
     * contents never cross the boundary. That is the difference between calling
     * a server action from a browser component, which is the supported pattern,
     * and importing a module that happens to hold one.
     */
    // NOT MEMOISED ACROSS ROOTS, deliberately. A cached hit carries the trace
    // from whichever file reached it first, so a shared module would report six
    // different client files as all going through one unrelated import chain —
    // a report that names the wrong path is worse than a slower one. The tree is
    // small enough that a per-root walk costs under a second.
    function serverOnlyReach(p: string, stack: string[] = []): { why: string; trace: string[] } | null {
        if (stack.includes(p)) return null;                 // a cycle

        const src = code(p);
        for (const { pattern, why } of SERVER_ONLY) {
            if (pattern.test(src)) return { why, trace: [...stack.map(rel), rel(p)] };
        }

        for (const spec of importsOf(p)) {
            const next = resolveImport(p, spec);
            if (!next) continue;
            if (firstDirective(next) === 'use server') continue;
            const hit = serverOnlyReach(next, [...stack, p]);
            if (hit) return hit;
        }
        return null;
    }

    const clientFiles = FILES.filter((p) => firstDirective(p) === 'use client');

    it('there ARE client components to check — vacuity guard', () => {
        expect(clientFiles.length).toBeGreaterThan(100);
    });

    it('THE WALK FINDS THE BOUNDARY CROSSING WHEN THERE IS ONE — positive control', () => {
        // lib/system-settings still reaches next/cache — that is correct, it is
        // a server module. The point of the control is that the walk SEES it,
        // so an empty result below means "no client file reaches one" rather
        // than "the walk resolves nothing".
        const hit = serverOnlyReach(join(SRC, 'lib', 'system-settings.ts'));

        expect(hit).not.toBeNull();
        expect(hit!.why).toBe('next/cache');
    });

    it('and the pure schema module it was split from does NOT', () => {
        // The other half of the control, and the fix itself: the definitions the
        // fees screen needs no longer drag the adapter with them.
        expect(serverOnlyReach(join(SRC, 'lib', 'system-settings-schema.ts'))).toBeNull();
    });

    it('NO "use client" FILE CAN REACH A SERVER-ONLY MODULE', () => {
        const offenders = clientFiles
            .map((p) => [rel(p), serverOnlyReach(p)] as const)
            .filter(([, hit]) => hit !== null)
            .map(([file, hit]) => `${file} → ${hit!.why} via ${hit!.trace.join(' → ')}`);

        expect(offenders).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#382 — and the build is a step somebody actually runs', () => {
    it('npm run verify runs the build alongside the checks that were already run', () => {
        const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));

        expect(pkg.scripts.verify).toContain('npm run build');
        expect(pkg.scripts.verify).toContain('npm run typecheck');
        expect(pkg.scripts.verify).toContain('npm run test');
    });
});
