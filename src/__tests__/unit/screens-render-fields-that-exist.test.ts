/**
 * @jest-environment node
 */

/**
 *   #387 A RATCHET FOR THE DEFECT CLASS THIS AUDIT HAS FOUND SIX TIMES: A SCREEN
 *        RENDERING A FIELD NOTHING WRITES.
 *
 *        #100 the dashboard's Active Orders tile, always 0.
 *        #89  export portfolio returns, structurally always zero.
 *        #88  fulfilment keyed on metadata.exportId, which nothing set.
 *        #140 pendingSince, written and never read — the same defect inverted.
 *        #335 three queries keyed on fields nothing writes.
 *        #385 a required "Monthly Savings Target" with no reader.
 *
 *        Each was found by hand, one at a time. The shape is always the same: a
 *        field is declared on an entity type, a screen renders it, and no code
 *        anywhere puts a value there — so the tile is permanently zero, the
 *        badge never appears, the date is always the fallback, and nothing looks
 *        broken enough for anyone to check.
 *
 *   THE SWEEP, AND WHY IT IS SHAPED THIS WAY
 *   ----------------------------------------
 *   The universe is the fields declared on the interfaces in src/lib/types.
 *   That is deliberate: those are stored-entity shapes, so "nothing writes this"
 *   is a meaningful statement about them. Sweeping every property access in
 *   every .tsx would drown the real hits in React props and library fields.
 *
 *   A WRITE TAKES THREE FORMS, and the sweep that produced this file found
 *   thirteen candidates, then two, then none as each was added — every
 *   "finding" it lost was a form of writing it could not see:
 *
 *       field: value          an object-literal key
 *       field,                ES6 shorthand — cost eleven false positives
 *       obj.field = value     property assignment — cost the last two
 *
 *   That progression is the reason this file exists as a test rather than as a
 *   one-off script: a detector this easy to get subtly wrong needs its own
 *   controls, run every time, rather than a number in a commit message.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const TYPES = join(SRC, 'lib', 'types');

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === '__tests__' || entry === 'node_modules') continue;
            walk(full, out);
        } else if (/\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

const FILES = walk(SRC);
const cache = new Map<string, string>();
const code = (p: string) => {
    if (!cache.has(p)) cache.set(p, stripComments(readFileSync(p, 'utf-8'), { label: relative(ROOT, p) }));
    return cache.get(p)!;
};

/**
 * Field names too generic to reason about — they appear on entities and on
 * every DOM node, response envelope and React prop in the tree.
 */
const GENERIC = new Set([
    'id', 'name', 'type', 'status', 'title', 'value', 'label', 'key', 'data',
    'error', 'message', 'url', 'email', 'phone', 'address', 'amount', 'total',
    'count', 'date', 'createdAt', 'updatedAt', 'description', 'notes', 'reason',
    'role', 'roles', 'userId',
]);

/** field -> the interfaces that declare it. */
const DECLARED: Map<string, Set<string>> = (() => {
    const map = new Map<string, Set<string>>();
    for (const entry of readdirSync(TYPES)) {
        if (!entry.endsWith('.ts')) continue;
        const src = code(join(TYPES, entry));
        for (const m of src.matchAll(/(?:export\s+)?interface\s+(\w+)\s*(?:extends[^{]+)?\{([^}]*)\}/g)) {
            for (const f of m[2].matchAll(/^\s*(\w+)\??\s*:/gm)) {
                const field = f[1];
                if (GENERIC.has(field) || field.length <= 3) continue;
                if (!map.has(field)) map.set(field, new Set());
                map.get(field)!.add(m[1]);
            }
        }
    }
    return map;
})();

/** Every field name written anywhere in src/, in any of the three forms. */
const WRITTEN: Set<string> = (() => {
    const set = new Set<string>();
    for (const p of FILES) {
        // A declaration is not a write — that is the whole point of the sweep.
        if (p.startsWith(TYPES)) continue;
        const src = code(p);
        for (const m of src.matchAll(/(?:^|[{,\s])(\w+)\s*:\s*[^:\s]/gm)) set.add(m[1]);
        for (const m of src.matchAll(/^\s*(\w+)\s*,\s*$/gm)) set.add(m[1]);
        for (const m of src.matchAll(/\.(\w+)\s*=\s*[^=]/g)) set.add(m[1]);
        for (const m of src.matchAll(/\[\s*[`'"](\w+)/g)) set.add(m[1]);
    }
    return set;
})();

/** field -> the .tsx files that read it off something. */
const READ_BY_SCREENS: Map<string, string[]> = (() => {
    const map = new Map<string, string[]>();
    const screens = FILES.filter((p) => p.endsWith('.tsx'));
    for (const p of screens) {
        const src = code(p);
        for (const m of src.matchAll(/[\w)\]]\s*\??\.\s*(\w+)\b/g)) {
            const field = m[1];
            if (!DECLARED.has(field)) continue;
            const list = map.get(field) ?? [];
            if (!list.includes(p)) list.push(p);
            map.set(field, list);
        }
    }
    return map;
})();

// ─────────────────────────────────────────────────────────────────────────────
describe('#387 — the sweep can see', () => {
    it('THERE ARE ENTITY FIELDS, SCREENS AND WRITES TO COMPARE', () => {
        // Three vacuity guards on one assertion. The finding below is an empty
        // list, and an empty list is what a broken sweep produces too.
        expect(DECLARED.size).toBeGreaterThan(200);
        expect(READ_BY_SCREENS.size).toBeGreaterThan(100);
        expect(WRITTEN.size).toBeGreaterThan(500);
    });

    it('and it recognises all THREE ways a field gets written', () => {
        // Each of these cost the sweep a false finding before it was added:
        // the shorthand form cost eleven, the assignment form the last two.
        expect(WRITTEN.has('totalEarnings')).toBe(true);      // `totalEarnings,`  shorthand
        expect(WRITTEN.has('actualDelivery')).toBe(true);     // `x.actualDelivery = …`
        expect(WRITTEN.has('savingsBalance')).toBe(true);     // `savingsBalance: …`
    });

    it('and it does NOT count a type declaration as a write', () => {
        // The sweep's whole premise. If src/lib/types counted, every declared
        // field would look written and nothing could ever be found.
        const declarationOnly = 'aFieldNameThatOnlyExistsInThisAssertion';

        expect(WRITTEN.has(declarationOnly)).toBe(false);
        expect([...DECLARED.keys()].some((f) => !WRITTEN.has(f))).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#387 — no screen renders a field nothing writes', () => {
    it('EVERY ENTITY FIELD A SCREEN READS HAS A WRITER SOMEWHERE', () => {
        const orphans = [...READ_BY_SCREENS.entries()]
            .filter(([field]) => !WRITTEN.has(field))
            .map(([field, files]) => ({
                field,
                declaredOn: [...(DECLARED.get(field) ?? [])].sort(),
                readBy: files.map((f) => relative(ROOT, f)),
            }));

        expect(orphans).toEqual([]);
    });
});
