const nextJest = require('next/jest')

const createJestConfig = nextJest({
    // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
    dir: './',
})

// Add any custom config to be passed to Jest
const customJestConfig = {
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    testEnvironment: 'jest-environment-jsdom',
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        // uuid v14 ships ESM only, which Jest cannot parse. Without this, any
        // suite importing supabase-db fails at import time — part of why the
        // adapter was only ever exercised through a hand-written mock.
        '^uuid$': '<rootDir>/src/lib/__mocks__/uuid.js',
    },
    collectCoverageFrom: [
        'src/app/actions/**/*.ts',
        'src/lib/**/*.ts',
        'src/components/**/*.{ts,tsx}',
        '!src/**/*.d.ts',
        '!src/**/*.stories.{ts,tsx}',
        '!src/**/__tests__/**',
    ],
    coverageThreshold: {
        global: {
            branches: 60,
            functions: 60,
            lines: 70,
            statements: 70,
        },
    },
    testMatch: [
        '**/__tests__/**/*.[jt]s?(x)',
        '**/?(*.)+(spec|test).[jt]s?(x)',
    ],
    testPathIgnorePatterns: [
        '/node_modules/',
        '/.next/',
        // ── Real-Postgres integration tests ───────────────────────────────────
        // These deliberately bypass the global supabase-db mock and talk to a
        // staging database. They have their own config and setup.
        // Run them with: npm run test:db
        '/__tests__/db-integration/',
        // ── Playwright e2e specs ───────────────────────────────────────────────
        // These files import @playwright/test which Jest cannot resolve.
        // Run them with: npx playwright test
        '/e2e/',
        '/tests/e2e/',
        // ── Integration tests that cannot currently run ───────────────────────
        // This said they need a live Firebase Admin service account and to
        // "Run them with: npm run test:integration (in environments with
        // credentials)". Neither is true, and see
        // src/__tests__/unit/excluded-suites-state.test.ts for the detail.
        //
        // Credentials are not what is missing: the client SDK is the shim in
        // src/lib/shims/firebase, wired in as `"firebase": "file:./..."`, and
        // its addDoc/setDoc/updateDoc throw by design. Four of these suites
        // were written against the real SDK before the Supabase migration and
        // never migrated, so npm run test:integration cannot make them pass in
        // any environment — it starts an emulator nothing is able to reach.
        //
        // The remaining failures (auto-approval, data-consistency) are real
        // tests of real code that need a real database, which is a separate
        // problem with a real answer.
        '/src/__tests__/integration/',
        '/tests/integration/',
        // ── QA/diagnostic scripts in /tests/ root and root __tests__ ─────────
        // These are one-off scripts or simulation tests, not structured unit tests.
        '/tests/final-qa',
        '/tests/run-full-qa',
        '/tests/qa-validator',
        '/tests/qa-seed-admin',
        // phase7-simulation requires @/lib/audit-log-admin (missing) and Firebase Admin
        '/__tests__/phase7-simulation',
    ],
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig)
