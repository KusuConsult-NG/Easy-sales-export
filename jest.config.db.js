/**
 * Integration tests against a REAL Postgres.
 *
 * The main suite mocks `@/lib/supabase-db` globally (jest.setup.js), so all 398
 * unit tests run against a hand-written fake. That is fast and useful, and it
 * cannot catch anything about how the database actually behaves.
 *
 * It did not catch:
 *
 *   - wallet credits updating `wallets.balance` while the application reads
 *     `raw_data->>'balance'`, so a credit changed nothing anyone could see
 *   - FieldValue.increment resolving in JavaScript, losing concurrent updates
 *
 * Both passed the unit suite, code review, and a staging check that queried the
 * same column the bug was writing to. This config exists so that class of
 * defect has somewhere to fail.
 *
 * Run with:  npm run test:db
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, loaded from
 * .env.staging. Without them every test skips rather than fails, so CI stays
 * green and nobody is tempted to point this at production.
 */

const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

module.exports = createJestConfig({
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
    testMatch: ['**/__tests__/db-integration/**/*.test.ts'],
    setupFilesAfterEnv: ['<rootDir>/jest.db.setup.js'],
    testEnvironment: 'node',
    // Real network round trips, and some tests open two concurrent sessions.
    testTimeout: 30000,
    maxWorkers: 1,
});
