/**
 * @jest-environment node
 */

/**
 * A link could run a schema migration over three collections.
 *
 * THE BUG
 * -------
 * /api/admin/schema-fix exported a GET, and `?dryRun=false` makes
 * runSchemaStandardizationAction write:
 *
 *     users            roles: ["general_user"] where roles is not an array,
 *                      isVerified: false, createdAt, updatedAt
 *     products         status: "draft", price: 0, availableQuantity: 0
 *     export_windows   defaults for missing fields
 *
 * The session cookie is `sameSite: "lax"` (src/lib/auth.config.ts), and Lax
 * sends the cookie on a top-level GET navigation. So a link anywhere a
 * signed-in super_admin might click it —
 *
 *     https://.../api/admin/schema-fix?dryRun=false
 *
 * — ran the migration, with no form, no token and no confirmation.
 *
 * The `roles` write is the sharp end. A user document whose roles field is
 * missing or malformed is reset to ["general_user"], so this is a way to strip
 * an administrator's roles by getting a *different* administrator to follow a
 * link. Lax does not send cookies on a cross-site POST, so the method is the
 * fix.
 *
 * Even the default dry run was worth moving off GET: it reads all 41,105 user
 * documents plus every product, and returns a `details` array naming each one.
 *
 * THE SECRET PATH COULD NOT WORK
 * ------------------------------
 *     const hasValidSecret = process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
 *     if (!hasValidSecret) { ...session check... }
 *
 * runSchemaStandardizationAction opens with its own requireSession() and
 * config:update check, so a caller holding the secret and no session reached the
 * action and was refused by it — and the route returned the action's result
 * verbatim, so that refusal came back as **HTTP 200** with
 * `{ success: false, error: "Unauthorized..." }`.
 *
 * A scheduler pointed at this reports success forever while doing nothing,
 * which is how the four unscheduled cron endpoints went unnoticed. Nothing
 * references this route — no UI, no workflow, no script; `npm run fix:schema`
 * runs scripts/firebase-schema-fix.ts directly — so the path is removed rather
 * than repaired, and a failure now carries an error status.
 *
 * NOT RECONCILED
 * --------------
 * The route requires the super_admin ROLE; the action requires the
 * config:update PERMISSION, which `admin` holds too. The route is stricter than
 * the action it calls, and the action is invokable as a server action either
 * way. Narrowing the action would take config:update from `admin` everywhere
 * else; widening the route would let `admin` rewrite the users collection. Both
 * are product decisions. Pinned below so neither drifts by accident.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const requireSession = jest.fn<any>();
const runSchemaStandardizationAction = jest.fn<any>();

jest.mock('@/lib/session-guard', () => ({
    requireSession: (...args: any[]) => requireSession(...args),
}));

jest.mock('@/app/actions/schema-standardization', () => ({
    runSchemaStandardizationAction: (...args: any[]) => runSchemaStandardizationAction(...args),
}));

const SUPER_ADMIN = { session: { user: { id: 'sa-1', roles: ['super_admin'] } }, error: null };
const PLAIN_ADMIN = { session: { user: { id: 'a-1', roles: ['admin'] } }, error: null };
const ANONYMOUS = { session: null, error: { error: 'Authentication required' } };

const OK = { success: true, error: null, data: { reports: [] } };

function request(url = 'https://example.com/api/admin/schema-fix', auth?: string) {
    return {
        url,
        headers: { get: (k: string) => (k.toLowerCase() === 'authorization' && auth ? auth : null) },
    } as any;
}

async function loadRoute() {
    return await import('@/app/api/admin/schema-fix/route');
}

beforeEach(() => {
    jest.resetModules();
    requireSession.mockReset();
    runSchemaStandardizationAction.mockReset();
    runSchemaStandardizationAction.mockResolvedValue(OK);
    delete process.env.CRON_SECRET;
});

describe('a migration is not a link', () => {
    it('there is no GET handler', async () => {
        // THE test. A GET is what a browser issues when a link is followed, and
        // a lax cookie rides along with it.
        const route: any = await loadRoute();

        expect(route.GET).toBeUndefined();
    });

    it('the handler is a POST', async () => {
        const route: any = await loadRoute();

        expect(typeof route.POST).toBe('function');
    });

    it('and it still runs for a super_admin', async () => {
        // Vacuity guard: a route that refuses everyone passes every assertion
        // above and quietly removes the only way to run this.
        requireSession.mockResolvedValue(SUPER_ADMIN);
        const { POST } = await loadRoute();

        const res: any = await POST(request());

        expect(res.status).toBe(200);
        expect(runSchemaStandardizationAction).toHaveBeenCalled();
    });
});

describe('dryRun still defaults to safe', () => {
    beforeEach(() => { requireSession.mockResolvedValue(SUPER_ADMIN); });

    it('no parameter means a dry run', async () => {
        const { POST } = await loadRoute();

        await POST(request());

        expect(runSchemaStandardizationAction).toHaveBeenCalledWith(true);
    });

    it('an unrecognised value means a dry run', async () => {
        // Only the exact string "false" writes. "0", "no" and "" must not.
        for (const value of ['0', 'no', '', 'False', 'true']) {
            jest.resetModules();
            runSchemaStandardizationAction.mockClear();
            const { POST } = await loadRoute();

            await POST(request(`https://example.com/api/admin/schema-fix?dryRun=${value}`));

            expect(`${value}: ${runSchemaStandardizationAction.mock.calls[0][0]}`).toBe(`${value}: true`);
        }
    });

    it('dryRun=false writes, as it always did', async () => {
        const { POST } = await loadRoute();

        await POST(request('https://example.com/api/admin/schema-fix?dryRun=false'));

        expect(runSchemaStandardizationAction).toHaveBeenCalledWith(false);
    });
});

describe('the secret no longer stands in for a session', () => {
    it('a valid CRON_SECRET does not admit an anonymous caller', async () => {
        // It used to skip the session check, reach the action, and be refused
        // there — reported back as HTTP 200.
        process.env.CRON_SECRET = 'a-real-secret';
        requireSession.mockResolvedValue(ANONYMOUS);
        const { POST } = await loadRoute();

        const res: any = await POST(request(undefined, 'Bearer a-real-secret'));

        expect(res.status).toBe(401);
        expect(runSchemaStandardizationAction).not.toHaveBeenCalled();
    });

    it('the route reads no authorization header at all', async () => {
        const { readFileSync } = require('fs');
        const { join } = require('path');
        const src: string = readFileSync(
            join(process.cwd(), 'src/app/api/admin/schema-fix/route.ts'),
            'utf-8'
        );
        const code = src
            .split('\n')
            .filter((l: string) => {
                const t = l.trim();
                return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
            })
            .join('\n');

        expect(code).not.toContain('CRON_SECRET');
        expect(code).not.toContain('authorization');
    });
});

describe('a refusal is not a success', () => {
    it('a failed run answers with an error status', async () => {
        // The action's { success: false } used to come back as HTTP 200, so a
        // scheduler could report success forever while nothing happened.
        requireSession.mockResolvedValue(SUPER_ADMIN);
        runSchemaStandardizationAction.mockResolvedValue({
            success: false,
            error: "Unauthorized: Admin permission 'config:update' required.",
            data: null,
        });
        const { POST } = await loadRoute();

        const res: any = await POST(request());

        expect(res.status).toBe(500);
    });

    it('a thrown error is not a success either', async () => {
        requireSession.mockResolvedValue(SUPER_ADMIN);
        runSchemaStandardizationAction.mockRejectedValue(new Error('adapter exploded'));
        const { POST } = await loadRoute();

        const res: any = await POST(request());

        expect(res.status).toBe(500);
    });
});

describe('who may run it', () => {
    it('an anonymous caller may not', async () => {
        requireSession.mockResolvedValue(ANONYMOUS);
        const { POST } = await loadRoute();

        const res: any = await POST(request());

        expect(res.status).toBe(401);
        expect(runSchemaStandardizationAction).not.toHaveBeenCalled();
    });

    it('a plain admin may not, through this route', async () => {
        // Pinned, not fixed. The action this calls accepts config:update, which
        // `admin` holds — so `admin` can invoke it as a server action while this
        // route refuses them. Two definitions of one authority; reconciling them
        // is a product decision either way, and this is the stricter side.
        requireSession.mockResolvedValue(PLAIN_ADMIN);
        const { POST } = await loadRoute();

        const res: any = await POST(request());

        expect(res.status).toBe(401);
        expect(runSchemaStandardizationAction).not.toHaveBeenCalled();
    });

    it('and the divergence is real, not imagined', async () => {
        const { hasAdminPermission } = await import('@/lib/admin-permissions');

        expect(hasAdminPermission(['admin'], 'config:update')).toBe(true);
        expect(hasAdminPermission(['super_admin'], 'config:update')).toBe(true);
        expect(hasAdminPermission(['support'], 'config:update')).toBe(false);
    });
});
