/**
 * @jest-environment node
 */

/**
 * The test harness must implement everything the database adapter offers.
 *
 * WHY
 * ---
 * `jest.setup.js` hand-rolls a mock of `supabaseDb`. When the adapter gains a
 * method the mock does not have, code under test calls it and gets
 * `x is not a function`. Almost every action wraps its work in try/catch, so the
 * throw is swallowed, the action returns a generic failure, and any assertion
 * about what it should have written **can never fail**.
 *
 * That is not a hypothesis. Three of these surfaced by accident in a single day:
 *
 *   collection().add()   an action that created documents threw before its
 *                        later writes — noted in this file's own comments
 *   docRef.set()         stubbed as `() => Promise.resolve()`, recording
 *                        nothing, so the academy auto-enrol tests all passed
 *                        against a function that enrolled nobody
 *   batch.delete()       missing entirely; account deletion threw
 *                        `batch.delete is not a function`
 *
 * Each was found by a test failing for a confusing reason, not by looking. This
 * test looks.
 *
 * WHAT IT CANNOT PROVE
 * --------------------
 * That a stub BEHAVES correctly — only that it exists. `docRef.set()` existed
 * and recorded nothing, which this check would have passed. Presence is the
 * floor, not the ceiling: a stub that silently discards its arguments is still
 * a vacuum, and only a positive assertion in the test that uses it will catch
 * that.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

/** Method names the adapter exposes on a collection/query or on db itself. */
function adapterMethods(): Set<string> {
    const src = readFileSync(join(process.cwd(), 'src/lib/supabase-db.ts'), 'utf-8');
    const names = new Set<string>();

    // `  async foo(` and `  foo(` at class-member indentation.
    //
    // Control-flow keywords sit at the same indentation and match the same
    // shape, so they are excluded explicitly — the first version of this test
    // demanded the harness implement `.if()`, `.for()` and `.switch()`.
    const KEYWORD = new Set([
        'if', 'for', 'while', 'switch', 'catch', 'return', 'function',
        'do', 'else', 'try', 'typeof', 'await', 'new', 'super', 'this',
    ]);
    for (const m of src.matchAll(/^\s{2,4}(?:async\s+)?([a-zA-Z][a-zA-Z0-9_]*)\s*\(/gm)) {
        if (!KEYWORD.has(m[1])) names.add(m[1]);
    }
    return names;
}

/** Method names the mock implements, however they are written. */
function harnessMethods(): Set<string> {
    const src = readFileSync(join(process.cwd(), 'jest.setup.js'), 'utf-8');
    const names = new Set<string>();

    // `foo: (` — arrow-style stubs, and `foo: docObj` — reference-style.
    for (const m of src.matchAll(/^\s+([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*[({[a-zA-Z]/gm)) {
        names.add(m[1]);
    }
    return names;
}

/**
 * Adapter members that are not part of the query surface a test would reach.
 * Kept short and justified — this list is where coverage goes to hide.
 */
const NOT_QUERY_SURFACE = new Set([
    'constructor',
    'Number',        // a numeric coercion helper, not a method on the fluent API
    'data',          // returned by a snapshot the test itself constructs
    'forEach',       // iterating a snapshot the test constructs
    'toDate',
]);

describe('the jest harness against the real adapter', () => {
    const adapter = adapterMethods();
    const harness = harnessMethods();

    it('can read both surfaces (sanity)', () => {
        // Without this, a rename or a moved file makes the assertion below pass
        // against two empty sets — the vacuity failure this whole file exists
        // to prevent, reproduced inside it.
        expect(adapter.size).toBeGreaterThan(15);
        expect(harness.size).toBeGreaterThan(10);
    });

    it('implements every method the adapter exposes', () => {
        const missing = [...adapter]
            .filter((m) => !NOT_QUERY_SURFACE.has(m))
            .filter((m) => !harness.has(m))
            .sort();

        if (missing.length > 0) {
            throw new Error(
                `\n\njest.setup.js is missing ${missing.length} adapter method(s):\n\n` +
                missing.map((m) => `  .${m}()`).join('\n') +
                `\n\nCode under test that calls one gets "x is not a function". Most\n` +
                `actions catch that, return a generic failure, and leave the test's\n` +
                `assertions unable to fail.\n\n` +
                `Add a stub — and make it RECORD its arguments. docRef.set() existed\n` +
                `as () => Promise.resolve() and recorded nothing, which passed this\n` +
                `check while making an entire suite vacuous.\n`
            );
        }
        expect(missing).toEqual([]);
    });

    it('exports every top-level helper the adapter exports', () => {
        // The fluent surface above is not the whole adapter. supabase-db.ts also
        // exports modular compat helpers — doc, getDoc, setDoc, updateDoc,
        // collection, increment, serverTimestamp, arrayUnion, arrayRemove,
        // deleteField, runTransaction — and ten-odd action files destructure
        // them:
        //
        //     const { supabaseDb: db, doc, getDoc, runTransaction } =
        //         await import('@/lib/supabase-db');
        //
        // The mock exported only supabaseDb, getAdminDb and getTableName. Every
        // one of those helpers was undefined, so the first call threw
        // "doc is not a function", the action's catch turned it into a generic
        // failure, and no assertion about what it wrote could fail.
        //
        // cooperative/_payment.ts — a money path — could not be tested at all,
        // and nothing said so. The check above passes happily, because it only
        // ever looked at class members.
        const adapterSrc = readFileSync(join(process.cwd(), 'src/lib/supabase-db.ts'), 'utf-8');
        const harnessSrc = readFileSync(join(process.cwd(), 'jest.setup.js'), 'utf-8');

        const exported = [...adapterSrc.matchAll(/^export (?:async )?(?:function|const) ([a-zA-Z][a-zA-Z0-9_]*)/gm)]
            .map((m) => m[1]);

        // The mock declares them as object properties: `doc: (...)` etc.
        const missing = exported
            .filter((name) => !new RegExp(`\\b${name}\\s*:`).test(harnessSrc))
            .sort();

        expect(exported.length).toBeGreaterThan(5);
        if (missing.length > 0) {
            throw new Error(
                `\n\njest.setup.js does not export ${missing.length} adapter helper(s):\n\n` +
                missing.map((m) => `  ${m}()`).join('\n') +
                `\n\nCode that destructures one gets undefined and throws on the\n` +
                `first call. Most actions catch that and return a generic failure,\n` +
                `which leaves every assertion about their writes unable to fail.\n`
            );
        }
        expect(missing).toEqual([]);
    });

    it('records the writes it accepts, rather than swallowing them', () => {
        // The narrower lesson from docRef.set(). A write stub that returns a
        // resolved promise and calls no jest.fn() is indistinguishable from a
        // working one, right up until a test asserts on it.
        const src = readFileSync(join(process.cwd(), 'jest.setup.js'), 'utf-8');
        const writeStubs = ['set', 'update', 'add', 'delete', 'create'];

        const lines = src.split('\n');
        const silent: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(/^\s+(set|update|add|delete|create):\s*\([^)]*\)\s*=>\s*(.*)$/);
            if (!m) continue;

            // A stub may be one line, or open a block and record on the next.
            // Reading only the first line reported every multi-line stub as
            // silent — which is what the first version of this check did.
            const body = [m[2], ...lines.slice(i + 1, i + 4)].join(' ');
            if (!/mockFirestore/.test(body)) {
                silent.push(`${m[1]}: ${m[2].trim().slice(0, 40) || '(block)'}`);
            }
        }

        if (silent.length > 0) {
            throw new Error(
                `\n\nThese write stubs accept a call and record nothing:\n\n` +
                silent.map((x) => `  ${x}`).join('\n') +
                `\n\ndocRef.set() was exactly this — () => Promise.resolve() — and it\n` +
                `made every assertion about a .set() write unable to fail.\n`
            );
        }
        expect(silent).toEqual([]);
    });
});
