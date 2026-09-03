/**
 * @jest-environment node
 */

/**
 * The export return that was released to nobody — #319.
 *
 * WHAT HAPPENED
 * -------------
 * cron/release-escrow's first loop pays a matured export window: principal plus
 * ROI, credited to the member's cooperative savings. It found the member like
 * this:
 *
 *     const userDoc = await tx.get(db.collection(COLLECTIONS.USERS).doc(userId));
 *     const cooperativeId = userDoc.data()?.cooperativeId;
 *     if (cooperativeId) { ...credit the nested member... }
 *
 * dashboard.ts already established — in a comment it still carries — that
 * NOTHING on the server writes `cooperativeId` onto a USER document. It lives
 * on the membership record and on withdrawal rows. The only writer anywhere is
 * JoinCooperativeModal, a client-side Firebase-SDK file left over from before
 * the Supabase migration. For every member created by any current path that
 * gate was shut, and the whole payout block was skipped.
 *
 * WHY IT IS WORSE THAN THE DASHBOARD VERSION OF THE SAME BUG
 * ----------------------------------------------------------
 * The dashboard's copy of this mistake showed a member ₦0 where they had
 * savings — wrong, but a read. This one is a write, and everything around it
 * reported that the write had happened:
 *
 *   - the window was ALREADY claimed "delivered" → "completed", with
 *     finalPayoutAmount recorded, before the credit was attempted. The
 *     compare-and-swap #249–#251 added to stop double payouts also makes a
 *     missed payout permanent: no later run can reclaim the window.
 *   - an `escrow_released` audit row was written regardless of whether
 *     anything had been released.
 *   - stats.totalValueReleased added the payout and stats.succeeded counted
 *     it, so the job reported moving money it had not moved.
 *
 * The member's capital and return went nowhere, the ledger said released, and
 * nothing anywhere could find it again. That is #42/#100/#114's "written and
 * never read" crossed with #296/#313's "reported success on failure", on the
 * one path where the two together lose a member's money.
 *
 * WHAT THE FIX DOES
 * -----------------
 * Looks the member up in the order dashboard.ts was fixed to use — current
 * top-level COOPERATIVE_MEMBERS first, keyed by user id; the legacy nested
 * subcollection only as a fallback behind a cooperativeId a pre-migration user
 * may still carry. And when neither exists it refuses to call it paid: the
 * window is flagged needsReconciliation with a note, counted `unpaid`, audited
 * as payment_failed, and left out of totalValueReleased.
 *
 * The flag is #318's, and it is only worth writing because #318 made
 * reconcile-fulfilment read it. The last two tests here pin that end of it —
 * a flag nobody reads is the defect, not the fix.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { COLLECTIONS } from '@/lib/types/firestore';
import { FieldValue } from '@/lib/firestore-compat';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures and the recording db
// ─────────────────────────────────────────────────────────────────────────────

/** collection path -> docId -> data. A nested path is "cooperatives/c1/members". */
let DOCS: Record<string, Record<string, any>> = {};

/** Every write the route made, in order. */
let WRITES: Array<{ op: 'set' | 'update'; path: string; id: string; data: any }> = [];

/** What claimStatusTransition should answer, per document id. */
let CLAIMS: Record<string, { claimed: boolean; status?: string | null }> = {};

function record(op: 'set' | 'update', path: string, id: string, data: any) {
    WRITES.push({ op, path, id, data });
    const bucket = (DOCS[path] ||= {});
    bucket[id] = op === 'set' ? { ...data } : { ...(bucket[id] ?? {}), ...data };
}

function makeCollection(path: string): any {
    const filters: Array<[string, string, any]> = [];
    const q: any = {
        where: (f: string, op: string, v: any) => { filters.push([f, op, v]); return q; },
        orderBy: () => q,
        limit: () => q,
        all: () => q,
        select: () => q,
        get: async () => {
            let rows = Object.entries(DOCS[path] ?? {});
            for (const [f, op, v] of filters) {
                if (op === '==') rows = rows.filter(([, d]) => d[f] === v);
                // "<=" is the maturity/threshold filter. Every seeded window in
                // this suite is already mature, so it passes them all through
                // rather than pretending to compare Timestamps.
            }
            return {
                docs: rows.map(([id, data]) => ({ id, data: () => data })),
                empty: rows.length === 0,
            };
        },
        doc: (id?: string) => {
            const docId = id ?? `generated-${Object.keys(DOCS[path] ?? {}).length + WRITES.length}`;
            return {
                id: docId,
                get: async () => ({
                    id: docId,
                    exists: Boolean(DOCS[path]?.[docId]),
                    data: () => DOCS[path]?.[docId],
                }),
                set: async (data: any) => record('set', path, docId, data),
                update: async (data: any) => record('update', path, docId, data),
                collection: (sub: string) => makeCollection(`${path}/${docId}/${sub}`),
            };
        },
    };
    return q;
}

jest.mock('@/lib/supabase-db', () => ({
    supabaseDb: {
        collection: (name: string) => makeCollection(name),
        // supabase-db's runTransaction takes NO LOCK — it just calls the
        // callback. The fake matches that exactly, and reads/writes go through
        // the same recorder so a tx.update is as visible as a plain one.
        runTransaction: async (fn: any) => fn({
            get: (ref: any) => ref.get(),
            set: (ref: any, data: any) => ref.set(data),
            update: (ref: any, data: any) => ref.update(data),
        }),
    },
}));

jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(async (params: any) => {
        const answer = CLAIMS[params.id] ?? { claimed: true };
        if (answer.claimed) {
            record('update', params.collection, params.id, {
                status: params.to, ...(params.patch ?? {}),
            });
        }
        return answer;
    }),
    claimStatusTransitionFromAny: jest.fn(async () => ({ claimed: true })),
}));

const mockCreateNotification = jest.fn(async () => ({ success: true, error: null, data: null }));
jest.mock('@/infrastructure/notifications/service', () => ({
    createNotification: (...args: any[]) => (mockCreateNotification as any)(...args),
}));

const SECRET = 'test-cron-secret';

function req(auth: string | null = `Bearer ${SECRET}`) {
    return {
        headers: { get: (h: string) => (h.toLowerCase() === 'authorization' ? auth : null) },
        nextUrl: new URL('https://x/api/cron/release-escrow'),
    } as any;
}

/** A matured export window: delivered, past its release date. */
function window_(id: string, userId: string, amount: number, roi = '20%') {
    return {
        userId, amount, roi,
        status: 'delivered',
        commodity: 'Sesame',
        quantity: '10 tonnes',
        escrowReleaseDate: new Date(Date.now() - 86_400_000).toISOString(),
    };
}

async function run() {
    const { GET } = await import('@/app/api/cron/release-escrow/route');
    const res: any = await GET(req());
    return res.json();
}

/** The route's report for loop 1. */
async function exportWindowStats() {
    return (await run()).exportWindows;
}

beforeEach(() => {
    jest.resetModules();
    // resetModules does NOT clear call history. Both are needed.
    jest.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    DOCS = {};
    WRITES = [];
    CLAIMS = {};
});

// ─────────────────────────────────────────────────────────────────────────────

describe('a member with a current membership record is paid', () => {
    beforeEach(() => {
        DOCS[COLLECTIONS.EXPORT_WINDOWS] = { w1: window_('w1', 'u1', 100_000) };
        DOCS[COLLECTIONS.USERS] = { u1: { id: 'u1' } };
        DOCS[COLLECTIONS.COOPERATIVE_MEMBERS] = {
            u1: { userId: 'u1', savingsBalance: 5_000, cooperativeId: 'coop-1' },
        };
    });

    it('THE test: the credit reaches the top-level membership record', async () => {
        // The user document carries NO cooperativeId — the shape every current
        // path produces. Before the fix this member was paid nothing at all.
        await run();

        const credit = WRITES.find(
            (w) => w.path === COLLECTIONS.COOPERATIVE_MEMBERS && w.id === 'u1',
        );

        expect(credit).toBeDefined();
        expect(credit!.data.savingsBalance).toEqual(FieldValue.increment(120_000));
    });

    it('the payout is principal plus the window ROI', async () => {
        const stats = await exportWindowStats();

        expect(stats.succeeded).toBe(1);
        expect(stats.unpaid).toBe(0);
        expect(stats.totalValueReleased).toBe(120_000);
    });

    it('a cooperative deposit row records the return', async () => {
        await run();

        const deposit = WRITES.find((w) => w.path === COLLECTIONS.COOPERATIVE_TRANSACTIONS);

        expect(deposit).toBeDefined();
        expect(deposit!.data).toMatchObject({
            type: 'deposit',
            subType: 'export_return',
            amount: 120_000,
            userId: 'u1',
            cooperativeId: 'coop-1',
            status: 'completed',
        });
    });

    it('the window is not flagged for reconciliation', async () => {
        await run();

        const flagged = WRITES.filter((w) => w.data?.needsReconciliation === true);

        expect(flagged).toEqual([]);
    });

    it('the credit lands on whichever field the document already uses', async () => {
        // A legacy document keys the same money `balance`. Incrementing
        // `savingsBalance` on it would split the member's savings across two
        // numbers rather than migrating it — lib/cooperative-member-balance.ts.
        DOCS[COLLECTIONS.COOPERATIVE_MEMBERS] = { u1: { userId: 'u1', balance: 5_000 } };

        await run();

        const credit = WRITES.find(
            (w) => w.path === COLLECTIONS.COOPERATIVE_MEMBERS && w.id === 'u1',
        );

        expect(credit!.data.balance).toEqual(FieldValue.increment(120_000));
        expect(credit!.data.savingsBalance).toBeUndefined();
    });
});

describe('a legacy nested member is still paid', () => {
    it('falls back to the nested subcollection when there is no root record', async () => {
        // The pre-Supabase shape: no top-level record, but the user document
        // does carry a cooperativeId. Kept working, because a member who has
        // one is exactly the member who cannot be found any other way.
        DOCS[COLLECTIONS.EXPORT_WINDOWS] = { w1: window_('w1', 'u1', 100_000) };
        DOCS[COLLECTIONS.USERS] = { u1: { id: 'u1', cooperativeId: 'coop-legacy' } };
        DOCS[`${COLLECTIONS.COOPERATIVES}/coop-legacy/members`] = {
            u1: { userId: 'u1', balance: 1_000 },
        };

        const stats = await exportWindowStats();

        const credit = WRITES.find(
            (w) => w.path === `${COLLECTIONS.COOPERATIVES}/coop-legacy/members`,
        );

        expect(credit).toBeDefined();
        expect(credit!.data.balance).toEqual(FieldValue.increment(120_000));
        expect(stats.succeeded).toBe(1);
        expect(stats.unpaid).toBe(0);
    });

    it('the root record wins when both exist', async () => {
        // Not arbitrary: every other reader and writer in the app uses the
        // top-level collection. Paying the nested copy would credit money into
        // the record nothing else consults.
        DOCS[COLLECTIONS.EXPORT_WINDOWS] = { w1: window_('w1', 'u1', 100_000) };
        DOCS[COLLECTIONS.USERS] = { u1: { id: 'u1', cooperativeId: 'coop-legacy' } };
        DOCS[COLLECTIONS.COOPERATIVE_MEMBERS] = { u1: { userId: 'u1', savingsBalance: 0 } };
        DOCS[`${COLLECTIONS.COOPERATIVES}/coop-legacy/members`] = {
            u1: { userId: 'u1', balance: 1_000 },
        };

        await run();

        expect(WRITES.some((w) => w.path === COLLECTIONS.COOPERATIVE_MEMBERS)).toBe(true);
        expect(WRITES.some((w) => w.path.includes('/members'))).toBe(false);
    });
});

describe('a member with nowhere to be paid is not reported as paid', () => {
    beforeEach(() => {
        // No membership record anywhere: the case the old gate produced
        // silently for everybody, and the case that remains genuinely possible
        // for an export investor who never joined a cooperative.
        DOCS[COLLECTIONS.EXPORT_WINDOWS] = { w1: window_('w1', 'u1', 100_000) };
        DOCS[COLLECTIONS.USERS] = { u1: { id: 'u1' } };
    });

    it('THE test: nothing is credited and nothing is counted as released', async () => {
        const stats = await exportWindowStats();

        expect(WRITES.some((w) => w.path === COLLECTIONS.COOPERATIVE_MEMBERS)).toBe(false);
        expect(WRITES.some((w) => w.path === COLLECTIONS.COOPERATIVE_TRANSACTIONS)).toBe(false);
        expect(stats.succeeded).toBe(0);
        expect(stats.totalValueReleased).toBe(0);
    });

    it('it is counted as unpaid, which is not the same as skipped', async () => {
        // A skip is a window another run already claimed and is fine. An unpaid
        // one is money owed. Collapsing them would file the thing needing a
        // human under "nothing to do".
        const stats = await exportWindowStats();

        expect(stats.unpaid).toBe(1);
        expect(stats.skipped).toBe(0);
        expect(stats.processed).toBe(1);
    });

    it('the window is flagged for reconciliation, with the reason', async () => {
        await run();

        const flag = WRITES.find(
            (w) => w.path === COLLECTIONS.EXPORT_WINDOWS && w.data?.needsReconciliation === true,
        );

        expect(flag).toBeDefined();
        expect(flag!.id).toBe('w1');
        expect(flag!.data.payoutError).toContain('NOT credited');
        expect(flag!.data.payoutError).toContain('u1');
        // The note has to say the window cannot be reprocessed, because the
        // obvious remedy — re-run the cron — is the one that will not work.
        expect(flag!.data.payoutError).toMatch(/cannot be reprocessed/i);
    });

    it('it is audited as a failed payment, not as a release', async () => {
        await run();

        const actions = (global as any).mockCreateAdminAuditLog.mock.calls
            .map((c: any[]) => c[0].action);

        expect(actions).toContain('payment_failed');
        expect(actions).not.toContain('escrow_released');
    });

    it('the audit row carries the figure that is owed', async () => {
        await run();

        const failure = (global as any).mockCreateAdminAuditLog.mock.calls
            .map((c: any[]) => c[0])
            .find((e: any) => e.action === 'payment_failed');

        expect(failure.targetId).toBe('w1');
        expect(failure.metadata.totalPayout).toBe(120_000);
        expect(failure.metadata.reason).toBe('no_cooperative_membership');
    });

    it('one unpaid window does not stop the next one being paid', async () => {
        DOCS[COLLECTIONS.EXPORT_WINDOWS].w2 = window_('w2', 'u2', 50_000);
        DOCS[COLLECTIONS.USERS].u2 = { id: 'u2' };
        DOCS[COLLECTIONS.COOPERATIVE_MEMBERS] = { u2: { userId: 'u2', savingsBalance: 0 } };

        const stats = await exportWindowStats();

        expect(stats.succeeded).toBe(1);
        expect(stats.unpaid).toBe(1);
        expect(stats.totalValueReleased).toBe(60_000);
    });
});

describe('the claim still governs whether anything happens at all', () => {
    it('a window another run already took is skipped, and pays nothing', async () => {
        // The compare-and-swap #249–#251 added. #319 must not have loosened it:
        // an unpaid window and a lost claim are different, and only one of them
        // is money owed.
        DOCS[COLLECTIONS.EXPORT_WINDOWS] = { w1: window_('w1', 'u1', 100_000) };
        DOCS[COLLECTIONS.USERS] = { u1: { id: 'u1' } };
        DOCS[COLLECTIONS.COOPERATIVE_MEMBERS] = { u1: { userId: 'u1', savingsBalance: 0 } };
        CLAIMS.w1 = { claimed: false, status: 'completed' };

        const stats = await exportWindowStats();

        expect(stats.skipped).toBe(1);
        expect(stats.succeeded).toBe(0);
        expect(stats.unpaid).toBe(0);
        expect(WRITES.some((w) => w.path === COLLECTIONS.COOPERATIVE_MEMBERS)).toBe(false);
        expect(WRITES.some((w) => w.data?.needsReconciliation === true)).toBe(false);
    });
});

describe('the flag is read by the job that reports it', () => {
    // A flag nobody reads IS the defect — #318, #141, #42. Written here rather
    // than assumed, because the fix above is only worth anything if this holds.

    it('reconcile-fulfilment scans export windows for it', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const { stripComments } = await import('@/lib/testing/strip-comments');

        const rel = 'src/app/api/cron/reconcile-fulfilment/route.ts';
        const src = stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });

        const sources = src.slice(
            src.indexOf('const sources'),
            src.indexOf('for (const { collection, kind } of sources)'),
        );

        expect(sources).toContain('COLLECTIONS.EXPORT_WINDOWS');
        expect(sources).toContain('export_return_uncredited');
    });

    it('it reports the payout owed, not the smaller principal', async () => {
        // An export window carries BOTH `amount` (what the member put in) and
        // `finalPayoutAmount` (what they are owed). Reading `amount` first —
        // which is what the three pre-existing sources want — would understate
        // every export debt on the report. finalPayoutAmount is written on
        // export windows and nothing else, so it goes first safely.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const { stripComments } = await import('@/lib/testing/strip-comments');

        const rel = 'src/app/api/cron/reconcile-fulfilment/route.ts';
        const src = stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });

        // Scoped to the needsReconciliation block: three other scans in this
        // file also build an `amount: data.…` line, and .find() over the whole
        // source picked up the refunds one instead.
        const block = src.slice(
            src.indexOf('const needsReconciliation'),
            src.indexOf('const needsReconciliationTotal'),
        );
        const line = block.split('\n').find((l) => l.includes('amount: data.'));

        expect(line).toBeDefined();
        // PRESENCE before ordering. Asserting only the order let a mutant that
        // DELETED finalPayoutAmount survive: indexOf returns -1 for a missing
        // symbol, and -1 is less than every real index, so the comparison
        // passed on exactly the code it existed to reject. The behavioural
        // version of this check lives in reconcile-fulfilment.test.ts, which
        // executes the route against a window carrying both figures.
        expect(line!).toContain('data.finalPayoutAmount');
        expect(line!).toContain('data.amount');
        expect(line!.indexOf('data.finalPayoutAmount'))
            .toBeLessThan(line!.indexOf('data.amount ??'));
    });

    it('nothing else in the codebase writes finalPayoutAmount', async () => {
        // The vacuity guard on the test above: reading finalPayoutAmount first
        // is only safe while export windows are its sole writer. If a second
        // writer appears, the ordering has to be reconsidered rather than
        // silently mis-reporting that one.
        const { execSync } = await import('child_process');

        const writers = execSync('grep -rln "finalPayoutAmount:" src || true', {
            encoding: 'utf-8', cwd: process.cwd(),
        }).split('\n').filter((f) => f.trim() && !f.includes('__tests__'));

        expect(writers).toEqual(['src/app/api/cron/release-escrow/route.ts']);
    });
});

describe('the gate that caused this is gone', () => {
    it('the payout no longer depends on a user document carrying cooperativeId', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const { stripComments } = await import('@/lib/testing/strip-comments');

        const rel = 'src/app/api/cron/release-escrow/route.ts';
        const src = stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });

        // The user document is still read — the legacy fallback needs it — but
        // the ROOT membership lookup must come first, or the fallback becomes
        // the primary path again and the bug returns.
        const rootLookup = src.indexOf('COLLECTIONS.COOPERATIVE_MEMBERS');
        const userLookup = src.indexOf('COLLECTIONS.USERS');

        expect(rootLookup).toBeGreaterThan(-1);
        expect(rootLookup).toBeLessThan(userLookup);
    });
});
