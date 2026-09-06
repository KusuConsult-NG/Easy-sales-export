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
const { hasDb, isLocal } = resolveDbEnv({ label: 'db-integration' });

/** True when a real database is configured. */
global.HAS_DB = hasDb;

/**
 * True only for 127.0.0.1 / localhost.
 *
 * Exposed because a destructive test helper must be able to refuse, and the
 * locality decision is already made here — restating it in the helper would be
 * a second copy of a safety rule, which is how the weaker one ends up deciding.
 * See src/__tests__/integration/setup.ts.
 */
global.DB_IS_LOCAL = isLocal;

/** describe() that skips the whole block when no database is configured. */
global.maybeDescribe = hasDb ? describe : describe.skip;
