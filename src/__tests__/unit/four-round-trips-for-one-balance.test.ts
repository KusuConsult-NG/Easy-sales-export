/**
 * @jest-environment node
 */

/**
 *   THE OWNER: "fix the wallet one next."
 *
 *       [slow-action] getWalletAction took 2475ms — 12 reads
 *
 *   (Twelve was the old meter over-attributing; the real count is five.)
 *
 * ── MEASURED, AND THE FIRST MEASUREMENT WAS WRONG ───────────────────────────
 *
 *   The first pass reported TEN READS, DEPTH EIGHT and named this the worst
 *   action on the platform. It was measured against a fixture with no wallet
 *   row, so every figure came from `_getOrCreateWallet`'s MISS path — the
 *   branch that mints a wallet, checks for a stranded balance under a
 *   superseded profile, writes, and reads back. That happens once in an
 *   account's life.
 *
 *   Seeded properly:
 *
 *       the wallet already exists   5 reads, depth 4  ->  5 reads, depth 2
 *       no wallet yet              10 reads, depth 8  -> 10 reads, depth 6
 *
 *   The first row is what everybody pays, every time, and it is the one worth
 *   having. A cold-start path measured as if it were the common one is how a
 *   fixture turns into a wrong headline.
 *
 * ── WHAT THE CHAIN WAS ──────────────────────────────────────────────────────
 *
 *   Four of those five reads were sequential purely because they were written
 *   in a column:
 *
 *       1. the wallet row          needs the caller's id
 *       2. the identity search     needs the caller's id
 *       3. the transaction sweep   needs the OWNED IDS from 2
 *       4. the user row, for bank details
 *                                  needs the caller's id
 *
 *   ONLY THE SWEEP DEPENDS ON ANYTHING. The other three go out together, and
 *   the sweep follows — two waits instead of four.
 *
 *   AND THE USER ROW GOES THROUGH THE REQUEST MEMO NOW. This was the last hot
 *   action still reading it with a bare `.doc(userId).get()`, so a dashboard
 *   that already held the row read it again here.
 *
 * ── WHAT IS DELIBERATELY NOT CHANGED ────────────────────────────────────────
 *
 *   `.all()` ON THE SWEEP STAYS. Its own comment explains why: a bare `.get()`
 *   stops at DEFAULT_QUERY_LIMIT and hands back a snapshot indistinguishable
 *   from a complete one, so a long-standing account would see lifetime totals
 *   that quietly stopped counting and a Pending Withdrawals that could omit a
 *   real payout. Correctness over round trips, and that trade is not this
 *   change's to reverse.
 *
 *   It does mean one entry in the meter can be several HTTP calls — the sweep
 *   pages a thousand rows at a time. Computing those three figures in the
 *   database, the way platform_revenue_totals and count_user_segments already
 *   do, is the next thing worth measuring here. It is a migration, not a
 *   reordering, and it belongs in its own change.
 *
 *   The BALANCE is still the live row alone. lib/wallet-lookup says at length
 *   why: a balance is spendable, migration 005's credit and debit functions
 *   only ever move the live row, and a total summed across profiles would put
 *   a figure on screen that checkout then refuses. The three STATS are summed
 *   across every owned profile, because they are history rather than money to
 *   be found — asserted below, both ways.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { measureReadDepth } from '@/lib/testing/read-depth';
import { COLLECTIONS } from '@/lib/types/firestore';

/*
 *   A REAL PER-REQUEST MEMOISER — React's cache() is a PASS-THROUGH under
 *   jest, so without it the memo this change starts using does not exist and
 *   the counts below are measured against a platform that has none.
 */
jest.mock('react', () => {
    const actual: any = jest.requireActual('react');
    return {
        ...actual,
        cache: (fn: any) => {
            const memo = new Map<string, any>();
            return (...args: any[]) => {
                const key = JSON.stringify(args);
                if (!memo.has(key)) memo.set(key, fn(...args));
                return memo.get(key);
            };
        },
    };
});

jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: jest.fn(async () => ({ success: true, limit: 100, remaining: 99, reset: 0 })) }),
    getClientIp: jest.fn(() => '127.0.0.1'),
    createRateLimitResponse: jest.fn(),
}));

const UID = 'holder-1';
const EMAIL = 'holder@example.test';
const TXN = COLLECTIONS.WALLET_TRANSACTIONS;
const WALLETS = 'wallets';

/** Today's cost of the wallet screen a holder actually waits on. */
const CEILING = { reads: 5, depth: 2 };

let store: FakeDbHandle;

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, UID, {
        uid: UID, email: EMAIL, roles: ['general_user'],
        isVerified: true, profileComplete: true, serviceRegistrations: {},
        bankAccountNumber: '0123456789', bankName: 'Test Bank', bankAccountName: 'A Holder',
    });
    (global as any).mockRequireSession = jest.fn(() => Promise.resolve({
        session: { user: { id: UID, email: EMAIL, roles: ['general_user'] } },
        error: null,
    }));
});

const wallet = () => import('@/app/actions/wallet');

/** The state everybody but a brand-new account is in. */
function seedAnExistingWallet(): void {
    store.seed(WALLETS, UID, { userId: UID, balance: 5000, currency: 'NGN' });
    store.seed(TXN, 't1', { userId: UID, type: 'funding', status: 'completed', amount: 5000 });
    store.seed(TXN, 't2', { userId: UID, type: 'purchase', status: 'completed', amount: -1200 });
    store.seed(TXN, 't3', { userId: UID, type: 'withdrawal', status: 'pending', amount: -800 });
}

describe('what the wallet screen actually waits for', () => {
    it('THE INSTRUMENT WORKS — a chain measures deep, a batch measures shallow', async () => {
        //   THE CONTROL. Without it every ceiling below passes on anything.
        const g = global as any;

        const serial = measureReadDepth();
        await g.mockFirestoreGet();
        await g.mockFirestoreGet();
        await g.mockFirestoreGet();
        expect({ reads: serial.reads, depth: serial.depth }).toEqual({ reads: 3, depth: 3 });

        const together = measureReadDepth();
        await Promise.all([g.mockFirestoreGet(), g.mockFirestoreGet(), g.mockFirestoreGet()]);
        expect({ reads: together.reads, depth: together.depth }).toEqual({ reads: 3, depth: 1 });
    });

    it('A HOLDER WITH A WALLET WAITS TWICE, not four times', async () => {
        seedAnExistingWallet();
        const { getWalletAction } = await wallet();
        const seen = measureReadDepth();

        const result: any = await getWalletAction();

        expect(result.success).toBe(true);
        expect(seen.reads).toBeLessThanOrEqual(CEILING.reads);
        expect(seen.depth).toBeLessThanOrEqual(CEILING.depth);
    });

    it('AND THE FIGURES ARE THE SAME ONES — balance, stats and bank details', async () => {
        //   A reordering that changed an amount would be the worst possible
        //   outcome on a money screen, so every figure is pinned.
        seedAnExistingWallet();
        const { getWalletAction } = await wallet();

        const result: any = await getWalletAction();

        expect(result.data.balance).toBe(5000);
        expect(result.data.stats).toEqual({
            totalFunded: 5000, totalSpent: 1200, pendingWithdrawals: 800,
        });
        expect(result.data.bankDetails).toMatchObject({
            accountNumber: '0123456789', bankName: 'Test Bank', accountName: 'A Holder',
        });
    });

    it('reads the caller\'s row ONCE, through the memo the rest of the platform uses', async () => {
        /*
         *   This was the last hot action reading it with a bare
         *   `.doc(userId).get()`. On a dashboard that has already read the row
         *   — every module gate does — that second read was pure cost.
         */
        seedAnExistingWallet();
        const { readUserDocOnce } = await import('@/lib/current-user-doc');
        const { getWalletAction } = await wallet();
        store.reads.length = 0;

        //   SOMEBODY ELSE IN THE REQUEST READS IT FIRST, which is the whole
        //   point and the only way to tell a memo from a single read: with one
        //   reader, a bare .get() and the memo are indistinguishable.
        await readUserDocOnce(UID);
        await getWalletAction();

        const ownRow = store.reads.filter(
            (r: any) => r.collection === COLLECTIONS.USERS && r.id === UID);
        expect(ownRow).toHaveLength(1);
    });

    it('and a FIRST-EVER visit still mints the wallet, just with less waiting', async () => {
        //   The cold path — the one the first measurement mistook for the
        //   common one. It is deeper, it happens once, and it must still work.
        const { getWalletAction } = await wallet();
        const seen = measureReadDepth();

        const result: any = await getWalletAction();

        expect(result.data.balance).toBe(0);
        expect((store.get(WALLETS, UID) as any)?.userId).toBe(UID);
        //   Below where it was, and not asserted tightly: minting is rare and
        //   a ceiling here would pin the stranded-balance check nobody wants
        //   to lose.
        expect(seen.depth).toBeLessThanOrEqual(6);
    });
});

describe('the money rules the reordering must not touch', () => {
    it('THE BALANCE IS THE LIVE ROW ALONE, never a sum across profiles', async () => {
        /*
         *   lib/wallet-lookup's rule, and the reason it exists: a balance is
         *   SPENDABLE. migration 005's credit_wallet_once and debit_wallet_once
         *   only ever move the live row, so a total summed across profiles
         *   would put a figure on screen that checkout then refuses to honour.
         */
        seedAnExistingWallet();
        store.seed(COLLECTIONS.USERS, 'superseded', { uid: 'superseded', email: EMAIL, _migratedTo: UID });
        store.seed(WALLETS, 'superseded', { userId: 'superseded', balance: 99000, currency: 'NGN' });
        const { getWalletAction } = await wallet();

        const result: any = await getWalletAction();

        expect(result.data.balance).toBe(5000);
    });

    it('but the STATS are summed over every profile, because they are history', async () => {
        //   Nothing is paid out of totalFunded or totalSpent, and
        //   pendingWithdrawals is money ALREADY debited. The sum is also the
        //   only figure that agrees with the transaction list beside it.
        seedAnExistingWallet();
        store.seed(COLLECTIONS.USERS, 'superseded', { uid: 'superseded', email: EMAIL, _migratedTo: UID });
        store.seed(TXN, 't4', { userId: 'superseded', type: 'funding', status: 'completed', amount: 2000 });
        const { getWalletAction } = await wallet();

        const result: any = await getWalletAction();

        expect(result.data.stats.totalFunded).toBe(7000);
    });

    it('and the sweep still reads EVERY page, not the first five thousand rows', async () => {
        /*
         *   A source ratchet. `.all()` is what stops a long-standing account
         *   seeing lifetime totals that quietly stopped counting, and it is
         *   exactly the sort of thing a round-trip fix is tempted to drop.
         */
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/wallet.ts'), 'utf8');

        //   ANCHORED TO THIS SWEEP. `.all()` appears twice in the file, so a
        //   bare toContain passes with the stats sweep silently capped —
        //   which is what a mutant proved.
        expect(src).toContain('db.collection(TXN_COLLECTION), "userId", ownedIds,\n    )\n        .all()\n        .get();');
        expect(src).toContain('txnsSnap.truncated');
    });
});
