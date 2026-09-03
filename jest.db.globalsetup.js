/**
 * Probes what the configured stack can actually serve, before any test runs.
 *
 * WHY A CAPABILITY PROBE AND NOT JUST "IS A DATABASE CONFIGURED"
 * -------------------------------------------------------------
 * db-env-guard answers "is there a database", which is the right question for
 * fifteen of the sixteen files here. auth-shim-pagination.test.ts asks a
 * different one: it drives supabase.auth.admin.*, which is GoTrue, a separate
 * service from PostgREST.
 *
 * A rig that serves the REST API but not GoTrue — which is what you get
 * without Docker, and what scripts/local-supabase-rest.sh sets up — turned
 * those eight tests red. Red for a missing service reads exactly like red for
 * a broken shim, and this suite exists to make that distinction, not to blur
 * it. So the capability is probed and the file skips when it is absent, the
 * same way the whole suite skips when no database is configured.
 *
 * A probe rather than a flag, because a flag is a second copy of a fact the
 * stack already knows.
 */

const path = require('path');

module.exports = async function globalSetup() {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
        require('dotenv').config({ path: path.resolve(process.cwd(), '.env.staging') });
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.DB_SUITE_HAS_GOTRUE = 'false';
    if (!url) return;

    try {
        // /auth/v1/health is GoTrue's own liveness endpoint. Any answer at all
        // means the service is routed; a 501 from a gateway that does not serve
        // it, or a connection error, means it is not.
        const res = await fetch(`${url.replace(/\/$/, '')}/auth/v1/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(5000),
        });
        process.env.DB_SUITE_HAS_GOTRUE = String(res.status < 500);
    } catch {
        process.env.DB_SUITE_HAS_GOTRUE = 'false';
    }
};
