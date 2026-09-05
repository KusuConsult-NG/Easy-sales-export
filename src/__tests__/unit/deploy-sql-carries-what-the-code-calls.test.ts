/**
 * @jest-environment node
 */

/**
 *   #422 THE DEPLOY FILE COULD NOT BE BUILT, AND THE STEP THAT VERIFIES IT
 *   WOULD HAVE PASSED ON A DATABASE THAT CANNOT RUN THE CODE.
 *
 *   Found when the hosting subscription came back and a deploy became possible
 *   again. `node scripts/build-deploy-sql.mjs` REFUSED TO BUILD: migrations 025
 *   and 026 were on disk and in neither EXPECTED nor EXCLUDED. That refusal is
 *   a guard added by an earlier finding doing exactly its job — four migrations
 *   (019-022) had once been dropped from the consolidated file while the code
 *   on main called the functions they create.
 *
 *   WHAT WAS AT STAKE. 025 creates claim_status_transition_in, and
 *   status-transition.ts routes marketplaceOrders and cooperative_loans through
 *   it. On a database without that function every order transition comes back
 *   claimed=false, which the four call sites driving the order state machine
 *   report as "somebody else already did it" — a conflict, not an error. The
 *   platform would look like it was under contention rather than broken. 026
 *   replaces apply_document_patch so it mirrors the native typed columns; the
 *   older definition is what let a `.where("status", ...)` list disagree with
 *   the document it links to, which is #77, and which is the literal mechanism
 *   of "we fix it and it breaks again" — the fix lands in raw_data and the list
 *   keeps reading the column.
 *
 *   AND THE VERIFICATION BLOCK HAD DRIFTED AGAIN. The generated file ends with
 *   a block you run against the target database to confirm the deploy took. Its
 *   list of function names was typed by hand, and:
 *
 *     - it said "Expect 19 rows" over a list of 20 — the same count-vs-list
 *       mismatch its own comment records having had before (9 over 16);
 *     - it carried none of the four functions from 025 and 026, so it would
 *       have certified a database missing claim_status_transition_in;
 *     - it omitted two helpers from 016 that apply_array_ops calls.
 *
 *   A check that passes on a database missing the functions is not a check.
 *   That is the same shape as #331/#372/#373 — a control that cannot find
 *   anything — reached from the deployment side.
 *
 *   FIXED BY DERIVING IT. 025 and 026 are in EXPECTED with their ordering
 *   reasons (026 MUST follow 017, which it replaces). The verification list and
 *   its count are now READ OUT OF the migrations the script just concatenated,
 *   so neither can disagree with the file. A second query returns the shortfall
 *   directly, so nobody has to count rows by eye.
 *
 *   THIS TEST IS THE RATCHET, and its middle assertion is the general one: every
 *   Postgres function the application calls through .rpc() must be created by a
 *   migration the deploy file includes. Nothing checked that before — the unit
 *   suite mocks @/lib/supabase-db globally, so a .rpc('brand_new_function')
 *   added with no migration passes every test and 500s in production.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     drop 025 from EXPECTED                             KILLED
 *     drop 026 from EXPECTED                             KILLED
 *     hard-code the verification count                   KILLED
 *     verification lists only the first function         KILLED
 *     a new .rpc() with no migration behind it           KILLED
 *     reword the header prose                            SURVIVED, as intended
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { execFileSync } from 'child_process';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase/migrations');

/** The deploy file the script actually produces, built once. */
let deploySql = '';

beforeAll(() => {
    // Building it IS the first assertion: the script exits non-zero rather than
    // emitting a file that omits a migration nobody accounted for.
    deploySql = execFileSync('node', ['scripts/build-deploy-sql.mjs'], {
        cwd: ROOT, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024,
    });
});

/** Every function name a SQL body creates. */
function functionsIn(sql: string): Set<string> {
    const out = new Set<string>();
    const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_]+)"?/gi;
    for (const m of sql.matchAll(re)) out.add(m[1]);
    return out;
}

/** Every .rpc("name") the application source calls, comments stripped. */
function rpcsCalledByTheApplication(): Map<string, string[]> {
    const calls = new Map<string, string[]>();
    const walk = (dir: string): string[] => {
        const out: string[] = [];
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, e.name);
            if (e.isDirectory()) {
                if (e.name === 'node_modules' || e.name === '__tests__') continue;
                out.push(...walk(p));
            } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
                out.push(p);
            }
        }
        return out;
    };

    for (const file of [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts'))]) {
        const rel = relative(ROOT, file);
        // Stripped, so a function named only in a comment is not counted as a
        // call — the mistake that would make this test demand migrations for
        // functions nothing invokes.
        const src = stripComments(readFileSync(file, 'utf-8'), { label: rel });
        for (const m of src.matchAll(/\.rpc\(\s*['"`]([a-z_]+)['"`]/g)) {
            if (!calls.has(m[1])) calls.set(m[1], []);
            calls.get(m[1])!.push(rel);
        }
    }
    return calls;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#422 — the deploy file can be built at all', () => {
    it('THE BUILDER DOES NOT REFUSE — every migration on disk is accounted for', () => {
        expect(deploySql).toContain('CONSOLIDATED DEPLOY');
        expect(deploySql.length).toBeGreaterThan(10_000);
    });

    it('and it carries EVERY migration file, minus the ones excluded with a reason', () => {
        const onDisk = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));
        const script = readFileSync(join(ROOT, 'scripts/build-deploy-sql.mjs'), 'utf-8');
        const excluded = new Set(
            [...script.split('const EXCLUDED')[1].split('const args')[0]
                .matchAll(/n:\s*"(\d+)"/g)].map((m) => m[1]));

        const absent = onDisk.filter((f) => {
            const n = f.slice(0, f.indexOf('_'));
            return !excluded.has(n) && !deploySql.includes(f);
        });
        expect({ absent }).toEqual({ absent: [] });
    });

    it('and 026 comes AFTER 017, which it replaces', () => {
        // Reversed, apply_document_patch loses the native-column mirroring and
        // a list query goes back to contradicting the document. #77.
        const a = deploySql.indexOf('017_targeted_document_patch.sql');
        const b = deploySql.indexOf('026_document_patch_mirrors_native_columns.sql');
        expect(a).toBeGreaterThan(-1);
        expect(b).toBeGreaterThan(a);
    });

    it('and 014 still comes after 013, and RLS is still last', () => {
        // The two ordering rules that predate this finding, pinned so adding
        // entries cannot quietly reshuffle them.
        expect(deploySql.indexOf('014_debit_nested_jsonb_balance.sql'))
            .toBeGreaterThan(deploySql.indexOf('013_debit_jsonb_balance.sql'));
        const rls = deploySql.indexOf('004_enable_row_level_security.sql');
        for (const other of ['026_document', '025_status', '021_single']) {
            expect(deploySql.indexOf(other)).toBeLessThan(rls);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#422 — every function the code calls is in the deploy file', () => {
    it('THE GENERAL RULE: no .rpc() without a migration behind it', () => {
        const shipped = functionsIn(deploySql);
        const called = rpcsCalledByTheApplication();

        const orphans = [...called.entries()]
            .filter(([fn]) => !shipped.has(fn))
            .map(([fn, files]) => ({ fn, calledFrom: files }));

        // A .rpc() name with no CREATE FUNCTION in the deploy file is a call
        // that 500s against a freshly deployed database. The unit suite cannot
        // catch it — jest.setup.js mocks @/lib/supabase-db globally, so every
        // RPC in those tests is a jest.fn().
        expect({ orphans }).toEqual({ orphans: [] });
    });

    it('and the premise holds — the scan finds the RPCs we know are there', () => {
        // If the scan found nothing, the assertion above would pass vacuously.
        const called = rpcsCalledByTheApplication();
        expect(called.size).toBeGreaterThanOrEqual(15);
        for (const known of ['credit_wallet_once', 'claim_status_transition_in',
                             'apply_document_patch', 'debit_jsonb_balance']) {
            expect([...called.keys()]).toContain(known);
        }
    });

    it('and claim_status_transition_in specifically — the one 025 adds', () => {
        // Named rather than left to the general rule: without it every
        // marketplace order transition reports a conflict rather than an error,
        // which reads as contention and not as a broken deployment.
        expect(functionsIn(deploySql).has('claim_status_transition_in')).toBe(true);
        expect(deploySql).toContain('025_status_transition_dedicated_tables.sql');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#422 — and the verification step can actually fail', () => {
    /** The generated block, not any migration's own commentary. */
    const block = () => deploySql.slice(
        deploySql.indexOf('VERIFICATION — run this after the statements above'));

    it('ITS COUNT MATCHES ITS OWN LIST', () => {
        const src = block();
        const claimed = Number(/Expect (\d+) rows/.exec(src)![1]);
        const listed = new Set(
            [...src.split('ORDER BY proname')[0].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));

        expect({ claimed, listed: listed.size }).toEqual({ claimed: listed.size, listed: listed.size });
    });

    it('and it lists EVERY function the deploy file creates', () => {
        const src = block();
        const listed = new Set(
            [...src.split('ORDER BY proname')[0].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
        const shipped = functionsIn(deploySql);

        const unverified = [...shipped].filter((f) => !listed.has(f)).sort();
        expect({ unverified }).toEqual({ unverified: [] });
    });

    it('and it asks for the SHORTFALL, not just a row count to eyeball', () => {
        expect(block()).toMatch(/EXCEPT\s*\nSELECT proname FROM pg_proc/);
        expect(block()).toMatch(/Expect ZERO rows/);
    });

    it('and the list is derived, not typed', () => {
        // The defect was a hand-kept second statement of what the file contains.
        const script = readFileSync(join(ROOT, 'scripts/build-deploy-sql.mjs'), 'utf-8');
        expect(script).toMatch(/shippedFunctions = functionsCreatedBy\(chosen\.map/);
        expect(script).toMatch(/Expect \$\{shippedFunctions\.length\} rows/);
    });
});
