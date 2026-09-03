/**
 * @jest-environment node
 */

/**
 * THE BRUTE-FORCE LIMIT ON THE LOGIN ENDPOINT WAS THROWN AND THEN CAUGHT BY ITS
 * OWN CIRCUIT BREAKER.
 *
 * authorize() in lib/auth.ts is what POST /api/auth/callback/credentials runs.
 * It is the endpoint a password-guessing script talks to — the React login form
 * is a convenience in front of it, not a gate. Its rate limit read:
 *
 *     try {
 *         const rateLimitResult = await consumeLoginAttempt(email);
 *         if (!rateLimitResult.allowed) {
 *             throw new Error(rateLimitResult.error || "Too many login attempts. ...");
 *         }
 *     } catch (err: any) {
 *         // CIRCUIT BREAKER: Fail Open
 *         if (err.message && err.message.includes("Too many login attempts")) {
 *             throw err; // Real rate limit
 *         }
 *         logger.error("... Redis consumeLoginAttempt failed, failing open ...");
 *     }
 *
 * One try/catch doing two jobs: raising the refusal, and deciding whether an
 * exception is a refusal or an outage. It told them apart by reading the
 * sentence — and consumeLoginAttempt does not say that sentence. Both of its
 * refusal paths, the Redis sliding window and the in-memory fallback, return
 *
 *     "Too many failed login attempts. If you cannot remember your credentials,
 *      please contact support at ..., or try again in N minutes."
 *
 * `"Too many failed login attempts".includes("Too many login attempts")` is
 * false — one word apart. So the refusal was raised, caught, classified as an
 * infrastructure fault, logged as "failing open", and the login continued.
 *
 * The first test below is the finding: with the limiter answering
 * allowed:false, authorize() returned a complete signed-in user object. There
 * was no limit on password attempts against that endpoint at all.
 *
 * WHY THE MESSAGE IS NOT SIMPLY CORRECTED
 * ---------------------------------------
 * Because a guard that has to recognise a sentence breaks the next time
 * somebody improves the sentence, which is what happened. The distinction is
 * structural now — the catch wraps only the CALL, so an exception out of the
 * limiter still fails open, while the DECISION to refuse is taken outside it
 * and cannot be swallowed by anything.
 *
 * preValidateLoginAction, the twin gate in app/actions/auth.ts, was already
 * correct for exactly that reason: it RETURNS its refusal, so no catch can
 * reach it. Same check, two shapes, and only the one that could be silently
 * defeated was.
 *
 * THE MESSAGE IN THESE TESTS IS NOT TYPED OUT
 * -------------------------------------------
 * It is obtained by driving the real consumeLoginAttempt until it refuses, and
 * that string is what authorize() is then given. The two modules are coupled by
 * execution rather than by a literal copied into a test — which is the coupling
 * whose failure this whole finding is.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

// ── The NextAuth config, captured rather than built ──────────────────────────
let captured: any = null;
jest.mock('next-auth', () => ({
    __esModule: true,
    default: (config: unknown) => {
        captured = config;
        return { handlers: {}, signIn: jest.fn(), signOut: jest.fn(), auth: jest.fn() };
    },
    CredentialsSignin: class extends Error {
        code = 'credentials';
        type = 'CredentialsSignin';
    },
}));

// ESM-only; mocked to a factory so the provider config — and with it the real
// authorize() — comes back as a plain object this file can call.
jest.mock('next-auth/providers/credentials', () => ({
    __esModule: true,
    default: (config: unknown) => config,
}));

// No Upstash in this environment, which is also the path that produces the
// in-memory refusal the tests read the real message from.
jest.mock('@/lib/redis', () => ({ redis: {}, isRedisConfigured: false, CACHE_TTL: {} }));

const consumeLoginAttempt = jest.fn<(e: string) => Promise<any>>();
const resetLoginAttempts = jest.fn<(e: string) => Promise<void>>();
jest.mock('@/lib/rate-limit', () => ({
    consumeLoginAttempt: (e: string) => consumeLoginAttempt(e),
    resetLoginAttempts: (e: string) => resetLoginAttempts(e),
}));

const signInWithPassword = jest.fn<(c: unknown) => Promise<any>>();
const createUser = jest.fn<(c: unknown) => Promise<any>>();
jest.mock('@/lib/supabase', () => ({
    supabase: { auth: { signInWithPassword: (c: unknown) => signInWithPassword(c) } },
    supabaseAdmin: { auth: { admin: { createUser: (c: unknown) => createUser(c) } } },
}));

jest.mock('@/lib/supabase-db', () => ({
    supabaseDb: {
        collection: () => ({
            doc: () => ({
                get: async () => ({ exists: true, data: () => ({ id: 'sb-1' }) }),
                set: jest.fn(),
                update: jest.fn(),
            }),
            where: () => ({ get: async () => ({ empty: true, docs: [] }) }),
        }),
    },
}));
jest.mock('@/lib/firestore-utils', () => ({ runQueryWithRetry: (fn: () => unknown) => fn() }));

const getUserProfile = jest.fn(async (_id: string) => ({
    id: 'sb-1',
    email: 'victim@example.com',
    displayName: 'Victim',
    roles: ['general_user'],
}) as any);
jest.mock('@/lib/user-cache', () => ({
    getUserProfile: (id: string) => getUserProfile(id),
    invalidateUserProfile: jest.fn(),
}));

const loggedErrors: string[] = [];
jest.mock('@/lib/logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: (...args: unknown[]) => { loggedErrors.push(args.map(String).join(' ')); },
        debug: jest.fn(),
    },
}));

type Authorize = (credentials: unknown) => Promise<any>;

function authorize(): Authorize {
    // requireActual, because jest.setup.js replaces @/lib/auth globally.
    jest.requireActual('@/lib/auth');
    if (!captured) throw new Error('lib/auth.ts did not call NextAuth');
    return captured.providers[0].authorize as Authorize;
}

const CREDENTIALS = { email: 'victim@example.com', password: 'Password1!' };

function setNodeEnv(value: string) {
    // Readonly in the Node typings; the runtime does not care.
    (process.env as Record<string, string>).NODE_ENV = value;
}
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

/**
 * The sentence consumeLoginAttempt ACTUALLY produces when it locks somebody
 * out, obtained by locking somebody out.
 *
 * NODE_ENV must be production for the count to happen at all — outside it the
 * limiter waves every address through except the e2e probe, deliberately.
 */
async function realRefusalMessage(): Promise<string> {
    const rateLimit: any = jest.requireActual('@/lib/rate-limit');
    const email = `brute-force-probe-${Date.now()}@example.com`;
    setNodeEnv('production');
    try {
        let last: any = null;
        for (let i = 0; i < 10; i += 1) {
            last = await rateLimit.consumeLoginAttempt(email);
            if (!last.allowed) return String(last.error);
        }
        throw new Error('consumeLoginAttempt never refused — the premise has changed');
    } finally {
        setNodeEnv(ORIGINAL_NODE_ENV as string);
    }
}

beforeEach(() => {
    loggedErrors.length = 0;
    consumeLoginAttempt.mockReset();
    resetLoginAttempts.mockReset();
    signInWithPassword.mockReset();
    createUser.mockReset();

    consumeLoginAttempt.mockResolvedValue({ allowed: true, remainingAttempts: 4 });
    resetLoginAttempts.mockResolvedValue(undefined);
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'sb-1' } }, error: null });
});

afterEach(() => {
    setNodeEnv(ORIGINAL_NODE_ENV as string);
});

describe('a caller the login limiter has locked out', () => {
    it('IS REFUSED — this returned a signed-in user', async () => {
        const message = await realRefusalMessage();
        consumeLoginAttempt.mockResolvedValueOnce({ allowed: false, error: message });

        const outcome = await authorize()(CREDENTIALS)
            .then((user) => ({ signedInAs: user?.id }))
            .catch((err: Error) => ({ refusedWith: err.message }));

        // Before the fix this was { signedInAs: 'sb-1' }.
        expect(outcome).toEqual({ refusedWith: message });
    });

    it('and their password is never even checked', async () => {
        consumeLoginAttempt.mockResolvedValueOnce({
            allowed: false,
            error: await realRefusalMessage(),
        });

        await authorize()(CREDENTIALS).catch(() => undefined);

        // The point of consuming the attempt before verifying: a locked-out
        // caller must not get another guess evaluated.
        expect(signInWithPassword).not.toHaveBeenCalled();
        expect(getUserProfile).not.toHaveBeenCalledWith('sb-1');
    });

    it('and is told how long to wait, not "Authentication failed."', async () => {
        const message = await realRefusalMessage();
        consumeLoginAttempt.mockResolvedValueOnce({ allowed: false, error: message });

        const err = await authorize()(CREDENTIALS).catch((e: Error) => e);

        // The outer catch maps unknown codes to "Authentication failed." and
        // classifies transient network faults separately. This message must
        // survive both and reach the user intact.
        expect((err as Error).message).toBe(message);
        expect((err as Error).message).toMatch(/try again in \d+ minutes/);
    });

    it('AND THE REFUSAL IT IS GIVEN NEVER CONTAINED THE SENTENCE THE OLD GUARD MATCHED', async () => {
        // The premise of the whole finding, asserted against the live limiter
        // rather than stated. One word — "failed" — is the entire defect.
        const message = await realRefusalMessage();

        expect(message).toContain('Too many failed login attempts');
        expect(message.includes('Too many login attempts')).toBe(false);
    });

    it.each([
        ['the limiter\'s own wording', { allowed: false, error: 'Too many failed login attempts. Try again in 12 minutes.' }],
        ['a rewording that drops the phrase entirely', { allowed: false, error: 'Account temporarily locked.' }],
        ['the phrase the old guard wanted', { allowed: false, error: 'Too many login attempts. Please try again later.' }],
        ['no message at all', { allowed: false }],
    ])('is refused when the limiter says so with %s', async (_label, decision) => {
        // A refusal is a refusal whatever it is worded as. This is what makes
        // the fix a fix rather than a corrected string.
        consumeLoginAttempt.mockResolvedValueOnce(decision as any);

        const outcome = await authorize()(CREDENTIALS)
            .then(() => 'signed in')
            .catch(() => 'refused');

        expect(outcome).toBe('refused');
    });
});

describe('an outage in the limiter still fails open', () => {
    it('lets the login through when consumeLoginAttempt throws', async () => {
        // Deliberate, and unchanged: Upstash being down must not lock every
        // user out of a financial platform. Only an EXCEPTION means "down".
        consumeLoginAttempt.mockRejectedValueOnce(new Error('Upstash request timed out'));

        const user = await authorize()(CREDENTIALS);

        expect(user).toMatchObject({ id: 'sb-1', email: 'victim@example.com' });
    });

    it('and says so in the log, naming the underlying failure', async () => {
        consumeLoginAttempt.mockRejectedValueOnce(new Error('Upstash request timed out'));

        await authorize()(CREDENTIALS);

        expect(loggedErrors.join('\n')).toContain('failing open');
        expect(loggedErrors.join('\n')).toContain('Upstash request timed out');
    });
});

describe('an allowed attempt', () => {
    it('proceeds and clears the counter once the password is proven', async () => {
        const user = await authorize()(CREDENTIALS);

        expect(user).toMatchObject({ id: 'sb-1' });
        expect(resetLoginAttempts).toHaveBeenCalledWith('victim@example.com');
    });

    it('and a wrong password is still rejected without the limiter refusing', async () => {
        // Guards the other direction: the restructure must not turn the gate
        // into something that only ever passes.
        signInWithPassword.mockResolvedValueOnce({ data: null, error: { message: 'Invalid login credentials' } });
        delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

        const outcome = await authorize()(CREDENTIALS)
            .then(() => 'signed in')
            .catch((e: Error) => e.message);

        // The no-Firebase-fallback branch throws this literal, which is not in
        // the error map and is not ALL_CAPS, so it reaches the user verbatim —
        // hence the missing full stop the map's own copy has.
        expect(outcome).toMatch(/^Invalid email or password\.?$/);
    });
});

describe('the gate no longer decides by reading a message', () => {
    it('the refusal is raised outside the catch that fails open', () => {
        const source = readFileSync(join(process.cwd(), 'src/lib/auth.ts'), 'utf-8');
        const code = source
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');

        // The catch may no longer inspect what it caught to decide whether it
        // was a rate limit. That test is what the phrase-matching was.
        expect(code).not.toMatch(/includes\(\s*["']Too many/);

        // And the throw must sit after the catch closes, not inside the try.
        const catchEnd = code.indexOf('failing open. Error:');
        const throwAt = code.indexOf('!rateLimitResult.allowed');
        expect(catchEnd).toBeGreaterThan(-1);
        expect(throwAt).toBeGreaterThan(catchEnd);
    });

    it('and the twin gate in preValidateLoginAction still returns rather than throws', () => {
        // It was correct all along, and this is why. Pinned so the two gates
        // cannot drift back apart.
        const source = readFileSync(join(process.cwd(), 'src/app/actions/auth.ts'), 'utf-8');

        expect(source).toContain('return { success: false, error: rateLimitResult.error');
    });
});
