/**
 * @jest-environment node
 */

/**
 * HOW LONG THE ANSWER TOOK WAS STILL PART OF THE ANSWER.
 *
 * #361 and #363 made the login pre-check and registration return identical
 * replies whether or not an address is registered. That closes what the reply
 * SAYS. It leaves what the clock says, and the two registration paths do
 * genuinely different work:
 *
 *   free address     createUser (a password hash), then a profile write
 *   taken address    createUser fails, signInWithPassword (another hash),
 *                    then a notification email
 *
 * An attacker who cannot read a difference in the body can measure one in the
 * response time, and with enough samples the network noise averages out. The
 * two fixes above are worth much less while that holds.
 *
 * WHAT WAS DONE
 * -------------
 * Every enumeration-sensitive reply is held to a common floor, so the work
 * behind it stops being visible. Registration pads every exit, including
 * validation errors and thrown exceptions — an exception that escapes early is
 * as good an oracle as a fast rejection. The login pre-check pads FAILURES
 * only; a successful sign-in is the hot path and carries no signal, since
 * everyone already knows their own address is registered.
 *
 * The notification email is capped rather than merely awaited. It is the one
 * piece of work only the taken path does, so a slow send is exactly what would
 * push that path past the floor and hand the signal back.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * A floor is not a fixed cost. A path that naturally runs LONGER than the floor
 * is not padded and leaks as before — which is silent by nature, so the helper
 * logs it. Nothing here can equalise TLS, a CDN, or variance inside the auth
 * provider. The claim is bounded and asserted as such: the work THIS codebase
 * does is no longer visible in the response time.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

// A short floor, set before the module under test is imported. The alternative
// is a suite that genuinely sleeps 1.5s per case, which nobody would keep.
const TEST_FLOOR_MS = 120;
process.env.AUTH_RESPONSE_FLOOR_MS = String(TEST_FLOOR_MS);

import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

const VICTIM_AUTH_ID = 'victim-uuid';
const VICTIM_EMAIL = 'admin@example.com';

const createUser = jest.fn(async (_a: Record<string, unknown>) => ({
    data: { user: { id: 'fresh-uuid' } } as any,
    error: null as { message: string } | null,
}));
const signInWithPassword = jest.fn(async (_c: { email: string; password: string }) => ({
    data: { user: null } as any,
    error: { message: 'Invalid login credentials' } as any,
}));
/** A deliberately slow notification, to prove the cap does something. */
let emailDelayMs = 0;
const sendEmailNotification = jest.fn(async (_d: Record<string, unknown>) => {
    if (emailDelayMs > 0) await new Promise((r) => setTimeout(r, emailDelayMs));
    return { success: true };
});

jest.mock('@/lib/supabase', () => ({
    supabaseAdmin: {
        auth: { admin: {
            createUser: (a: Record<string, unknown>) => createUser(a),
            listUsers: async () => ({ data: { users: [] } }),
        } },
        from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
        rpc: async () => ({ data: null, error: null }),
    },
}));
jest.mock('@supabase/supabase-js', () => ({
    createClient: () => ({ auth: { signInWithPassword: (c: any) => signInWithPassword(c) } }),
}));
jest.mock('@/lib/email-notifications', () => ({
    sendEmailNotification: (d: Record<string, unknown>) => sendEmailNotification(d),
    getBaseUrl: () => 'https://easysalesexport.com',
}));
jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: async () => ({ success: true, remaining: 4 }) }),
    loginLimiter: { check: async () => ({ success: true, remaining: 4 }) },
    getActionClientIp: async () => '127.0.0.1',
    checkRateLimit: async () => ({ success: true }),
}));
jest.mock('@/lib/rate-limit', () => ({
    consumeLoginAttempt: async () => ({ allowed: true }),
    resetLoginAttempts: async () => undefined,
}));
jest.mock('resend', () => ({
    Resend: class { emails = { send: async () => ({ error: null }) }; },
}));
jest.mock('next/headers', () => ({
    headers: async () => ({ get: () => '' }),
    cookies: async () => ({ set: () => undefined, get: () => undefined }),
}));

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    emailDelayMs = 0;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    createUser.mockImplementation(async () => ({ data: { user: { id: 'fresh-uuid' } }, error: null }));
    signInWithPassword.mockImplementation(async () => ({
        data: { user: null }, error: { message: 'Invalid login credentials' },
    }));
});

afterEach(() => {
    delete process.env.AUTH_RESPONSE_FLOOR_MS;
    process.env.AUTH_RESPONSE_FLOOR_MS = String(TEST_FLOOR_MS);
});

async function actions() {
    return import('@/app/actions/auth');
}

function registration(email: string): FormData {
    const fd = new FormData();
    Object.entries({
        fullName: 'Some Person',
        email,
        password: 'Str0ng!Passw0rd',
        confirmPassword: 'Str0ng!Passw0rd',
        phone: '08030000001',
        gender: 'male',
    }).forEach(([k, v]) => fd.append(k, v));
    return fd;
}

/** Run `workMs` of work under a `floorMs` floor. */
async function withResponseFloorFor(workMs: number, floorMs: number): Promise<void> {
    const { withResponseFloor } = await import('@/lib/constant-time-response');
    await withResponseFloor(async () => { await new Promise((r) => setTimeout(r, workMs)); }, floorMs);
}

async function timed(work: () => Promise<unknown>): Promise<number> {
    const started = Date.now();
    await work();
    return Date.now() - started;
}

function seedVictim(): void {
    store.seed(COLLECTIONS.USERS, VICTIM_AUTH_ID, {
        uid: VICTIM_AUTH_ID, email: VICTIM_EMAIL, fullName: 'Real Admin',
        roles: ['super_admin'], profileComplete: true,
    });
}

// ─── the helper's own contract ───────────────────────────────────────────────

describe('withResponseFloor', () => {
    it('holds a fast result until the floor', async () => {
        const { withResponseFloor } = await import('@/lib/constant-time-response');

        const elapsed = await timed(() => withResponseFloor(async () => 'done', 100));

        expect(elapsed).toBeGreaterThanOrEqual(95);
    });

    it('PADS A THROWN ERROR TOO', async () => {
        // A path that fails fast and one that fails slowly are as good an
        // oracle as two different messages, and an early throw is exactly the
        // exit an author forgets to cover.
        const { withResponseFloor } = await import('@/lib/constant-time-response');

        const started = Date.now();
        await expect(withResponseFloor(async () => { throw new Error('no'); }, 100)).rejects.toThrow('no');

        expect(Date.now() - started).toBeGreaterThanOrEqual(95);
    });

    it('DOES NOT DELAY WORK THAT ALREADY EXCEEDS THE FLOOR', async () => {
        /**
         * The total must be max(elapsed, floor), never elapsed + floor.
         * Additive padding would make a slow path slower in proportion to how
         * slow it already was — widening the very gap the floor exists to
         * close, while looking like a defence.
         *
         * The numbers are chosen so the two behaviours cannot overlap: 220ms of
         * work under a 150ms floor is ~220ms correct and ~370ms additive. An
         * earlier version of this test used 120ms work / 40ms floor and a
         * `< 200` bound, which BOTH satisfy — the mutant walked straight past
         * it.
         */
        const WORK_MS = 220;
        const FLOOR_MS = 150;

        const elapsed = await timed(() => withResponseFloorFor(WORK_MS, FLOOR_MS));

        expect(elapsed).toBeGreaterThanOrEqual(WORK_MS - 5);
        expect(elapsed).toBeLessThan(WORK_MS + FLOOR_MS - 30);
    });

    it('and says so, because a floor that no longer covers a path is silent otherwise', async () => {
        const { withResponseFloor } = await import('@/lib/constant-time-response');
        const { logger } = await import('@/lib/logger');
        const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

        await withResponseFloor(async () => { await new Promise((r) => setTimeout(r, 60)); }, 10, 'slowPath');

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('slowPath'));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('floor'));
        warn.mockRestore();
    });
});

describe('atMost', () => {
    it('stops waiting at the cap without cancelling the work', async () => {
        const { atMost } = await import('@/lib/constant-time-response');
        let finished = false;
        const slow = new Promise<void>((r) => setTimeout(() => { finished = true; r(); }, 300));

        const elapsed = await timed(() => atMost(slow, 50));

        expect(elapsed).toBeLessThan(200);
        expect(finished).toBe(false);
        await slow;
        expect(finished).toBe(true);
    });

    it('swallows a rejection, because side work must not change the reply', async () => {
        const { atMost } = await import('@/lib/constant-time-response');

        await expect(atMost(Promise.reject(new Error('smtp down')), 50)).resolves.toBeUndefined();
    });
});

// ─── registration ────────────────────────────────────────────────────────────

describe('registration takes the same time whether the address is taken', () => {
    it('A TAKEN ADDRESS AND A FREE ONE ARE HELD THE SAME LENGTH OF TIME', async () => {
        seedVictim();
        const { registerAction } = await actions();

        createUser.mockImplementation(async () => ({
            data: { user: null }, error: { message: 'already been registered' },
        }));
        const taken = await timed(() => registerAction({}, registration(VICTIM_EMAIL)));

        createUser.mockImplementation(async () => ({ data: { user: { id: 'fresh-uuid' } }, error: null }));
        const free = await timed(() => registerAction({}, registration('nobody@example.com')));

        expect(taken).toBeGreaterThanOrEqual(TEST_FLOOR_MS - 5);
        expect(free).toBeGreaterThanOrEqual(TEST_FLOOR_MS - 5);
        // The gap is what an attacker measures. Both paths are padded to the
        // same floor, so what is left is scheduler noise, not work.
        expect(Math.abs(taken - free)).toBeLessThan(TEST_FLOOR_MS / 2);
    });

    it('A SLOW NOTIFICATION DOES NOT PUSH THE TAKEN PATH PAST THE FLOOR', async () => {
        // The email is the one piece of work only the taken path does. Awaited
        // without a cap, a slow Resend call is the whole leak, restored.
        seedVictim();
        emailDelayMs = 5000;
        const { registerAction } = await actions();

        createUser.mockImplementation(async () => ({
            data: { user: null }, error: { message: 'already been registered' },
        }));
        const taken = await timed(() => registerAction({}, registration(VICTIM_EMAIL)));

        expect(taken).toBeLessThan(2000);
    });

    it('pads a validation error too, so there is no fast third class', async () => {
        const { registerAction } = await actions();
        const bad = registration('nobody@example.com');
        bad.set('password', 'short');
        bad.set('confirmPassword', 'short');

        const elapsed = await timed(() => registerAction({}, bad));

        expect(elapsed).toBeGreaterThanOrEqual(TEST_FLOOR_MS - 5);
    });
});

// ─── login ───────────────────────────────────────────────────────────────────

describe('a failed login is held to the floor', () => {
    it('an unknown address and a wrong password take the same time', async () => {
        store.seed(COLLECTIONS.USERS, 'real', { email: 'registered@example.com' });
        const { preValidateLoginAction } = await actions();

        const known = await timed(() => preValidateLoginAction({
            email: 'registered@example.com', password: 'Wr0ng!Passw0rd',
        }));
        const unknown = await timed(() => preValidateLoginAction({
            email: 'nobody@example.com', password: 'Wr0ng!Passw0rd',
        }));

        expect(known).toBeGreaterThanOrEqual(TEST_FLOOR_MS - 5);
        expect(unknown).toBeGreaterThanOrEqual(TEST_FLOOR_MS - 5);
        expect(Math.abs(known - unknown)).toBeLessThan(TEST_FLOOR_MS / 2);
    });

    it('but a SUCCESSFUL login is not padded, because it is the hot path', async () => {
        // Everyone already knows their own address is registered, so there is
        // nothing to hide here — and paying the floor on every sign-in would
        // be a real cost for no gain.
        store.seed(COLLECTIONS.USERS, 'supabase-ok', { email: 'good@example.com', roles: ['general_user'] });
        signInWithPassword.mockImplementation(async () => ({
            data: { user: { id: 'supabase-ok' } }, error: null,
        }));
        const { preValidateLoginAction } = await actions();

        const elapsed = await timed(() => preValidateLoginAction({
            email: 'good@example.com', password: 'Str0ng!Passw0rd',
        }));

        expect(elapsed).toBeLessThan(TEST_FLOOR_MS);
    });
});

// ─── the property that made padding possible ─────────────────────────────────

describe('the login failure path does no work that varies with the address', () => {
    it('RUNS NO QUERY BETWEEN THE AUTH FAILURE AND THE REPLY', () => {
        /**
         * Padding hides a difference; removing it is better. #361 deleted the
         * lookup that existed only to tell the two failures apart, so on this
         * side of the wire they now execute the same instructions.
         *
         * Asserted at the source, over comment-stripped text: this file and
         * that one both discuss the removed query at length, and a raw scan
         * would match the prose describing the fix.
         */
        const source = stripComments(
            readFileSync(join(process.cwd(), 'src/app/actions/auth.ts'), 'utf-8'),
        );
        const failureBranch = source.slice(
            source.indexOf('if (!responseData) {'),
            source.indexOf('} else {\n                responseData = authData;'),
        );

        expect(failureBranch).not.toContain('COLLECTIONS.USERS');
        expect(failureBranch).not.toContain('.get()');
        expect(failureBranch).toContain('Invalid email or password.');
    });
});

/** Source with comments removed — see the note in the test above. */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}
