/**
 * @jest-environment node
 */

/**
 *   BRUTE-FORCE LOCKOUT WAS OFF, AND THE LOG SAID SO ON EVERY ATTEMPT.
 *
 *   From the owner's production log, one line, verbatim:
 *
 *       [Auth:Fallback] Redis consumeLoginAttempt failed, failing open.
 *       Error: Too many failed login attempts. If you cannot remember your
 *       credentials, please contact support at support@easysalesexport.com,
 *       or try again in 3 minutes.
 *
 *   Read it twice. That is not a Redis failure — it is the RATE LIMITER'S OWN
 *   REFUSAL, word for word, being logged as an infrastructure outage and then
 *   waved through.
 *
 * ── HOW ─────────────────────────────────────────────────────────────────────
 *
 *   lib/auth.ts raised the refusal with `throw` INSIDE the try that wraps the
 *   Redis call, so the circuit breaker's catch received it. The catch told a
 *   real refusal from an outage the only way it could — by matching the text:
 *
 *       err.message.includes("Too many login attempts")
 *
 *   rate-limit.ts says "Too many FAILED login attempts". That word was added
 *   when somebody made the message friendlier — it also gained the support
 *   address and "try again in N minutes" — and at that moment "Too many login
 *   attempts" stopped being a substring of it.
 *
 *   Nothing threw. Nothing went red. The re-throw simply never fired again,
 *   and the lockout has been open ever since, announcing itself in the log on
 *   every single attempt.
 *
 * ── WHY THE FIX IS NOT A BETTER STRING ──────────────────────────────────────
 *
 *   A rule that depends on wording somebody else owns breaks the next time
 *   somebody improves a sentence, and it breaks silently and OPEN. The
 *   `allowed` flag was always the answer, so the decision moved out of the try
 *   and nothing is matched at all.
 *
 *   These tests are written to fail on the old shape for the RIGHT reason:
 *   the last one refuses a lockout carrying wording no guard could anticipate,
 *   which is the exact mutation that shipped.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

type Authorize = (c: Record<string, unknown>) => Promise<unknown>;

let captured: { providers: { authorize: Authorize }[] } | null = null;

jest.mock('next-auth', () => ({
    __esModule: true,
    default: (config: unknown) => { captured = config as never; return { handlers: {}, auth: jest.fn() }; },
    CredentialsSignin: class extends Error { code = 'credentials'; type = 'CredentialsSignin'; },
}));
jest.mock('next-auth/providers/credentials', () => ({
    __esModule: true,
    default: (config: unknown) => config,
}));

const consumeLoginAttempt = jest.fn<any>();
const resetLoginAttempts = jest.fn(async () => undefined);
jest.mock('@/lib/rate-limit', () => ({
    consumeLoginAttempt: (...a: any[]) => consumeLoginAttempt(...a),
    resetLoginAttempts: (...a: any[]) => resetLoginAttempts(...(a as [])),
}));

/** THE PASSWORD CHECK. Whether this ran is what "the lockout held" means. */
const signInWithPassword = jest.fn<any>();
jest.mock('@/lib/supabase', () => ({
    supabase: { auth: { signInWithPassword: (...a: any[]) => signInWithPassword(...a) } },
    supabaseAdmin: { auth: { admin: {} } },
}));
jest.mock('@/lib/user-cache', () => ({
    getUserProfile: jest.fn(async () => null), invalidateUserProfile: jest.fn(),
}));
jest.mock('@/lib/firebase-admin', () => ({
    getAdminAuth: () => ({ createCustomToken: jest.fn(async () => 'tok') }),
    getAdminDb: () => ({}), adminAuth: { createCustomToken: jest.fn(async () => 'tok') },
}));
jest.mock('@/lib/profile-lookup', () => ({ findProfilesByEmail: jest.fn(async () => []) }));

const CREDENTIALS = { email: 'victim@example.com', password: 'Str0ng!Passw0rd' };

/** The limiter's real refusal — copied from rate-limit.ts, not paraphrased. */
const THE_REAL_MESSAGE =
    'Too many failed login attempts. If you cannot remember your credentials, please ' +
    'contact support at support@easysalesexport.com, or try again in 3 minutes.';

async function authorize(): Promise<Authorize> {
    //   requireActual, because jest.setup.js replaces this module globally.
    jest.requireActual('@/lib/auth');
    if (!captured) throw new Error('lib/auth.ts did not call NextAuth');
    return captured.providers[0].authorize;
}

const attempt = async () => {
    const fn = await authorize();
    try { return { threw: false as const, value: await fn(CREDENTIALS) }; }
    catch (e: any) { return { threw: true as const, message: String(e?.message ?? e) }; }
};

beforeEach(() => {
    jest.clearAllMocks();
    //   A password that IS correct is not needed: every assertion here is about
    //   whether the check was REACHED. A rejection keeps the flow short.
    signInWithPassword.mockResolvedValue({ data: null, error: { message: 'INVALID_LOGIN_CREDENTIALS' } });
});

describe('a locked-out login does not reach the password check', () => {
    it('THE test — the limiter refuses and the attempt stops there', async () => {
        consumeLoginAttempt.mockResolvedValue({ allowed: false, error: THE_REAL_MESSAGE });

        const r = await attempt();

        expect(r.threw).toBe(true);
        //   NEVER CONSULTED. This is the whole point: a lockout that still lets
        //   the password be tried is not a lockout, it is a log line.
        expect(signInWithPassword).not.toHaveBeenCalled();
    });

    it('and the person is told what the limiter said, not "Authentication failed"', async () => {
        consumeLoginAttempt.mockResolvedValue({ allowed: false, error: THE_REAL_MESSAGE });

        const r = await attempt();

        expect(r.threw && r.message).toContain('try again in 3 minutes');
    });

    it('AND THE REFUSAL DOES NOT DEPEND ON ITS OWN WORDING — the mutation that shipped', async () => {
        //   THE RATCHET. The old code told a refusal from an outage by matching
        //   "Too many login attempts" in the message. Someone reworded the
        //   message, the match stopped hitting, and the lockout silently opened.
        //
        //   So: a refusal whose wording no guard could have anticipated, and one
        //   carrying no message at all. Both must still refuse. Any future
        //   version that reads the text fails here rather than in production.
        for (const error of ['Slow down, friend.', '', undefined]) {
            jest.clearAllMocks();
            signInWithPassword.mockResolvedValue({ data: null, error: { message: 'INVALID_LOGIN_CREDENTIALS' } });
            consumeLoginAttempt.mockResolvedValue({ allowed: false, error });

            const r = await attempt();

            expect(r.threw).toBe(true);
            expect(signInWithPassword).not.toHaveBeenCalled();
        }
    });
});

describe('and the controls that make those mean something', () => {
    it('an allowed attempt DOES reach the password check', async () => {
        //   VACUITY CONTROL. If authorize() refused everybody — a bad mock, a
        //   throw before step 3 — every assertion above would pass while
        //   proving nothing.
        consumeLoginAttempt.mockResolvedValue({ allowed: true, remainingAttempts: 4 });

        await attempt();

        expect(signInWithPassword).toHaveBeenCalledTimes(1);
    });

    it('and a Redis OUTAGE still fails open, which is the deliberate choice', async () => {
        //   Unchanged, and worth pinning: Upstash being down must not lock the
        //   whole platform out. The fix narrows the catch to the I/O; it does
        //   not turn the circuit breaker into a closed one.
        consumeLoginAttempt.mockRejectedValue(new Error('ECONNRESET'));

        await attempt();

        expect(signInWithPassword).toHaveBeenCalledTimes(1);
    });

    it('and the limiter is asked about the right person', async () => {
        consumeLoginAttempt.mockResolvedValue({ allowed: true, remainingAttempts: 4 });

        await attempt();

        expect(consumeLoginAttempt).toHaveBeenCalledWith(CREDENTIALS.email);
    });
});
