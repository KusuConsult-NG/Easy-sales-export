/**
 * @jest-environment node
 */

/**
 * Finding #81, measured under the timezone the app's learners actually live in.
 *
 * WHY THIS FILE IS NOT IN unit/ WITH THE REST
 * -------------------------------------------
 * A process has ONE timezone, fixed before any Date exists. `process.env.TZ =
 * 'Africa/Lagos'` inside a jest test does nothing — the sandbox's Date has
 * already resolved its zone — and the first version of this test proved it:
 * a control asserting `getHours()` was 13 for 12:00Z failed with 12, which
 * meant the two assertions underneath it had been passing under UTC while
 * claiming to prove a UTC-vs-local divergence. Exactly the vacuity this audit
 * keeps finding.
 *
 * So the timezone is set on the PROCESS, by `npm run test:tz`, and this
 * directory is excluded from the default run the way /pg/ and /db-integration/
 * already are. src/__tests__/unit/academy-progress-behaviour.test.ts spawns
 * that script, so `npm run test` still covers it.
 *
 * THE DEFECT
 * ----------
 * logLessonActivityAction names each day document
 * `new Date().toISOString().split("T")[0]` — a UTC calendar date.
 * calculateStreakAction began its walk at `setHours(0,0,0,0)` — LOCAL midnight
 * — and rendered that instant with `toISOString()`. Lagos is UTC+1, so local
 * midnight is 23:00 the PREVIOUS day in UTC and the walk started one day behind
 * the id the writer had just created. Today's lesson never counted; a learner
 * who studied today and not yesterday was told their streak was 0, on the day
 * they earned it.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
}));

const LEARNER = 'learner-1';
const DAYS = `${COLLECTIONS.USER_ACTIVITY_LOGS}/${LEARNER}/days`;

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: LEARNER, roles: ['user'], email: 'l@example.com' } },
        error: null,
    }));
});

const actions = () => import('@/app/actions/academy/_ac_progress');

/** The UTC day `offset` days before now, in the id format the writer uses. */
function utcDay(offset: number): string {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - offset);
    return d.toISOString().split('T')[0];
}

describe('the process really is running east of UTC', () => {
    // The control the first attempt was missing. Without it every assertion
    // below could pass under UTC and prove nothing at all.
    it('is an hour ahead, so the local and UTC calendars can disagree', () => {
        expect(process.env.TZ).toBe('Africa/Lagos');
        const noon = new Date('2026-08-19T12:00:00Z');
        expect(noon.getHours()).toBe(13);
    });

    it('local midnight lands on the PREVIOUS UTC day', () => {
        const local = new Date('2026-08-19T12:00:00Z');
        local.setHours(0, 0, 0, 0);
        expect(local.toISOString().split('T')[0]).toBe('2026-08-18');
    });
});

describe('calculateStreakAction (finding #81)', () => {
    it('counts a lesson logged today', async () => {
        const { logLessonActivityAction, calculateStreakAction } = await actions();
        await logLessonActivityAction();

        // Pre-fix this was { streak: 0 }: the walk began on the UTC rendering of
        // LOCAL midnight, which is yesterday's document id.
        expect(((await calculateStreakAction(LEARNER)) as any).data).toEqual({ streak: 1 });
    });

    it('counts a run of days ending today', async () => {
        const { logLessonActivityAction, calculateStreakAction } = await actions();
        await logLessonActivityAction();
        for (const back of [1, 2, 3]) {
            const id = utcDay(back);
            store.seed(DAYS, id, { date: id, lessonsCompletedCount: 1 });
        }

        expect(((await calculateStreakAction(LEARNER)) as any).data).toEqual({ streak: 4 });
    });

    it('still allows one day of grace when today has no lesson yet', async () => {
        for (const back of [1, 2]) {
            const id = utcDay(back);
            store.seed(DAYS, id, { date: id, lessonsCompletedCount: 1 });
        }

        const { calculateStreakAction } = await actions();
        expect(((await calculateStreakAction(LEARNER)) as any).data).toEqual({ streak: 2 });
    });

    it('still ends the streak at a two-day gap', async () => {
        for (const back of [2, 3, 4]) {
            const id = utcDay(back);
            store.seed(DAYS, id, { date: id, lessonsCompletedCount: 1 });
        }

        const { calculateStreakAction } = await actions();
        expect(((await calculateStreakAction(LEARNER)) as any).data).toEqual({ streak: 0 });
    });

    it('writes the day under the same id it later reads', async () => {
        const { logLessonActivityAction } = await actions();
        await logLessonActivityAction();

        expect(store.all(DAYS).map(([id]) => id)).toEqual([utcDay(0)]);
    });
});
