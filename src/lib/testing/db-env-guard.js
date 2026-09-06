/**
 * Decides whether a real-database suite may run, and against what.
 *
 * Two setups need this — jest.db.setup.js (the adapter suite) and
 * jest.integration.setup.js (the application suites). It lives in one place
 * because this audit keeps finding the other outcome: two copies of a rule,
 * drifted apart, with the weaker one deciding.
 *
 * WHERE CREDENTIALS COME FROM
 * ---------------------------
 * process.env first, .env.staging second. CI exports the values from the
 * ephemeral Supabase stack it just started, and must not have them replaced by
 * whatever a checked-in env file happens to say. dotenv does not override
 * already-set variables, which is the behaviour relied on here.
 *
 * WHY IT SKIPS RATHER THAN FAILS
 * ------------------------------
 * A developer without a database gets skips, so their run is green and nobody
 * deletes the suite. CI is a different case and is checked separately below:
 * there, a skip is the failure. `npm run test:db` skipped 69 tests silently on
 * every machine for as long as it has existed, because .env.staging carries the
 * three Supabase variables with empty values — present enough to look
 * configured, empty enough to disable everything. That is the exact shape this
 * file exists to make visible.
 */

const path = require('path');

/**
 * The production project ref.
 *
 * Recorded deliberately: it is not a secret — it ships in the public
 * NEXT_PUBLIC_SUPABASE_URL — and the whole point is to recognise it. These
 * suites create and delete rows, so pointing them at production is one
 * character in an env file.
 */
const PRODUCTION_PROJECT_REF = 'dpuiznenrymoyarvdave';

/**
 * @param {{ label: string, envFile?: string }} opts
 * @returns {{ hasDb: boolean, url: string, key: string, isLocal: boolean }}
 */
function resolveDbEnv({ label, envFile = '.env.staging' }) {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        require('dotenv').config({ path: path.resolve(process.cwd(), envFile) });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const hasDb = Boolean(url && key);

    if (hasDb && url.includes(PRODUCTION_PROJECT_REF)) {
        throw new Error(
            `[${label}] Refusing to run: the configured database is the PRODUCTION project ` +
            `(${PRODUCTION_PROJECT_REF}). These tests create and delete rows.`
        );
    }

    // CI must never skip quietly. The whole reason these suites were wired in is
    // that a suite which does not run looks identical to one that passes, and
    // the difference only shows up as a defect in production months later.
    if (!hasDb && process.env.CI) {
        throw new Error(
            `[${label}] No database configured, and this is CI.\n` +
            `  NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.\n` +
            `  A skipped integration suite in CI is a silent hole, so this is a failure ` +
            `rather than a skip.`
        );
    }

    if (!hasDb) {
        console.warn(
            `[${label}] Skipping — no database configured.\n` +
            `  Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in ${envFile},\n` +
            // Was "npx supabase start", which pulls container images and so
            // fails on exactly the machines that reach this message. up.sh
            // needs no Docker, and it writes the two variables above.
            `  or bring the whole stack up locally with: ./scripts/local-stack/up.sh\n` +
            `  then re-run with those variables exported from .env.development.local\n` +
            `  (${envFile} currently carries all three variables with EMPTY values.)`
        );
    }

    return {
        hasDb,
        url,
        key,
        isLocal: /127\.0\.0\.1|localhost/.test(url),
    };
}

module.exports = { resolveDbEnv, PRODUCTION_PROJECT_REF };
