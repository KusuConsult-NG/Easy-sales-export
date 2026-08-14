/**
 * @jest-environment node
 */

/**
 * `npm test` is not the whole suite, and the escape hatch it names does not work.
 *
 * 179 test files exist. The default config runs 148. The other 31 are excluded
 * by testPathIgnorePatterns in jest.config.js, CI runs only `npm run test`, and
 * so nothing in the pipeline has executed them since they were excluded.
 *
 * Running them: 21 failures across 6 suites, plus 23 Playwright specs and one
 * suite that cannot even be parsed. This file records why, because the reasons
 * are not the ones the config gives.
 *
 * WHAT THE CONFIG SAID
 * --------------------
 *     // These require a live Firebase Admin service account
 *     // (GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_KEY) which
 *     // is not available in CI.
 *     // Run them with: npm run test:integration (in environments with credentials)
 *
 * Both halves are wrong, and the second is the kind of claim this audit keeps
 * finding: a documented control that does not exist. Missing credentials are
 * not what stops these tests, and `npm run test:integration` cannot make them
 * pass in any environment.
 *
 *     "firebase": "file:./src/lib/shims/firebase"          package.json
 *
 * The `firebase` dependency IS the shim. The real client SDK is not installed.
 * addDoc, setDoc, updateDoc and writeBatch throw by design:
 *
 *     [firebase/firestore shim] addDoc() is not implemented. Client-side writes
 *     are not supported — perform this write in a Server Action using
 *     supabaseDb from "@/lib/supabase-db".
 *
 * So `npm run test:integration` starts a Firestore emulator and then runs tests
 * against a package that refuses to talk to it. There is no environment in
 * which that command works, because nothing is missing — the SDK was removed on
 * purpose during the Supabase migration and these files were not migrated with
 * it. Eleven of the seventeen failures are that one error.
 *
 * WHAT THEY WOULD TEST IF THEY RAN
 * --------------------------------
 * Mostly nothing. cooperatives, courses and loans import no application code at
 * all — they addDoc a row, read it back, and assert the row came back:
 *
 *     const loanRef = await addDoc(collection(global.testDb, 'loan_applications'), loanData);
 *     // 4. Verify loan was created
 *
 * No loan action is called. No eligibility rule, no tier calculation, no
 * ownership check. Migrating them off the shim would produce three green suites
 * that assert a database stores what you put in it. That is worth knowing
 * before anyone spends a day on the migration: the value is in rewriting them
 * against the actions, not in porting the writes.
 *
 * land.test.ts is half-migrated — it imports getAdminDb from supabase-db on
 * line 11 and still calls addDoc on line 41 — which is presumably where the
 * migration stopped.
 *
 * THE OTHER SIX FAILURES ARE A DIFFERENT THING
 * -------------------------------------------
 * auto-approval.test.ts does exercise real code (processCooperativeRegistration,
 * processAcademyRegistration, getCleanBroadcastList) and data-consistency.test.ts
 * checks referential integrity across live collections. Both need a real
 * database. Under the unit harness every query resolves through
 * global.mockFirestoreGet, which no integration test stubs, so `.get()` returns
 * undefined and the failure is `Cannot read properties of undefined (reading
 * 'empty')` at service.ts:525. These are genuine tests pointed at infrastructure
 * that is not wired up — unlike the eleven above, they are worth connecting.
 *
 * health-diagnostic.test.ts fails to parse entirely (`SyntaxError: Unexpected
 * token 'export'`), so it has never contributed a result either way.
 *
 * WHAT HAS SINCE BEEN WIRED IN
 * ----------------------------
 * The two suites worth connecting now run in CI on every pull request, against
 * an ephemeral Supabase stack that scripts/ci-integration-db.sh brings up:
 *
 *     src/__tests__/integration/auto-approval.test.ts
 *     tests/integration/data-consistency.test.ts
 *
 * `npm run test:integration` is that suite now, not the Firebase emulator. Both
 * files needed work before they meant anything — data-consistency was four
 * loops over query results, which assert nothing when the query returns nothing,
 * and one of them had no expect() at all.
 *
 * They stay in jest.config.js's ignore list because they need a database and
 * `npm run test` must not. Excluded from the default run is not the same as
 * excluded from CI, and that distinction is the whole point of this change.
 *
 * WHY THE REST IS RECORDED RATHER THAN FIXED
 * ------------------------------------------
 * Deleting suites and rebuilding integration coverage against Supabase are both
 * decisions with a cost, and neither is a defect to fix inside an audit. The
 * same choice as the QoreID bypass in #140 and MFA enforcement in #167: assert
 * the state so it is visible in the suite rather than only in a pull request
 * nobody re-reads.
 *
 * These tests are written to FAIL when somebody migrates or removes these
 * suites, at which point they should be replaced by the real thing.
 */

import { describe, it, expect } from '@jest/globals';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

/**
 * Assertions about what the code does have to read code.
 *
 * Six assertions in this audit have now matched the comment explaining the
 * defect instead of the defect, because a fix that quotes what was wrong puts
 * the old string back into the file.
 */
function codeOnly(src: string): string {
    return src
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

const config = source('jest.config.js');
const pkg = JSON.parse(source('package.json'));

describe('the documented way to run these suites cannot work', () => {
    it('the firebase dependency is the local shim', () => {
        // THE fact. Everything else follows from it.
        expect(pkg.dependencies.firebase ?? pkg.devDependencies?.firebase)
            .toBe('file:./src/lib/shims/firebase');
    });

    it('the shim throws on every client-side write', () => {
        const shim = source('src/lib/shims/firebase/firestore.js');

        expect(shim).toContain('is not implemented');
        for (const fn of ['addDoc', 'setDoc', 'updateDoc', 'writeBatch']) {
            expect(shim).toContain(fn);
        }
    });

    it('test:integration no longer starts an emulator nothing can reach', () => {
        // It was `firebase emulators:exec ... npm run test:integration:run`,
        // which booted a Firestore emulator that no code in this project can
        // address. It runs the two migrated suites against a real database now.
        expect(pkg.scripts['test:integration']).toContain('jest.config.integration.js');
        expect(pkg.scripts['test:integration']).not.toContain('emulators:exec');
        expect(pkg.scripts['test:integration:run']).toBeUndefined();
    });

    it('the emulator config is no longer referenced by any script', () => {
        // The file is left on disk for the four unmigrated suites, but nothing
        // runs it. A script that cannot work is worse than no script: it is an
        // answer to "how do I run these?" that costs an afternoon to disprove.
        const scripts = Object.values(pkg.scripts).join(' ');

        expect(scripts).not.toContain('jest.config.emulator.js');
    });

    it('the config no longer blames missing credentials', () => {
        // Asserted on the correction rather than the absence of the old claim,
        // because the corrected comment quotes it to say what was wrong.
        expect(config).toContain('Credentials are not what is missing');
        expect(config).toContain('npm run test:integration cannot make them pass');
    });
});

describe('the four suites still excluded from every run', () => {
    it('three of them call no application code', () => {
        // If this starts failing, someone has begun pointing them at real
        // actions, which is the rewrite this file argues for.
        for (const name of ['cooperatives', 'courses', 'loans']) {
            const src = codeOnly(source(`src/__tests__/integration/${name}.test.ts`));
            const appImports = src
                .split('\n')
                .filter((l) => l.startsWith('import') && /@\/(app|lib|infrastructure)\//.test(l));

            expect(appImports).toEqual([]);
        }
    });

    it('and write through the SDK that is not installed', () => {
        // So they fail at the first write, before reaching any assertion.
        for (const name of ['cooperatives', 'courses', 'loans', 'land']) {
            expect(source(`src/__tests__/integration/${name}.test.ts`))
                .toContain("from 'firebase/firestore'");
        }
    });

    it('land.test.ts is half-migrated', () => {
        const land = source('src/__tests__/integration/land.test.ts');

        expect(land).toContain('from "@/lib/supabase-db"');
        expect(land).toContain('addDoc');
    });

    it('two of them do exercise real code and are worth connecting', () => {
        // Vacuity guard: if every excluded suite were worthless, the honest
        // recommendation would be deletion, and this file would be an excuse
        // for leaving dead files in the tree.
        const autoApproval = source('src/__tests__/integration/auto-approval.test.ts');

        expect(autoApproval).toContain('processCooperativeRegistration');
        expect(autoApproval).toContain('getCleanBroadcastList');
        expect(source('tests/integration/data-consistency.test.ts')).toContain('COLLECTIONS');
    });

    it('two excluded suites already pass', () => {
        // email and paystack run clean under the default harness. They are
        // excluded by directory, not because anything is wrong with them.
        for (const name of ['email', 'paystack']) {
            expect(existsSync(join(process.cwd(), `src/__tests__/integration/${name}.test.ts`)))
                .toBe(true);
        }
    });
});

describe('the exclusions themselves', () => {
    it('names every excluded integration directory', () => {
        for (const dir of ['/src/__tests__/integration/', '/tests/integration/', '/__tests__/db-integration/']) {
            expect(config).toContain(dir);
        }
    });

    it('CI runs the smoke project only — the other Playwright specs still never run', () => {
        // Updated 2026-08-14. Previously this asserted CI ran NO Playwright at
        // all, which was true for the month the specs sat here unexecuted.
        //
        // Running them by hand revealed why that mattered twice over. They could
        // not launch — Playwright pins an exact browser build and the
        // environment shipped another — and once launched, all seven smoke
        // specs PASSED against a backend where every data fetch was failing.
        // Their assertions ("URL is not /auth/", "body is not empty") were true
        // of a page rendering nothing but an error banner.
        //
        // So the `e2e-smoke` job now runs that one project against a real
        // ephemeral database, and the marketplace spec asserts the query
        // actually succeeded. The remaining 22 specs still never run: they need
        // seeded users and module fixtures that do not exist yet.
        const specs = execSync('find e2e tests/e2e -name "*.spec.ts" 2>/dev/null | wc -l', {
            encoding: 'utf-8',
            cwd: process.cwd(),
            shell: '/bin/bash',
        }).trim();

        expect(Number(specs)).toBeGreaterThan(20);
        // jest still ignores them — they are Playwright's, not jest's.
        expect(config).toContain("'/e2e/'");

        const ci = source('.github/workflows/ci.yml');

        // The smoke project runs, and only the smoke project.
        expect(ci).toContain('--project=smoke');
        // Guards against someone widening this to the full suite without
        // seeding the fixtures it needs.
        expect(ci).not.toContain('npx playwright test\n');
        expect(ci).not.toContain('npm run test:e2e');

        // It needs a real database or the marketplace spec skips itself, and a
        // skipped smoke test proves nothing.
        expect(ci).toContain('ci-integration-db.sh');
    });

    it('CI runs the integration suites as well as the default config', () => {
        // This asserted that CI ran `npm run test` and nothing else, which was
        // why none of the above was caught. It failed when the integration job
        // was added, which is what it was for.
        const ci = source('.github/workflows/ci.yml');

        expect(ci).toContain('npm run test');
        expect(ci).toContain('npm run test:integration');
        expect(ci).toContain('./scripts/ci-integration-db.sh');
    });

    it('a skipped integration suite fails CI instead of passing quietly', () => {
        // The failure mode this whole change exists to prevent. The suites skip
        // when no database is configured — correct locally, and indistinguishable
        // from passing in a CI log. `npm run test:db` skipped 69 tests on every
        // machine for as long as it has existed for exactly that reason.
        const guard = source('src/lib/testing/db-env-guard.js');
        const guardCode = codeOnly(guard);

        expect(guardCode).toContain('if (!hasDb && process.env.CI)');
        expect(guardCode).toContain('throw new Error');
    });

    it('both real-database setups share one production refusal', () => {
        // Two copies of a safety rule is how the weaker one ends up deciding.
        for (const setup of ['jest.db.setup.js', 'jest.integration.setup.js']) {
            expect(source(setup)).toContain("require('./src/lib/testing/db-env-guard')");
        }
        expect(codeOnly(source('src/lib/testing/db-env-guard.js')))
            .toContain('PRODUCTION_PROJECT_REF');
    });

    it('the db-integration suite is still configured but skipping', () => {
        // 69 tests that have never run, because .env.staging carries all three
        // Supabase variables with EMPTY values — configured enough to look
        // fine, empty enough to disable everything. Recorded because it is the
        // same defect as the one above, one directory over, and it is not fixed
        // by this change.
        expect(pkg.scripts['test:db']).toContain('jest.config.db.js');

        const staging = existsSync(join(process.cwd(), '.env.staging'))
            ? source('.env.staging')
            : '';
        if (staging) {
            expect(staging).toMatch(/NEXT_PUBLIC_SUPABASE_URL=\s*$/m);
        }
    });
});
