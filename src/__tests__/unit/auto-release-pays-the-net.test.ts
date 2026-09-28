/**
 * @jest-environment node
 */

/**
 * The auto-release paid the gross, by hand — #325.
 *
 * Four paths release a marketplace escrow to a seller. Two were repaired; the
 * two loops of cron/release-escrow were missed by BOTH repairs, and
 * _escrow_lifecycle.ts's own note says as much of its sibling: "was moved onto
 * credit_wallet_once for exactly these reasons; this one was missed". Neither
 * repair reached the cron.
 *
 * 1. THE FEE
 *    Three escrow creators compute `platformFee` from MARKETPLACE_CONFIG and
 *    store it alongside `netAmount`. Both sibling paths pay `netAmount`, with
 *    the gross only as a fallback for escrows written before the fee existed.
 *    The cron credited `data.amount` — the gross — so the platform's own
 *    commission was handed to the seller.
 *
 *    The same escrow therefore paid a different amount depending on whether an
 *    admin pressed Release or a timer fired. #113 ("the admin release tells the
 *    seller the gross and pays the net") and #109 ("the fee is computed on every
 *    escrow and withheld from none") on the paths those two findings did not
 *    reach.
 *
 * 2. THE CREDIT
 *    It read the wallet and wrote a computed balance:
 *
 *        if (!walletSnap.exists) tx.set(walletRef, { balance: amount })
 *        else                    tx.update(walletRef, { balance: increment(...) })
 *
 *    The increment branch is safe; the set branch is not, and the status claim
 *    above it does not cover the gap. That claim stops ONE escrow being released
 *    twice. It does nothing when TWO DIFFERENT escrows for the same seller are
 *    released in one run before that seller has a wallet row: both take the set
 *    branch, the last write wins, and one payout is simply gone.
 *    supabaseDb.runTransaction takes no lock and cannot roll back.
 *
 * 3. NO IDEMPOTENCY REFERENCE, so a re-run credited again.
 *
 * Both loops now credit through creditWalletOnce under the SAME reference the
 * admin path uses, so an admin release and a timer release of one escrow cannot
 * both pay.
 *
 * The tests execute the route. The fee question is "what number reached the
 * seller", and only running it answers that.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { COLLECTIONS } from '@/lib/types/firestore';

function source(rel: string): string {
    return stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });
}

/** collection -> docId -> data */
let DOCS: Record<string, Record<string, any>> = {};
let WRITES: Array<{ path: string; id: string; data: any }> = [];
/** Every creditWalletOnce call, in order. */
let CREDITS: Array<Record<string, any>> = [];
/** references already claimed, so a second credit reports claimed:false. */
let CLAIMED: Set<string> = new Set();
/** running wallet balance the fake ledger reports back. */
let LEDGER_BALANCE = 0;

function makeCollection(path: string): any {
    // `where` FILTERS on equality, on `in`, and — #968 — on FIELD PRESENCE for
    // range operators. A no-op version let both escrow loops pick up the same
    // seeded row — loop 2 queries the statuses awaiting confirmation and loop 3
    // status == "delivered" — so every credit appeared twice and the counts
    // looked like a double payout. It was not one: the shared reference meant
    // the ledger refused the second, which is the property that fix added. But a
    // harness that cannot tell the two loops apart cannot test either of them.
    //
    //   `in` was added when loop 2 stopped asking for a single status. Without
    //   it the two loops collapsed back into one again, for the same reason.
    //
    //   ABSENCE IS MODELLED, ORDERING IS NOT, and that asymmetry is deliberate.
    //   A range filter here drops any row where the field is missing and keeps
    //   every row where it is present, because "a document without the field
    //   does not match" is the ENTIRE mechanism that keeps #968 from paying the
    //   pre-existing backlog. A harness that let an unstamped row through would
    //   make the backlog test below assert nothing. Ordering is not modelled
    //   because every fixture here is deliberately old, which the fixtures say.
    const filters: Array<[string, string, any]> = [];
    const q: any = {
        where: (f: string, op: string, v: any) => { filters.push([f, op, v]); return q; },
        orderBy: () => q, limit: () => q, all: () => q, select: () => q,
        //   Shared by `get` and `count`, so an aggregate cannot report a
        //   different population than a read of the same query would return.
        //   #968's backlog figure is a subtraction of two counts, and the whole
        //   number is wrong if the two disagree about what the filters mean.
        matching: () => {
            let rows = Object.entries(DOCS[path] ?? {});
            const RANGE = ['<', '<=', '>', '>='];
            for (const [f, op, v] of filters) {
                if (op === '==') rows = rows.filter(([, d]) => (d as any)[f] === v);
                else if (op === 'in') {
                    const set = Array.isArray(v) ? v : [v];
                    rows = rows.filter(([, d]) => set.includes((d as any)[f]));
                } else if (RANGE.includes(op)) {
                    rows = rows.filter(([, d]) => (d as any)[f] !== undefined && (d as any)[f] !== null);
                }
            }
            return rows;
        },
        count: () => ({
            get: async () => ({ data: () => ({ count: q.matching().length }) }),
        }),
        get: async () => {
            const rows = q.matching();
            return {
                docs: rows.map(([id, data]: [string, any]) => ({ id, data: () => data })),
                empty: rows.length === 0,
            };
        },
        doc: (id?: string) => {
            const docId = id ?? `gen-${WRITES.length}`;
            return {
                id: docId,
                get: async () => ({
                    id: docId, exists: Boolean(DOCS[path]?.[docId]),
                    data: () => DOCS[path]?.[docId],
                }),
                set: async (d: any) => { WRITES.push({ path, id: docId, data: d }); (DOCS[path] ||= {})[docId] = { ...d }; },
                update: async (d: any) => { WRITES.push({ path, id: docId, data: d }); (DOCS[path] ||= {})[docId] = { ...(DOCS[path]?.[docId] ?? {}), ...d }; },
                collection: (sub: string) => makeCollection(`${path}/${docId}/${sub}`),
            };
        },
    };
    return q;
}

jest.mock('@/lib/supabase-db', () => ({
    supabaseDb: {
        collection: (name: string) => makeCollection(name),
        runTransaction: async (fn: any) => fn({
            get: (ref: any) => ref.get(),
            set: (ref: any, d: any) => ref.set(d),
            update: (ref: any, d: any) => ref.update(d),
        }),
    },
}));

// The fake DB cannot implement the CAS primitives — jest.setup documents this.
jest.mock('@/lib/wallet-ledger', () => ({
    creditWalletOnce: jest.fn(async (params: any) => {
        CREDITS.push(params);
        const first = !CLAIMED.has(params.reference);
        if (first) {
            CLAIMED.add(params.reference);
            LEDGER_BALANCE += params.amount;
        }
        return { claimed: first, balance: LEDGER_BALANCE };
    }),
}));

jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(async () => ({ claimed: true })),
    claimStatusTransitionFromAny: jest.fn(async () => ({ claimed: true })),
}));

jest.mock('@/infrastructure/notifications/service', () => ({
    createNotification: jest.fn(async () => ({ success: true, error: null, data: null })),
}));

const SECRET = 'test-cron-secret';

async function runCron() {
    const { GET } = await import('@/app/api/cron/release-escrow/route');
    const res: any = await GET({
        headers: { get: (h: string) => (h.toLowerCase() === 'authorization' ? `Bearer ${SECRET}` : null) },
        nextUrl: new URL('https://x/api/cron/release-escrow'),
    } as any);
    return res.json();
}

const OLD = new Date(Date.now() - 40 * 86_400_000).toISOString();

/**
 * A funded escrow dispatched longer ago than the unconfirmed window — #968.
 *
 * This used to carry `releaseRequestedAt`, the trigger of the seven-day loop
 * that had no caller and therefore never fired. Loop 2 now runs from `shippedAt`,
 * stamped at dispatch, so that is what makes a row due.
 */
function dispatchedEscrow(id: string, extra: Record<string, unknown> = {}) {
    return {
        [id]: {
            sellerId: 'seller-1', buyerId: 'buyer-1',
            amount: 100_000, productName: 'Cocoa', orderId: 'ord-1',
            status: 'funded', shippedAt: OLD,
            ...extra,
        },
    };
}

/**
 * The same escrow with NO dispatch stamp — a row that predates #968.
 *
 * Funded, old, never confirmed, and not payable: there is no `shippedAt` for the
 * five days to run from. This is the backlog the owner chose not to pay.
 */
function unstampedEscrow(id: string, extra: Record<string, unknown> = {}) {
    return {
        [id]: {
            sellerId: 'seller-1', buyerId: 'buyer-1',
            amount: 100_000, productName: 'Cocoa', orderId: 'ord-1',
            status: 'funded',
            ...extra,
        },
    };
}

/** A delivered escrow past its 24-hour window. */
function deliveredEscrow(id: string, extra: Record<string, unknown> = {}) {
    return {
        [id]: {
            sellerId: 'seller-1', buyerId: 'buyer-1',
            amount: 100_000, productName: 'Cocoa', orderId: 'ord-1',
            status: 'delivered', updatedAt: OLD,
            ...extra,
        },
    };
}

beforeEach(() => {
    jest.resetModules();
    // resetModules does NOT clear call history; both are needed.
    jest.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    DOCS = {};
    WRITES = [];
    CREDITS = [];
    CLAIMED = new Set();
    LEDGER_BALANCE = 0;
});

describe('the seller is paid the net, not the gross', () => {
    it('THE test: the unconfirmed dispatch auto-release withholds the platform fee', async () => {
        // The defect, executed. ₦100,000 gross with ₦5,000 fee recorded paid
        // the seller ₦100,000; it now pays the ₦95,000 the escrow says.
        DOCS[COLLECTIONS.ESCROW_TRANSACTIONS] = dispatchedEscrow('esc-1', {
            netAmount: 95_000, platformFee: 5_000,
        });

        await runCron();

        expect(CREDITS).toHaveLength(1);
        expect(CREDITS[0].amount).toBe(95_000);
        expect(CREDITS[0].userId).toBe('seller-1');
    });

    it('and so does the 24-hour delivered auto-release', async () => {
        // The second loop, missed by the same two repairs.
        DOCS[COLLECTIONS.ESCROW_TRANSACTIONS] = deliveredEscrow('esc-2', {
            netAmount: 95_000, platformFee: 5_000,
        });

        await runCron();

        expect(CREDITS).toHaveLength(1);
        expect(CREDITS[0].amount).toBe(95_000);
    });

    it('AND AN ESCROW WITH NO DISPATCH STAMP IS NOT PAID AT ALL — the #968 backlog', async () => {
        /*
         *   THE OWNER'S DECISION, EXECUTED. Re-pointing loop 2 at dispatch made
         *   every escrow whose order shipped long ago instantly payable, and the
         *   rows already sitting in the collection when it shipped are a backlog
         *   nobody has reviewed. Asked what the first run should do, the owner
         *   chose: report it, do not pay it.
         *
         *   Nothing enforces that but the absence of the field. There is no
         *   activation date to keep in step with a deploy and no flag to leave
         *   switched the wrong way — a row written before #968 has no `shippedAt`,
         *   and `where("shippedAt", "<=", …)` does not match a document that does
         *   not have it.
         *
         *   So this is the test that the money stays put, and it is the only
         *   thing standing between an unreviewed backlog and a batch payout.
         *   Delete the range-presence filter from the harness above and it passes
         *   vacuously, which is why that filter has its own note.
         */
        DOCS[COLLECTIONS.ESCROW_TRANSACTIONS] = unstampedEscrow('esc-backlog', {
            netAmount: 95_000, platformFee: 5_000,
        });

        await runCron();

        expect(CREDITS).toHaveLength(0);
    });

    it('and the cron REPORTS that backlog rather than reading zero as nothing-to-do', async () => {
        //   A count of zero payouts is indistinguishable from an empty
        //   collection unless the rows that were skipped are named. `unstamped`
        //   is how the owner sees the size of what is waiting.
        DOCS[COLLECTIONS.ESCROW_TRANSACTIONS] = unstampedEscrow('esc-backlog', {
            netAmount: 95_000, platformFee: 5_000,
        });

        const body = await runCron();

        expect(body.escrowTransactions.processed).toBe(0);
        expect(body.escrowTransactions.unstamped).toBeGreaterThan(0);
    });

    it('an escrow written before the fee existed still pays its gross', async () => {
        // The fallback both siblings use. Without it, an old row with no
        // netAmount would pay 0 — which is worse than paying the gross.
        DOCS[COLLECTIONS.ESCROW_TRANSACTIONS] = dispatchedEscrow('esc-3');

        await runCron();

        expect(CREDITS[0].amount).toBe(100_000);
    });

    it('a zero or nonsense netAmount falls back rather than paying it', async () => {
        // `Number.isFinite(net) && net > 0` — a stored 0 must not zero a payout.
        for (const bad of [0, -5, 'lots', null]) {
            jest.resetModules();
            CREDITS = []; CLAIMED = new Set(); LEDGER_BALANCE = 0; WRITES = [];
            DOCS = { [COLLECTIONS.ESCROW_TRANSACTIONS]: dispatchedEscrow('esc-4', { netAmount: bad as any }) };

            await runCron();

            expect(CREDITS[0].amount).toBe(100_000);
        }
    });

    it('the history rows and the ledger record the SAME figure that was paid', async () => {
        // #91/#113's shape: telling the seller one number and moving another.
        DOCS[COLLECTIONS.ESCROW_TRANSACTIONS] = dispatchedEscrow('esc-5', { netAmount: 95_000 });

        await runCron();

        const walletTx = WRITES.find((w) => w.path === COLLECTIONS.WALLET_TRANSACTIONS);
        const ledger = WRITES.find((w) => w.path === COLLECTIONS.TRANSACTIONS);

        expect(walletTx!.data.amount).toBe(95_000);
        expect(ledger!.data.amount).toBe(95_000);
        expect(walletTx!.data.balanceAfter - walletTx!.data.balanceBefore).toBe(95_000);
    });
});

describe('the credit goes through the ledger primitive', () => {
    it('it is claimed under a reference, so a re-run cannot pay twice', async () => {
        DOCS[COLLECTIONS.ESCROW_TRANSACTIONS] = dispatchedEscrow('esc-6', { netAmount: 95_000 });

        await runCron();
        const balanceAfterFirst = LEDGER_BALANCE;

        // A second run of the same escrow — the claim mock lets it through, so
        // only the ledger reference stands between this and a double payout.
        jest.resetModules();
        CREDITS = [];
        await runCron();

        expect(CREDITS[0].claimed).toBeUndefined();     // input, not result
        expect(LEDGER_BALANCE).toBe(balanceAfterFirst); // nothing added
    });

    it('the reference is the SAME one the admin path uses', async () => {
        // So an admin release and a timer release of one escrow cannot both
        // pay. Two doors, one claim.
        DOCS[COLLECTIONS.ESCROW_TRANSACTIONS] = dispatchedEscrow('esc-7', { netAmount: 95_000 });

        await runCron();

        expect(CREDITS[0].reference).toBe('escrow-release:esc-7');
        expect(source('src/app/actions/marketplace/_escrow_lifecycle.ts'))
            .toContain('reference: `escrow-release:${escrowId}`');
    });

    it('recorded as a disbursement, not as revenue', async () => {
        // platform_revenue_totals() sums processed_payments rows whose status
        // is 'completed'. An escrow release is platform-held money going OUT;
        // recording it completed would add every payout to reported revenue.
        DOCS[COLLECTIONS.ESCROW_TRANSACTIONS] = dispatchedEscrow('esc-8', { netAmount: 95_000 });

        await runCron();

        expect(CREDITS[0].status).toBe('disbursement');
    });

    it('two escrows for one seller in one run both land', async () => {
        // The exact loss the old set-branch caused: both would have taken
        // `tx.set(walletRef, { balance })` and the last write would have won.
        DOCS[COLLECTIONS.ESCROW_TRANSACTIONS] = {
            ...dispatchedEscrow('esc-a', { netAmount: 30_000 }),
            ...dispatchedEscrow('esc-b', { netAmount: 20_000 }),
        };

        await runCron();

        expect(CREDITS).toHaveLength(2);
        expect(CREDITS.map((c) => c.amount).sort((a, b) => a - b)).toEqual([20_000, 30_000]);
        expect(LEDGER_BALANCE).toBe(50_000);
    });

    it('the hand-rolled wallet write is gone from both loops', async () => {
        // COUNTED over the file: one surviving copy would satisfy a membership
        // assertion while the other loop still lost money.
        const src = source('src/app/api/cron/release-escrow/route.ts');

        expect(src).not.toContain('balance: FieldValue.increment(amount)');
        expect((src.match(/creditWalletOnce\(\{/g) ?? []).length).toBe(2);
        expect((src.match(/Number\.isFinite\(netStored\) && netStored > 0/g) ?? []).length).toBe(2);
    });
});

describe('the history rows cannot duplicate themselves', () => {
    it('their ids are derived from the escrow, not random', async () => {
        DOCS[COLLECTIONS.ESCROW_TRANSACTIONS] = dispatchedEscrow('esc-9', { netAmount: 95_000 });

        await runCron();

        const walletTx = WRITES.find((w) => w.path === COLLECTIONS.WALLET_TRANSACTIONS);

        expect(walletTx!.id).toBe('escrow-release-esc-9');
    });

    it('the global ledger key is the WHOLE escrow id', async () => {
        // It was `ESCROW-RELEASE-${escrowId.substring(0, 8)}`. Truncating an id
        // to make a key is #104 exactly — there five characters of a seller id
        // collided for two sellers on one order.
        DOCS[COLLECTIONS.ESCROW_TRANSACTIONS] = dispatchedEscrow('escrow-with-a-long-id', { netAmount: 95_000 });

        await runCron();

        const ledger = WRITES.find((w) => w.path === COLLECTIONS.TRANSACTIONS);

        expect(ledger!.id).toBe('ESCROW-RELEASE-escrow-with-a-long-id');
        expect(source('src/app/api/cron/release-escrow/route.ts'))
            .not.toContain('escrowId.substring(0, 8)');
    });

    it('two escrows sharing an 8-character prefix get separate ledger rows', async () => {
        // The collision the truncation allowed, executed.
        DOCS[COLLECTIONS.ESCROW_TRANSACTIONS] = {
            ...dispatchedEscrow('abcdefgh-one', { netAmount: 10_000 }),
            ...dispatchedEscrow('abcdefgh-two', { netAmount: 20_000 }),
        };

        await runCron();

        const ledgerIds = WRITES.filter((w) => w.path === COLLECTIONS.TRANSACTIONS).map((w) => w.id);

        expect(new Set(ledgerIds).size).toBe(2);
    });
});

describe('the sibling paths this was aligned with', () => {
    it('both still prefer netAmount over the gross', () => {
        // Pinned so the alignment is not later "simplified" in the wrong
        // direction — by making the siblings match the cron rather than the
        // other way round.
        expect(source('src/app/actions/marketplace/_escrow_lifecycle.ts'))
            .toContain('Number.isFinite(netStored) && netStored > 0 ? netStored : gross');
        expect(source('src/app/actions/marketplace/_escrow_actions.ts'))
            .toContain('Number.isFinite(Number(data.netAmount)) && Number(data.netAmount) > 0');
    });

    it('all four release paths credit through the ledger primitive', () => {
        const PATHS = [
            'src/app/api/cron/release-escrow/route.ts',
            'src/app/actions/marketplace/_escrow_lifecycle.ts',
            'src/app/actions/marketplace/_escrow_actions.ts',
        ];

        for (const rel of PATHS) {
            expect(source(rel)).toContain('creditWalletOnce(');
        }
    });
});
