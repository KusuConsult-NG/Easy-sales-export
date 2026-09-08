/**
 * @jest-environment node
 */

/**
 *   #500 THREE CONTROLS AT THE END OF admin/_users.ts: ONE REFUSED BY ITS OWN
 *        VALIDATOR, ONE THAT VALIDATED NOTHING, AND ONE GUARDED BY A READ
 *        PERMISSION.
 *
 * ── 1. THE NIN TOGGLE HAS NEVER WORKED ──────────────────────────────────────
 *
 *   UserKycVerificationSchema declared:
 *
 *       field: z.enum(["bvn", "tin", "cac"])
 *
 *   while everything on either side of it handled four:
 *
 *       _toggleUserKycVerificationAction   field: 'bvn'|'nin'|'tin'|'cac'
 *       nestedFieldMap                     nin: 'kyc.ninVerified'
 *       legacyFieldMap                     nin: 'ninVerified'
 *       statusField                        field === 'nin' ? 'kyc.ninStatus' : …
 *       admin/users/page.tsx:1021          { key: "nin", label: "NIN", … }
 *
 *   NIN is the FIRST row of that panel. Pressing its button sent `field: "nin"`,
 *   safeParse rejected it before a line of the mapping ran, and the admin got a
 *   validation error about a value the rest of the platform accepts.
 *
 *   The TypeScript union said four and the validator said three. The validator
 *   wins: the union is compile-time only, and a server action is a public
 *   endpoint.
 *
 * ── 2. THE GENDER UPDATE PARSED NOTHING AT ALL ──────────────────────────────
 *
 *   Every neighbouring action in the file parses its input. This one leaned on
 *   the union `"male" | "female"`, which is erased at runtime, and wrote
 *   whatever arrived onto the user document.
 *
 *   THE FIELD IS READ, so a junk value is not inert: `options.gender` filters
 *   this very list and the segment counts group on it. An OBJECT would be worse
 *   again — the same mapping already extracts state and lga defensively with the
 *   note "preventing React objects-as-children crashes", which is this lesson
 *   already learned on a different field.
 *
 *   It also wrote onto ids that do not exist, which mints a user record holding
 *   a gender and nothing else — the shape #495 spent three thousand rows on.
 *
 * ── 3. THE ACCOUNT UNLOCK WAS GATED ON users:read ───────────────────────────
 *
 *   admin-permissions.ts is explicit about what that admits: "every admin role
 *   holds users:read" — ten of them, including support, moderator and each
 *   module's own admin. It is the weakest gate in the matrix.
 *
 *   What it guarded is not a lookup. resetLoginAttempts clears the failed-login
 *   counter in Redis AND the in-memory store — the whole lockout. So the
 *   lowest-privileged admin role could clear the lock on any email, repeatedly,
 *   including a super_admin's, and keep an account indefinitely guessable.
 *
 *   NO UI CALLS IT, which is not a reason to leave it: a Next.js server action is
 *   addressable by its own id whether or not a button points at it. An endpoint
 *   with no caller is one with no witnesses, not one that cannot be reached.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     "nin" removed from the enum again              KILLED
 *     the gender schema check removed                KILLED
 *     the gender existence check removed             KILLED
 *     the unlock gate returned to users:read         KILLED
 *     previousGender dropped from the audit entry    KILLED
 *     reword this header                             SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
    revalidateTag: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

let store: FakeDbHandle;

const USERS = COLLECTIONS.USERS;

function actAs(id: string, roles: string[]): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        { session: { user: { id, roles, email: `${id}@example.com` } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs('admin-1', ['super_admin']);
});

async function actions() {
    return import('@/app/actions/admin/_users');
}

const read = (id: string) => store.get(USERS, id) as Record<string, any>;

function seedUser(id: string, extra: Record<string, unknown> = {}): void {
    store.seed(USERS, id, {
        email: `${id}@example.com`,
        firstName: 'Ada',
        lastName: 'Obi',
        roles: ['general_user'],
        createdAt: '2026-01-01T00:00:00.000Z',
        ...extra,
    });
}

const auditEntries = () =>
    ((globalThis as any).mockCreateAdminAuditLog.mock.calls as any[][])
        .map(([payload]) => payload);

// ─────────────────────────────────────────────────────────────────────────────
describe('#500 — the NIN toggle reaches the code that handles NIN', () => {
    const toggleKyc = async (id: string, field: string, current: boolean) =>
        (await (await actions()).toggleUserKycVerificationAction(id, field as any, current)) as any;

    it('TOGGLING NIN SUCCEEDS AND WRITES THE NIN FIELDS', async () => {
        //   THE test. It used to fail validation before reaching nestedFieldMap,
        //   which has handled `nin` all along.
        seedUser('u1', { kyc: { nin: 'x' } });

        expect(await toggleKyc('u1', 'nin', false)).toMatchObject({ success: true });

        const row = read('u1');
        expect(row.kyc.ninVerified).toBe(true);
        expect(row.ninVerified).toBe(true);
        expect(row.kyc.ninStatus).toBe('verified');
    });

    it('AND THE OTHER THREE STILL WORK', async () => {
        //   The control: adding a value to an enum must not disturb the values
        //   already in it.
        for (const field of ['bvn', 'tin', 'cac']) {
            seedUser(`u-${field}`);
            expect((await toggleKyc(`u-${field}`, field, false)).success).toBe(true);
        }
    });

    it('and a field nobody handles is still refused', async () => {
        //   The vacuity guard. Widening the enum to accept anything would pass
        //   both assertions above.
        seedUser('u1');

        expect((await toggleKyc('u1', 'passport', false)).success).toBe(false);
        expect(read('u1').passportVerified).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#500 — the gender update validates what it is given', () => {
    const setGender = async (id: string, gender: string) =>
        (await (await actions()).updateUserGenderAction(id, gender as any)) as any;

    it('A VALUE THAT IS NOT A GENDER IS REFUSED, NOT STORED', async () => {
        //   THE test. The union is erased at runtime and a server action is a
        //   public endpoint, so nothing stopped this reaching the document.
        seedUser('u1', { gender: 'female' });

        expect((await setGender('u1', 'banana')).success).toBe(false);
        expect(read('u1').gender).toBe('female');
    });

    it('AND AN OBJECT IS REFUSED — the crash this file already learned about', async () => {
        //   The mapping extracts state and lga defensively "preventing React
        //   objects-as-children crashes". gender had no such guard on the way in.
        seedUser('u1', { gender: 'female' });

        expect((await setGender('u1', { evil: true } as any)).success).toBe(false);
        expect(read('u1').gender).toBe('female');
    });

    it('AND A REAL VALUE IS STORED, LOWER-CASED', async () => {
        //   The control, and the normalisation: the filter compares
        //   `String(u.gender || "").toLowerCase()`, so what is stored has to
        //   match what is compared.
        seedUser('u1');

        expect((await setGender('u1', 'Male')).success).toBe(true);
        expect(read('u1').gender).toBe('male');
    });

    it('AND AN UNKNOWN TARGET IS REFUSED RATHER THAN CREATED', async () => {
        expect(await setGender('ghost', 'male')).toMatchObject({
            success: false, error: 'User not found',
        });
        expect(store.get(USERS, 'ghost')).toBeUndefined();
    });

    it('and the audit entry says what the gender was before', async () => {
        seedUser('u1', { gender: 'female' });

        await setGender('u1', 'male');

        const entry = auditEntries().find((p) => p?.action === 'user_gender_update');
        expect(entry.metadata).toMatchObject({ newGender: 'male', previousGender: 'female' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#500 — clearing the login lockout is a write, not a read', () => {
    const unlock = async (email: string) =>
        (await (await actions()).unlockUserAccount(email)) as any;

    it('A SUPPORT ADMIN CANNOT CLEAR THE BRUTE-FORCE LOCKOUT', async () => {
        //   THE test. `support` holds users:read — the gate this used to ask
        //   for — and resetLoginAttempts clears the whole lockout.
        actAs('support-1', ['support']);

        expect(await unlock('victim@example.com')).toMatchObject({
            success: false,
            error: 'Unauthorized: Permission required - users:update',
        });
    });

    it('AND NEITHER CAN A MODULE ADMIN', async () => {
        //   Ten roles hold users:read. A fix naming one of them would leave the
        //   rest.
        actAs('coop-1', ['cooperative_admin']);

        expect((await unlock('victim@example.com')).success).toBe(false);
    });

    it('AND AN ADMIN STILL CAN — the refusal is a permission, not a wall', async () => {
        //   The control. Unlocking a genuinely locked-out member is the reason
        //   this action exists.
        actAs('admin-2', ['admin']);

        expect(await unlock('member@example.com')).toMatchObject({ success: true });
    });

    it('and a malformed address is still refused before anything is cleared', async () => {
        actAs('admin-2', ['admin']);

        expect((await unlock('not-an-email')).success).toBe(false);
    });
});
