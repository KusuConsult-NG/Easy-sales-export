/**
 * @jest-environment node
 */

/**
 * A SUPABASE OUTAGE TOLD EVERY USER THEIR PASSWORD WAS WRONG.
 *
 * authorize() authenticates against Supabase and then branches on `sbError`:
 *
 *     const { data: sbData, error: sbError } = await supabase.auth.signInWithPassword(...);
 *     if (!sbError && sbData?.user) { ...signed in... }
 *     else { ...legacy Firebase fallback... }
 *
 * The supabase-js client does not THROW when the project is unreachable. It
 * returns an AuthRetryableFetchError, so `sbError` is set in exactly the same
 * shape as for a wrong password. Everything past that `else` treats it as a
 * credential failure, and with no Firebase configured — which is this
 * platform's shape today, the migration off Firebase having otherwise been
 * completed — it ends at
 *
 *     throw new Error("Invalid email or password");
 *
 * Executed before it was fixed: with signInWithPassword returning undici's
 * "fetch failed", authorize() answered "Invalid email or password".
 *
 * That is the worst available answer to an outage. It is wrong, it is
 * confident, and the remedy it invites — reset your password — is served by the
 * same service that is down. Across 41,105 accounts an outage becomes a reset
 * stampede on top of the outage.
 *
 * WHAT MAKES IT A FINDING RATHER THAN A ROUGH EDGE
 * -----------------------------------------------
 * The predicate was already there. isTransientError is imported into
 * lib/auth.ts and was applied only to the message in the OUTER catch — by which
 * point the real fault had been replaced by the literal above, so the check
 * could never see anything to classify. The information was destroyed one frame
 * before the code that needed it.
 *
 * And the twin got it right. preValidateLoginAction runs the same sign-in and
 * classifies its authError with the same helper, returning "A temporary
 * connection issue occurred. Please try again." Two halves of one login, and
 * the half that is wrong is the half reachable without a browser:
 * preValidateLoginAction is called by the React form, authorize() is what
 * POST /api/auth/callback/credentials runs.
 *
 * WHY THE CHECK GOES BEFORE THE FALLBACK, NOT AFTER IT AS THE TWIN DOES
 * --------------------------------------------------------------------
 * The JIT migration provisions the user through supabaseAdmin. An unreachable
 * Supabase cannot complete it, so consulting Firebase first spends a round-trip
 * at Google to arrive at a failure already known — and a half-completed
 * migration is a worse outcome than a clean "try again".
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TRANSIENT_ERROR_MARKERS, isTransientError } from '@/lib/transient-error';

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
jest.mock('next-auth/providers/credentials', () => ({
    __esModule: true,
    default: (config: unknown) => config,
}));

jest.mock('@/lib/rate-limit', () => ({
    consumeLoginAttempt: async () => ({ allowed: true, remainingAttempts: 4 }),
    resetLoginAttempts: async () => undefined,
}));

const signInWithPassword = jest.fn<(c: unknown) => Promise<any>>();
const createUser = jest.fn<(c: unknown) => Promise<any>>();
jest.mock('@/lib/supabase', () => ({
    supabase: { auth: { signInWithPassword: (c: unknown) => signInWithPassword(c) } },
    supabaseAdmin: { auth: { admin: { createUser: (c: unknown) => createUser(c) } } },
}));

const docUpdate = jest.fn(async (_p: unknown) => undefined);
jest.mock('@/lib/supabase-db', () => ({
    supabaseDb: {
        collection: () => ({
            doc: () => ({
                get: async () => ({ exists: false }),
                set: jest.fn(),
                update: (p: unknown) => docUpdate(p),
            }),
            where: () => ({ get: async () => ({ empty: true, docs: [] }) }),
        }),
    },
}));
jest.mock('@/lib/firestore-utils', () => ({ runQueryWithRetry: (fn: () => unknown) => fn() }));
jest.mock('@/lib/user-cache', () => ({
    getUserProfile: async () => null,
    invalidateUserProfile: jest.fn(),
}));
jest.mock('@/lib/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

type Authorize = (credentials: unknown) => Promise<any>;
function authorize(): Authorize {
    jest.requireActual('@/lib/auth');
    return captured.providers[0].authorize as Authorize;
}

const CREDENTIALS = { email: 'member@example.com', password: 'Password1!' };
const TRANSIENT_REPLY = 'A temporary connection issue occurred. Please try again.';

/** What supabase-js hands back when the project cannot be reached. */
function unreachable(message: string) {
    return {
        data: { user: null, session: null },
        error: Object.assign(new Error(message), { name: 'AuthRetryableFetchError', status: 0 }),
    };
}

/** What it hands back when the password is simply wrong. */
function wrongPassword() {
    return {
        data: { user: null, session: null },
        error: Object.assign(new Error('Invalid login credentials'), { name: 'AuthApiError', status: 400 }),
    };
}

async function messageShownFor(reply: unknown): Promise<string> {
    signInWithPassword.mockResolvedValueOnce(reply as any);
    return authorize()(CREDENTIALS)
        .then(() => 'SIGNED IN')
        .catch((e: Error) => e.message);
}

const realFetch = global.fetch;
const ORIGINAL_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const fetchSpy = jest.fn<(...a: unknown[]) => Promise<any>>();

beforeEach(() => {
    signInWithPassword.mockReset();
    createUser.mockReset();
    docUpdate.mockReset();
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: 'INVALID_PASSWORD' } }) });
    (global as any).fetch = fetchSpy;
    delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
});

afterEach(() => {
    (global as any).fetch = realFetch;
    if (ORIGINAL_KEY === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    else process.env.NEXT_PUBLIC_FIREBASE_API_KEY = ORIGINAL_KEY;
});

describe('when Supabase Auth cannot be reached', () => {
    it('THE USER IS NOT TOLD THEIR PASSWORD IS WRONG', async () => {
        // The finding. This returned "Invalid email or password".
        const shown = await messageShownFor(unreachable('fetch failed'));

        expect(shown).toBe(TRANSIENT_REPLY);
    });

    it('and the fault itself never reaches the login screen', async () => {
        // A DNS failure carries the project hostname. safe-action.ts was found
        // handing exactly this to the browser verbatim; this path must not.
        const shown = await messageShownFor(
            unreachable('getaddrinfo ENOTFOUND db.abcdefghijklmnop.supabase.co'),
        );

        expect(shown).toBe(TRANSIENT_REPLY);
        expect(shown).not.toContain('supabase.co');
        expect(shown).not.toContain('abcdefghijklmnop');
    });

    it.each(TRANSIENT_ERROR_MARKERS.map((m) => [m]))(
        'answers "temporary connection issue" for a fault reading %s',
        async (marker) => {
            /**
             * The invariant the fix rests on, checked across the WHOLE marker
             * list rather than for one string: whatever this branch decides is
             * transient, the outer catch must independently reach the same
             * verdict on the message it is handed. If those two classifications
             * ever disagree, the raw fault text is what the user sees.
             */
            const shown = await messageShownFor(unreachable(`upstream said: ${marker}`));

            expect(shown).toBe(TRANSIENT_REPLY);
        },
    );

    it('and the legacy Firebase fallback is not consulted at all', async () => {
        // Even with Firebase configured. The migration provisions through
        // supabaseAdmin, so it cannot complete while Supabase is down — and a
        // half-done migration is worse than a clean "try again".
        process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'a-real-looking-key';

        await messageShownFor(unreachable('fetch failed'));

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(createUser).not.toHaveBeenCalled();
        expect(docUpdate).not.toHaveBeenCalled();
    });
});

describe('a genuinely wrong password is still a wrong password', () => {
    it('and still says so', async () => {
        const shown = await messageShownFor(wrongPassword());

        expect(shown).toMatch(/^Invalid email or password\.?$/);
        expect(shown).not.toBe(TRANSIENT_REPLY);
    });

    it('and Supabase\'s own credential error is not classified as an outage', async () => {
        // The premise of the split, asserted rather than assumed. If this ever
        // becomes true, every wrong password starts reading as an outage.
        expect(isTransientError('Invalid login credentials')).toBe(false);
        expect(isTransientError('Email not confirmed')).toBe(false);
    });

    it('and the legacy Firebase fallback is STILL consulted for it', async () => {
        // The check must not have killed the migration path it sits in front of.
        process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'a-real-looking-key';

        await messageShownFor(wrongPassword());

        expect(fetchSpy).toHaveBeenCalled();
        expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('accounts:signInWithPassword');
    });
});

describe('the two halves of a sign-in agree', () => {
    it('preValidateLoginAction classifies its own sign-in failure the same way', () => {
        // The twin. It has been right all along, and pinning it is what stops
        // the pair drifting apart again in the other direction.
        const source = readFileSync(join(process.cwd(), 'src/app/actions/auth.ts'), 'utf-8');

        expect(source).toContain('const isTransient = isTransientError(errMsg);');
        expect(source).toContain(TRANSIENT_REPLY);
    });

    it('and authorize() classifies the error object, not a literal it wrote itself', () => {
        const code = readFileSync(join(process.cwd(), 'src/lib/auth.ts'), 'utf-8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');

        // The whole defect was that the only classification happened after the
        // real error had been thrown away.
        expect(code).toContain('isTransientError(sbError)');

        const classifiedAt = code.indexOf('isTransientError(sbError)');
        const literalAt = code.indexOf('throw new Error("Invalid email or password")');
        expect(classifiedAt).toBeGreaterThan(-1);
        expect(literalAt).toBeGreaterThan(classifiedAt);
    });
});
