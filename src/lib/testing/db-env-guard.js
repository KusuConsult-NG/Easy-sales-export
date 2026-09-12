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
    /**
     * WHERE TO LOOK, IN ORDER — #655.
     *
     * process.env first (CI exports the ephemeral stack's values), then the file
     * the LOCAL STACK ACTUALLY WRITES, then the staging file.
     *
     * `.env.development.local` was missing from this list, and the consequence
     * was the exact shape the comment below this one describes. Running the
     * local stack and then following its own closing instructions —
     *
     *     ./scripts/local-stack/up.sh
     *     npm run test:db          # printed by up.sh as the thing to run next
     *
     * — skipped all 17 suites and 161 tests. `.env.staging` is where the guard
     * looked, and that file DOES NOT EXIST in this repository; the stack writes
     * its URL and keys to `.env.development.local` instead. Two halves of one
     * workflow that never met.
     *
     * scripts/local-stack/jest-env.js exists because of this identical problem
     * on the pg side, and says so in its own header. The fix reached one of the
     * two harnesses. It reaches both now.
     *
     * dotenv does not override variables that are already set, so CI — which
     * exports them through $GITHUB_ENV — is unaffected by either file, and the
     * production-project check below still runs on whatever is resolved.
     */
    const candidates = ['.env.development.local', envFile];
    for (const file of candidates) {
        if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) break;
        require('dotenv').config({ path: path.resolve(process.cwd(), file) });
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
            //   #655 — this used to end "then re-run with those variables
            //   exported from .env.development.local", which was the manual step
            //   this guard now performs, and a parenthetical saying `.env.staging`
            //   "currently carries all three variables with EMPTY values" — a
            //   file that is not in the repository at all. Both are gone: a
            //   message describing a file nobody has is worse than no message.
            `  or bring the whole stack up locally with: ./scripts/local-stack/up.sh\n` +
            `  which writes .env.development.local, and is read automatically.`
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
