/**
 * @jest-environment node
 */

/**
 *   #810 THE STRANDED-WALLET SCAN HAD THE SHAPE THAT TIMED THE FARM NATION
 *        SCREEN OUT, AND ITS OWN COPY OF A RULE THREE READERS HAD GOT WRONG.
 *
 *        THE WAIT. `_findStrandedWalletsAction` collected every superseded
 *        profile and then did this:
 *
 *            for (const row of superseded) {
 *                const snap = await db.collection(WALLETS).doc(row.id).get();
 *            }
 *
 *        One keyed read per profile, one after another. The measured population
 *        is 765 superseded profiles — 272 carrying a wallet row — so that is
 *        765 serialized round trips before the screen answers. At 20ms each,
 *        fifteen seconds; at 50ms, thirty-eight. #805 is the bill for exactly
 *        this in _farm_nation_approvals, where the screen stopped answering
 *        altogether, and the pool written there is reused rather than a second
 *        one appearing beside it.
 *
 *        THE COPY. #804 found three readers asking "is this row superseded?"
 *        with a query and getting a SELF-POINTING row wrong. This module was
 *        the fourth reader and it was CORRECT — it spelled the comparison out
 *        by hand, `pointer !== d.id`, and so was never in that list. A correct
 *        copy is still a copy; it is how the next one drifts. It goes through
 *        `supersedingPointer` now, beside the walk that has always applied it.
 *
 * ── WHAT IS ASSERTED, AND WHERE ─────────────────────────────────────────────
 *
 *   The ACTION is run with the wallet reads instrumented, because "the scan no
 *   longer waits for itself" is a claim about the scan. The meter records how
 *   many reads are in flight at once, so the sequential version scores 1 and
 *   this one does not, and both bounds are checked — concurrent, and not
 *   unboundedly so.
 *
 *   `scanned` gets a block of its own. Rewriting the loop nearly changed it: a
 *   wallet row that EXISTS carrying no `balance` field counts towards
 *   `scanned`, and collapsing "no row" and "no balance" into one `undefined`
 *   would have dropped it from that figure while leaving `stranded` correct —
 *   a wrong number on a screen with every test still green.
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

jest.mock('@/lib/wallet-ledger', () => ({
    consolidateWalletToLiveProfile: jest.fn(async () => ({ moved: false, reason: 'nothing_to_move' })),
}));

jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => undefined),
    recordAdminAction: jest.fn(async () => undefined),
}));

const requireAdmin = jest.fn<any>();
jest.mock('@/lib/require-admin', () => ({ requireAdmin: (...a: any[]) => requireAdmin(...a) }));

let store: FakeDbHandle;
const LIVE = 'live-profile';

/** Every wallet read the scan makes, and how many overlapped. */
let peak = 0;
let inFlight = 0;
let reads: string[] = [];

/**
 * Count wallet reads while they are in flight.
 *
 * The fake database serves every read through one global mock, with a
 * descriptor naming the collection and id set immediately before the call. So
 * the hook reads that descriptor and delegates — and it delegates SYNCHRONOUSLY,
 * before any await, because the descriptor is global and the next read
 * overwrites it. Delaying first would meter the wrong document, which is the
 * kind of instrument that measures itself rather than the code.
 */
function meterWalletReads() {
    const g = globalThis as any;
    const inner = g.mockFirestoreGet.getMockImplementation();

    g.mockFirestoreGet.mockImplementation(async (...args: any[]) => {
        const d = g.__firestoreAccess;
        if (d?.kind !== 'doc' || d?.collection !== COLLECTIONS.WALLETS) {
            return inner(...args);
        }

        reads.push(d.id);
        inFlight += 1;
        peak = Math.max(peak, inFlight);

        const pending = inner(...args);   // descriptor captured now, not later
        try {
            await new Promise((r) => setTimeout(r, 2));
            return await pending;
        } finally {
            inFlight -= 1;
        }
    });
}

const scan = async () => {
    const { findStrandedWalletsAction } = await import('@/app/actions/admin/_wallet_consolidation');
    return await findStrandedWalletsAction() as any;
};

const SUPERSEDED = 40;

beforeEach(() => {
    jest.clearAllMocks();
    peak = 0; inFlight = 0; reads = [];

    store = installFakeDb();
    requireAdmin.mockResolvedValue({ userId: 'an-admin', roles: ['super_admin'] });

    store.seed(COLLECTIONS.USERS, LIVE, { email: 'member@example.com', fullName: 'A Member' });
    for (let i = 0; i < SUPERSEDED; i++) {
        const id = `old-${String(i).padStart(3, '0')}`;
        store.seed(COLLECTIONS.USERS, id, { email: `m${i}@example.com`, _migratedTo: LIVE });
        store.seed(COLLECTIONS.WALLETS, id, { balance: 1000 + i });
    }

    meterWalletReads();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#810 — the scan no longer waits for itself', () => {
    it('READS OVERLAP', async () => {
        const r = await scan();

        expect(r.success).toBe(true);
        expect(peak).toBeGreaterThan(1);
    });

    it('AND NEVER MORE THAN THE BOUND', async () => {
        await scan();

        expect(peak).toBeLessThanOrEqual(8);
    });

    it('AND EVERY PROFILE IS READ EXACTLY ONCE', async () => {
        await scan();

        expect(reads).toHaveLength(SUPERSEDED);
        expect(new Set(reads).size).toBe(SUPERSEDED);
    });

    it('AND IT REPORTS THE SAME MONEY IT ALWAYS DID, in the same order', async () => {
        const r = await scan();

        expect(r.data.stranded).toHaveLength(SUPERSEDED);
        expect(r.data.scanned).toBe(SUPERSEDED);
        expect(r.data.stranded.map((s: any) => s.fromId))
            .toEqual([...reads].sort());
        expect(r.data.stranded[0].balance).toBe(1000);
        expect(r.data.stranded.every((s: any) => s.toId === LIVE)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#810 — `scanned` counts a wallet row, not a balance', () => {
    /**
     * The trap the rewrite nearly walked into. `scanned` is "superseded
     * profiles carrying a wallet row at all, stranded or not" — its own
     * docstring — so a row with no `balance` field is one of them.
     */
    it('A WALLET WITH NO BALANCE FIELD IS STILL SCANNED, and still not stranded', async () => {
        store.seed(COLLECTIONS.USERS, 'no-bal', { email: 'x@example.com', _migratedTo: LIVE });
        store.seed(COLLECTIONS.WALLETS, 'no-bal', { currency: 'NGN' });

        const r = await scan();

        expect(r.data.scanned).toBe(SUPERSEDED + 1);
        expect(r.data.stranded.map((s: any) => s.fromId)).not.toContain('no-bal');
    });

    it('AND A PROFILE WITH NO WALLET AT ALL IS NEITHER', async () => {
        store.seed(COLLECTIONS.USERS, 'no-wallet', { email: 'y@example.com', _migratedTo: LIVE });

        const r = await scan();

        expect(r.data.scanned).toBe(SUPERSEDED);
        expect(r.data.stranded.map((s: any) => s.fromId)).not.toContain('no-wallet');
    });

    it('and a zero balance is scanned but not stranded — 272 wallets are here', async () => {
        store.seed(COLLECTIONS.USERS, 'zero', { email: 'z@example.com', _migratedTo: LIVE });
        store.seed(COLLECTIONS.WALLETS, 'zero', { balance: 0 });

        const r = await scan();

        expect(r.data.scanned).toBe(SUPERSEDED + 1);
        expect(r.data.stranded.map((s: any) => s.fromId)).not.toContain('zero');
    });

    it('AND AN UNREADABLE BALANCE IS NOT MONEY — `NaN <= 0` is FALSE', async () => {
        //   #607's rule, and why this module uses isPositiveAmount rather than
        //   `balance > 0`: a balance that failed to parse would read as money.
        store.seed(COLLECTIONS.USERS, 'junk', { email: 'j@example.com', _migratedTo: LIVE });
        store.seed(COLLECTIONS.WALLETS, 'junk', { balance: 'not-a-number' });

        const r = await scan();

        expect(r.data.stranded.map((s: any) => s.fromId)).not.toContain('junk');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#810 — the self-pointer rule, now shared', () => {
    it('A ROW POINTING AT ITSELF IS NOT SUPERSEDED, so it is not read at all', async () => {
        //   What `supabaseAuthId` looks like on an ordinary linked account.
        store.seed(COLLECTIONS.USERS, 'self', { email: 's@example.com', supabaseAuthId: 'self' });
        store.seed(COLLECTIONS.WALLETS, 'self', { balance: 99_000 });

        const r = await scan();

        expect(reads).not.toContain('self');
        expect(r.data.stranded.map((s: any) => s.fromId)).not.toContain('self');
    });

    it('BUT supabaseAuthId POINTING ELSEWHERE STILL COUNTS', async () => {
        //   The direction that must not move — the pointer pair is honoured,
        //   not just `_migratedTo`.
        store.seed(COLLECTIONS.USERS, 'linked', { email: 'l@example.com', supabaseAuthId: LIVE });
        store.seed(COLLECTIONS.WALLETS, 'linked', { balance: 7_500 });

        const r = await scan();

        const row = r.data.stranded.find((s: any) => s.fromId === 'linked');
        expect(row).toBeDefined();
        expect(row.toId).toBe(LIVE);
        expect(row.balance).toBe(7_500);
    });

    it('POSITIVE CONTROL: a live row with money is never listed', async () => {
        // Otherwise "the self-pointer is excluded" could be measuring a scan
        // that lists nothing.
        store.seed(COLLECTIONS.WALLETS, LIVE, { balance: 50_000 });

        const r = await scan();

        expect(r.data.stranded.map((s: any) => s.fromId)).not.toContain(LIVE);
        expect(r.data.stranded.length).toBeGreaterThan(0);
    });

    it('and a caller without the permission is refused before any read', async () => {
        requireAdmin.mockResolvedValue({ error: 'Forbidden' });

        const r = await scan();

        expect(r.success).toBe(false);
        expect(reads).toEqual([]);
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Applied to src/app/actions/admin/_wallet_consolidation.ts alone, this suite
 *   re-run each time alongside the-way-out-of-a-stranded-balance.
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   SCAN_CONCURRENCY = 1 — the wait restored    1   "READS OVERLAP"
 *
 *   pool size = superseded.length (unbounded)   1   "AND NEVER MORE THAN THE
 *                                                   BOUND"
 *
 *   collapse exists/balance into one            1   "A WALLET WITH NO BALANCE
 *   `undefined` — the `scanned` trap                FIELD IS STILL SCANNED"
 *
 *   drop the supersedingPointer guard           5   "AND EVERY PROFILE IS READ
 *   (every row treated as superseded)               EXACTLY ONCE"
 *
 *   read only `_migratedTo`, not the pair       1   "BUT supabaseAuthId
 *                                                   POINTING ELSEWHERE STILL
 *                                                   COUNTS"
 *
 *   CONTROL — SHOULD SURVIVE
 *   reword the #810 comment in the action       0   SURVIVED ✓
 *
 *   THE THIRD IS THE ONE WORTH KEEPING. It is not a hypothetical — it is the
 *   first version of this fix, written and caught before it was committed. A
 *   wallet row that exists carrying no `balance` stops being counted in
 *   `scanned`, `stranded` stays exactly right, and nothing else in the suite
 *   notices. That is a wrong number on an admin screen with a green build.
 */
