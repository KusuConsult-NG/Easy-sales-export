/**
 * @jest-environment node
 */

/**
 *   #328 THE ONE DIRECTORY THAT WRITES TO PRODUCTION BY HAND WAS THE ONE
 *        DIRECTORY OUTSIDE EVERY GATE — AND IT HID A SCRIPT THAT HAS NEVER RUN.
 *
 *        tsconfig.json:      "exclude": [ "node_modules", "scripts", ... ]
 *        eslint.config.mjs:  globalIgnores([ ..., "scripts/**" ])
 *                            // One-off admin/maintenance scripts — not app code
 *
 *        They are not app code. They are something with a wider blast radius.
 *        Eight files under scripts/ import the same `db` the application does —
 *        firebase-admin.ts line 169 is `export const db: AdminDb = supabaseDb`,
 *        the live Supabase project — and write to it with no request, no
 *        session, no reviewer and no test. The pre-commit hook runs
 *        `eslint --max-warnings=0` and `tsc --noEmit` over every staged file in
 *        this repository except these.
 *
 *        WHAT THE EXEMPTION HID
 *        ----------------------
 *        scripts/firebase-schema-fix.ts opened with
 *
 *            import * as admin from 'firebase-admin';
 *            if (!admin.apps.length) { ... }
 *
 *        `firebase-admin` in this repository is not Google's SDK. package.json
 *        resolves it to `file:./src/lib/shims/firebase-admin`, and that shim's
 *        index.js is, in full:
 *
 *            module.exports = { auth: () => ({}) };
 *
 *        `admin.apps` is undefined. Line 9 throws "Cannot read properties of
 *        undefined (reading 'length')" and the script dies there — before the
 *        tier migration, before the course seeding, before its closing
 *        "🎉 All fixes applied successfully." It has never done anything.
 *
 *        The typechecker reports all of it in one second, and had never been
 *        pointed at the file. Turning the exclusion off produced fifteen errors
 *        across three files, every one of them a real defect:
 *
 *          firebase-schema-fix.ts   12  a Firebase that does not exist
 *          audit-data-integrity.ts   2  `import * as fs from "fs"` twice
 *          seed-cooperative.ts       1  the shim's .d.ts under-declared its
 *                                       own module.exports
 *
 *        This suite holds the gates open, pins the shim halves together, and
 *        EXECUTES the rewritten repair against a seeded database — including
 *        the 5,001-user case, because the read that lost the other 36,000
 *        users is the one thing source text cannot show.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import * as ts from 'typescript';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { ACADEMY_CONFIG } from '@/lib/constants';
import { ACADEMY_PLANS } from '@/lib/academy-plan';

const ROOT = process.cwd();
const SHIM = 'src/lib/shims/firebase-admin';

function read(rel: string): string {
    return readFileSync(join(ROOT, rel), 'utf-8');
}

/** Every file under scripts/ that reaches the database. */
const DB_TOUCHING_SCRIPTS = [
    'scripts/audit-data-integrity.ts',
    'scripts/backfill-export-funding-goals.ts',
    'scripts/backfill-fixed-savings-ledger.ts',
    'scripts/firebase-schema-fix.ts',
    'scripts/repair-savings-balance.ts',
    'scripts/repair-schemas.ts',
    'scripts/seed-cooperative.ts',
    'scripts/seed-local.ts',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#328 — the typechecker sees scripts/', () => {
    /**
     * Resolved through TypeScript's own config parser rather than by reading
     * the "exclude" array, because the array is not the only way to lose a
     * file: a narrowed "include", a "files" list or a project reference would
     * each drop scripts/ while leaving the exclude entry absent. This asks the
     * question the compiler answers — is this file in the program?
     */
    const parsed = (() => {
        const configPath = join(ROOT, 'tsconfig.json');
        const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
        expect(error).toBeUndefined();
        return ts.parseJsonConfigFileContent(config, ts.sys, ROOT);
    })();

    const inProgram = new Set(parsed.fileNames.map((f) => f.replace(`${ROOT}/`, '')));

    it.each(DB_TOUCHING_SCRIPTS)('%s is part of the typechecked program', (rel) => {
        expect({ rel, checked: inProgram.has(rel) }).toEqual({ rel, checked: true });
    });

    it('and the repair module split out of firebase-schema-fix is too', () => {
        expect(inProgram.has('scripts/academy-schema-repair.ts')).toBe(true);
    });

    it('POSITIVE CONTROL: the parser really does exclude what tsconfig excludes', () => {
        // Without this, "everything is in the program" could mean the parse
        // returned every file on disk and the assertions above prove nothing.
        // node_modules is still excluded, and e2e/ still is.
        const excludedSomething = parsed.fileNames.some((f) => f.includes('/node_modules/'));
        expect(excludedSomething).toBe(false);
        expect([...inProgram].some((f) => f.startsWith('e2e/'))).toBe(false);
    });

    it('the whole program typechecks — scripts/ included', async () => {
        // The gate itself, executed. `tsc --noEmit` is what the pre-commit hook
        // runs; this is the same program, and it is the assertion that would
        // have caught firebase-schema-fix.ts on the day it was written.
        const program = ts.createProgram(parsed.fileNames, parsed.options);
        const diagnostics = [
            ...program.getSemanticDiagnostics(),
            ...program.getSyntacticDiagnostics(),
        ].filter((d) => d.file && !d.file.fileName.includes('/node_modules/'));

        const formatted = diagnostics.slice(0, 20).map((d) => {
            const file = d.file!.fileName.replace(`${ROOT}/`, '');
            const { line } = d.file!.getLineAndCharacterOfPosition(d.start ?? 0);
            return `${file}:${line + 1} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
        });

        expect(formatted).toEqual([]);
    }, 300_000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#328 — eslint sees scripts/', () => {
    /**
     * Run as a subprocess rather than through eslint's Node API: the flat
     * config is an ESM module, and loading it inside jest's VM fails with
     * "A dynamic import callback was invoked without --experimental-vm-modules".
     * The CLI is also what the pre-commit hook invokes, so this is the gate
     * itself and not a model of it.
     *
     * `--no-warn-ignored` is deliberately NOT passed: an ignored file is
     * reported as "File ignored because of a matching ignore pattern", which is
     * exactly the signal being tested for.
     */
    function lint(paths: string[]): { status: number | null; output: string } {
        const result = spawnSync(
            'npx',
            ['eslint', '--format', 'json', ...paths],
            { cwd: ROOT, encoding: 'utf-8', timeout: 120_000 },
        );
        return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
    }

    it('does not ignore the scripts that write to the database', () => {
        const { output } = lint(DB_TOUCHING_SCRIPTS);

        const results = JSON.parse(output.slice(output.indexOf('['), output.lastIndexOf(']') + 1));
        const ignored = results
            .filter((r: any) => r.messages.some((m: any) => /File ignored/.test(m.message)))
            .map((r: any) => r.filePath.replace(`${ROOT}/`, ''));

        expect(ignored).toEqual([]);
    }, 180_000);

    it('POSITIVE CONTROL: it still ignores what it is supposed to', () => {
        // Otherwise "nothing is ignored" could mean the parse found no
        // messages at all and the assertion above is vacuous.
        // next-env.d.ts exists on disk and is still in globalIgnores.
        const { output } = lint(['next-env.d.ts']);
        expect(output).toMatch(/File ignored/);
    }, 180_000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#328 — the firebase-admin shim declares exactly what it exports', () => {
    /**
     * Both halves of a shim have to agree. The narrow direction — a .d.ts that
     * omits a real export — rejects working code, which is how
     * seed-cooperative.ts failed to compile on `getFirestore`. The WIDE
     * direction is what killed firebase-schema-fix.ts: code written against a
     * surface the module does not have, with nothing to say so.
     */
    const ENTRIES = ['index', 'app', 'firestore', 'auth', 'storage', 'messaging'];

    it.each(ENTRIES)('%s.d.ts declares every name %s.js exports', (entry) => {
        // require, not import: the point is what the module exports AT
        // RUNTIME, which is the half the .d.ts is being checked against.
        const runtime = require(join(ROOT, SHIM, `${entry}.js`));
        const declared = read(`${SHIM}/${entry}.d.ts`);

        const missing = Object.keys(runtime).filter(
            (name) => !new RegExp(`\\bexport\\s+(?:declare\\s+)?(?:const|function|class|type|let|var)\\s+${name}\\b`).test(declared)
                && !new RegExp(`\\bexport\\s*\\{[^}]*\\b${name}\\b`).test(declared),
        );

        expect({ entry, missing }).toEqual({ entry, missing: [] });
    });

    it('POSITIVE CONTROL: the check can find a missing declaration', () => {
        const declared = 'export const auth: any;';
        const runtimeNames = ['auth', 'getFirestore'];
        const missing = runtimeNames.filter(
            (n) => !new RegExp(`\\bexport\\s+(?:declare\\s+)?(?:const|function|class|type|let|var)\\s+${n}\\b`).test(declared),
        );
        expect(missing).toEqual(['getFirestore']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#328 — the premise that killed the script, pinned', () => {
    /**
     * If somebody installs the real firebase-admin, every comment written above
     * about why this script crashed becomes false. This test is how they find
     * out, rather than by trusting prose.
     */
    // Loaded by path, not by specifier: jest's haste map refuses the bare name
    // because a stale .next/standalone copy of the shim's package.json is a
    // second provider of it. The path is what the specifier resolves to.
    const admin = require(join(ROOT, SHIM, 'index.js')) as any;

    it('firebase-admin resolves to the two-line shim, not the Google SDK', () => {
        expect(Object.keys(admin)).toEqual(['auth']);
    });

    it('so `admin.apps.length` — the old line 9 — throws', () => {
        expect(admin.apps).toBeUndefined();
        expect(() => admin.apps.length).toThrow(/Cannot read propert/);
    });

    it('and package.json still points the specifier at that shim', () => {
        const pkg = JSON.parse(read('package.json'));
        const declared = pkg.dependencies?.['firebase-admin'] ?? pkg.devDependencies?.['firebase-admin'];
        expect(declared).toBe('file:./src/lib/shims/firebase-admin');
    });

    it('THE REWRITTEN SCRIPT NO LONGER REACHES FOR THAT SURFACE', () => {
        const src = stripComments(read('scripts/firebase-schema-fix.ts'))
            + stripComments(read('scripts/academy-schema-repair.ts'));

        expect(src).not.toMatch(/from ['"]firebase-admin['"]/);
        expect(src).not.toMatch(/admin\.apps/);
        expect(src).not.toMatch(/admin\.initializeApp/);
        expect(src).not.toMatch(/admin\.firestore\(\)/);
        // The database it does write through.
        expect(src).toMatch(/supabaseDb as db/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#328 — the academy plan repair, executed', () => {
    let store: FakeDbHandle;
    let repair: typeof import('../../../scripts/academy-schema-repair');

    const withPlan = (plan: unknown) => ({ serviceRegistrations: { academy: { plan } } });

    beforeEach(async () => {
        jest.clearAllMocks();
        repair = await import('../../../scripts/academy-schema-repair');
    });

    it('rewrites a legacy "advanced" plan onto "standard"', async () => {
        store = installFakeDb({ users: { u1: withPlan('advanced') } });

        const done = await repair.migrateLegacyAcademyPlans();

        expect(done).toEqual([{ id: 'u1', from: 'advanced', to: 'standard' }]);
        expect(store.get('users', 'u1')?.serviceRegistrations.academy.plan).toBe('standard');
    });

    it('leaves a plan that is already spelled correctly completely alone', async () => {
        store = installFakeDb({
            users: {
                a: withPlan('foundation'),
                b: withPlan('standard'),
                c: withPlan('elite'),
            },
        });

        const done = await repair.migrateLegacyAcademyPlans();

        expect(done).toEqual([]);
        // Not rewritten with an identical value plus a fresh updatedAt.
        expect(store.get('users', 'b')).not.toHaveProperty('updatedAt');
        expect(global.mockFirestoreBatchCommit).not.toHaveBeenCalled();
    });

    it('DOES NOT GUESS A TIER for a value that is not a plan at all', async () => {
        // "registration" is a real stored value — every academy application
        // carried it (see resolveApplicationPlan). Registration is free, so
        // choosing a tier here would grant a paid plan nobody bought.
        store = installFakeDb({ users: { u1: withPlan('registration') } });

        const done = await repair.migrateLegacyAcademyPlans();

        expect(done).toEqual([]);
        expect(store.get('users', 'u1')?.serviceRegistrations.academy.plan).toBe('registration');
    });

    it('ignores a user with no academy registration', async () => {
        store = installFakeDb({ users: { u1: { email: 'a@b.c' }, u2: { serviceRegistrations: {} } } });
        expect(await repair.migrateLegacyAcademyPlans()).toEqual([]);
    });

    it('and ignores an empty-string plan rather than treating it as legacy', async () => {
        store = installFakeDb({ users: { u1: withPlan(''), u2: withPlan(null) } });
        expect(await repair.migrateLegacyAcademyPlans()).toEqual([]);
    });

    /**
     * THE READ THAT LOST 36,000 USERS.
     *
     * A query with no explicit .limit() stops at the adapter's 5,000-row
     * default and returns the truncated page as though it were the collection.
     * The original wrote `db.collection(USERS).get()`, so on a ~41,000-user
     * database this migration would have repaired the first 5,000 and printed
     * a completion summary.
     *
     * The fake reproduces that cap (fake-db.ts, verified against real Postgres
     * in src/__tests__/pg/fake-db-matches-postgres.test.ts), so this is the
     * real behaviour and not a restatement of the fix.
     */
    it('READS THE WHOLE COLLECTION — 5,001 users, not the first 5,000', async () => {
        const users: Record<string, any> = {};
        for (let i = 0; i < 5001; i++) users[`u${i}`] = withPlan('advanced');
        store = installFakeDb({ users });

        const done = await repair.migrateLegacyAcademyPlans();

        expect(done.length).toBe(5001);
    }, 120_000);

    it('POSITIVE CONTROL: a bare .get() on the same store stops at 5,000', async () => {
        // Proves the cap is live in this harness, so the test above measures
        // .all() rather than a fake that never truncates.
        const users: Record<string, any> = {};
        for (let i = 0; i < 5001; i++) users[`u${i}`] = withPlan('advanced');
        installFakeDb({ users });

        const { supabaseDb } = await import('@/lib/supabase-db');
        const capped = await supabaseDb.collection('users').get();

        expect(capped.size).toBe(5000);
    }, 120_000);

    /**
     * A COMMITTED BATCH CANNOT BE REUSED.
     *
     * The original built ONE batch outside the loop, called `batch.commit()`
     * inside it with no `await`, and kept adding to the same object. Past 400
     * matching users the final commit re-sent everything the first had already
     * sent, and neither un-awaited failure could be observed.
     */
    it('commits a FRESH batch per chunk, and awaits every one', async () => {
        const users: Record<string, any> = {};
        for (let i = 0; i < 401; i++) users[`u${i}`] = withPlan('advanced');
        store = installFakeDb({ users });

        const done = await repair.migrateLegacyAcademyPlans();

        expect(done.length).toBe(401);
        // 400 + 1, so two commits.
        expect(global.mockFirestoreBatchCommit).toHaveBeenCalledTimes(2);
        // 401 updates in total, not 400 + 401 as a reused batch would send.
        expect(global.mockFirestoreBatchUpdate).toHaveBeenCalledTimes(401);
        // And every one landed.
        for (let i = 0; i < 401; i++) {
            expect(store.get('users', `u${i}`)?.serviceRegistrations.academy.plan).toBe('standard');
        }
    }, 120_000);

    it('a failing commit REJECTS rather than being swallowed', async () => {
        store = installFakeDb({ users: { u1: withPlan('advanced') } });
        (global.mockFirestoreBatchCommit as any).mockRejectedValueOnce(new Error('supabase down'));

        await expect(repair.migrateLegacyAcademyPlans()).rejects.toThrow('supabase down');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#328 — the course seeding, executed', () => {
    let repair: typeof import('../../../scripts/academy-schema-repair');

    beforeEach(async () => {
        jest.clearAllMocks();
        repair = await import('../../../scripts/academy-schema-repair');
    });

    it('creates the three sold tiers when the catalogue is empty', async () => {
        installFakeDb({});
        const created = await repair.initializeAcademyCourses();
        expect(created).toEqual([...ACADEMY_PLANS]);
    });

    /**
     * THE SEEDED PRICES DISAGREED WITH WHAT CHECKOUT CHARGES.
     *
     * The original hard-coded 25,000 / 50,000 / 100,000, under the aside
     * "Or whatever default is, standard was 50000". ACADEMY_CONFIG — what the
     * payment paths bill against — says 45,000 / 90,000 / 270,000. A catalogue
     * advertising a third of the fee is not a display bug.
     */
    it.each([...ACADEMY_PLANS])('prices the %s course at the fee checkout charges', async (tier) => {
        installFakeDb({});
        await repair.initializeAcademyCourses();

        // mockFirestoreAdd is called as (collection, data) — the payload is the
        // second argument, not the first.
        const written = (global.mockFirestoreAdd as any).mock.calls
            .map((c: any[]) => c[1])
            .find((doc: any) => doc?.tier === tier);

        expect(written).toBeDefined();
        expect(written.price).toBe(ACADEMY_CONFIG.plans[tier].fee);
        expect(written.title).toBe(ACADEMY_CONFIG.plans[tier].name);
    });

    it('AND NONE OF THE OLD LITERALS SURVIVES ANYWHERE IN THE SCRIPT', () => {
        const src = stripComments(read('scripts/academy-schema-repair.ts'));
        for (const stale of ['25000', '50000', '100000']) {
            expect({ stale, present: src.includes(stale) }).toEqual({ stale, present: false });
        }
    });

    it('skips a tier that already has a course, and creates only the rest', async () => {
        installFakeDb({ academy_courses: { existing: { tier: 'standard', price: 90000 } } });

        const created = await repair.initializeAcademyCourses();

        expect(created).toEqual(['foundation', 'elite']);
        expect(global.mockFirestoreAdd).toHaveBeenCalledTimes(2);
    });

    it('is idempotent — a second run over a full catalogue writes nothing', async () => {
        installFakeDb({
            academy_courses: Object.fromEntries(
                ACADEMY_PLANS.map((t) => [`c-${t}`, { tier: t, price: ACADEMY_CONFIG.plans[t].fee }]),
            ),
        });

        expect(await repair.initializeAcademyCourses()).toEqual([]);
        expect(global.mockFirestoreAdd).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#328 — the entrypoint no longer reports success it cannot deliver', () => {
    const src = stripComments(read('scripts/firebase-schema-fix.ts'));

    it('IT DOES NOT PRINT AN UNCONDITIONAL SUCCESS LINE', () => {
        // Each half used to catch its own errors, log, and return normally;
        // main() then printed this and exited 0.
        expect(src).not.toMatch(/All fixes applied successfully/);
    });

    it('the repair steps are not wrapped in a swallowing try/catch', () => {
        // The two `try { ... } catch (error) { console.error(...) }` blocks
        // that made a failed run look like a clean one.
        expect(src).not.toMatch(/catch\s*\(\s*error\s*\)\s*\{\s*console\.error/);
    });

    it('and a failure exits NON-ZERO, so a wrapper can see it', () => {
        expect(src).toMatch(/\.catch\(\s*\(\s*err\s*\)\s*=>\s*\{/);
        expect(src).toMatch(/process\.exit\(1\)/);
    });

    it('the reported counts come from what was actually written', () => {
        expect(src).toMatch(/repaired\.length/);
        expect(src).toMatch(/created\.length/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#328 — the duplicate import the gate found', () => {
    it('audit-data-integrity.ts imports fs exactly once', () => {
        const src = stripComments(read('scripts/audit-data-integrity.ts'));
        const imports = src.match(/^\s*import .*['"]fs['"];?\s*$/gm) ?? [];
        expect(imports.length).toBe(1);
    });
});
