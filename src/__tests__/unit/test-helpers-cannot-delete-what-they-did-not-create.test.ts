/**
 * @jest-environment node
 */

/**
 *   #435 A TEST HELPER DELETED EVERY ROW OF NINE COLLECTIONS, ON WHATEVER
 *   DATABASE THE ENVIRONMENT NAMED — AND WAS ONE CONFIG LINE FROM RUNNING.
 *
 *   Found by pulling on jest.config.integration.js, which named THREE test
 *   files by hand while eight sat in the same directories. The other five ran
 *   under no config at all — not there, and not in the main suite, which
 *   ignores those paths. So the first question was why, and the answer was in
 *   src/__tests__/integration/setup.ts:
 *
 *       const collections = ['users', 'loans', 'loan_applications',
 *           'cooperative_memberships', 'enrollments', 'land_listings',
 *           'withdrawals', 'escrow_transactions', 'audit_logs'];
 *       const snapshot = await adminDb.collection(name).get();
 *       snapshot.docs.forEach((d) => batch.delete(d.ref));
 *
 *   No test prefix. No id filter. No locality check. Six suites called it in
 *   beforeAll AND afterAll.
 *
 *   AND `getAdminDb()` IS NOT A FIREBASE LEFTOVER. It is
 *   `export function getAdminDb(): AdminDb { return supabaseDb; }` — the real
 *   adapter, pointed at whatever NEXT_PUBLIC_SUPABASE_URL and
 *   SUPABASE_SERVICE_ROLE_KEY say.
 *
 *   DEMONSTRATED, NOT ARGUED — BY ME, BY ACCIDENT. I widened that allowlist to
 *   find out whether the five orphans were salvageable, ran them against the
 *   local stack, and `users` went from 9 rows to 0. I re-seeded. It was a
 *   throwaway local database and nothing irreplaceable was lost, but that is
 *   the finding: the same run against a staging database loses real data, and
 *   the only thing standing between the two is which URL an env file holds.
 *
 *   WHAT WAS AND WAS NOT PROTECTING IT, STATED FAIRLY. lib/testing/db-env-guard
 *   refuses when the URL carries the production project ref, and that guard is
 *   real — PRODUCTION WAS NEVER AT RISK FROM THIS. But it recognises ONE
 *   hardcoded ref. A staging database, a restored copy, a new project: all
 *   wiped, silently.
 *
 *   AND THE REPOSITORY ALREADY KNEW BETTER. Every suite under
 *   __tests__/db-integration cleans up by test prefix —
 *   `.eq("collection_name", COLLECTION).like("id", "jest-db-%")` — removing
 *   only rows it wrote. Two conventions for one job, and the destructive one
 *   sat in the files nobody ran, which is where a rule goes to rot.
 *
 *   WHY THE FIVE WERE ORPHANED, WHICH IS ITS OWN FINDING. Four of them
 *   (loans, courses, land, cooperatives) write through the Firebase CLIENT SDK
 *   — 20 addDoc/setDoc/updateDoc calls between them — and this repository's own
 *   shim refuses every one: "Client-side writes are not supported". They test a
 *   data path the application removed. The four suites that pass make ZERO
 *   client-SDK calls; the split is exact.
 *
 *   The fifth, tests/integration/health-diagnostic, jest.mock()s the database
 *   and asserts against the mock — a unit test in an integration location.
 *
 *   AND TWO OF THE EXCLUDED FILES PASSED ALL ALONG. email and paystack were
 *   dropped from the allowlist with the failing ones and have nothing wrong
 *   with them. The gate now runs 5 suites / 31 tests where it ran 3 / 11.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the locality guard removed                        KILLED
 *     the fixture filter dropped from the query         KILLED
 *     the per-document marker check dropped             KILLED
 *     createTestUser throws again on an existing user   KILLED
 *     testMatch goes back to a file allowlist           KILLED
 *     reword the header prose                           SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: relative(ROOT, p) });

const SETUP = 'src/__tests__/integration/setup.ts';
const CONFIG = 'jest.config.integration.js';

// ─────────────────────────────────────────────────────────────────────────────
describe('#435 — the helper refuses a database that is not local', () => {
    const g = global as unknown as { DB_IS_LOCAL?: boolean };
    let previous: boolean | undefined;

    beforeEach(() => { previous = g.DB_IS_LOCAL; });
    afterEach(() => {
        if (previous === undefined) delete g.DB_IS_LOCAL;
        else g.DB_IS_LOCAL = previous;
    });

    it('THROWS WHEN THE DATABASE IS NOT LOCAL', async () => {
        g.DB_IS_LOCAL = false;
        const { cleanupTestData } = await import('@/__tests__/integration/setup');
        await expect(cleanupTestData()).rejects.toThrow(/Refusing to delete test data/);
    });

    it('and THROWS WHEN NOBODY SAID — undefined is not permission', async () => {
        // The setup file that sets this flag is loaded only by the integration
        // config. Reached any other way, the helper must refuse rather than
        // assume, because the failure being prevented is exactly a destructive
        // helper running somewhere nobody expected.
        delete g.DB_IS_LOCAL;
        const { cleanupTestData } = await import('@/__tests__/integration/setup');
        await expect(cleanupTestData()).rejects.toThrow(/not local/);
    });

    it('and the refusal names how to get a local database', async () => {
        g.DB_IS_LOCAL = false;
        const { cleanupTestData } = await import('@/__tests__/integration/setup');
        await expect(cleanupTestData()).rejects.toThrow(/local-stack\/up\.sh/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#435 — it deletes only what it created', () => {
    it('THE QUERY FILTERS ON THE FIXTURE MARKER', () => {
        const src = code(SETUP);
        expect(src).toMatch(/\.where\('_jestIntegrationFixture', '==', true\)/);
    });

    it('and each document is checked again before it is deleted', () => {
        const src = code(SETUP);
        // Belt and braces: a row arriving without the marker is skipped even
        // though the query already excluded it.
        expect(src).toMatch(/_jestIntegrationFixture !== true\) continue;/);
    });

    it('and THERE IS NO UNFILTERED COLLECTION-WIDE DELETE LEFT', () => {
        const src = code(SETUP);
        // The defect, in the exact shape it had: read the whole collection,
        // then delete every document in it.
        const readsWholeCollection = /\.collection\(collectionName\)\s*\.get\(\)/.test(src);
        expect({ readsWholeCollection }).toEqual({ readsWholeCollection: false });
    });

    it('and every row it writes carries the marker, or cleanup could never find it', () => {
        expect(code(SETUP)).toMatch(/_jestIntegrationFixture: true/);
    });

    it('and createTestUser REUSES an existing account rather than throwing or deleting', () => {
        // "A user with this email address has already been registered" was the
        // first error in every one of the failing suites. Deleting the account
        // to make room would destroy rows this helper did not write.
        const src = code(SETUP);
        expect(src).toMatch(/getUserByEmail\(data\.email\)/);
        expect(src).not.toMatch(/deleteUser\(/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#435 — a test cannot be dropped from the gate by omission', () => {
    it('testMatch IS A DIRECTORY GLOB, NOT A LIST OF FILENAMES', () => {
        const src = readFileSync(join(ROOT, CONFIG), 'utf-8');
        const match = src.match(/testMatch:\s*\[([^\]]*)\]/);
        expect(match).not.toBeNull();
        const entries = [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

        expect(entries.length).toBeGreaterThan(0);
        // Every entry must be a glob. A named .test.ts file is the defect: five
        // suites sat outside such a list, running nowhere.
        const named = entries.filter((e) => !e.includes('*'));
        expect({ namedFiles: named }).toEqual({ namedFiles: [] });
    });

    it('and anything deliberately excluded is named where a reader meets it', () => {
        const src = readFileSync(join(ROOT, CONFIG), 'utf-8');
        const ignore = src.match(/testPathIgnorePatterns:\s*\[([\s\S]*?)\n    \],/);
        expect(ignore).not.toBeNull();

        const entries = [...ignore![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
        expect(entries.length).toBeGreaterThan(0);

        // Each excluded file must actually exist — an ignore entry for a file
        // that has been renamed silently stops excluding anything.
        for (const entry of entries) {
            const rel = entry.replace('<rootDir>/', '');
            expect({ entry, exists: existsSync(join(ROOT, rel)) }).toEqual({ entry, exists: true });
        }

        // And the block must carry reasons, not just paths.
        expect(ignore![1]).toMatch(/Client-side writes are not supported/);
        expect(ignore![1]).toMatch(/unit test in an integration location/i);
    });

    it('and the four excluded product suites really do use client-SDK writes', () => {
        // The stated reason, checked rather than trusted. If one of them is
        // rewritten against the server actions, this fails and the exclusion
        // should be lifted.
        for (const name of ['loans', 'courses', 'land', 'cooperatives']) {
            const src = code(`src/__tests__/integration/${name}.test.ts`);
            expect({ name, clientWrites: /\b(addDoc|setDoc|updateDoc|deleteDoc)\s*\(/.test(src) })
                .toEqual({ name, clientWrites: true });
        }
    });

    it('and the suites that DO run make no client-SDK writes at all', () => {
        for (const name of ['email', 'paystack', 'auto-approval', 'broadcast-audiences']) {
            const src = code(`src/__tests__/integration/${name}.test.ts`);
            expect({ name, clientWrites: /\b(addDoc|setDoc|updateDoc|deleteDoc)\s*\(/.test(src) })
                .toEqual({ name, clientWrites: false });
        }
    });

    it('and both setups publish the locality answer rather than restating it', () => {
        // One safety rule, decided in db-env-guard, read everywhere else.
        for (const f of ['jest.integration.setup.js', 'jest.db.setup.js']) {
            const src = readFileSync(join(ROOT, f), 'utf-8');
            expect({ f, publishes: /global\.DB_IS_LOCAL = isLocal;/.test(src) })
                .toEqual({ f, publishes: true });
        }
    });
});
