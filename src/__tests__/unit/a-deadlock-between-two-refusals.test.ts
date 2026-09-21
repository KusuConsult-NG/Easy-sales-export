/**
 * @jest-environment node
 */

/**
 *   #806 TWO TOOLS, EACH NAMING THE OTHER AS ITS PREREQUISITE, AND NO WAY IN.
 *
 *   A split account is two rows sharing an email with NO pointer between them.
 *   Five of them turned up in a production log, and settling one that held a
 *   wallet balance was impossible:
 *
 *       /admin/forensics/duplicates   "still holds a wallet balance … Move the
 *                                      balance onto the record you are keeping
 *                                      first, then settle the group."
 *
 *       migration 046                 `not_the_same_person` — it refuses when
 *                                      the source "points somewhere ELSE or
 *                                      points nowhere at all", its own words.
 *                                      A split account points nowhere, so:
 *                                      settle the duplicate first.
 *
 *   Neither could go first. `findStrandedWalletsAction` was no way round it
 *   either — it lists rows that ALREADY point somewhere, so a split account
 *   never appeared on it — and that action has no screen at all.
 *
 * ── WHAT BREAKS IT ──────────────────────────────────────────────────────────
 *
 *   The pointer is written FIRST and the money moves SECOND, inside the one
 *   action that has just recorded an admin's decision that these rows are one
 *   person. 046's guard is not widened: it still refuses any pair nothing
 *   pointed, and what points them is a write this action made under
 *   `users:update`, with a required reason and an audit row.
 *
 *   THE ORDER IS THE WHOLE FIX, so it is asserted by reading the store at the
 *   moment the mover is called — not by reading the source.
 *
 * ── AND IT IS STILL TWO DECISIONS ───────────────────────────────────────────
 *
 *   `moveBalances` is required. Moving somebody's money as a silent side
 *   effect of an identity decision is the shape this audit keeps filing
 *   against, and it costs something real: the module header promises that
 *   clearing one field puts the group back, and once a balance has moved that
 *   is no longer wholly true. So the refusal names the record and the amount,
 *   and the screen names them again before the button.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

const requireAdmin = jest.fn<any>();
jest.mock('@/lib/require-admin', () => ({ requireAdmin: (...a: any[]) => requireAdmin(...a) }));

const consolidateWalletToLiveProfile = jest.fn<any>();
jest.mock('@/lib/wallet-ledger', () => ({
    consolidateWalletToLiveProfile: (...a: any[]) => consolidateWalletToLiveProfile(...a),
}));

const createAdminAuditLog = jest.fn<(e: any) => Promise<void>>(async () => undefined);
jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: (e: any) => createAdminAuditLog(e),
    recordAdminAction: jest.fn(async () => undefined),
}));

let store: FakeDbHandle;

const ADMIN = 'an-admin';
const KEEP = 'a-keeper';
const GONE = 'b-the-other-one';
const EMAIL = 'member@example.com';
const REASON = 'Same person — the paper file and the payment reference both match.';

/** Pointer recorded at the moment the mover was called. */
let pointerWhenMoved: unknown;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    requireAdmin.mockResolvedValue({ userId: ADMIN, roles: ['super_admin'] });
    pointerWhenMoved = undefined;

    consolidateWalletToLiveProfile.mockImplementation(async ({ fromId }: any) => {
        pointerWhenMoved = store.get(COLLECTIONS.USERS, fromId)?._migratedTo;
        return { moved: true, amount: 5000, fromBalance: 0, toBalance: 5000, reason: null };
    });

    //   A SPLIT ACCOUNT: one address, two rows, no pointer either way.
    store.seed(COLLECTIONS.USERS, KEEP, { email: EMAIL, fullName: 'A Member', roles: ['buyer'] });
    store.seed(COLLECTIONS.USERS, GONE, { email: EMAIL, fullName: 'A Member', roles: ['buyer'] });
});

const fund = (id: string, balance: number) =>
    store.seed(COLLECTIONS.WALLETS, id, { id, balance });

const resolve = async (over: Record<string, unknown> = {}) => {
    const { resolveDuplicateProfileGroupAction } = await import('@/app/actions/admin/_duplicate_profiles');
    return await resolveDuplicateProfileGroupAction({
        email: EMAIL, keepId: KEEP, supersedeIds: [GONE], reason: REASON, ...over,
    }) as any;
};

const list = async () => {
    const { listDuplicateProfileGroupsAction } = await import('@/app/actions/admin/_duplicate_profiles');
    return await listDuplicateProfileGroupsAction() as any;
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#806 — the deadlock, and the way out of it', () => {
    it('A FUNDED RECORD IS STILL REFUSED WITHOUT CONSENT, AND NAMES THE AMOUNT', async () => {
        fund(GONE, 5000);

        const res = await resolve();

        expect(res.success).toBe(false);
        expect(res.error).toContain(GONE);
        expect(res.error).toContain('₦5,000');
        //   Nothing was written. The old refusal's promise, kept.
        expect(store.get(COLLECTIONS.USERS, GONE)?._migratedTo).toBeUndefined();
        expect(consolidateWalletToLiveProfile).not.toHaveBeenCalled();
    });

    it('AND WITH CONSENT IT SETTLES — pointer written AND money moved', async () => {
        fund(GONE, 5000);

        const res = await resolve({ moveBalances: true });

        expect(res.success).toBe(true);
        expect(res.data.superseded).toEqual([GONE]);
        expect(res.data.moved).toEqual(['₦5,000 from b-the-other-one']);
        expect(store.get(COLLECTIONS.USERS, GONE)?._migratedTo).toBe(KEEP);
        expect(consolidateWalletToLiveProfile).toHaveBeenCalledWith(
            expect.objectContaining({ fromId: GONE, toId: KEEP, actorId: ADMIN }),
        );
    });

    it('THE POINTER EXISTS BEFORE THE MOVER IS CALLED — the order IS the fix', async () => {
        /*
         *   046 re-reads the pointer inside its own transaction. Called the
         *   other way round it answers `not_the_same_person`, which is the
         *   deadlock. Read from the STORE at call time, so this measures the
         *   sequence rather than the source.
         */
        fund(GONE, 5000);

        await resolve({ moveBalances: true });

        expect(pointerWhenMoved).toBe(KEEP);
    });

    it('and an unfunded record never reaches the mover at all', async () => {
        const res = await resolve();

        expect(res.success).toBe(true);
        expect(res.data.moved).toEqual([]);
        expect(consolidateWalletToLiveProfile).not.toHaveBeenCalled();
    });

    it('consent on a group with nothing to move changes nothing', async () => {
        const res = await resolve({ moveBalances: true });

        expect(res.success).toBe(true);
        expect(consolidateWalletToLiveProfile).not.toHaveBeenCalled();
        expect(store.get(COLLECTIONS.USERS, GONE)?._migratedTo).toBe(KEEP);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#806 — and when the move fails, the row goes back', () => {
    /**
     * The state this must never create is the one the old refusal existed to
     * prevent: a superseded row still holding money. If the mover will not
     * move it, the supersession is undone.
     */
    it('A THROW PUTS THE POINTER BACK — and says migration 046 may be why', async () => {
        fund(GONE, 5000);
        consolidateWalletToLiveProfile.mockRejectedValue(
            new Error('Wallet consolidation failed: function consolidate_wallet_to_live_profile does not exist'),
        );

        const res = await resolve({ moveBalances: true });

        expect(res.success).toBe(false);
        expect(res.error).toContain('046');
        //   Empty, not absent and not deleted — see the action's own note.
        expect(store.get(COLLECTIONS.USERS, GONE)?._migratedTo).toBe('');
    });

    it('AND A REFUSAL FROM THE DATABASE PUTS IT BACK TOO', async () => {
        fund(GONE, 5000);
        consolidateWalletToLiveProfile.mockResolvedValue({
            moved: false, amount: 0, fromBalance: 5000, toBalance: 0, reason: 'not_the_same_person',
        });

        const res = await resolve({ moveBalances: true });

        expect(res.success).toBe(false);
        expect(res.error).toContain('not_the_same_person');
        expect(store.get(COLLECTIONS.USERS, GONE)?._migratedTo).toBe('');
    });

    it('A CLEARED POINTER READS AS NO POINTER to every reader', async () => {
        /*
         *   `FieldValue.delete()` is refused by this module's ratchet, so the
         *   rollback writes "". That is only a rollback if the readers agree it
         *   means nothing — `str()` answers null for it, and the superseded
         *   population is found with `where("_migratedTo", "!=", "")`, which an
         *   empty string does not match.
         */
        const { supersedingPointer } = await import('@/lib/user-identity');
        const { classifyGroup } = await import('@/lib/duplicate-profile-resolution');

        expect(supersedingPointer(GONE, '')).toBeNull();
        expect(classifyGroup([
            { id: KEEP, data: {} },
            { id: GONE, data: { _migratedTo: '' } },
        ]).state).toBe('needs-a-decision');
    });

    it('but `nothing_to_move` is NOT a failure — the state asked for holds', async () => {
        //   The balance reached zero between the read and the call. Somebody
        //   spent it, or another admin moved it. Rolling back would undo a
        //   correct supersession over a race that resolved itself.
        fund(GONE, 5000);
        consolidateWalletToLiveProfile.mockResolvedValue({
            moved: false, amount: 0, fromBalance: 0, toBalance: 0, reason: 'nothing_to_move',
        });

        const res = await resolve({ moveBalances: true });

        expect(res.success).toBe(true);
        expect(store.get(COLLECTIONS.USERS, GONE)?._migratedTo).toBe(KEEP);
        expect(res.data.moved).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#806 — the money move is audited as its own act', () => {
    it('ITS AUDIT ROW IS WRITTEN BEFORE THE MOVE, carrying both ids', async () => {
        fund(GONE, 5000);
        const order: string[] = [];
        createAdminAuditLog.mockImplementation(async (e: any) => { order.push(`audit:${e.action}`); });
        consolidateWalletToLiveProfile.mockImplementation(async () => {
            order.push('move');
            return { moved: true, amount: 5000, fromBalance: 0, toBalance: 5000, reason: null };
        });

        await resolve({ moveBalances: true });

        expect(order).toEqual([
            'audit:user_profile_supersede',
            'audit:wallet_balance_consolidated',
            'move',
        ]);
        expect(createAdminAuditLog).toHaveBeenCalledWith(expect.objectContaining({
            action: 'wallet_balance_consolidated',
            metadata: expect.objectContaining({ fromId: GONE, toId: KEEP }),
        }));
    });

    it('and the supersession audit records which records were funded', async () => {
        fund(GONE, 5000);

        await resolve({ moveBalances: true });

        expect(createAdminAuditLog).toHaveBeenCalledWith(expect.objectContaining({
            action: 'user_profile_supersede',
            metadata: expect.objectContaining({ funded: [GONE] }),
        }));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#806 — the screen is told the figure before the operator chooses', () => {
    it('THE LISTING CARRIES EACH RECORD\'S BALANCE', async () => {
        fund(GONE, 5000);

        const res = await list();
        const group = res.data.groups.find((g: any) => g.email === EMAIL);

        expect(group.candidates.find((c: any) => c.id === GONE).walletBalance).toBe(5000);
        expect(group.candidates.find((c: any) => c.id === KEEP).walletBalance).toBe(0);
    });

    it('POSITIVE CONTROL: a wallet-less group reads zero rather than undefined', async () => {
        // Otherwise "the balance is carried" could be true of a field that is
        // simply always absent, and the screen would render nothing either way.
        const res = await list();
        const group = res.data.groups.find((g: any) => g.email === EMAIL);

        expect(group.candidates.every((c: any) => c.walletBalance === 0)).toBe(true);
    });

    it('and the gates are unchanged — neither door opens without users:update', async () => {
        requireAdmin.mockResolvedValue({ error: 'Not permitted' });

        expect((await list()).success).toBe(false);
        expect((await resolve({ moveBalances: true })).success).toBe(false);
        expect(consolidateWalletToLiveProfile).not.toHaveBeenCalled();
    });

    it('and a reason is still required before anything moves', async () => {
        fund(GONE, 5000);

        const res = await resolve({ moveBalances: true, reason: 'ok' });

        expect(res.success).toBe(false);
        expect(consolidateWalletToLiveProfile).not.toHaveBeenCalled();
        expect(store.get(COLLECTIONS.USERS, GONE)?._migratedTo).toBeUndefined();
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Applied to src/app/actions/admin/_duplicate_profiles.ts, this suite re-run
 *   with a-decision-only-a-person-can-make each time.
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   move regardless of consent (drop           1    "A FUNDED RECORD IS STILL
 *   `&& !moveBalances`)                             REFUSED WITHOUT CONSENT"
 *
 *   consolidate BEFORE writing the pointer     1    "THE POINTER EXISTS BEFORE
 *   — the deadlock, restored                        THE MOVER IS CALLED"
 *
 *   drop the rollback on a throw               1    "A THROW PUTS THE POINTER
 *                                                   BACK"
 *
 *   drop the rollback on a refusal             1    "AND A REFUSAL FROM THE
 *                                                   DATABASE PUTS IT BACK TOO"
 *
 *   treat `nothing_to_move` as a failure       1    "but `nothing_to_move` is
 *                                                   NOT a failure"
 *
 *   move the wallet audit after the move       1    "ITS AUDIT ROW IS WRITTEN
 *                                                   BEFORE THE MOVE"
 *
 *   CONTROL — SHOULD SURVIVE
 *   reword a comment in the action             0    SURVIVED ✓
 *
 *   The second row is the one worth reading twice: putting the consolidation
 *   back before the pointer write — which is the deadlock, restored — kills
 *   SEVEN tests, because that order is not a detail of this fix. It is the
 *   fix.
 */
