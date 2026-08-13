/**
 * Setup for the application integration suites.
 *
 * The difference from jest.setup.js is the whole point: this one does NOT mock
 * @/lib/supabase-db. These suites call real actions (processCooperativeRegistration,
 * getCleanBroadcastList) and let them write to a real database, which is the
 * only way to find out whether the adapter, the schema and the logic agree.
 *
 * The difference from jest.db.setup.js is subject matter. That suite tests the
 * adapter against Postgres. This one tests the application.
 *
 * Run with:  npm run test:integration
 * In CI:     against an ephemeral Supabase stack, see .github/workflows/ci.yml
 */

const { resolveDbEnv } = require('./src/lib/testing/db-env-guard');

const { hasDb } = resolveDbEnv({ label: 'integration' });

global.HAS_DB = hasDb;

/** describe() that skips the whole block when no database is configured. */
global.maybeDescribe = hasDb ? describe : describe.skip;

// Real network round trips against a database that may have just booted.
jest.setTimeout(30000);
