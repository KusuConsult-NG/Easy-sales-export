/**
 * @jest-environment node
 */

/**
 *   #513 A DEV SEEDER THAT MINTED ANY ROLE YOU NAMED FOR IT.
 *
 *   POST /api/auth/register took `role` off the request body and wrote it:
 *
 *       const userRoles = role ? [role] : ["general_user"];
 *
 *   unauthenticated, with `isVerified: true`, `verified: true` and
 *   `profileComplete: true` alongside it, and a real Supabase auth account
 *   behind it. NOTHING CALLS IT — not a page, not a script, not a test, not the
 *   e2e suite. The only references in the tree are three audit notes observing
 *   that it "returns 404 in production". registerAction is the sign-up path.
 *
 * ── IT IS NOT AN OPEN DOOR, AND THAT COMES FIRST ────────────────────────────
 *
 *   The production block holds. I checked rather than assumed, because the
 *   container does NOT run `next start` — the Dockerfile ends
 *   CMD ["node", "server.js"], so the `next` CLI, which is what defaults
 *   NODE_ENV when it is unset, never runs; and the Dockerfile sets no NODE_ENV
 *   of its own. What saves it is line 5 of Next's generated standalone server,
 *   `process.env.NODE_ENV = 'production'`, unconditionally, before any handler.
 *
 *   So no live account was ever created through this route, and this finding is
 *   not a breach report.
 *
 * ── BUT NODE_ENV IS THE WRONG QUESTION ──────────────────────────────────────
 *
 *   NODE_ENV describes THE PROCESS. It says nothing about WHICH DATABASE the
 *   process is pointed at, and those are different facts. `npm run dev` with
 *   production Supabase credentials in .env.local is NODE_ENV=development
 *   against the live users table — and for this project that is not a
 *   hypothetical configuration, it is how the operational work has been done.
 *
 *   THE LIMIT OF THAT MEASUREMENT, STATED: this container is a fresh clone with
 *   no .env files, so I could not read what the owner's .env.local points at. I
 *   am describing a configuration the project is known to use, not one I
 *   observed. The finding does not rest on it either way — an unauthenticated
 *   endpoint that assigns roles from its request body is worth closing whichever
 *   database it is aimed at.
 *
 * ── WHAT IT SKIPPED THAT THE REAL PATH DOES ─────────────────────────────────
 *
 *   Against registerAction, which is the comparison that matters because it
 *   proves each of these is this platform's own standard rather than my opinion:
 *
 *     rate limit       registerAction throttles per IP        THIS: none
 *     password policy  passwordPolicySchema, shared with
 *                      changePasswordAction since #330        THIS: none — "x"
 *                                                             was a password
 *     phone dedup      phoneLookupVariants, because members
 *                      arrived by six writers spelling it
 *                      differently                            THIS: exact
 *                      string only, missing the case the helper exists for
 *     roles            hardcoded ["general_user"]             THIS: yours
 *     isVerified       not set                                THIS: true
 *
 * ── RETIRED, NOT DELETED, AND HARDENED ANYWAY ───────────────────────────────
 *
 *   The owner's standing rule, and the treatment #379, #386, #431 and #485
 *   established. A retired endpoint one flag from being live must not be
 *   revivable in the state it was found in, so the flag is not the only change:
 *   the role is checked against SEEDABLE_ROLES, the verified flags are gone and
 *   replaced by #495's provenance marker, the phone check uses the shared
 *   variants, and the swallowed catch logs.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the retirement flag removed                    KILLED
 *     the production block removed                   KILLED
 *     role taken from the body again                 KILLED
 *     isVerified: true written again                 KILLED
 *     the phone check back to an exact match         KILLED
 *     reword this header                             SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { MANUFACTURED_PROFILE_MARKER, verificationState } from '@/lib/profile-provenance';

const mockCreateUser = jest.fn() as jest.Mock<any>;
const mockGetUserByEmail = jest.fn() as jest.Mock<any>;
const mockDeleteUser = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/firebase-admin', () => ({
    adminAuth: {
        createUser: (...a: any[]) => mockCreateUser(...a),
        getUserByEmail: (...a: any[]) => mockGetUserByEmail(...a),
        deleteUser: (...a: any[]) => mockDeleteUser(...a),
    },
}));

let store: FakeDbHandle;
let savedNodeEnv: string | undefined;

const setNodeEnv = (value: string | undefined) => {
    if (value === undefined) delete (process.env as Record<string, unknown>).NODE_ENV;
    else Object.defineProperty(process.env, 'NODE_ENV', { value, configurable: true });
};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    savedNodeEnv = process.env.NODE_ENV;
    setNodeEnv('development');
    delete process.env.VERCEL_ENV;
    delete process.env.RAILWAY_ENVIRONMENT;
    process.env.LEGACY_DEV_USER_SEEDING = 'enabled';

    const notFound: any = new Error('not found');
    notFound.code = 'auth/user-not-found';
    mockGetUserByEmail.mockRejectedValue(notFound);
    mockCreateUser.mockResolvedValue({ uid: 'seeded-uid-1' });
    mockDeleteUser.mockResolvedValue({});
});

afterEach(() => {
    setNodeEnv(savedNodeEnv);
    delete process.env.LEGACY_DEV_USER_SEEDING;
});

const VALID = {
    email: 'seed@example.com',
    password: 'x',
    firstName: 'Ada',
    lastName: 'Obi',
    phone: '08031234567',
};

async function post(body: Record<string, unknown>) {
    const { POST } = await import('@/app/api/auth/register/route');
    return POST(new Request('https://example.com/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    }) as never);
}

const seeded = () => store.get(COLLECTIONS.USERS, 'seeded-uid-1') as any;

// ─────────────────────────────────────────────────────────────────────────────
describe('#513 — a caller does not name its own privileges', () => {
    it('ASKING FOR super_admin IS REFUSED', async () => {
        //   THE test. `const userRoles = role ? [role] : ["general_user"]` put
        //   the request body straight into the roles array. There are three
        //   super_admins on this platform.
        const res = await post({ ...VALID, role: 'super_admin' });

        expect(res.status).toBe(403);
        expect(mockCreateUser).not.toHaveBeenCalled();
        expect(seeded()).toBeUndefined();
    });

    it('AND SO IS EVERY OTHER ADMIN ROLE', async () => {
        for (const role of ['admin', 'wave_admin', 'academy_admin', 'support']) {
            jest.clearAllMocks();
            expect((await post({ ...VALID, role })).status).toBe(403);
        }
        expect(mockCreateUser).not.toHaveBeenCalled();
    });

    it('AND general_user IS STILL SEEDED — the refusal is a rule, not a wall', async () => {
        //   The vacuity guard, and the reason the endpoint can be revived at all.
        const res = await post({ ...VALID, role: 'general_user' });

        expect(res.status).toBe(201);
        expect(seeded().roles).toEqual(['general_user']);
    });

    it('and omitting the role defaults to general_user rather than to nothing', async () => {
        expect((await post(VALID)).status).toBe(201);
        expect(seeded().roles).toEqual(['general_user']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#513 — a seeded account does not claim to be verified', () => {
    it('IT IS NOT WRITTEN AS VERIFIED', async () => {
        //   #495's class, exactly: 3,605 rows called themselves verified and
        //   nobody had verified them. This route wrote three such flags at once.
        await post(VALID);

        expect(seeded().isVerified).toBeUndefined();
        expect(seeded().verified).toBeUndefined();
        expect(seeded().profileComplete).toBe(false);
    });

    it('AND #495 REPORTS IT AS UNEVIDENCED', async () => {
        //   Asserted through the shared rule rather than the field, so a change
        //   to what provenance means cannot leave this route behind.
        await post(VALID);

        expect(seeded()[MANUFACTURED_PROFILE_MARKER]).toBe(true);
        expect(verificationState(seeded())).toBe('unevidenced');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#513 — both gates', () => {
    it('THE FLAG IS OFF BY DEFAULT AND THE ANSWER IS 410', async () => {
        delete process.env.LEGACY_DEV_USER_SEEDING;

        const res = await post(VALID);
        expect(res.status).toBe(410);
        expect(mockCreateUser).not.toHaveBeenCalled();
    });

    it('AND PRODUCTION IS STILL 404, FLAG OR NO FLAG', async () => {
        //   The environment gate comes first, so the refusal cannot be used to
        //   learn which flags a deployment has set.
        setNodeEnv('production');

        expect((await post(VALID)).status).toBe(404);

        setNodeEnv('development');
        process.env.RAILWAY_ENVIRONMENT = 'production';
        expect((await post(VALID)).status).toBe(404);
    });

    it('and a production deployment is refused even with the flag on', async () => {
        setNodeEnv('production');
        process.env.LEGACY_DEV_USER_SEEDING = 'enabled';

        expect((await post(VALID)).status).toBe(404);
        expect(mockCreateUser).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#513 — the checks it skipped', () => {
    it('A PHONE STORED IN ANOTHER SPELLING IS STILL A DUPLICATE', async () => {
        //   registerAction's reason applies unchanged: six writers store the
        //   phone differently and the bulk import is where most members came
        //   from, so an exact-string check misses the case the helper exists for.
        store.seed(COLLECTIONS.USERS, 'existing-1', { phone: '+2348031234567' });

        const res = await post({ ...VALID, phone: '08031234567' });

        expect(res.status).toBe(409);
        expect(mockCreateUser).not.toHaveBeenCalled();
    });

    it('and an existing auth account for the email is refused', async () => {
        mockGetUserByEmail.mockResolvedValue({ uid: 'other' });

        expect((await post(VALID)).status).toBe(409);
        expect(mockCreateUser).not.toHaveBeenCalled();
    });

    it('and a missing required field is refused before any account is made', async () => {
        expect((await post({ ...VALID, phone: '' })).status).toBe(400);
        expect(mockCreateUser).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#513 — the route states no rule of its own', () => {
    it('THE SEEDABLE ROLES AND THE PROVENANCE MARKER COME FROM lib', () => {
        //   Comments stripped: this header and the route's quote the removed
        //   expression to explain it — #493's trap, met six times now.
        const body = stripComments(
            readFileSync('src/app/api/auth/register/route.ts', 'utf-8'),
            { label: 'auth/register route.ts' },
        );

        expect(body).toContain('SEEDABLE_ROLES');
        expect(body).toContain('[MANUFACTURED_PROFILE_MARKER]');
        expect(body).not.toMatch(/roles:\s*\[role\]/);
        expect(body).not.toMatch(/isVerified:\s*true/);
        expect(body).not.toContain('"_system_skeleton_backfill"');
    });
});
