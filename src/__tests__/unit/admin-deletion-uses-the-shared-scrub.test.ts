/**
 * @jest-environment node
 */

/**
 *   #305 #283's FIX NEVER REACHED THE ADMIN DELETION PATH.
 *
 *        softDeleteUserAction in admin_extensions.ts scrubbed three fields by
 *        hand:
 *
 *            email      deleted_<ts>_<id>@deleted.com
 *            phone      DELETED-<base36>
 *            fullName / displayName   "Deleted User"
 *
 *        and that was all of it. bvn, nin, nextOfKin, the identity-document
 *        URLs, dateOfBirth, bankAccountNumber/Name/Code,
 *        firstName/lastName/otherName and residentialAddress all stayed on the
 *        row of an account an admin had just reported as deleted.
 *
 *        #283 found precisely this on the MEMBER's own erasure path, concluded
 *        that a hand-written list in one file is how the omission happens, and
 *        moved the definition into lib/user-erasure.ts — where
 *        user-erasure.test.ts checks it against the User type, so a new PII
 *        field cannot be added without erasure learning about it.
 *
 *        That file's header even names this path: "there is more than one
 *        deletion path — see the note on bulk-user-operations.ts below". And
 *        this path still did not use it. The recurring shape, one more time:
 *        the copy somebody remembered fixing, and the copy added later.
 *
 *        `originalEmail: userData.email` was there too, annotated "Optional:
 *        Keep for audit, or remove if strict GDPR" — so the line above it
 *        scrubbed the email and this one wrote the real address back into the
 *        field beside it.
 *
 *   #300 AND THE RETENTION RECORD IS WRITTEN HERE TOO.
 *        The owner's instruction is that nothing is destroyed. The member's own
 *        erasure copies the document references to the server-only retention
 *        collection before scrubbing; this path now does the same, so which
 *        door an account leaves by does not decide whether its Cloudinary
 *        references survive.
 *
 * WHAT IS STILL AN OWNER DECISION, AND IS NOT DECIDED HERE
 * -------------------------------------------------------
 * bulkDeleteUsersAction — the same job in bulk, up to 50 accounts — marks
 * `deleted: true, suspended: true` and scrubs NOTHING AT ALL. That is task
 * #206, still open, and it is a policy question rather than a defect to fix
 * quietly: an admin removing spam accounts is not a right-to-erasure request,
 * and making a bulk button scrub 50 people's identity data is a decision with
 * consequences either way.
 *
 * What this suite does pin is that the two doors are now DIFFERENT in a known,
 * recorded way rather than by accident — and that the single door uses the
 * shared definition, so whichever way #206 goes, there is one list to point at.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { ERASED_FIELDS } from '@/lib/user-erasure';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
    isAdmin: () => true,
}));

const mockRevoke = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/auth-revocation', () => ({
    revokeAuthAccess: (...a: any[]) => mockRevoke(...a),
}));

jest.mock('@/lib/firebase-admin', () => ({
    adminAuth: { updateUser: async () => undefined, deleteUser: async () => undefined },
    adminStorage: { bucket: () => ({ file: () => ({ delete: async () => undefined }) }) },
}));

let store: FakeDbHandle;

const SUPER = 'super-1';
const TARGET = 'member-9';

/** A member row carrying every kind of thing this codebase stores about a person. */
const FULL_MEMBER = {
    email: 'ada@example.com',
    fullName: 'Ada Nwosu',
    firstName: 'Ada',
    lastName: 'Nwosu',
    phone: '08030000000',
    bvn: '22222222222',
    nin: '11111111111',
    dateOfBirth: '1990-04-01',
    residentialAddress: '12 Marina, Lagos',
    bankAccountNumber: '0123456789',
    bankAccountName: 'ADA NWOSU',
    bankCode: '058',
    nextOfKin: { name: 'Chidi Nwosu', phone: '08040000000' },
    documents: { validId: 'https://res.cloudinary.com/x/id.pdf' },
    roles: ['general_user'],
};

function code(rel: string): string {
    return stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'));
}

const EXT = 'src/app/actions/admin_extensions.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#305 — the admin deletion, executed', () => {
    beforeEach(() => {
        jest.resetModules();
        store = installFakeDb();
        mockRequireSession.mockResolvedValue({
            session: { user: { id: SUPER, email: 's@e.com', roles: ['super_admin'] } },
        });
        mockRevoke.mockResolvedValue({ primaryRevoked: true });
        store.seed(COLLECTIONS.USERS, TARGET, { ...FULL_MEMBER });
    });

    const remove = async () =>
        (await (await import('@/app/actions/admin_extensions')).softDeleteUserAction(TARGET)) as any;

    it('EVERY PII FIELD IN THE SHARED DEFINITION IS GONE', async () => {
        expect(await remove()).toMatchObject({ success: true });

        const row = store.get(COLLECTIONS.USERS, TARGET)!;
        const survivors = ERASED_FIELDS.filter((f) => row[f] !== undefined);

        // Named rather than counted, so a failure says WHICH field survived.
        expect(survivors).toEqual([]);
    });

    it('including the four the hand-written list never touched', async () => {
        // The ones that mattered most, asserted individually so this test still
        // means something if ERASED_FIELDS is ever narrowed.
        await remove();
        const row = store.get(COLLECTIONS.USERS, TARGET)!;

        expect(row.bvn).toBeUndefined();
        expect(row.nin).toBeUndefined();
        expect(row.nextOfKin).toBeUndefined();
        expect(row.documents).toBeUndefined();
    });

    it('AND THE REAL EMAIL IS NOT WRITTEN BACK BESIDE THE SCRUBBED ONE', async () => {
        // `originalEmail: userData.email` undid the scrub one line below it.
        await remove();
        const row = store.get(COLLECTIONS.USERS, TARGET)!;

        expect(row.originalEmail).toBeUndefined();
        expect(row.email).toBe(`deleted_${TARGET}@redacted.local`);
    });

    it('the account is suspended — the field the sign-in path actually reads', async () => {
        await remove();
        const row = store.get(COLLECTIONS.USERS, TARGET)!;

        expect(row.suspended).toBe(true);
        expect(row.deleted).toBe(true);
    });

    it('AND THE DOCUMENT REFERENCES SURVIVE IN THE RETENTION RECORD', async () => {
        await remove();

        const retained = store.get(COLLECTIONS.ERASURE_RETENTION, TARGET);
        expect(retained).toBeDefined();
        expect(retained?.documents).toEqual({ validId: 'https://res.cloudinary.com/x/id.pdf' });
        expect(retained?.reason).toBe('right_to_erasure');
    });

    it('the retention record is NOT a second copy of the profile', async () => {
        await remove();
        const retained = store.get(COLLECTIONS.ERASURE_RETENTION, TARGET)!;

        for (const leaked of ['bvn', 'nin', 'nextOfKin', 'bankAccountNumber']) {
            expect({ leaked, present: leaked in retained }).toEqual({ leaked, present: false });
        }
    });

    it('and a failed auth revocation is still reported as a failure', async () => {
        // Telling somebody an account is gone while its password still works is
        // the outcome this whole path exists to avoid.
        mockRevoke.mockResolvedValue({ primaryRevoked: false, error: 'nope' });

        expect(await remove()).toMatchObject({ success: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#305 — the definition lives in one place', () => {
    it('THE HAND-WRITTEN LIST IS GONE', () => {
        const src = code(EXT);

        expect(src).not.toMatch(/scrubbedPhone/);
        expect(src).not.toMatch(/scrubbedName/);
        expect(src).not.toMatch(/originalEmail:/);
        expect(src).not.toMatch(/@deleted\.com/);
    });

    it('and the shared one is used instead', () => {
        const src = code(EXT);

        expect(src).toMatch(/\.\.\.userErasurePatch\(targetUserId\)/);
        expect(src).toMatch(/erasedEmailFor\(targetUserId\)/);
    });

    it('THE RETENTION RECORD IS WRITTEN BEFORE THE SCRUB', () => {
        // userErasurePatch deletes `documents`; reading it afterwards reads
        // nothing. Both paths take the same care.
        const src = code(EXT);
        const retained = src.indexOf('erasureRetentionRecord(');
        const scrubbed = src.indexOf('userErasurePatch(targetUserId)');

        expect(retained).toBeGreaterThan(-1);
        expect(scrubbed).toBeGreaterThan(retained);
    });

    it('BOTH deletion paths now build their patch from lib/user-erasure', () => {
        // The member's own path and the admin's. If a third appears, it should
        // fail this rather than grow a fourth list.
        for (const path of ['src/app/actions/user.ts', EXT]) {
            expect({ path, shared: code(path).includes('userErasurePatch(') })
                .toEqual({ path, shared: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#305 — what is left for the owner (#206), recorded not hidden', () => {
    /**
     * bulkDeleteUsersAction scrubs nothing. That is deliberate for now and
     * belongs to the owner, so this pins the CURRENT behaviour rather than
     * asserting it is right — if somebody changes it, they change this test and
     * see the decision they are taking.
     */
    const BULK = 'src/app/actions/bulk-user-operations.ts';

    it('the bulk door marks the account and does not scrub', () => {
        const src = code(BULK);

        expect(src).toMatch(/deleted: true/);
        expect(src).toMatch(/suspended: true/);
        expect(src).not.toMatch(/userErasurePatch\(/);
    });

    it('and it destroys nothing either — it was always a mark', () => {
        expect(code(BULK)).not.toMatch(/userRef\.delete\(\)/);
    });

    it('it still refuses more than 50 at once, and refuses self-deletion', () => {
        const src = code(BULK);

        expect(src).toMatch(/userIds\.length > 50/);
        expect(src).toMatch(/Cannot delete your own account/);
    });
});
