/**
 * @jest-environment node
 */

/**
 * The remaining seven HTTP entry points no test had named, and the three
 * defects in them.
 *
 * ── A SUBSCRIPTION THAT SAVED NOTHING AND SAID IT HAD ───────────────────────
 *
 *   /api/notifications/subscribe wrote the push token with `update()`. The
 *   adapter's own warning names this exact case:
 *
 *       "update() on missing document — no rows will be affected. Use
 *        set(data, { merge: true }) if the document may not exist yet."
 *
 *   It keeps the write a no-op rather than throwing, deliberately, so the
 *   caller is told nothing. And a signed-in member CAN be without a profile
 *   row — /api/onboarding/complete handles precisely that case three routes
 *   over, creating the document when it finds none. For those members this
 *   returned `{ success: true }` and stored no token, so the browser believed
 *   it had subscribed and no push notification would ever arrive.
 *
 * ── TWO ADMIN GATES ON THE SESSION TOKEN ────────────────────────────────────
 *
 *   #356's class, on the two finance routes, and what they guard is the point:
 *   one reads the company's live Paystack balance, the other SENDS EMAILS to
 *   members about money owed them, in batches, on the platform's own template.
 *   A finance admin whose access had been revoked could do both for the rest of
 *   their session.
 *
 * ── AND THREE ROUTES HANDING OUT THE INSIDE OF THE SERVER ───────────────────
 *
 *   `details: error.message`, `error: error.message || "Internal error"`. The
 *   wallet route's defect, twice more. The cron route below does the same thing
 *   and is RIGHT to: it sits behind CRON_SECRET, only the scheduler reads it,
 *   and the message is what the workflow's failure reporting needs. The
 *   difference is who is listening, and it is asserted both ways.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

const ROOT = process.cwd();
const source = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });

const requireAdmin = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/require-admin', () => ({
    requireAdmin: (...args: any[]) => requireAdmin(...args),
}));

let store: FakeDbHandle;

function actAs(id: string | null) {
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : { session: { user: { id, roles: ['general_user'], email: `${id}@example.test` } }, error: null },
    ));
}

const post = (body: unknown) => ({ json: async () => body } as any);

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs('user-1');
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/notifications/subscribe', () => {
    const route = async () => await import('@/app/api/notifications/subscribe/route');

    it('A MEMBER WITH NO PROFILE ROW STILL GETS THEIR TOKEN SAVED', async () => {
        /*
         *   THE test. `update()` on a missing document is a logged no-op in
         *   this adapter, so this returned success and wrote nothing — and the
         *   browser then believed it was subscribed.
         */
        const res: any = await (await route()).POST(post({ token: 'fcm-token-abcdefghij' }));

        expect(await res.json()).toMatchObject({ success: true });
        expect((store.get(COLLECTIONS.USERS, 'user-1') as any)?.fcmToken)
            .toBe('fcm-token-abcdefghij');
    });

    it('AND A MEMBER WHO HAS ONE KEEPS EVERYTHING ELSE ON IT', () => {
        //   Merging, not setting: the row carries roles, email and the rest.
        store.seed(COLLECTIONS.USERS, 'user-1', { roles: ['general_user'], email: 'ada@example.test' });

        return route()
            .then((m) => m.POST(post({ token: 'fcm-token-abcdefghij' })))
            .then(() => {
                const row = store.get(COLLECTIONS.USERS, 'user-1') as any;
                expect(row.fcmToken).toBe('fcm-token-abcdefghij');
                expect(row.email).toBe('ada@example.test');
                expect(row.roles).toEqual(['general_user']);
            });
    });

    it('AN ANONYMOUS CALLER IS REFUSED, and writes nothing', async () => {
        actAs(null);

        const res: any = await (await route()).POST(post({ token: 'fcm-token-abcdefghij' }));

        expect(res.status).toBe(401);
        expect(store.size(COLLECTIONS.USERS)).toBe(0);
    });

    it('AND A TOKEN THAT IS NOT ONE IS REFUSED', async () => {
        const { POST } = await route();

        for (const body of [{}, { token: '' }, { token: 'short' }, { token: 12345678901 }]) {
            const res: any = await POST(post(body));
            expect({ body, status: res.status }).toEqual({ body, status: 400 });
        }
        expect(store.size(COLLECTIONS.USERS)).toBe(0);
    });

    it('DELETE REMOVES IT, and a member with no row is not given one', async () => {
        //   `update()` is right on this side: a member with no row has no token
        //   stored, so a no-op IS the correct outcome of asking for its removal.
        store.seed(COLLECTIONS.USERS, 'user-1', { fcmToken: 'fcm-token-abcdefghij' });

        expect((await (await route()).DELETE({} as any)).status).not.toBe(401);
        expect((store.get(COLLECTIONS.USERS, 'user-1') as any).fcmToken).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the two finance routes an admin reaches', () => {
    it('THE BALANCE ROUTE RE-READS THE ROLES rather than trusting the token', () => {
        const src = source('src/app/api/admin/finance/paystack-balance/route.ts');

        expect(src).toContain('requireAdmin("finance:read")');
        expect(src).not.toContain('session.user.roles');
    });

    it('AND SO DOES THE ONE THAT SENDS MEMBERS EMAIL ABOUT MONEY', () => {
        const src = source('src/app/api/admin/finance/recovery-emails/route.ts');

        expect(src).toContain('requireAdmin("finance:reconcile")');
        expect(src).not.toContain('hasAdminPermission(session.user.roles');
        //   And the audit row names the actor the GATE re-read, not the token.
        expect(src).toContain('userId: gate.userId');
    });

    it('A REFUSED GATE STOPS THE BALANCE ROUTE BEFORE PAYSTACK IS CALLED', async () => {
        requireAdmin.mockResolvedValue({ error: 'Unauthorized: Permission required' });
        const fetchSpy = jest.spyOn(globalThis, 'fetch' as any);

        const { GET } = await import('@/app/api/admin/finance/paystack-balance/route');
        const res: any = await GET({} as any);

        expect(res.status).toBe(403);
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('what each route says when something throws', () => {
    it('NO PUBLIC ROUTE PUTS THE EXCEPTION IN THE RESPONSE', () => {
        /*
         *   Three of them did. `details: error.message` and
         *   `error: error.message || "Internal error"` hand whatever threw — a
         *   database error, a fetch failure — to whoever asked.
         */
        for (const rel of [
            'src/app/api/onboarding/complete/route.ts',
            'src/app/api/admin/finance/paystack-balance/route.ts',
            'src/app/api/wallet/verify/route.ts',
        ]) {
            const src = source(rel);
            expect({ rel, leaks: /error\.message/.test(src) }).toEqual({ rel, leaks: false });
        }
    });

    it('AND THE CRON ROUTE STILL DOES, because only the scheduler reads it', () => {
        /*
         *   The vacuity guard, and the actual rule: this is not "never return a
         *   message", it is "not to the public". backfill-missing-emails sits
         *   behind CRON_SECRET and the message is what the workflow's failure
         *   reporting needs in order to say what broke.
         */
        const src = source('src/app/api/cron/backfill-missing-emails/route.ts');

        expect(src).toContain('refuseUnauthorisedCron');
        expect(src).toMatch(/error instanceof Error \? error\.message/);
    });

    it('AND A RUN THAT REACHED NOTHING IS A 500, not a green tick', () => {
        //   A job that reports `{ ok: true }` over a run that did not happen is
        //   how a scheduled check stops being read.
        const src = source('src/app/api/cron/backfill-missing-emails/route.ts');

        expect(src).toContain('couldNotTell.length === report.scanned');
        expect(src).toContain('report.scanned > 0');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and the two smallest', () => {
    it('MFA ENABLE REQUIRES A SIX-CHARACTER STRING, not anything of length six', () => {
        //   The body is arbitrary JSON: an ARRAY of six elements has
        //   `length === 6` and would have reached verifyTOTPToken, which
        //   expects a string. On the endpoint that turns on a second factor.
        const src = source('src/app/api/auth/mfa/enable/route.ts');

        expect(src).toContain('typeof token !== "string"');
        //   And it is rate limited, because the alternative is brute-forcing a
        //   six-digit code.
        expect(src).toContain('withRateLimit(enableMFAHandler, "mfa-enable")');
    });

    it('AND THE NEXTAUTH ROUTE EXPORTS BOTH VERBS', () => {
        //   Five lines, and the whole of sign-in depends on them being exported
        //   under the names the framework looks for.
        const src = source('src/app/api/auth/[...nextauth]/route.ts');

        expect(src).toContain('export const { GET, POST } = handlers');
        expect(src).toContain("from \"@/lib/auth\"");
    });
});
