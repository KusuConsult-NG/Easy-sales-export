/**
 * Setup for the real-Postgres integration suite.
 *
 * Loads .env.staging and decides whether the suite can run at all. Crucially it
 * does NOT mock @/lib/supabase-db — that global mock is exactly what these
 * tests exist to bypass.
 */

const { resolveDbEnv } = require('./src/lib/testing/db-env-guard');

// Shared with jest.integration.setup.js. This file used to carry its own copy
// of the credential loading, the production-project refusal and the skip
// warning; two copies of a safety rule is how the weaker one ends up deciding.
const { hasDb } = resolveDbEnv({ label: 'db-integration' });

/** True when a real database is configured. */
global.HAS_DB = hasDb;

/** describe() that skips the whole block when no database is configured. */
global.maybeDescribe = hasDb ? describe : describe.skip;

/**
 * describe() for blocks that need GoTrue (supabase.auth.admin.*), not just the
 * REST API. Probed in jest.db.globalsetup.js — see the note there on why a rig
 * without GoTrue must skip these rather than fail them.
 */
global.maybeDescribeAuth = hasDb && process.env.DB_SUITE_HAS_GOTRUE === 'true'
    ? describe
    : describe.skip;

if (hasDb && process.env.DB_SUITE_HAS_GOTRUE !== 'true') {
    console.warn(
        '[db-integration] GoTrue is not reachable at this stack — the auth-shim '
        + 'tests are SKIPPED, not passed. A full stack (scripts/ci-integration-db.sh) '
        + 'serves it; the Docker-free rig (scripts/local-supabase-rest.sh) does not.',
    );
}
