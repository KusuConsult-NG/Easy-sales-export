/**
 * @jest-environment node
 */

/**
 *   #890 #884'S CRASH, ON THE MONEY PATHS THAT FIX DID NOT REACH.
 *
 *   #884 was a production TypeError the owner pasted from their log:
 *
 *       getMyLandListings error:
 *       TypeError: b.verifiedAt.toDate is not a function
 *
 *   It was fixed in land-actions.ts and nowhere else. A sweep for the same
 *   shape found 78 unguarded `.toDate()` call sites, and the pattern that
 *   causes it exactly — a PRESENCE test standing in for a TYPE test, with a
 *   cast telling the compiler not to worry — in four places that move money:
 *
 *       _escrow_actions.ts       12 sites, across BOTH escrow list readers
 *       _mp_products.ts           the seller's product EDIT
 *       _loans_repayments.ts      the borrower's repayment
 *
 *   The shape:
 *
 *       createdAt: data.createdAt ? (data.createdAt as Timestamp).toDate()… : null
 *
 *   `data.createdAt ?` asks whether the field is THERE. A stored timestamp
 *   comes back in four shapes — Timestamp, ISO string, Date, number — and the
 *   adapter only converts a FULL ISO string, so a date-only string, a number,
 *   or a value written by a different door arrives truthy with no `.toDate()`.
 *   The cast is what stops the compiler saying so.
 *
 * ── WHY ESCROW IS THE WORST OF THEM ─────────────────────────────────────────
 *
 *   Both escrow readers build their list inside `snapshot.docs.map(...)`, so
 *   the throw unwinds the whole action and the catch returns `{success:false}`.
 *   ONE row with an odd date and a buyer or seller sees NO escrow at all — not
 *   an error naming the bad row, and not the others that were fine. That is
 *   #439's sentence, which #884 quoted: "One row, the entire page." Here the
 *   page is the money they are owed.
 *
 * ── AND THE SECOND HALF OF "SELLERS CAN'T EDIT PRODUCTS" ────────────────────
 *
 *   #885 opened the gate on that screen. This is the line just past it:
 *   `_updateProductAction` reads the product's own `createdAt` to preserve it
 *   across the edit, with the same presence-test-and-cast. So the owner's
 *   report had TWO independent causes — a refusal she could read, and a crash
 *   she could not — and fixing either alone would have left her still unable to
 *   save.
 *
 * ── THE LOAN DUE DATE IS REFUSED, NOT GUESSED ───────────────────────────────
 *
 *   `_loans_repayments.ts` had no guard at all, not even a presence test. Its
 *   due date is passed straight to `calculatePenalty` and compared with `new
 *   Date()`, so a default would MOVE MONEY: the epoch makes every instalment
 *   maximally overdue and charges a penalty nobody owes; "now" silently waives
 *   one that is owed. An unreadable due date stops the repayment and says so.
 *
 *   EXECUTED against a fake database, because the defect is a throw and a
 *   source scan cannot see one.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
    CacheKeys: new Proxy({}, { get: () => (...a: any[]) => a.join(':') }),
    CacheTTL: new Proxy({}, { get: () => 60 }),
}));
jest.mock('next/cache', () => ({
    revalidateTag: () => undefined, revalidatePath: () => undefined,
    updateTag: () => undefined, unstable_cache: (fn: any) => fn,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

let store: FakeDbHandle;
const ME = 'user-1';

const seedEscrow = (id: string, over: Record<string, unknown> = {}) =>
    store.seed(COLLECTIONS.ESCROW_TRANSACTIONS, id, {
        id,
        participants: [ME, 'seller-1'],
        buyerId: ME,
        sellerId: 'seller-1',
        amount: 250_000,
        status: 'funded',
        createdAt: '2026-09-12T10:32:43.735Z',
        updatedAt: '2026-09-12T10:32:43.735Z',
        ...over,
    });

const mine = async () => {
    const { getUserEscrowTransactions } = await import('@/app/actions/marketplace/_escrow_actions');
    return await getUserEscrowTransactions() as any;
};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    mockRequireSession.mockResolvedValue({
        session: { user: { id: ME, roles: ['buyer'], email: 'b@e.com', name: 'B' } },
        error: null,
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#890 — one odd date no longer empties a person\'s escrow', () => {
    it('THE CRASH SHAPE: a date-only createdAt is survived', async () => {
        /*
         *   `"2026-09-12"` does not match the adapter's full-ISO pattern, so it
         *   arrives as a string. A string has no `.toDate()`.
         */
        seedEscrow('e-1', { createdAt: '2026-09-12' });

        const res = await mine();

        expect(res.success).toBe(true);
        expect(res.data.transactions).toHaveLength(1);
    });

    it('AND ONE BAD ROW NO LONGER TAKES THE GOOD ONES WITH IT', async () => {
        //   The throw was inside the .map, so a buyer with three live escrows
        //   and one odd date saw none of them.
        seedEscrow('good-1');
        seedEscrow('bad-1', { paidAt: '2026-09-12' });
        seedEscrow('good-2');

        const res = await mine();

        expect(res.success).toBe(true);
        expect(res.data.transactions.map((t: any) => t.id).sort())
            .toEqual(['bad-1', 'good-1', 'good-2']);
    });

    it('AND EVERY SHAPE A STORED TIMESTAMP TAKES IS SURVIVED', async () => {
        seedEscrow('iso', { releasedAt: '2026-09-12T10:32:43.735Z' });
        seedEscrow('dateonly', { releasedAt: '2026-09-12' });
        seedEscrow('millis', { releasedAt: 1_757_672_000_000 });
        seedEscrow('absent', { releasedAt: undefined });
        seedEscrow('rubbish', { releasedAt: 'not a date at all' });

        const res = await mine();

        expect(res.success).toBe(true);
        expect(res.data.transactions).toHaveLength(5);
    });

    it('AND AN UNREADABLE DATE BECOMES null, not 1 January 1970', async () => {
        //   #608's rule: the epoch is this codebase's word for "unknown" and
        //   screens read it aloud as a real date.
        seedEscrow('rubbish', { releasedAt: 'not a date at all' });

        const res = await mine();

        expect(res.data.transactions[0].releasedAt).toBeNull();
    });

    it('AND A GOOD DATE IS STILL READ, not flattened to null', async () => {
        //   The control: "never throws" is also satisfied by returning null for
        //   everything, which would blank every escrow date on the screen.
        seedEscrow('iso', { paidAt: '2026-09-12T10:32:43.735Z' });

        const res = await mine();

        expect(res.data.transactions[0].paidAt).toBe('2026-09-12T10:32:43.735Z');
    });

    it('AND ANOTHER PERSON\'S ESCROW IS STILL NOT RETURNED — the existing rule', async () => {
        seedEscrow('mine-1');
        store.seed(COLLECTIONS.ESCROW_TRANSACTIONS, 'theirs-1', {
            id: 'theirs-1', participants: ['someone-else', 'seller-9'],
            buyerId: 'someone-else', amount: 1, status: 'funded',
            createdAt: '2026-09-12T10:32:43.735Z',
        });

        const res = await mine();

        expect(res.data.transactions.map((t: any) => t.id)).toEqual(['mine-1']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#890 — and no money path reads a stored date by casting it', () => {
    it('THE SWEEP: the presence-test-and-cast shape is gone from all four', () => {
        /*
         *   `(x as Timestamp).toDate()` is the signature. A source scan, because
         *   the point is that the clause must not come back — and because three
         *   of these four were found by scanning rather than by a bug report.
         */
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');
        const { stripComments } = require('@/lib/testing/strip-comments');

        for (const rel of [
            'src/app/actions/marketplace/_escrow_actions.ts',
            'src/app/actions/marketplace/_mp_products.ts',
            'src/app/actions/cooperative/_loans_repayments.ts',
            'src/app/actions/land-actions.ts',
        ]) {
            const src = stripComments(
                readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel },
            );
            expect({ rel, cast: /as Timestamp\)\s*\.toDate\(\)/.test(src) })
                .toEqual({ rel, cast: false });
        }
    });

    it('AND THE ESCROW READERS BOTH GO THROUGH THE SHARED READER', () => {
        //   Two readers, one fixed, is how this codebase's defects usually
        //   survive. Six fields each.
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');

        const src = readFileSync(
            join(process.cwd(), 'src/app/actions/marketplace/_escrow_actions.ts'), 'utf8',
        );

        expect(src.split('safeToISOStringOptional(').length - 1).toBeGreaterThanOrEqual(12);
    });

    it('AND THE LOAN DUE DATE REFUSES RATHER THAN DEFAULTING', () => {
        /*
         *   The one place a fallback would have been wrong. Both defaults move
         *   money, in opposite directions, so neither is available.
         */
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');

        const src = readFileSync(
            join(process.cwd(), 'src/app/actions/cooperative/_loans_repayments.ts'), 'utf8',
        );
        const at = src.indexOf('const dueDate = toDateOrNull(installmentData.dueDate)');

        expect(at).toBeGreaterThan(-1);
        const after = src.slice(at, at + 700);
        expect(after).toContain('if (!dueDate)');
        expect(after).toContain('throw new Error(');
        //   And it does NOT quietly pick a date.
        expect(after).not.toMatch(/\?\?\s*new Date\(\)/);
        expect(after).not.toContain('UNKNOWN_DATE');
    });
});
