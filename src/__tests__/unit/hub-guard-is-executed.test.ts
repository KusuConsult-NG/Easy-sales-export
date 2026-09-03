/**
 * @jest-environment node
 */

/**
 *   #366 THE GUARD ON SIXTEEN LAYOUTS HAD NEVER BEEN RUN.
 *
 *        lib/hub-guard.ts wraps the front door of every module in this
 *        platform — dashboard, messages, and the member and onboarding
 *        layouts of marketplace (seller, buyer, onboarding), farm-nation,
 *        export, cooperatives, WAVE and academy. Sixteen layouts import
 *        requireHubRegistration, and it decides, for each of them, whether the
 *        caller gets in or is sent to /hub/register.
 *
 *        It sat at 0% executed coverage. Five suites assert things about it —
 *        #353's admin-bypass fix, the cached-profile contract, the forced
 *        password change — and every one of them reads the FILE. Not one of
 *        them calls the function. That is the shape this audit keeps finding:
 *        a control that is described rather than exercised, where a test
 *        passes because the source still contains a string.
 *
 *        WHAT RUNNING IT FOUND
 *        ---------------------
 *        1. EVERY FORCED PASSWORD RESET WAS LOGGED AS AN EXCEPTION.
 *
 *           Two of the three redirect() calls sit INSIDE the try block. Next's
 *           redirect() works by throwing NEXT_REDIRECT, so both were caught by
 *
 *               } catch(err) {
 *                   console.error("Hub Guard Exception:", err);
 *                   throw err;
 *               }
 *
 *           The rethrow means the redirect still happens — the behaviour was
 *           correct — but every legacy member sent to
 *           /auth/reset-legacy-password produced a console.error naming a
 *           control-flow signal as a fault. The file's own closing comment says
 *           "redirect() MUST be called outside the try/catch block", and two of
 *           its three calls are inside it. A log that cries wolf on the normal
 *           path is how the real Hub Guard Exception goes unread.
 *
 *        2. AN ADMIN WITH A TEMPORARY PASSWORD IS NEVER ASKED TO CHANGE IT.
 *
 *           The admin bypass returns before requiresPasswordChange is read, so
 *           an admin account created by the legacy import keeps its temporary
 *           PIN through every module. session-guard.ts does not force it
 *           either — it is read there for the session payload, not as a gate.
 *           RECORDED, not changed: forcing a password change on admins is a
 *           policy decision, and it is stated at the bottom of this file so it
 *           is a decision rather than an oversight.
 *
 *        Everything else this suite pins is behaviour that was already right
 *        and had simply never been demonstrated: the ten-role admin bypass
 *        from #353, the cache-then-database read, the refusal of an incomplete
 *        profile, and the rethrow of a database error rather than a redirect —
 *        which matters because redirecting on a transient outage would send a
 *        fully-registered member back through onboarding.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { ALL_ADMIN_ROLES } from '@/lib/admin-permissions';
import { stripComments } from '@/lib/testing/strip-comments';

/** Next's redirect() throws; this reproduces that so callers can be observed. */
class RedirectSignal extends Error {
    constructor(public readonly to: string) {
        super(`NEXT_REDIRECT;${to}`);
        this.name = 'NEXT_REDIRECT';
    }
}

jest.mock('next/navigation', () => ({
    redirect: (to: string) => { throw new RedirectSignal(to); },
}));

let cached: unknown = null;

jest.mock('@/lib/redis', () => ({
    getCached: async () => cached,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
    CacheKeys: { userProfile: (id: string) => `user:profile:${id}` },
}));

let store: FakeDbHandle;

async function guard() {
    return (await import('@/lib/hub-guard')).requireHubRegistration();
}

/** Run the guard and report where it sent the caller, or that it returned. */
async function outcome(): Promise<{ redirectedTo: string } | { returned: true } | { threw: string }> {
    try {
        await guard();
        return { returned: true };
    } catch (e) {
        if (e instanceof RedirectSignal) return { redirectedTo: e.to };
        return { threw: (e as Error).message };
    }
}

function signedInAs(id: string, roles: string[]) {
    (global as any).mockRequireSession.mockResolvedValue({
        session: { user: { id, roles, email: `${id}@example.com`, name: id } },
        error: null,
    });
}

beforeEach(() => {
    jest.resetModules();
    store = installFakeDb();
    cached = null;
    (global as any).mockRequireSession.mockReset();
    signedInAs('member-1', ['general_user']);
});

afterEach(() => {
    store.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#366 — the guard runs, and lets a completed member through', () => {
    it('a member whose profile is complete is admitted', async () => {
        store.seed('users', 'member-1', { profileComplete: true });

        expect(await outcome()).toEqual({ returned: true });
    });

    it('an incomplete profile goes to /hub/register', async () => {
        store.seed('users', 'member-1', { profileComplete: false });

        expect(await outcome()).toEqual({ redirectedTo: '/hub/register' });
    });

    it('and so does an account with no user row at all', async () => {
        expect(await outcome()).toEqual({ redirectedTo: '/hub/register' });
    });

    it('a row that simply has no profileComplete field is refused too', async () => {
        // The strict `=== true` is the point: an account created before the
        // field existed, or by a writer that forgets it, is NOT admitted by
        // absence. `!== false` would have let every one of them in.
        store.seed('users', 'member-1', { email: 'member-1@example.com' });

        expect(await outcome()).toEqual({ redirectedTo: '/hub/register' });
    });

    it('a signed-out caller goes to the login page, carrying the reason', async () => {
        (global as any).mockRequireSession.mockResolvedValue({
            session: null,
            error: { error: 'Session revoked' },
        });

        const result = await outcome();

        expect(result).toEqual({ redirectedTo: '/auth/login?error=Session%20revoked' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#366 — the #353 admin bypass, executed rather than read', () => {
    it('ALL TEN ADMIN ROLES ARE ADMITTED WITHOUT A USER ROW', async () => {
        // #353's fix was asserted from source text. This runs it. moderator and
        // support are the two the hand-written `endsWith("_admin")` test
        // refused, and they are in this list.
        for (const role of ALL_ADMIN_ROLES) {
            jest.resetModules();
            store.clear();
            signedInAs('staff-1', [role]);

            expect({ role, outcome: await outcome() }).toEqual({ role, outcome: { returned: true } });
        }
    });

    it('and a non-admin role is not admitted by the same path', async () => {
        // Vacuity guard: if the bypass admitted everyone, the loop above would
        // pass for the wrong reason.
        signedInAs('seller-1', ['seller', 'general_user']);

        expect(await outcome()).toEqual({ redirectedTo: '/hub/register' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#366 — the cached profile is trusted, and the database is the fallback', () => {
    it('a cached complete profile is admitted without touching the database', async () => {
        cached = { profileComplete: true };
        // Nothing seeded: if the guard read the database it would redirect.

        expect(await outcome()).toEqual({ returned: true });
    });

    it('and a cached INCOMPLETE profile is refused without touching it either', async () => {
        cached = { profileComplete: false };
        store.seed('users', 'member-1', { profileComplete: true });

        expect(await outcome()).toEqual({ redirectedTo: '/hub/register' });
    });

    it('a cache miss falls through to the database', async () => {
        cached = null;
        store.seed('users', 'member-1', { profileComplete: true });

        expect(await outcome()).toEqual({ returned: true });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#366 — the forced password change', () => {
    it('a legacy member with a temporary password is sent to reset it', async () => {
        store.seed('users', 'member-1', { profileComplete: true, requiresPasswordChange: true });

        expect(await outcome()).toEqual({ redirectedTo: '/auth/reset-legacy-password' });
    });

    it('and so is one who has not finished onboarding — reset comes first', async () => {
        store.seed('users', 'member-1', { profileComplete: false, requiresPasswordChange: true });

        expect(await outcome()).toEqual({ redirectedTo: '/auth/reset-legacy-password' });
    });

    it('AN ADMIN WITH A TEMPORARY PASSWORD IS NEVER ASKED — recorded, not changed', async () => {
        // The bypass returns before requiresPasswordChange is read. Stated as a
        // test so the policy is visible: an admin provisioned by the legacy
        // import keeps its temporary PIN across every module.
        signedInAs('staff-1', ['admin']);
        store.seed('users', 'staff-1', { profileComplete: true, requiresPasswordChange: true });

        expect(await outcome()).toEqual({ returned: true });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#366 — a database outage must not look like an unfinished profile', () => {
    it('the error is rethrown, not turned into a redirect', async () => {
        // Redirecting here would send a fully-registered member back through
        // onboarding because Postgres blinked. The file says so; this proves it.
        (global as any).mockFirestoreGet.mockRejectedValueOnce(new Error('connection reset'));

        expect(await outcome()).toEqual({ threw: 'connection reset' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#366 — a redirect is not an exception', () => {
    it('THE FORCED-RESET REDIRECT IS NOT LOGGED AS A HUB GUARD EXCEPTION', () => {
        // Both reset redirects sat inside the try, and Next's redirect() works
        // by throwing, so `catch(err) { console.error("Hub Guard Exception") }`
        // fired on the normal legacy-member path. The rethrow kept the
        // behaviour right and the log wrong.
        //
        // Asserted on the source because the fix is structural: the redirect
        // target is now decided inside the try and performed outside it, the
        // same shape the file already used for /hub/register.
        // COMMENT-STRIPPED FIRST, and that is load-bearing. The #366 note in
        // hub-guard.ts quotes the very `} catch(err) {` this slice looks for,
        // and it appears BEFORE the try — so on raw source the slice ran
        // backwards, produced an empty string, and passed no matter what the
        // code did. Mutation M5 proved it. Eighth time in this audit that a
        // tombstone comment has been mistaken for live code.
        const src = stripComments(require('fs').readFileSync(
            require('path').join(process.cwd(), 'src/lib/hub-guard.ts'), 'utf-8'));
        const openTry = src.indexOf('try {');
        const closeTry = src.indexOf('} catch');

        expect(openTry).toBeGreaterThan(-1);
        expect(closeTry).toBeGreaterThan(openTry);
        expect(src.slice(openTry, closeTry)).not.toContain('redirect(');
    });

    it('and the guard still sends legacy members to the reset page', async () => {
        // The behavioural half of the same claim: restructuring must not lose
        // the redirect it was restructuring.
        store.seed('users', 'member-1', { profileComplete: true, requiresPasswordChange: true });

        expect(await outcome()).toEqual({ redirectedTo: '/auth/reset-legacy-password' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#366 — the sixteen layouts this guards', () => {
    /**
     * The exact set, so none of the above is hypothetical and so a layout that
     * quietly stops asking cannot hide behind a count.
     *
     * Mutation M12 renamed the import in dashboard/layout.tsx and survived
     * twice: first because `requireHubRegistrationX` contains the bare name,
     * then because three OTHER files mention the guard only in comments, so a
     * raw-text count of 19 stayed above a `>= 16` assertion after one was lost.
     * Word-anchored, comment-stripped, and pinned as a list.
     */
    const BEHIND_THE_GUARD = [
        'src/app/academy/(learner)/layout.tsx',
        'src/app/academy/setup/layout.tsx',
        'src/app/cooperatives/(member)/layout.tsx',
        'src/app/cooperatives/onboarding/layout.tsx',
        'src/app/cooperatives/onboarding/page.tsx',
        'src/app/dashboard/layout.tsx',
        'src/app/export/(app)/layout.tsx',
        'src/app/export/onboarding/layout.tsx',
        'src/app/farm-nation/(member)/layout.tsx',
        'src/app/farm-nation/onboarding/layout.tsx',
        'src/app/marketplace/buyer/layout.tsx',
        'src/app/marketplace/onboarding/layout.tsx',
        'src/app/marketplace/seller/layout.tsx',
        'src/app/messages/layout.tsx',
        'src/app/wave/(member)/layout.tsx',
        'src/app/wave/application/layout.tsx',
    ];

    it('ARE EXACTLY THE SIXTEEN RECORDED, so none of the above is hypothetical', () => {
        const { readFileSync, readdirSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');
        const ROOT = process.cwd();

        const found: string[] = [];
        const walk = (dir: string) => {
            for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
                const rel = `${dir}/${e.name}`;
                if (e.isDirectory()) walk(rel);
                else if (/\.tsx?$/.test(e.name)
                    && /\brequireHubRegistration\b/.test(
                        stripComments(readFileSync(join(ROOT, rel), 'utf-8')))) {
                    found.push(rel);
                }
            }
        };
        walk('src/app');

        expect(found.sort()).toEqual([...BEHIND_THE_GUARD].sort());
    });

    it('and three more files mention it only in comments', () => {
        // Named, because they are why a raw-text count was 19 and not 16.
        for (const file of [
            'src/app/profile/page.tsx',
            'src/app/actions/auth.ts',
            'src/app/actions/password-reset.ts',
        ]) {
            const raw = require('fs').readFileSync(
                require('path').join(process.cwd(), file), 'utf-8');

            expect({ file, raw: /requireHubRegistration|hub-guard/.test(raw),
                code: /requireHubRegistration/.test(stripComments(raw)) })
                .toEqual({ file, raw: true, code: false });
        }
    });
});
