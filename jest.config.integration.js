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
    testMatch: [
        '<rootDir>/src/__tests__/integration/auto-approval.test.ts',
        '<rootDir>/tests/integration/data-consistency.test.ts',
        '<rootDir>/src/__tests__/integration/broadcast-audiences.test.ts',
    ],
    setupFilesAfterEnv: ['<rootDir>/jest.integration.setup.js'],
    testEnvironment: 'node',
    testTimeout: 30000,
    maxWorkers: 1,
});
