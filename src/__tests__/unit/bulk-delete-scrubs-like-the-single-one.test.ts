/**
 * @jest-environment node
 */

/**
 *   #206 THE ADMIN BULK DELETE SCRUBBED NO PERSONAL DATA AT ALL.
 *
 *        Two doors delete a member. Both are gated on `users:delete`, and both
 *        files describe the other as doing the same job:
 *
 *          softDeleteUserAction   (admin_extensions.ts)      one user
 *          bulkDeleteUsersAction  (bulk-user-operations.ts)  up to fifty
 *
 *        The single door does the work five findings built: it writes the
 *        retention record FIRST so nothing is destroyed (#300), applies the
 *        shared PII patch (#283, #305, #371), scrubs the eight module rows the
 *        member's identity is copied onto (#376), and revokes sign-in against
 *        the scrubbed address.
 *
 *        The bulk door wrote FIVE FIELDS:
 *
 *            { deleted: true, deletedAt, deletedBy, deletionReason,
 *              suspended: true }
 *
 *        and nothing else. Name, email, phone, BVN, NIN, next of kin, bank
 *        account and identity-document URLs all remained — on the user row and
 *        on every module row — for as many as fifty people at a time.
 *
 *        NOT AN ACCESS DEFECT. `suspended` is the field lib/auth.ts actually
 *        refuses at login, and the bulk door set it. It is a RETENTION defect:
 *        the same compliance failure #283 opened, surviving on the door nobody
 *        was looking at.
 *
 *   WHY SHARING THE FIELD LISTS HAD NOT BEEN ENOUGH
 *
 *        #305 moved the PII field list into lib/user-erasure.ts precisely
 *        because "a hand-written list in one file is exactly how the omission
 *        happened", and its header says there is more than one deletion path
 *        and names this file. The fixes still went to one of them — because
 *        what was missing here was never a FIELD. It was the four STEPS.
 *
 *        So the OPERATION now lives in lib/user-soft-delete.ts and both doors
 *        call it. There is one implementation of "delete a user", not two that
 *        happen to agree.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { stripComments } from '@/lib/testing/strip-comments';
import { COLLECTIONS } from '@/lib/types/firestore';
import { ERASED_FIELDS } from '@/lib/user-erasure';

// ─── mocks ───────────────────────────────────────────────────────────────────

const mockRevoke = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/auth-revocation', () => ({
    revokeAuthAccess: (...a: any[]) => mockRevoke(...a),
}));

const mockEraseModules = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/module-application-erasure', () => ({
    eraseModuleApplications: (...a: any[]) => mockEraseModules(...a),
    MODULE_ERASURE_TARGETS: [],
}));

// ─── fixtures ────────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const OPERATION = 'src/lib/user-soft-delete.ts';
const BULK = 'src/app/actions/bulk-user-operations.ts';
const SINGLE = 'src/app/actions/admin_extensions.ts';

const USERS = COLLECTIONS.USERS;
const RETENTION = COLLECTIONS.ERASURE_RETENTION;
const ADMIN = 'admin-1';

let store: FakeDbHandle;

function source(rel: string): string {
    return stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });
}

function sourceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const e of readdirSync(dir)) {
            if (e === 'node_modules' || e === '__tests__') continue;
            const full = join(dir, e);
            if (statSync(full).isDirectory()) walk(full);
            else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full.slice(ROOT.length + 1));
        }
    };
    walk(join(ROOT, 'src'));
    return out.sort();
}

/** A member with a full identity profile, as production rows carry. */
function seedMember(id: string, over: Record<string, unknown> = {}): void {
    store.seed(USERS, id, {
        uid: id,
        fullName: 'Chidi Okonkwo', name: 'Chidi Okonkwo',
        email: 'chidi@example.com', phone: '08031234567', phoneNumber: '08031234567',
        bvn: '22222222222', nin: '11111111111',
        nextOfKinName: 'Ada Okonkwo', nextOfKinPhone: '08039999999',
        residentialAddress: '14 Awolowo Road, Ikoyi',
        bankAccountNumber: '0123456789', bankName: 'GTBank',
        documents: { idCard: 'https://res.cloudinary.com/x/id.png' },
        roles: ['buyer'],
        ...over,
    });
}

const op = async () => await import('@/lib/user-soft-delete');

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    mockRevoke.mockResolvedValue({ primaryRevoked: true });
    mockEraseModules.mockResolvedValue({ ok: true, failures: [] });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#206 — the shared operation scrubs, retains and revokes', () => {
    it('THE PERSONAL FIELDS ARE GONE FROM THE ROW', async () => {
        // THE test. Every field lib/user-erasure names as PII, checked against
        // that list rather than a copy of it — so a field added there is
        // covered here without editing this test.
        seedMember('u1');

        expect((await op()).softDeleteUserRecord('u1', ADMIN)).toBeInstanceOf(Promise);
        await (await op()).softDeleteUserRecord('u1', ADMIN);

        const row = store.get(USERS, 'u1')!;
        const survivors = (ERASED_FIELDS as readonly string[])
            .filter((f) => row[f] !== undefined && row[f] !== null);

        expect(survivors).toEqual([]);
    });

    it('and the row itself SURVIVES, with its uid — nothing is destroyed', async () => {
        seedMember('u1');

        await (await op()).softDeleteUserRecord('u1', ADMIN);

        const row = store.get(USERS, 'u1')!;
        expect(row.uid).toBe('u1');
        expect(row.deleted).toBe(true);
        expect(row.deletedBy).toBe(ADMIN);
        // The field lib/auth.ts actually refuses at login.
        expect(row.suspended).toBe(true);
    });

    it('THE RETENTION RECORD IS WRITTEN, and before the scrub', async () => {
        seedMember('u1');

        await (await op()).softDeleteUserRecord('u1', ADMIN);

        // It exists, and it carries what the row no longer does.
        const kept = store.get(RETENTION, 'u1');
        expect(kept).toBeDefined();
        expect(JSON.stringify(kept)).toContain('cloudinary');
    });

    it('and a FAILED retention write scrubs nothing at all', async () => {
        // The no-destruction rule as control flow. Losing the document
        // references is the one outcome the owner ruled out, so if they cannot
        // be kept, nothing is removed.
        seedMember('u1');
        const { supabaseDb } = await import('@/lib/supabase-db');
        const real = supabaseDb.collection.bind(supabaseDb);
        const spy = jest.spyOn(supabaseDb, 'collection').mockImplementation(((name: string) => {
            if (name === RETENTION) throw new Error('retention unavailable');
            return real(name);
        }) as any);

        try {
            const outcome = await (await op()).softDeleteUserRecord('u1', ADMIN);

            expect(outcome).toEqual({ ok: false, stage: 'retention', reason: 'retention unavailable' });
            expect(store.get(USERS, 'u1')!.email).toBe('chidi@example.com');
        } finally {
            spy.mockRestore();
        }
    });

    it('the eight module rows are scrubbed too, and a failure is reported', async () => {
        seedMember('u1');
        expect((await (await op()).softDeleteUserRecord('u1', ADMIN)).ok).toBe(true);
        expect(mockEraseModules).toHaveBeenCalledWith('u1');

        mockEraseModules.mockResolvedValue({ ok: false, failures: ['a', 'b'] });
        seedMember('u2');
        const outcome = await (await op()).softDeleteUserRecord('u2', ADMIN);

        expect(outcome).toEqual({ ok: false, stage: 'modules', reason: '2 module row(s) unreachable' });
    });

    it('sign-in is revoked against the SCRUBBED address, not the real one', async () => {
        seedMember('u1');

        await (await op()).softDeleteUserRecord('u1', ADMIN);

        const [userId, email] = mockRevoke.mock.calls[0] as [string, string];
        expect(userId).toBe('u1');
        expect(email).not.toBe('chidi@example.com');
        expect(email).toContain('u1');
    });

    it('and a failed revocation is reported rather than swallowed', async () => {
        seedMember('u1');
        mockRevoke.mockResolvedValue({ primaryRevoked: false, error: 'supabase down' });

        expect(await (await op()).softDeleteUserRecord('u1', ADMIN))
            .toEqual({ ok: false, stage: 'auth', reason: 'supabase down' });
    });

    it('a missing account is a failure, not a silent success', async () => {
        const outcome = await (await op()).softDeleteUserRecord('nobody', ADMIN);

        expect(outcome).toEqual({ ok: false, stage: 'write', reason: 'user not found' });
        expect(mockEraseModules).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#206 — BOTH doors run it, and no door keeps its own copy', () => {
    it('the two admin doors call the shared operation', () => {
        for (const door of [SINGLE, BULK]) {
            expect({ door, calls: source(door).includes('softDeleteUserRecord(') })
                .toEqual({ door, calls: true });
        }
    });

    it('AND NEITHER KEEPS A SECOND IMPLEMENTATION BESIDE IT', () => {
        // The whole point. Two doors that agree today is what produced this
        // finding; one implementation is what stops the next one.
        for (const door of [SINGLE, BULK]) {
            const src = source(door);
            for (const step of ['userErasurePatch(', 'erasureRetentionRecord(',
                'eraseModuleApplications(', 'revokeAuthAccess(']) {
                expect({ door, step, present: src.includes(step) })
                    .toEqual({ door, step, present: false });
            }
        }
    });

    it('and the sites that scrub a user are exactly the four that should', () => {
        // Swept, so a fifth appearing later is visible here rather than being
        // the next #206.
        const callers = sourceFiles().filter((f) => {
            const s = source(f);
            return s.includes('erasureRetentionRecord(') && s.includes('userErasurePatch(');
        });

        expect(callers.sort()).toEqual([
            // The member's own right-to-erasure request.
            'src/app/actions/user.ts',
            /**
             * The 30-day retention sweep. Deliberately NOT folded into the
             * shared operation: it is not "an admin deleted this account", it
             * is "the retention period expired", and it carries its own
             * env-gated auth destruction (GDPR_PURGE_DELETE_AUTH, default off)
             * which softDeleteUserRecord must never acquire. Same steps, a
             * different decision about the last one.
             */
            'src/app/api/cron/gdpr-purge/route.ts',
            // Both admin doors, through one implementation.
            OPERATION,
            // Where the field lists and the retention record are defined.
            'src/lib/user-erasure.ts',
        ].sort());
    });

    it('and the shared operation does NOT destroy an auth identity', () => {
        // The distinction above, as an assertion. The cron may, behind an env
        // flag the owner turns on; the admin doors revoke access and keep the
        // identity, so a deletion is reversible and nothing is destroyed.
        const src = source(OPERATION);

        expect(src).toContain('revokeAuthAccess(');
        expect(src).not.toContain('GDPR_PURGE_DELETE_AUTH');
        expect(src).not.toMatch(/deleteUser\(|adminAuth\.deleteUser/);
    });

    it('THE BULK DOOR DOES NOT COUNT A HALF-SCRUBBED ACCOUNT AS DELETED', () => {
        const src = source(BULK);

        expect(src).toMatch(/if\s*\(!outcome\.ok\)/);
        expect(src).toContain('failedIds.push(userId);');
        expect(src).toContain('SOFT_DELETE_STAGE_MESSAGE[outcome.stage]');
        // And it says WHY, not only how many.
        expect(src).toContain('failures');
    });

    it('and the DELETE no longer batches, because a scrub does not fit in one', () => {
        // A retention write, a row update, eight module sweeps and an auth
        // revocation per user do not belong in — or survive — a batched update.
        //
        // SCOPED TO THE DELETE. My first draft asserted the file had no
        // `db.batch()` at all and failed: bulkSuspend, bulkActivate and
        // bulkAssignRoles each batch a single-field update, which is exactly
        // what a batch is for. Only this one had to stop.
        const src = source(BULK);
        const a = src.indexOf('export async function bulkDeleteUsersAction');
        const b = src.indexOf('export async function createImpersonationTokenAction', a + 1);
        expect({ a: a > -1, b: b > a }).toEqual({ a: true, b: true });

        expect(src.slice(a, b)).not.toContain('db.batch()');
        // And the other three still do, so this is a scoped change.
        expect(src.slice(0, a)).toContain('db.batch()');
    });

    it('it still refuses more than fifty, and refuses self-deletion', () => {
        // The guards that were already right, unchanged by this finding.
        const src = source(BULK);

        expect(src).toMatch(/userIds\.length > 50/);
        expect(src).toContain('Cannot delete your own account');
        expect(src).toContain('users:delete');
    });

    it('and it still refuses an admin target unless the caller is a super_admin', () => {
        expect(source(BULK)).toMatch(/userRoles\.includes\("admin"\) && !isSuperAdmin/);
    });

    it('NOTHING IS DELETED by either door', () => {
        // The standing rule for this codebase.
        for (const f of [OPERATION, BULK, SINGLE]) {
            expect({ f, destroys: /userRef\.delete\(\)|\.doc\([^)]*\)\.delete\(\)/.test(source(f)) })
                .toEqual({ f, destroys: false });
        }
    });

    it('the write-up survives in the file, and the sweeps do not read it', () => {
        // The tombstone trap, both directions.
        const raw = readFileSync(join(ROOT, OPERATION), 'utf-8');

        expect(raw).toContain('THE BULK DELETE SCRUBBED NO PERSONAL DATA AT ALL');
        expect(source(OPERATION)).not.toContain('THE BULK DELETE SCRUBBED NO PERSONAL DATA AT ALL');
    });
});
