/**
 * @jest-environment node
 */

/**
 * One row storing a number as a string breaks the WHOLE query, not that row.
 *
 * WHAT WAS MEASURED
 * -----------------
 * `.where("availableQuantity", ">", 0)` becomes, through applyJsonbFilter and
 * numericAware:
 *
 *     (raw_data->'availableQuantity')::numeric > 0
 *
 * The cast is on the JSONB value, not on its text form, and against real
 * PostgreSQL 16:
 *
 *     raw_data = {"availableQuantity": 12}    →  fine
 *     raw_data = {"availableQuantity": "12"}  →  ERROR: cannot cast jsonb string
 *                                                       to type numeric
 *
 * Per row. So a catalogue query that has worked for months starts returning an
 * error — not fewer results, an error — the moment ONE product's quantity is
 * stored as "12". Measured in src/__tests__/pg/fake-db-matches-postgres.test.ts.
 *
 * WHY THE CAST IS ON THE JSONB AND NOT THE TEXT
 * --------------------------------------------
 * Because `(raw_data->>'f')::numeric` would be safe for both spellings, and
 * PostgREST would not honour it. lib/supabase-db.ts records the four spellings
 * that were tried and what each returned; three of them silently gave the TEXT
 * answer, which is how "90000 is not greater than 900" got shipped. The jsonb
 * form is the one PostgREST applies. So the cast cannot simply be moved, and this
 * file guards the data instead of rewriting the query.
 *
 * WHAT THIS FILE GUARANTEES
 * -------------------------
 * 1. The set of fields compared with an ordering operator AND a numeric operand
 *    is small, known, and cannot grow unnoticed.
 * 2. Every writer of one of those fields coerces to a number.
 *
 * Those two together are what keep the landmine disarmed. Neither alone does: a
 * new numeric filter on an un-coerced field reopens it, and so does a new writer
 * of an already-filtered field.
 *
 * IT IS LATENT TODAY, NOT LIVE
 * ----------------------------
 * availableQuantity's writers all go through parseInt or Number, and
 * amountDisbursed has no writer at all. Recorded as measured rather than
 * overstated — but "no current writer does it" is exactly the guarantee that
 * quietly stops being true, and the failure mode is a whole page of the
 * marketplace returning an error.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry !== 'node_modules' && entry !== '__tests__') walk(full, out);
        } else if (/\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

const SOURCES = walk(join(ROOT, 'src'))
    .filter((f) => !f.includes('__tests__'))
    .map((f) => ({ rel: f.slice(ROOT.length + 1), code: stripComments(readFileSync(f, 'utf-8'), { label: f }) }));

/**
 * Fields compared with `<`, `<=`, `>` or `>=` against a NUMBER.
 *
 * A STRING operand takes numericAware's early return and emits no cast at all,
 * so date comparisons — the other 77 sites — are unaffected. Only a numeric
 * operand produces the cast that can raise.
 */
function numericFilterFields(): Map<string, string[]> {
    const found = new Map<string, string[]>();
    for (const { rel, code } of SOURCES) {
        for (const m of code.matchAll(/\.where\(\s*["'`]([a-zA-Z0-9_.]+)["'`]\s*,\s*["'`](?:<|<=|>|>=)["']\s*,\s*(-?[0-9][0-9_.]*)\s*\)/g)) {
            const field = m[1];
            if (!found.has(field)) found.set(field, []);
            found.get(field)!.push(rel);
        }
    }
    return found;
}

/**
 * The measured set. A RATCHET: it may shrink, never grow.
 *
 * Growing means a new field is compared numerically, and that field's writers
 * have to be checked the way availableQuantity's were.
 */
const KNOWN_NUMERIC_FILTER_FIELDS = ['amountDisbursed', 'availableQuantity'];

describe('the fields compared numerically are known', () => {
    it('and the list has not grown', () => {
        const fields = [...numericFilterFields().keys()].sort();
        expect(fields).toEqual(KNOWN_NUMERIC_FILTER_FIELDS);
    });

    it('the detector really finds them, so the list is not empty by accident', () => {
        // Positive control. A ratchet whose detector has silently stopped matching
        // reports a clean codebase — the exact vacuous pass this audit keeps
        // removing.
        const fields = numericFilterFields();
        expect(fields.size).toBeGreaterThan(0);
        expect(fields.get('availableQuantity')).toEqual(
            expect.arrayContaining(['src/app/actions/marketplace/_mp_catalog.ts']));
    });

    it('and it does NOT flag a date comparison, which emits no cast', () => {
        // The 77 other ordering comparisons are on ISO date strings. numericAware
        // returns the path untouched for a string operand, so no cast is emitted
        // and nothing can raise. Flagging those would make the ratchet useless.
        const dateSites = SOURCES.filter(({ code }) =>
            /\.where\(\s*["'`]createdAt["'`]\s*,\s*["'`]>=?["'`]/.test(code));
        expect(dateSites.length).toBeGreaterThan(0);
        expect([...numericFilterFields().keys()]).not.toContain('createdAt');
    });
});

describe('every writer of a numerically-filtered field coerces to a number', () => {
    /**
     * Writes of the form `field: <expression>`, with the expression captured.
     *
     * Reads are excluded by requiring the colon form — `data.availableQuantity`
     * and `=== 0` comparisons are not writes.
     */
    function writesOf(field: string): Array<{ rel: string; expr: string }> {
        const out: Array<{ rel: string; expr: string }> = [];
        for (const { rel, code } of SOURCES) {
            // Only where a document can actually be written.
            //
            // The adapter is server-only, so a `.tsx` component cannot write one.
            // Its `availableQuantity: ""` and `availableQuantity: e.target.value`
            // are React form STATE, and the server action they submit to coerces —
            // which is where the guarantee belongs. Flagging form state would make
            // this gate fire on correct code, and a gate that does that gets
            // deleted.
            if (!/^src\/(app\/(actions|api)|lib|services)\//.test(rel)) continue;
            if (rel.endsWith('.tsx')) continue;
            // A zod schema is not a write either — `z.number()` is the coercion.
            if (rel.startsWith('src/lib/validations/')) continue;

            for (const m of code.matchAll(new RegExp(`\\b${field}\\s*:\\s*([^,\\n}]+)`, 'g'))) {
                let expr = m[1].trim();
                // A type annotation in an interface is not a write.
                if (/^(number|string|boolean|any|unknown)\b/.test(expr)) continue;

                // Follow a bare identifier to its declaration in the same file.
                // `availableQuantity: stockQuantity` says nothing on its own; the
                // guarantee is at `const stockQuantity = Number(...)` twenty lines
                // up, and that is what has to be read.
                const bare = expr.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)$/);
                if (bare) {
                    const decl = code.match(new RegExp(
                        `\\b(?:const|let|var)\\s+${bare[1]}\\s*(?::[^=]+)?=\\s*([^;\\n]+)`));
                    if (decl) expr = `${expr} /* = */ ${decl[1].trim()}`;
                }

                out.push({ rel, expr });
            }
        }
        return out;
    }

    /** Coercions that produce a JSON number, or values that already are one. */
    function coerces(expr: string): boolean {
        return /\b(parseInt|parseFloat|Number)\s*\(/.test(expr)   // explicit coercion
            || /^-?[0-9][0-9_.]*$/.test(expr)                      // a literal
            || /FieldValue\.increment|increment\(/.test(expr)       // stays numeric
            || /^[a-zA-Z0-9_.]+\s*\?\?\s*-?[0-9]/.test(expr)        // `x ?? 0` — see below
            || /validatedData\./.test(expr);                        // zod-parsed, z.number()
    }

    for (const field of KNOWN_NUMERIC_FILTER_FIELDS) {
        it(`${field}`, () => {
            const writes = writesOf(field);
            const uncoerced = writes.filter((w) => !coerces(w.expr));

            if (uncoerced.length > 0) {
                throw new Error(
                    `\n\n${uncoerced.length} write(s) to \`${field}\` do not coerce to a number:\n\n`
                    + uncoerced.map((w) => `  ${w.rel}\n    ${field}: ${w.expr}`).join('\n')
                    + `\n\n\`${field}\` is compared with an ordering operator against a number, which\n`
                    + `emits (raw_data->'${field}')::numeric. Postgres RAISES on any row whose value\n`
                    + `is a JSON string — "cannot cast jsonb string to type numeric" — and one such\n`
                    + `row fails the entire query for every caller, not just that row.\n\n`
                    + `Coerce with Number(...) / parseInt(...), or parse through a zod z.number().\n`,
                );
            }
            expect(uncoerced).toEqual([]);
        });
    }

    it('and the coercion check is not satisfied by everything', () => {
        // Positive control for `coerces`. Without this the loop above passes even
        // if the predicate returns true unconditionally, which is the shape that
        // makes a scan look like a gate.
        expect(coerces('formData.get("availableQuantity") as string')).toBe(false);
        expect(coerces('rawInput.quantity')).toBe(false);
        expect(coerces('String(qty)')).toBe(false);

        expect(coerces('parseInt(formData.get("availableQuantity") as string || "0")')).toBe(true);
        expect(coerces('Number(form.availableQuantity)')).toBe(true);
        expect(coerces('0')).toBe(true);
    });

    it('and each field genuinely has writers to check, or the loop proves nothing', () => {
        // amountDisbursed is the interesting case: it has NO writer, which is
        // itself a recorded finding (the WAVE compliance report divides by a field
        // nothing sets). An empty write list passes the loop above trivially, so
        // it is called out here rather than looking like a clean result.
        const withWriters = KNOWN_NUMERIC_FILTER_FIELDS
            .filter((f) => writesOf(f).length > 0);
        expect(withWriters).toContain('availableQuantity');
        expect(writesOf('availableQuantity').length).toBeGreaterThanOrEqual(3);

        // Pinned deliberately. If amountDisbursed gains a writer, this fails and
        // the writer gets checked for coercion.
        expect(writesOf('amountDisbursed')).toEqual([]);
    });
});
