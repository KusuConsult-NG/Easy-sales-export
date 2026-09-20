/**
 * @jest-environment node
 */

/**
 *   #805 THE FARM NATION SCREEN STOPPED ANSWERING, AND THE SCAN WAS WAITING
 *        FOR ITSELF TWO HUNDRED TIMES.
 *
 *        /admin/forensics/farm-nation rendered 0 + 1 + 177 earlier in the day
 *        and returned "Could not read the Farm Nation approvals" a few hours
 *        later. No deploy touched it in between.
 *
 *        `_listFarmNationApprovalCasesAction` read 200 farmers and awaited
 *        `buildCase` once per farmer, in sequence. `buildCase` is a five-key
 *        walk whose no-application path costs eight round trips — the count is
 *        laid out in lib/bounded-concurrency — and the 177 are exactly the
 *        no-application cases. So the common case on that data is the longest
 *        one, and 200 × 8 sequential statements sat on the function's timeout:
 *        fast enough on a good minute, not on a bad one.
 *
 * ── WHAT IS ASSERTED, AND WHERE ─────────────────────────────────────────────
 *
 *   The pool itself is exercised directly — order, the bound, the failure
 *   path — because that is where the logic is.
 *
 *   Then the ACTION is run, with the lookup instrumented, because "the scan
 *   no longer waits for itself" is a claim about the scan and not about a
 *   helper it might or might not call. The meter records how many lookups are
 *   in flight at once, so the sequential version scores 1 and this one does
 *   not, and both bounds are checked: concurrent, and not unboundedly so.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { mapWithConcurrency } from '@/lib/bounded-concurrency';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

const requireAdmin = jest.fn<any>();
jest.mock('@/lib/require-admin', () => ({ requireAdmin: (...a: any[]) => requireAdmin(...a) }));

const findFarmNationApplications = jest.fn<any>();
jest.mock('@/lib/farm-nation-application-lookup', () => ({
    findFarmNationApplications: (...a: any[]) => findFarmNationApplications(...a),
}));

jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => undefined),
    recordAdminAction: jest.fn(async () => undefined),
}));

// ─────────────────────────────────────────────────────────────────────────────
describe('#805 — the pool itself', () => {
    /** Records how many calls are in flight at once. */
    const meter = () => {
        const state = { inFlight: 0, peak: 0, started: 0 };
        const run = async <T>(work: () => Promise<T>): Promise<T> => {
            state.started += 1;
            state.inFlight += 1;
            state.peak = Math.max(state.peak, state.inFlight);
            try {
                return await work();
            } finally {
                state.inFlight -= 1;
            }
        };
        return { state, run };
    };

    const tick = () => new Promise((r) => setTimeout(r, 1));

    it('RESULTS COME BACK IN INPUT ORDER, whatever order they finish in', async () => {
        // Deliberately inverted timings: the first item is the slowest, so an
        // implementation that pushed results as they landed would reverse them.
        const items = [30, 20, 10, 0];
        const out = await mapWithConcurrency(items, 4, async (ms) => {
            await new Promise((r) => setTimeout(r, ms));
            return ms;
        });

        expect(out).toEqual([30, 20, 10, 0]);
    });

    it('AND SEVERAL RUN AT ONCE — the whole point', async () => {
        const { state, run } = meter();
        await mapWithConcurrency(Array.from({ length: 20 }), 5, () => run(tick));

        expect(state.peak).toBeGreaterThan(1);
    });

    it('AND NEVER MORE THAN THE LIMIT', async () => {
        const { state, run } = meter();
        await mapWithConcurrency(Array.from({ length: 50 }), 5, () => run(tick));

        expect(state.peak).toBeLessThanOrEqual(5);
    });

    it('POSITIVE CONTROL: a limit of 1 really is sequential, so the meter works', async () => {
        // Without this, "peak > 1" above could be measuring a meter that counts
        // wrong rather than an implementation that overlaps.
        const { state, run } = meter();
        await mapWithConcurrency(Array.from({ length: 10 }), 1, () => run(tick));

        expect(state.peak).toBe(1);
    });

    it('a limit larger than the list does not spawn idle workers', async () => {
        const { state, run } = meter();
        await mapWithConcurrency(Array.from({ length: 3 }), 100, () => run(tick));

        expect(state.peak).toBeLessThanOrEqual(3);
        expect(state.started).toBe(3);
    });

    it('and a limit of zero is clamped rather than deadlocking', async () => {
        await expect(mapWithConcurrency([1, 2, 3], 0, async (n) => n * 2)).resolves.toEqual([2, 4, 6]);
    });

    it('an empty list does no work and returns nothing', async () => {
        const fn = jest.fn<any>();
        await expect(mapWithConcurrency([], 4, fn)).resolves.toEqual([]);
        expect(fn).not.toHaveBeenCalled();
    });

    it('A FAILURE STILL FAILS THE WHOLE CALL, as a throw in the old loop did', async () => {
        await expect(mapWithConcurrency([1, 2, 3], 2, async (n) => {
            if (n === 2) throw new Error('lookup exploded');
            return n;
        })).rejects.toThrow('lookup exploded');
    });

    it('AND THE REST STOP CLAIMING WORK once one has failed', async () => {
        //   A scan that is going to throw its answer away should stop reading.
        //   Without the flag, every remaining item is still fetched for a
        //   result nobody receives.
        const started: number[] = [];
        await expect(mapWithConcurrency(Array.from({ length: 40 }, (_, i) => i), 2, async (i) => {
            started.push(i);
            await tick();
            if (i === 0) throw new Error('first one fails');
            return i;
        })).rejects.toThrow('first one fails');

        /*
         *   LONG ENOUGH FOR A RUNAWAY WORKER TO FINISH THE LIST, which is the
         *   whole difficulty of measuring this. `Promise.all` rejects on the
         *   first failure, so the call returns while the other worker is still
         *   going; checking immediately finds a small number either way and
         *   proves nothing. Thirty-nine remaining items at a tick each is well
         *   under this, so without the flag `started` reaches forty.
         *
         *   This assertion was added because the mutant that deletes the flag
         *   SURVIVED the first version of it.
         */
        await new Promise((r) => setTimeout(r, 200));

        //   The two workers in flight when it failed may each claim one more
        //   before they observe the flag.
        expect(started.length).toBeLessThanOrEqual(4);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#805 — and the scan itself, which is the claim', () => {
    let store: FakeDbHandle;
    const FARMERS = 40;

    /** Every lookup this scan makes, and how many overlapped. */
    let peak = 0;
    let inFlight = 0;
    let lookups: string[] = [];

    beforeEach(() => {
        jest.clearAllMocks();
        peak = 0; inFlight = 0; lookups = [];

        store = installFakeDb();
        requireAdmin.mockResolvedValue({ userId: 'an-admin', roles: ['super_admin'] });

        for (let i = 0; i < FARMERS; i++) {
            store.seed(COLLECTIONS.USERS, `farmer-${String(i).padStart(3, '0')}`, {
                email: `farmer${i}@example.com`,
                fullName: `Farmer ${i}`,
                roles: ['farmer'],
                serviceRegistrations: { farmNation: { status: 'approved' } },
            });
        }

        //   The expensive path: approved on the registration, nothing found
        //   under any key. That is the shape 177 of the 178 production cases
        //   have, and the one the sequential scan spent its whole budget on.
        findFarmNationApplications.mockImplementation(async (_apps: any, keys: any) => {
            lookups.push(keys.userId);
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            try {
                await new Promise((r) => setTimeout(r, 2));
                return [];
            } finally {
                inFlight -= 1;
            }
        });
    });

    const scan = async () => {
        const { listFarmNationApprovalCasesAction } =
            await import('@/app/actions/admin/_farm_nation_approvals');
        return await listFarmNationApprovalCasesAction() as any;
    };

    it('IT NO LONGER WAITS FOR ITSELF — lookups overlap', async () => {
        const res = await scan();

        expect(res.success).toBe(true);
        expect(peak).toBeGreaterThan(1);
    });

    it('AND STILL LOOKS EVERY FARMER UP EXACTLY ONCE', async () => {
        await scan();

        expect(lookups).toHaveLength(FARMERS);
        expect(new Set(lookups).size).toBe(FARMERS);
    });

    it('AND REPORTS THE SAME CASES IT ALWAYS DID', async () => {
        const res = await scan();

        //   Every farmer is approved with no application findable, so every
        //   one is a case. The counts are what the screen reads.
        expect(res.data.cases).toHaveLength(FARMERS);
        expect(res.data.noApplication).toBe(FARMERS);
        expect(res.data.drift).toBe(0);
        expect(res.data.settled).toBe(0);
        expect(res.data.cases.every((c: any) => c.issue === 'no-application')).toBe(true);
    });

    it('and the order it hands back is still deterministic', async () => {
        const first = (await scan()).data.cases.map((c: any) => c.userId);
        jest.clearAllMocks();
        requireAdmin.mockResolvedValue({ userId: 'an-admin', roles: ['super_admin'] });
        findFarmNationApplications.mockImplementation(async () => []);
        const second = (await scan()).data.cases.map((c: any) => c.userId);

        expect(second).toEqual(first);
    });

    it('A LOOKUP THAT THROWS STILL FAILS THE SCAN rather than losing a farmer', async () => {
        //   The old loop propagated a throw out of the for-body into the
        //   action's catch. Silently dropping the farmer and reporting the rest
        //   would be a scan that under-reports without saying so.
        findFarmNationApplications.mockRejectedValue(new Error('statement timeout'));

        const res = await scan();

        expect(res.success).toBe(false);
        expect(res.error).toBe('Could not read the Farm Nation approvals.');
    });

    it('and a caller without the permission is still refused before any read', async () => {
        requireAdmin.mockResolvedValue({ error: 'Not permitted' });

        const res = await scan();

        expect(res.success).toBe(false);
        expect(lookups).toEqual([]);
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Applied to src/lib/bounded-concurrency.ts and
 *   src/app/actions/admin/_farm_nation_approvals.ts, this suite re-run each time.
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   SCAN_CONCURRENCY = 1 — the defect           1   "IT NO LONGER WAITS FOR
 *   restored, without restoring the loop            ITSELF"
 *
 *   pool size = items.length — unbounded        3   "AND NEVER MORE THAN THE
 *                                                   LIMIT"
 *
 *   out[i] replaced by out.push(…)              2   "RESULTS COME BACK IN
 *   — order lost on uneven timings                  INPUT ORDER"
 *
 *   swallow the rejection (return instead       3   "A FAILURE STILL FAILS THE
 *   of rethrowing)                                  WHOLE CALL"
 *
 *   drop the `failed` flag                      1   "AND THE REST STOP
 *                                                   CLAIMING WORK"
 *
 *   CONTROL — SHOULD SURVIVE
 *   reword a comment in the pool                0   SURVIVED ✓
 *
 *   THE FOURTH ONE SURVIVED THE FIRST DRAFT, and the reason is worth keeping.
 *   `Promise.all` rejects on the first failure, so the call RETURNS while the
 *   other worker is still going — and the test checked `started.length` one
 *   tick later, which is small whether or not the flag exists. It waits 200ms
 *   now, long enough for a runaway worker to walk the remaining thirty-nine
 *   items, so the flag is the only thing keeping the count down.
 */
