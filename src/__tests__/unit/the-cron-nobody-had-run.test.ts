/**
 * @jest-environment node
 */

/**
 *   #967 THE ROUTE THE OWNER IS BEING ASKED TO CURL HAD NEVER BEEN EXECUTED.
 *
 *   /api/cron/migration-audit is the check that says whether production's schema
 *   carries every migration the code expects. It cannot be run from this
 *   container — it needs `Authorization: Bearer <CRON_SECRET>`, and a plain
 *   browser gets 401 — so it has sat on the owner's list as "still unrun" across
 *   several sessions.
 *
 *   Two suites mention it. NEITHER EXECUTES IT: expired-export-windows-close and
 *   nothing-said-the-other-half-had-not-shipped both name the path in prose or a
 *   manifest and neither imports the handler. So the one thing nobody knew was
 *   whether the route works at all — and the cost of finding out the hard way is
 *   a production call that returns a 500 and tells the owner nothing.
 *
 *   That is the #366 and #965 shape a third time: a control described rather than
 *   run. This runs it.
 *
 * ── WHAT THIS DOES AND DOES NOT PROVE ───────────────────────────────────────
 *
 *   PROVES: the handler's own path. The refusals, the verdict-to-status mapping,
 *   and that a `cannot-tell` does not read as a clean bill — which is the rule
 *   the route's own header states and the one most worth pinning, because a check
 *   that could not look must never answer 200.
 *
 *   DOES NOT PROVE: that auditMigrations reads production correctly. That reads a
 *   real database and is mocked here. The point is narrower and still worth
 *   having: when the owner finally runs this with the secret, a 500 will not be
 *   the route's own doing.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';
import type { MigrationAudit } from '@/lib/migration-audit';

let audit: MigrationAudit;

jest.mock('@/lib/migration-audit', () => ({
    auditMigrations: async () => audit,
    reportMigrationAudit: () => undefined,
}));

const SECRET = 'a-secret-only-the-scheduler-has';
const ORIGINAL = process.env.CRON_SECRET;

async function call(headers: Record<string, string> = {}) {
    const mod = await import('@/app/api/cron/migration-audit/route');
    const res = await mod.GET(new NextRequest('https://example.com/api/cron/migration-audit', { headers }));
    return { status: res.status, body: await res.json() as Record<string, unknown> };
}

const authorised = { authorization: `Bearer ${SECRET}` };

beforeEach(() => {
    jest.resetModules();
    process.env.CRON_SECRET = SECRET;
    audit = {
        verdict: 'in-sync', expected: 53, missing: [], applyThese: [], detail: 'all present',
    } as unknown as MigrationAudit;
});

afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL;
});

describe('#967 — /api/cron/migration-audit, executed', () => {
    it('AN IN-SYNC SCHEMA ANSWERS 200 AND success: true', async () => {
        const { status, body } = await call(authorised);

        expect({ status, success: body.success, verdict: body.verdict })
            .toEqual({ status: 200, success: true, verdict: 'in-sync' });
    });

    it('A SCHEMA BEHIND THE CODE ANSWERS 503, AND RELAYS WHAT TO APPLY', async () => {
        /*
         *   The answer has to be actionable, not merely negative: the owner's next
         *   move is to apply what is missing, so the names have to come back.
         */
        audit = {
            verdict: 'behind',
            expected: 53,
            missing: [{ kind: 'index', name: 'idx_users_deleted_true' }],
            applyThese: ['053_live_people_count_indexes.sql'],
            detail: 'one index missing',
        } as unknown as MigrationAudit;

        const { status, body } = await call(authorised);

        expect({ status, success: body.success, verdict: body.verdict })
            .toEqual({ status: 503, success: false, verdict: 'behind' });
        expect(body.missingCount).toBe(1);
        expect(body.applyThese).toEqual(['053_live_people_count_indexes.sql']);
    });

    it('AND `cannot-tell` DOES NOT READ AS A CLEAN BILL — the route\'s own rule', async () => {
        /*
         *   The rule stated in the route's header: "A check that could not look must
         *   never read as a clean bill." It is the assertion most worth having,
         *   because the failure it prevents is the quiet one — an audit that could
         *   not reach the database answering 200 and the owner reading that as
         *   "production is fine".
         */
        audit = {
            verdict: 'cannot-tell',
            expected: 53,
            missing: [],
            applyThese: [],
            detail: 'could not read the applied list',
            cause: 'permission denied for table supabase_migrations',
        } as unknown as MigrationAudit;

        const { status, body } = await call(authorised);

        expect({ status, success: body.success }).toEqual({ status: 503, success: false });
        expect(body.cause).toBe('permission denied for table supabase_migrations');
    });

    it('a request with no Authorization header is refused, and does not run the audit', async () => {
        let ran = false;
        //   Re-mocked for this test alone: the refusal must come BEFORE the work,
        //   or an unauthenticated caller costs a database read.
        jest.resetModules();
        jest.doMock('@/lib/migration-audit', () => ({
            auditMigrations: async () => { ran = true; return audit; },
            reportMigrationAudit: () => undefined,
        }));

        const { status } = await call();

        expect(status).toBe(401);
        expect({ ranTheAudit: ran }).toEqual({ ranTheAudit: false });
    });

    it('and a wrong secret is refused too, so the header is checked rather than merely present', async () => {
        const { status } = await call({ authorization: 'Bearer not-the-secret' });

        expect(status).toBe(401);
    });

    it('AND AN UNCONFIGURED CRON_SECRET IS A 500, NOT AN OPEN DOOR', async () => {
        /*
         *   The fail-closed half. A missing secret must not mean "no check
         *   required" — that is the shape where a cron endpoint becomes public
         *   because an environment variable was never set.
         */
        delete process.env.CRON_SECRET;

        const { status } = await call(authorised);

        expect(status).toBe(500);
    });
});
