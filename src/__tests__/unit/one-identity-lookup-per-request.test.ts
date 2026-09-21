/**
 *   THE SAME FACT, LOOKED UP A HUNDRED AND SIXTY TIMES.
 *
 *   THE OWNER: "this app has gone back to being super slow. all the tabs loads
 *   very slow."
 *
 *   #904's fix is right and stays: a person with several profile rows must see
 *   the rows filed under every id they own, so an owner-scoped read resolves
 *   the set first. What it did not carry was a cost model.
 *
 *       ownedProfileIdsFor     116 call sites
 *       liveProfileId           44 more
 *
 *   Each is two indexed equality lookups against `users` — 42,845 rows,
 *   106 MB. For ONE signed-in person inside ONE render they all return the
 *   same answer, so a screen reading four owner-scoped collections paid for a
 *   dozen `users` queries to learn a fact it already had. Nothing memoised
 *   anything: a search for React's `cache` across src/ returned zero uses.
 *
 *   ── WHAT THIS ASSERTS, AND WHY IT IS THE STRUCTURE ─────────────────────────
 *
 *   NOT a query count, because it cannot be had here. `cache()` is scoped to a
 *   REQUEST, and outside one React hands each caller its own cache — measured,
 *   not assumed: three calls to a wrapped function in jest invoke it three
 *   times. That is exactly why the 284 tests over this module are unaffected,
 *   and exactly why the saving cannot be demonstrated in them.
 *
 *   So this pins the thing that CAN be checked: the three public entry points
 *   are the wrapped ones. Unwrap any of them — the one-line edit that would
 *   silently restore 160 redundant lookups — and this fails.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(process.cwd(), 'src', 'lib', 'owned-profile-ids.ts');

/** The file with its prose removed — a header quoting `cache(` is not a call. */
function codeOf(file: string): string {
    return readFileSync(file, 'utf-8')
        .split('\n')
        .filter((line) => {
            const t = line.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

describe('an identity is resolved once per request, not once per read', () => {
    const code = codeOf(SRC);

    it('found the module (sanity)', () => {
        expect(code.length).toBeGreaterThan(1000);
    });

    it('IT IMPORTS REACT\'S PER-REQUEST CACHE', () => {
        expect(code).toMatch(/import\s*\{\s*cache\s*\}\s*from\s*["']react["']/);
    });

    for (const name of ['ownedProfileIdsFor', 'ownedProfileIds', 'liveProfileId']) {
        it(`${name} IS EXPORTED WRAPPED, not bare`, () => {
            //   `export const x: T = cache(xUncached)` — the annotation is
            //   load-bearing too: cache() erodes the inferred return type and
            //   every caller that maps the result then trips noImplicitAny.
            //   `[\s\S]*?` rather than `[^=]+`: the annotation is a function
            //   type, so it CONTAINS an `=` in its arrow. The first attempt
            //   stopped dead at `=>` and reported all three as unwrapped.
            expect(code).toMatch(
                new RegExp(`export const ${name}\\s*:[\\s\\S]*?=\\s*cache\\(`),
            );
            //   And the bare async form must NOT also be exported, or a caller
            //   can reach past the cache without anything saying so.
            expect(code).not.toMatch(new RegExp(`export async function ${name}\\b`));
        });
    }

    it('and the chain calls the UNCACHED forms internally', () => {
        //   Memoising a memoised call buys nothing and hides which layer read.
        expect(code).toMatch(/ownedProfileIdsUncached\(await liveProfileIdUncached\(/);
    });
});
