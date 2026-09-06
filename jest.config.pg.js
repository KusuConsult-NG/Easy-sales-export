/**
 * The money SQL, against a REAL PostgreSQL — no Docker, no Supabase stack.
 *
 * WHAT THIS COVERS THAT NOTHING ELSE DOES
 * ---------------------------------------
 * Every money guarantee in this platform is a Postgres function:
 * claim_status_transition, increment_within_ceiling, debit_wallet_locked,
 * credit_wallet_once, claim_idempotency_key,
 * claim_single_open_loan_application. They exist because the Firestore-compat
 * adapter's runTransaction takes NO LOCK, so a check-then-write in JavaScript
 * lets two callers both read "pending" and both proceed — which is how this
 * codebase paid a withdrawal twice and admitted two fee-free members on one
 * invitation.
 *
 * The unit suite mocks @/lib/supabase-db globally, so it cannot execute a single
 * line of that SQL. jest.config.db.js can, but it goes through PostgREST and
 * therefore needs `supabase start` and Docker.
 *
 * Neither can do the thing that actually matters here: run two callers AT ONCE
 * and prove exactly one wins. That needs two connections to one real database,
 * which is what this config sets up.
 *
 * Run with:  npm run test:pg      (after ./scripts/local-postgres.sh start)
 *
 * Without LOCAL_PG_URL every test SKIPS rather than fails, so `npm test` and CI
 * stay green on a machine with no local cluster. Skipped is not passed — the
 * suite prints what it skipped and why.
 */

const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

module.exports = createJestConfig({
    testEnvironment: 'node',
    // NOT jest.setup.js. That file mocks @/lib/supabase-db globally, which is
    // exactly what these tests must not have — they talk to a database.
    setupFilesAfterEach: undefined,
    // The local stack writes its URL and keys to .env.development.local, which
    // Next does NOT load under NODE_ENV=test. Without this, a suite that goes
    // through PostgREST comes up pointed at PLACEHOLDER_SUPABASE_URL and fails
    // with a message that looks like a broken query. See the file's header.
    setupFiles: ['<rootDir>/scripts/local-stack/jest-env.js'],
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
    testMatch: ['<rootDir>/src/__tests__/pg/**/*.test.ts'],
    // Shared cluster, one schema: parallel workers would race each other's rows.
    maxWorkers: 1,
    testTimeout: 30000,
});
