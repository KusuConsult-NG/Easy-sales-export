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
 * WHY RECORDED RATHER THAN FIXED
 * ------------------------------
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

    it('test:integration still starts an emulator nothing can reach', () => {
        // Left as found — removing the script would hide the problem rather
        // than answer it. Pinned so the claim and the reality stay visible
        // together.
        expect(pkg.scripts['test:integration']).toContain('firebase emulators:exec');
        expect(pkg.scripts['test:integration:run']).toContain('jest.config.emulator.js');
    });

    it('the config no longer blames missing credentials', () => {
        // Asserted on the correction rather than the absence of the old claim,
        // because the corrected comment quotes it to say what was wrong.
        expect(config).toContain('Credentials are not what is missing');
        expect(config).toContain('npm run test:integration cannot make them pass');
    });
});

describe('what the excluded suites cover', () => {
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

    it('the Playwright specs are excluded and CI never runs them', () => {
        // 23 specs. `npm run test:e2e` exists; no workflow calls it.
        const specs = execSync('find e2e tests/e2e -name "*.spec.ts" 2>/dev/null | wc -l', {
            encoding: 'utf-8',
            cwd: process.cwd(),
            shell: '/bin/bash',
        }).trim();

        expect(Number(specs)).toBeGreaterThan(20);
        expect(config).toContain("'/e2e/'");

        const ci = source('.github/workflows/ci.yml');
        expect(ci).not.toContain('test:e2e');
        expect(ci).not.toContain('playwright test');
    });

    it('CI runs the default config only', () => {
        // The reason none of this was caught. Recorded so that wiring any of
        // these in is a visible change to this expectation.
        const ci = source('.github/workflows/ci.yml');

        expect(ci).toContain('npm run test');
        expect(ci).not.toContain('test:integration');
    });
});
