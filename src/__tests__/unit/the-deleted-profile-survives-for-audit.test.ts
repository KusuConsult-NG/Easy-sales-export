/**
 * @jest-environment node
 */

/**
 *   #530 A DELETED MEMBER'S PROFILE SURVIVES FOR FRAUD AUDIT, AND SOMEBODY CAN
 *        ACTUALLY READ IT.
 *
 *   Owner instruction, verbatim: "the users profile should still be saved even
 *   after they delete their profile so admin can use it for audit incase of
 *   fraud etc."
 *
 *   #300 had already applied the owner's standing "nothing is destroyed" rule to
 *   part of this: the KYC rows, the seller verification and the wallet are
 *   MARKED rather than deleted, and a retention record is written to
 *   ERASURE_RETENTION. But that record was, in its own words, "deliberately NOT
 *   the full profile" — userId, the Cloudinary document links, and the email at
 *   erasure. The user row itself was still scrubbed of name, phone, BVN, NIN,
 *   bank details and next of kin, and nothing kept a copy.
 *
 *   So the profile did not survive, and there was no reader for what did.
 *
 * ── A REVERSED ASSERTION, RECORDED AS ONE ───────────────────────────────────
 *
 *   erasure-retires-never-destroys.test.ts asserted the opposite under the
 *   heading "AND IS NOT A SECOND COPY OF THE PROFILE", with the reasoning
 *   "Copying BVN, NIN or next of kin here would defeat the erasure entirely".
 *   That reasoning is sound. It is overridden by a decision the owner is
 *   entitled to make, and the reversal is written into that file rather than
 *   quietly deleted, so the next reader knows the platform held the other
 *   position and why it moved.
 *
 * ── WHAT DID NOT MOVE ───────────────────────────────────────────────────────
 *
 *   THE USER ROW IS STILL SCRUBBED. userErasurePatch is untouched. The person
 *   disappears from every screen, list, query and export exactly as before.
 *   Nothing that reads a user reads the retained copy.
 *
 *   CREDENTIALS ARE NOT RETAINED. stripSecrets removes totpSecret,
 *   mfaRecoveryCodes and password material, however deeply nested. Keeping a
 *   profile for fraud audit is the owner's call; keeping somebody's second
 *   factor and recovery codes after they closed their account is not implied by
 *   it, and a leaked retention row must not become a route past MFA. That
 *   exclusion is asserted, not assumed.
 *
 *   THE LAWFUL BASIS TRAVELS WITH THE DATA. `basis: "fraud_prevention"` is on
 *   the row. A retention with no recorded purpose is the thing a regulator
 *   objects to; one with a named purpose can be defended or revised.
 *
 * ── AND THE SECOND HALF: "SO ADMIN CAN USE IT" ──────────────────────────────
 *
 *   ERASURE_RETENTION lives in document_collections, which migration 004 put
 *   under RLS with NO policies — service key only, no browser session, and no
 *   admin screen. Retaining a copy nobody can consult satisfies the letter of
 *   the instruction and none of its purpose, so getErasedUserRecordAction is
 *   the reader.
 *
 *   super_admin ONLY, on a NEW permission. users:read is held by all ten admin
 *   roles and users:export by `admin` as well, so neither expresses "read the
 *   complete record of somebody who asked to be forgotten". #64 met this exact
 *   problem and its note is the precedent: "There was no permission to use.
 *   users:read is the closest and is held by all ten roles, which is the problem
 *   restated rather than fixed."
 *
 *   EVERY READ IS RECORDED, before the record is returned. The justification for
 *   keeping the data is accountability; a retention whose use nobody can audit
 *   is the opposite of that.
 *
 *   IT IS NOT A RESTORE AND NOT A LIST. Nothing writes to the user row, and
 *   there is no browse-everyone-who-left — the caller has to know whose record
 *   they are opening, which is what an investigation looks like and a fishing
 *   expedition does not.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the profile snapshot dropped from the record     KILLED
 *     credentials retained instead of stripped         KILLED
 *     the reader's permission gate removed             KILLED
 *     the gate widened to users:export                 KILLED
 *     the audit row removed from the reader            KILLED
 *     reword this header                               SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { hasAdminPermission } from '@/lib/admin-permissions';
import { auth } from '@/lib/auth';

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: p });

const mockAudit = (globalThis as any).mockCreateAdminAuditLog as jest.Mock<any>;

const BOSS = 'boss-1';
const GONE = 'member-gone';
let store: FakeDbHandle;

/** requireAdmin reads auth() and then re-reads the roles from the database. */
function actAs(id: string, roles: string[]): void {
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles, email: `${id}@example.com` } },
        error: null,
    }));
    (auth as unknown as jest.Mock).mockImplementation(() => Promise.resolve({
        user: { id, roles, email: `${id}@example.com` },
    }));
    store.seed(COLLECTIONS.USERS, id, { roles, email: `${id}@example.com` });
}

beforeEach(() => {
    //   NO jest.resetModules() here, deliberately.
    //
    //   requireAdmin calls auth() from @/lib/auth, which jest.setup mocks.
    //   Resetting the registry gives each dynamic import a FRESH copy of that
    //   mock, so the implementation set by actAs() below — captured from this
    //   file's top-level import — belongs to a different copy and the action
    //   sees an unmocked auth() returning nothing. Measured: every call came
    //   back "Unauthenticated" against a correct gate. The action has no
    //   module-level state, so there is nothing to reset.
    jest.clearAllMocks();
    store = installFakeDb();
    mockAudit.mockImplementation(() => Promise.resolve());
    actAs(BOSS, ['super_admin']);
    store.seed(COLLECTIONS.ERASURE_RETENTION, GONE, {
        userId: GONE,
        emailAtErasure: 'ada@example.com',
        basis: 'fraud_prevention',
        profileAtErasure: { fullName: 'Ada Obi', bvn: '22107458391', phone: '08030000001' },
    });
});

const read = async (userId: string) => {
    const { getErasedUserRecordAction } = await import('@/app/actions/admin/_erased');
    return (await getErasedUserRecordAction(userId)) as any;
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#530 — the permission is new because none of the old ones fit', () => {
    it('ONLY super_admin HOLDS IT', () => {
        expect(hasAdminPermission(['super_admin'], 'users:read_erased')).toBe(true);
        expect(hasAdminPermission(['admin'], 'users:read_erased')).toBe(false);
    });

    it('AND NO MODULE ADMIN OR SUPPORT ROLE DOES', () => {
        for (const role of ['support', 'moderator', 'marketplace_admin', 'wave_admin', 'academy_admin']) {
            expect({ role, has: hasAdminPermission([role], 'users:read_erased') })
                .toEqual({ role, has: false });
        }
    });

    it('and the roles that DO hold the neighbouring permissions still do', () => {
        //   The vacuity guard: adding a permission must not have disturbed the
        //   matrix around it.
        expect(hasAdminPermission(['admin'], 'users:export')).toBe(true);
        expect(hasAdminPermission(['support'], 'users:read')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#530 — the reader, executed', () => {
    it('A super_admin GETS THE RETAINED PROFILE', async () => {
        //   THE test for the owner's stated purpose: an admin investigating
        //   fraud can see who the closed account belonged to.
        const res = await read(GONE);

        expect(res.success).toBe(true);
        expect(res.data.profileAtErasure.fullName).toBe('Ada Obi');
        expect(res.data.profileAtErasure.bvn).toBe('22107458391');
    });

    it('AND AN admin IS REFUSED', async () => {
        //   Not users:export, which `admin` holds. This is a different act.
        actAs('admin-1', ['admin']);

        const res = await read(GONE);

        expect(res.success).toBe(false);
        expect(res.data).toBeNull();
    });

    it('AND SO IS support', async () => {
        actAs('support-1', ['support']);

        expect((await read(GONE)).success).toBe(false);
    });

    it('AND A REVOKED super_admin IS REFUSED, BECAUSE THE RECORD DECIDES', async () => {
        //   requireAdmin re-reads the roles from the database. #356: the JWT
        //   keeps its claim for hours after the row loses it, and #526 found
        //   that unfixed on the endpoint that grants roles.
        actAs(BOSS, ['super_admin']);                                  // token says so
        store.seed(COLLECTIONS.USERS, BOSS, { roles: ['general_user'] }); // record does not

        expect((await read(GONE)).success).toBe(false);
    });

    it('AND EVERY SUCCESSFUL READ LEAVES A ROW', async () => {
        //   The whole justification for keeping the data is accountability.
        await read(GONE);

        const rows = mockAudit.mock.calls.map((c: any[]) => c[0]);
        expect(rows).toContainEqual(expect.objectContaining({
            action: 'data_access',
            userId: BOSS,
            targetId: GONE,
            targetType: 'erased_user',
        }));
    });

    it('AND A REFUSED READ LEAVES NONE', async () => {
        //   A row saying an admin read a record they were refused is worse than
        //   no row: it reads as evidence and is false.
        actAs('admin-1', ['admin']);

        await read(GONE);

        expect(mockAudit.mock.calls.map((c: any[]) => c[0]?.action)).not.toContain('data_access');
    });

    it('and a missing record says so rather than pretending to be a refusal', async () => {
        //   "No record" and "you may not see it" are different answers and an
        //   investigator needs to know which one they got.
        const res = await read('never-existed');

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/no retained record/i);
    });

    it('and an empty id is refused before anything is read', async () => {
        expect((await read('')).success).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#530 — what the reader deliberately is not', () => {
    const src = () => code('src/app/actions/admin/_erased.ts');

    it('IT NEVER WRITES TO THE USER ROW — this is not an un-delete', () => {
        const body = src();

        expect(body).not.toContain('COLLECTIONS.USERS');
        expect(body).not.toMatch(/\.update\(|\.set\(/);
    });

    it('AND IT CANNOT LIST EVERYONE WHO LEFT', () => {
        //   No query, no sweep: the caller must already know whose record they
        //   are opening.
        const body = src();

        expect(body).not.toContain('.where(');
        expect(body).not.toContain('.all()');
        expect(body).toContain('.doc(target).get()');
    });

    it('AND IT ASKS requireAdmin, NOT THE SESSION ROLES', () => {
        expect(src()).toContain('requireAdmin("users:read_erased")');
        expect(src()).not.toMatch(/session\?\.user\?\.roles/);
    });
});
