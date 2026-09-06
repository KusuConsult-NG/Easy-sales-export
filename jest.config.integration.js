/**
 * Application integration tests against a real database.
 *
 * WHAT THIS REPLACES
 * ------------------
 * `npm run test:integration` used to be:
 *
 *     firebase emulators:exec --project demo-test --only firestore,auth '...'
 *
 * which could not work in any environment. The firebase client SDK is not
 * installed — package.json wires `"firebase": "file:./src/lib/shims/firebase"`
 * and the shim's addDoc/setDoc/updateDoc throw by design — so the command
 * started an emulator that nothing in the project was able to talk to. See
 * src/__tests__/unit/excluded-suites-state.test.ts.
 *
 * WHICH SUITES RUN HERE
 * ---------------------
 * The two that exercise real application code:
 *
 *   src/__tests__/integration/auto-approval.test.ts   payment fulfilment and
 *                                                     broadcast filtering
 *   tests/integration/data-consistency.test.ts        referential integrity
 *
 * The other four (cooperatives, courses, land, loans) stay excluded. They were
 * written against the firebase client SDK before the Supabase migration and
 * three of them import no application code at all — they write a row and assert
 * the row comes back. Migrating them would produce green suites that test that
 * a database stores what you put in it; they need rewriting against the
 * actions, which is a separate piece of work.
 *
 * NOT --runInBand BY ACCIDENT
 * ---------------------------
 * These suites share one database and clean up by deleting the rows they made.
 * Run in parallel they would delete each other's fixtures.
 */

const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

module.exports = createJestConfig({
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
    /**
     * A DIRECTORY GLOB, NOT AN ALLOWLIST — #435.
     *
     * This named three files by hand while eight sat in the same directories.
     * The other five ran under NO config at all: not here, and not in the main
     * suite, which ignores these paths. A test can be dropped from the gate by
     * deleting one line, and nothing anywhere says it happened. Comparing the
     * directory listing to this array is the only way to find out.
     *
     * A glob cannot omit a file silently. Anything deliberately excluded is
     * named below WITH ITS REASON, where a reader meets it.
     */
    testMatch: [
        '<rootDir>/src/__tests__/integration/*.test.ts',
        '<rootDir>/tests/integration/*.test.ts',
    ],

    /**
     * Excluded ON PURPOSE, each with the reason.
     *
     * These are kept, not deleted — the standing rule on this codebase is that
     * things get retired and explained rather than destroyed (#379, #384, #386,
     * #426, #432). Re-including one is deleting a line from this list, and the
     * reason tells you what you would have to fix first.
     */
    testPathIgnorePatterns: [
        // WRITTEN AGAINST A DATA PATH THE APPLICATION REMOVED. All four write
        // through the Firebase client SDK — addDoc/setDoc/updateDoc, 20 calls
        // between them — and src/lib/shims/firebase/firestore.js refuses every
        // one on purpose: "Client-side writes are not supported — perform this
        // write in a Server Action using supabaseDb". They cannot pass without
        // being rewritten against the server actions, which is writing new
        // tests, not repairing these. The four passing suites in these
        // directories make zero client-SDK calls.
        '<rootDir>/src/__tests__/integration/loans.test.ts',
        '<rootDir>/src/__tests__/integration/courses.test.ts',
        '<rootDir>/src/__tests__/integration/land.test.ts',
        '<rootDir>/src/__tests__/integration/cooperatives.test.ts',
        // A UNIT TEST IN AN INTEGRATION LOCATION. It jest.mock()s
        // @/lib/firebase-admin and asserts against the mock, which is the one
        // thing this config exists NOT to do; it also fails to transform here
        // ("Cannot use import statement outside a module"). Its home is the
        // unit suite, and moving it is a separate job from this finding.
        '<rootDir>/tests/integration/health-diagnostic.test.ts',
    ],
    setupFilesAfterEnv: ['<rootDir>/jest.integration.setup.js'],
    testEnvironment: 'node',
    testTimeout: 30000,
    maxWorkers: 1,
});
