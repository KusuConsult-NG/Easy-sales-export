/**
 * Setup for the real-Postgres integration suite.
 *
 * Loads .env.staging and decides whether the suite can run at all. Crucially it
 * does NOT mock @/lib/supabase-db — that global mock is exactly what these
 * tests exist to bypass.
 */

require('dotenv').config({ path: '.env.staging' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * True when a staging database is configured.
 *
 * Tests use `maybeDescribe` (below) so a machine without credentials skips
 * rather than fails — otherwise CI would go red for everyone who has not set
 * staging up, and the suite would get deleted within a week.
 */
global.HAS_DB = Boolean(url && key);

/**
 * Refuses to run against the production project.
 *
 * These tests write and delete rows. Pointing them at production would be a
 * one-character mistake in an env file, so it is checked rather than trusted.
 * The production project ref is recorded here deliberately: it is not a secret
 * (it ships in the public NEXT_PUBLIC_SUPABASE_URL), and the whole point is to
 * recognise it.
 */
const PRODUCTION_PROJECT_REF = 'dpuiznenrymoyarvdave';

if (global.HAS_DB && url.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error(
        `[db-integration] .env.staging points at the PRODUCTION project (${PRODUCTION_PROJECT_REF}). ` +
        `These tests create and delete rows. Point .env.staging at your staging project before running them.`
    );
}

if (!global.HAS_DB) {
    console.warn(
        '[db-integration] Skipping — no staging database configured.\n' +
        '  Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.staging.\n' +
        '  See docs/staging-setup.md.'
    );
}

/** describe() that skips the whole block when no database is configured. */
global.maybeDescribe = global.HAS_DB ? describe : describe.skip;
