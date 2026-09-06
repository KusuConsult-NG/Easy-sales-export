/**
 * @jest-environment node
 */

/**
 *   #434 AN OPERATOR THE ADAPTER COULD NOT EXPRESS BECAME AN EQUALITY, AND THE
 *   TEST DOUBLE ANSWERED IT CORRECTLY.
 *
 *   Found by carrying on the query-semantics thread that produced #78 (a
 *   numeric filter comparing lexicographically) into the operator table itself:
 *   for each of the ten operators the adapter DECLARES, what does each of the
 *   three doors actually do?
 *
 *       FilterOperator = '==' | '!=' | '<' | '<=' | '>' | '>='
 *                      | 'in' | 'not-in' | 'array-contains' | 'array-contains-any'
 *
 *   THE JSONB SWITCH HAD NO `not-in` CASE. It fell through to
 *
 *       default: return query.eq(jsonPath, String(value));
 *
 *   so `.where("status", "not-in", ["cancelled", "refunded"])` became
 *   `raw_data->>'status' = 'cancelled,refunded'`. "Every order except these
 *   two" returned NOTHING. Not an error — an empty list, which every caller in
 *   this repository treats as "there are none".
 *
 *   AND WHICH BRANCH A CALL TAKES DEPENDS ON THE COLLECTION. Eight tables have
 *   native columns, a handful of fields each (lib/supabase-table-map). Every
 *   other field in the product goes through the JSONB path. So the same line of
 *   code worked on `marketplace_orders.status` and silently returned nothing on
 *   any collection without a native column — which is most of them.
 *
 *   THE THREE DOORS, AND THEY DID NOT AGREE
 *
 *     lib/testing/fake-db          implements not-in CORRECTLY, in memory. So a
 *                                  test would have been GREEN on a query that
 *                                  returns the wrong rows in production. That
 *                                  is the part worth keeping: the double was
 *                                  more capable than the thing it doubles.
 *     lib/supabase-client-db       THROWS: "Fail loudly rather than returning an
 *                                  unfiltered collection." Its own comment.
 *     lib/supabase-db              silently returned an equality.
 *
 *   AND array-contains-any ON A JSONB FIELD COULD NEVER HAVE RUN. Both adapters
 *   emitted PostgREST's `ov`, which is SQL `&&`, and Postgres has no `&&` for
 *   jsonb. Measured, not inferred — see below.
 *
 *   WHAT I MEASURED, AND WHERE. There is no Supabase in this container (the
 *   local stack needs Docker images the egress policy denies), so I started a
 *   real Postgres 16.13 and ran the exact expressions the adapter builds:
 *
 *     raw_data->>'status' <> 'cancelled'          -> a,c   (row with NO status EXCLUDED)
 *     raw_data->>'status' not in ('cancelled',…)  -> a     (row with NO status EXCLUDED)
 *     raw_data->'tags' && '["red"]'::jsonb        -> ERROR: operator does not
 *                                                    exist: jsonb && jsonb
 *     raw_data->'tags' @> '["red"]'::jsonb        -> a,d   (array-contains: fine)
 *     raw_data->>'status' = 'cancelled,refunded'  -> no rows   (the old not-in)
 *
 *   The two exclusions match Firestore's treatment of a missing field, so the
 *   `not-in` added here has the semantics callers already expect. The PostgREST
 *   wire syntax itself I could NOT exercise — no PostgREST here — so this suite
 *   asserts the query the adapter builds, and says so rather than implying more.
 *
 *   NOTHING IS BROKEN TODAY, SAID PLAINLY. `not-in` has no caller. All five
 *   array-contains-any callers ask for `users.roles`, which IS a native TEXT[]
 *   column and takes the working `overlaps` path. This is a trap, not an
 *   outage: the operator is in the declared type so TypeScript accepts it, the
 *   test double answers it correctly so a test passes, and production returns
 *   the wrong rows without an error. The next person to write it would have had
 *   no way to find out.
 *
 *   REFUSED, NOT GUESSED. array-contains-any on JSONB is an OR of `@>` filters,
 *   and I have no PostgREST to exercise that against. Shipping an unverified
 *   query in place of one that errors trades a loud failure for a quiet one,
 *   which is this finding's subject. Both adapters refuse it, with a message
 *   naming the fix.
 *
 *   ONE RESIDUAL DIVERGENCE, RECORDED RATHER THAN HIDDEN. fake-db still answers
 *   array-contains-any on any field, because its semantics are not wrong — the
 *   adapters refuse it for a Postgres limitation, not a meaning. It has no table
 *   map, so teaching it the native/JSONB split is a bigger change than this
 *   finding. The ratchet below pins that this is the ONLY operator the three
 *   doors treat differently.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the JSONB not-in case removed (back to default)   KILLED
 *     the JSONB default returns eq again                KILLED
 *     the native default returns eq again               KILLED
 *     array-contains-any on JSONB emits `ov` again      KILLED
 *     the browser adapter emits `ov` again              KILLED
 *     in-list quoting stops escaping                    KILLED
 *     reword the header prose                           SURVIVED, as intended
 */

const CALLS: Array<{ method: string; a?: any; b?: any; c?: any }> = [];

jest.mock('@/lib/supabase', () => {
    const record = (method: string) => (a: any, b: any, c: any) => {
        CALLS.push({ method, a, b, c });
        return chain;
    };
    const chain: any = {
        select: jest.fn(() => chain),
        eq: record('eq'), neq: record('neq'),
        lt: record('lt'), lte: record('lte'), gt: record('gt'), gte: record('gte'),
        in: record('in'), is: record('is'),
        not: record('not'), filter: record('filter'),
        contains: record('contains'), overlaps: record('overlaps'),
        order: jest.fn(() => chain),
        limit: jest.fn(() => chain),
        range: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    return { supabaseAdmin: { from: jest.fn(() => chain), rpc: jest.fn() }, supabase: { from: jest.fn(() => chain) } };
});

jest.mock('@/lib/cache-map', () => ({ invalidateCacheForCollection: jest.fn() }));

import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const { supabaseDb } =
    jest.requireActual<typeof import('@/lib/supabase-db')>('@/lib/supabase-db');

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: relative(ROOT, p) });

const SERVER = 'src/lib/supabase-db.ts';
const BROWSER = 'src/lib/supabase-client-db.ts';
const DOUBLE = 'src/lib/testing/fake-db.ts';

/** Every operator the adapter's own type says it accepts. */
const DECLARED_OPERATORS = [
    '==', '!=', '<', '<=', '>', '>=', 'in', 'not-in', 'array-contains', 'array-contains-any',
] as const;

const callFor = (method: string) => CALLS.find((c) => c.method === method);

/**
 * An `eq` that filters on a DOCUMENT FIELD, not the collection scope.
 *
 * A collection with no dedicated table lives in `document_collections`, which
 * every query narrows with `eq('collection_name', …)`. My first draft asserted
 * "no eq at all" and tripped on that — the same trap as the earlier assertions
 * anchored on the wrong occurrence of a string. Only a field filter is evidence
 * of the defect.
 */
const fieldEq = () => CALLS.find((c) => c.method === 'eq' && c.a !== 'collection_name');

beforeEach(() => { CALLS.length = 0; });

// ─────────────────────────────────────────────────────────────────────────────
describe('#434 — not-in on a JSONB field', () => {
    it('BUILDS A not.in FILTER, NOT AN EQUALITY', async () => {
        // 'jest_ops' has no native columns, so status lives in raw_data — the
        // branch nearly every collection in this product takes.
        await supabaseDb.collection('jest_ops')
            .where('status', 'not-in', ['cancelled', 'refunded']).get();

        const call = callFor('not');
        expect(call).toBeDefined();
        expect(call!.a).toContain('status');
        expect(call!.b).toBe('in');
        expect(call!.c).toBe('("cancelled","refunded")');

        // The defect: it used to be eq(path, 'cancelled,refunded'), matching
        // nothing at all.
        expect(fieldEq()).toBeUndefined();
    });

    it('and a single value is still a list', async () => {
        await supabaseDb.collection('jest_ops').where('status', 'not-in', 'cancelled').get();
        expect(callFor('not')!.c).toBe('("cancelled")');
    });

    it('and it works the same way on a NATIVE column', async () => {
        // marketplace_orders.status IS native, so this takes the other branch.
        // Both branches must mean the same thing or the collection decides the
        // answer, which is the defect one level up.
        await supabaseDb.collection('marketplaceOrders')
            .where('status', 'not-in', ['cancelled']).get();

        const call = callFor('not');
        expect(call).toBeDefined();
        expect({ column: call!.a, op: call!.b, list: call!.c })
            .toEqual({ column: 'status', op: 'in', list: '("cancelled")' });
    });

    it('and a value containing a quote or comma is ESCAPED, not left to close the list early', async () => {
        await supabaseDb.collection('jest_ops')
            .where('label', 'not-in', ['say "no"', 'a,b', 'back\\slash']).get();

        // Was `"${v}"` with no escaping: `"say "no""` ends the member at the
        // second quote and the rest becomes separate list entries.
        expect(callFor('not')!.c).toBe('("say \\"no\\"","a,b","back\\\\slash")');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#434 — array-contains-any', () => {
    it('STILL WORKS ON users.roles, which is what every caller asks for', async () => {
        await supabaseDb.collection('users')
            .where('roles', 'array-contains-any', ['admin', 'seller']).get();

        const call = callFor('overlaps');
        expect(call).toBeDefined();
        expect({ column: call!.a, values: call!.b }).toEqual({ column: 'roles', values: ['admin', 'seller'] });
    });

    it('and is REFUSED on a JSONB field rather than emitting SQL Postgres rejects', async () => {
        // `ov` is `&&`, and `jsonb && jsonb` is "operator does not exist" —
        // measured on Postgres 16, see the header.
        await expect(
            supabaseDb.collection('jest_ops').where('tags', 'array-contains-any', ['red']).get(),
        ).rejects.toThrow(/Unsupported query operator "array-contains-any" on JSONB field "tags"/);

        expect(callFor('filter')).toBeUndefined();
    });

    it('and array-contains on a JSONB field is untouched — it uses @>, which works', async () => {
        await supabaseDb.collection('jest_ops').where('tags', 'array-contains', 'red').get();

        const call = callFor('filter');
        expect(call).toBeDefined();
        expect({ op: call!.b, value: call!.c }).toEqual({ op: 'cs', value: '["red"]' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#434 — an operator the adapter cannot express fails loudly', () => {
    it('DOES NOT SILENTLY BECOME AN EQUALITY, on the JSONB path', async () => {
        await expect(
            supabaseDb.collection('jest_ops').where('status', 'like' as any, 'x%').get(),
        ).rejects.toThrow(/Unsupported query operator "like"/);
        expect(fieldEq()).toBeUndefined();
    });

    it('nor on the native path', async () => {
        await expect(
            supabaseDb.collection('marketplaceOrders').where('status', 'like' as any, 'x%').get(),
        ).rejects.toThrow(/Unsupported query operator "like"/);
        expect(fieldEq()).toBeUndefined();
    });

    it('and the message names the field or column, so the caller can act on it', async () => {
        await expect(
            supabaseDb.collection('jest_ops').where('someField', 'like' as any, 'x').get(),
        ).rejects.toThrow(/someField/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#434 — the three doors', () => {
    it('THE BROWSER ADAPTER REFUSES THE SAME JSONB array-contains-any', () => {
        // The identical `ov` line was in both. Fixing one and not the other is
        // the failure this audit has recorded seven times (#425, #426, #429,
        // #430, #431, #432, #433).
        const src = code(BROWSER);
        expect(src).not.toMatch(/'ov'/);
        expect(src).toMatch(/Unsupported query operator "array-contains-any" on JSONB field/);
    });

    it('and the server adapter no longer has an `ov` filter either', () => {
        expect(code(SERVER)).not.toMatch(/'ov'/);
    });

    it('and NEITHER adapter falls back to an equality any more', () => {
        for (const rel of [SERVER, BROWSER]) {
            const src = code(rel);
            expect({ rel, eqFallback: /default:\s*return query\.eq\(/.test(src) })
                .toEqual({ rel, eqFallback: false });
        }
    });

    it('EVERY DECLARED OPERATOR IS HANDLED OR REFUSED — none is silently wrong', async () => {
        // The ratchet. Adding an operator to FilterOperator without a case in
        // the JSONB switch is exactly how not-in got here.
        const outcomes: Record<string, string> = {};
        for (const op of DECLARED_OPERATORS) {
            CALLS.length = 0;
            const value = op === 'in' || op === 'not-in' || op === 'array-contains-any' ? ['x'] : 'x';
            try {
                await supabaseDb.collection('jest_ops').where('f', op, value).get();
                outcomes[op] = CALLS.length > 0 ? 'filtered' : 'NO FILTER APPLIED';
            } catch (err) {
                outcomes[op] = /Unsupported query operator/.test(String(err)) ? 'refused' : 'THREW SOMETHING ELSE';
            }
        }

        expect(outcomes).toEqual({
            '==': 'filtered', '!=': 'filtered',
            '<': 'filtered', '<=': 'filtered', '>': 'filtered', '>=': 'filtered',
            'in': 'filtered', 'not-in': 'filtered',
            'array-contains': 'filtered',
            // The one Postgres cannot do on jsonb.
            'array-contains-any': 'refused',
        });
    });

    it('and the declared list here is the adapter\'s own, not a copy that can drift', () => {
        const declared = code(SERVER).match(/type FilterOperator = ([^;]+);/);
        expect(declared).not.toBeNull();
        const fromSource = [...declared![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
        expect(fromSource.sort()).toEqual([...DECLARED_OPERATORS].sort());
    });

    it('and the test double implements not-in the way the fixed adapter does', () => {
        // Both exclude a row whose field is absent. Postgres does that because
        // NULL NOT IN (…) is NULL; Firestore does it too, so the double and the
        // adapter agree on the one operator this finding adds.
        const src = code(DOUBLE);
        const notIn = src.slice(src.indexOf("case 'not-in'"), src.indexOf("case 'array-contains'"));
        expect(notIn).toMatch(/if \(actual === undefined \|\| actual === null\) return false;/);
    });
});
