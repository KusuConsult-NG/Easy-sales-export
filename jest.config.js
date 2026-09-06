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
    /**
     * WHAT THE COVERAGE NUMBER IS A NUMBER *OF* — #436.
     *
     * This omitted src/app/api entirely. 121 route files, the server-side
     * entry points reachable from the internet, carrying the admin gates, the
     * payment verifications and the money writes — and the figure the CI floor
     * enforced was computed as though they did not exist.
     *
     * Measured when they were added: 87 of the 121 are at 0%, and the API
     * surface alone is at 25.8% statements (1,457 / 5,649). Overall statements
     * go 67.3% -> 61.7% and branches 55.8% -> 51.6% — which is the same suite
     * measured honestly, not a regression.
     *
     * #74 found this gate declaring 70% while the truth was 32%, because no
     * command passed --coverage. This is its sibling: the command runs now, and
     * it was measuring the half of the codebase least exposed.
     *
     * PAGES ARE STILL OUT, AS A STATED DECISION WITH ITS NUMBER. Adding
     * src/app/**\/*.tsx (246 page and layout components) gives 43.8% statements,
     * 35.4% branches, 30.1% functions, 44% lines — every one of them below the
     * floor below, so including them would mean LOWERING the floor by ten to
     * twenty-five points. That trades a gate that bites for a bigger
     * denominator, and src/components (437 files) already carries the UI logic
     * these pages compose. The figure is recorded so the exclusion is a
     * decision someone can revisit, not an omission nobody noticed.
     */
    collectCoverageFrom: [
        'src/app/actions/**/*.ts',
        'src/app/api/**/*.ts',
        'src/lib/**/*.ts',
        'src/components/**/*.{ts,tsx}',
        // Omitted too, and found by listing the directories rather than
        // reading the list: services/ is five modules that call getAdminDb()
        // for the analytics, finance and user-metrics figures; hooks/,
        // contexts/ and infrastructure/ are executable client logic.
        'src/services/**/*.ts',
        'src/hooks/**/*.{ts,tsx}',
        'src/contexts/**/*.{ts,tsx}',
        'src/infrastructure/**/*.ts',
        'src/config/**/*.ts',
        '!src/**/*.d.ts',
        '!src/**/*.stories.{ts,tsx}',
        '!src/**/__tests__/**',
    ],
    /**
     * A RATCHET, set to the true floor — not an aspiration.
     *
     * This said branches 60 / functions 60 / lines 70 / statements 70. The
     * actual figures at the time were 20.46 / 27.32 / 32.26 / 31.45, so
     * `npm run test:coverage` failed all four. Nothing noticed, because
     * thresholds only apply with --coverage and both the pre-push hook and CI
     * run `npm run test`. The numbers read as evidence that coverage is
     * enforced at 70% while it was 31% and ungated — the same shape as the
     * weak-secret check that could never print and the GATED_SEGMENTS list that
     * nothing imported.
     *
     * Set at the measured floor with about half a point of headroom, so it can
     * only be raised. Lowering one requires saying why here, which is the
     * review conversation the old numbers skipped.
     *
     * RAISED TWICE, as behavioural suites replaced structural ones. 31/20 was the
     * honest floor when the harness was a call recorder; lib/testing/fake-db.ts
     * gave it a real store, and these modules became testable:
     *
     *   lib/module-access-check      3.8 -> 94.5
     *   actions/sms-broadcast        6.1 -> 79
     *   lib/broadcast-logic          1.4 -> 76
     *   actions/admin/_marketplace   8.2 -> 66.7
     *   actions/in-app-broadcast     3.9 -> 63.6
     *   cooperative/_loans_applications 3.5 -> 55.8
     *   admin/_exports               6.6 -> 54.5
     *   marketplace/_mp_catalog      7.4 -> 53.5
     *   export/_ex_onboarding        3.6 -> 50.5
     *   lib/auth                     0   -> 38.8
     *
     * RAISED AGAIN, 38/29 -> 41/31, for the next batch:
     *
     *   actions/auth                16.8 -> 34.6
     *   wave/_wv_admin_applications 30.3 -> 68.9
     *   admin/_academy               8.8 -> 80.9
     *   academy/_ac_progress         6.2 -> 92.3
     *
     * AND AGAIN, 41/31 -> 48/39, and on to admin/_users:
     *
     *   wave/_wv_applications        11.1 -> 93.1
     *   farm-nation/_fn_onboarding    5.3 -> 88.9
     *   cooperative/_coop_identity    6.6 -> 92.0
     *   academy/_ac_applications      9.1 -> 94.7
     *   marketplace/_mp_onboarding    7.6 -> 90.4
     *   farm-nation/_fn_listings     11.2 -> 87.5
     *   marketplace/_mp_seller_dashboard 7.3 -> 73.7
     *   cooperative/_coop_admin_reports  4.5 -> 92.6
     *   cooperative/_coop_admin_members 22.7 -> 88.4
     *   cooperative/_coop_membership   11.5 -> 91.8
     *   village-market                 17.9 -> 83.2
     *   academy/_ac_admin_applications 20.2 -> 93.0
     *   admin/_legacy                   9.1 -> 94.7
     *   admin/_users                   40.1 -> 88.4
     *
     * Several of them found a defect on the way — see #77 to #87.
     *
     * WHY THE NUMBER IS NOT AS BAD AS IT SOUNDS, NOR AS GOOD AS THE SUITE COUNT
     * -------------------------------------------------------------------------
     * Most unit suites read SOURCE TEXT and assert on it. That is
     * deliberate: this codebase's defects were overwhelmingly structural — one
     * control applied on two doors out of three, a queue filtering on the wrong
     * field, a permission named nowhere, a status vocabulary that only went one
     * way — and those are facts about the shape of the code. But a structural
     * assertion executes almost nothing, so it contributes ~0 coverage while
     * still being a real gate.
     *
     * So this number measures how much of the app is EXERCISED, and the suite
     * count measures something else. Both are true and neither substitutes for
     * the integration, db and e2e jobs in .github/workflows/ci.yml, which are
     * the only things that run this code against a real database and a browser.
     */
    coverageThreshold: {
        global: {
            // Re-set against the WIDER denominator above (#436), and against
            // the MEASURED figure rather than an aspiration: statements 60.62,
            // branches 50.72, functions 56.06, lines 61.48.
            //
            // One to two points of headroom, deliberately. My first pass put
            // functions at 56 against a real 56.06 — a gate that a single new
            // uncovered function turns red for no defect. A floor that flaps
            // gets raised by whoever it inconveniences, which is how #74's
            // 70%-against-32% happened.
            branches: 49,
            functions: 54,
            lines: 60,
            statements: 59,
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
        // ── Real-Postgres SQL tests ───────────────────────────────────────────
        // These talk to an actual database through `pg`. The default run mocks
        // @/lib/supabase-db globally in jest.setup.js, and loading that mock
        // around a test that opens its own connection is not merely pointless —
        // it is how a suite ends up green while exercising a fake.
        // Run them with: npm run test:pg
        '/src/__tests__/pg/',
        // ── Tests that need a specific server TIMEZONE ────────────────────────
        // A process has one timezone, fixed before any Date exists;
        // `process.env.TZ = ...` inside a test does nothing, and a first
        // attempt at finding #81 passed under UTC while claiming to prove a
        // UTC-vs-local divergence. So these run in their own process with TZ
        // set on it.
        // Run them with: npm run test:tz
        // src/__tests__/unit/timezone-sensitive-suites-run.test.ts spawns that
        // script, so the default run still covers them.
        '/src/__tests__/tz/',
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
        // The remaining two — auto-approval and data-consistency — are real
        // tests of real code that need a real database. They now have one:
        // `npm run test:integration` runs them against an ephemeral Supabase
        // stack, and CI does that on every pull request.
        //
        // They stay excluded HERE because `npm run test` must not require a
        // database. Excluded from the default run is not the same as not run,
        // which is the distinction this list previously collapsed.
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
