/**
 * @jest-environment node
 */

/**
 *   ACADEMY HAD NEVER BEEN SWEPT AT ALL.
 *
 *   Counted across every module, bare owner reads against resolved ones:
 *
 *       wave              0 / 31      (tranche 5)
 *       farm-nation       2 / 19
 *       export            2 /  6
 *       marketplace       8 / 30
 *       cooperative      12 / 14
 *       academy           9 /  0      <- not one
 *
 *   WAVE was the inverse ratio. Academy is the absence: nine reads, no
 *   resolution anywhere in the module.
 *
 * ── THREE OF THE NINE DECIDE WHETHER SOMEBODY PAID ──────────────────────────
 *
 *   _payment.ts and _ac_enrollment.ts each call their PROCESSED_PAYMENTS read
 *   an "AUTHORITATIVE FALLBACK" — the check that settles it when the user
 *   document's registration status is missing or stale. A check that asks
 *   about one profile is not authoritative: a learner who paid before their
 *   profile was superseded reads as never having paid, and the platform asks
 *   them for the fee again.
 *
 * ── AND ONE OF THEM DELETES WORK ────────────────────────────────────────────
 *
 *   `_ac_enrollment.ts` resets progress when its read comes back EMPTY — the
 *   file's own comment describes that damage, from a time the field name was
 *   wrong: "a paid learner's progress was zeroed the next time they opened the
 *   dashboard."
 *
 *   An empty read is exactly what a superseded profile produces. So the same
 *   destruction was reachable by a second route the comment does not mention,
 *   and it runs on every academy dashboard load.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

let store: FakeDbHandle;

const LIVE = 'live-profile';
const OLD = 'superseded-profile';
const STRANGER = 'somebody-else';

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, LIVE, { email: 'learner@example.com' });
    store.seed(COLLECTIONS.USERS, OLD, { email: 'learner@example.com', _migratedTo: LIVE });
    store.seed(COLLECTIONS.USERS, STRANGER, { email: 'other@example.com' });
    (global as any).mockRequireSession.mockImplementation(() =>
        Promise.resolve({ session: { user: { id: LIVE, email: 'learner@example.com', roles: [] } }, error: null }));
});

describe('a learner who paid under the old profile has paid', () => {
    //   NAMED OUTRIGHT, no `?? somethingElse` and no skip-if-missing. A
    //   fixture that tolerates a missing export passes against a module that
    //   does not have one — which is how the enrolment test below silently ran
    //   nothing the first time it was written.
    async function paymentStatus() {
        const { checkAcademyPaymentStatusAction } = await import('@/app/actions/academy/_payment');
        return await checkAcademyPaymentStatusAction() as any;
    }

    it('THE test — the authoritative fallback sees every profile', async () => {
        store.seed(COLLECTIONS.PROCESSED_PAYMENTS, 'pay-1', {
            userId: OLD, type: 'academy_registration', status: 'completed', amount: 25_000,
        });

        const r = await paymentStatus();

        expect(r.success).toBe(true);
        expect(r.data).toBe('paid');
    });

    it('and a stranger\'s payment never counts as theirs', async () => {
        store.seed(COLLECTIONS.PROCESSED_PAYMENTS, 'pay-x', {
            userId: STRANGER, type: 'academy_registration', status: 'completed', amount: 25_000,
        });

        const r = await paymentStatus();

        expect(r.data).not.toBe('paid');
    });
});

describe('the enrolment sync does not duplicate what it cannot recognise', () => {
    /**
     *   WIDENING THE QUERY WAS NOT ENOUGH, and the mutation test is what said
     *   so: reverting the widened read left this assertion green.
     *
     *   COURSE_PROGRESS is keyed `${userId}_${courseId}`. The widened query
     *   FETCHES the superseded learner's row, and then the membership test
     *   asked `existingProgresses.has(`${liveId}_${courseId}`)` — which the
     *   row it had just fetched can never match. So the sync wrote a SECOND
     *   row at the live id with progressPercent 0, beside the real one, and
     *   the dashboard (now reading both) would list the course twice, once at
     *   zero.
     *
     *   The old row is never overwritten, so nothing is destroyed. The claim
     *   this file originally made — that progress would be "zeroed" — was
     *   wrong, and the test that was supposed to demonstrate it proved nothing
     *   because the fixture never seeded an eligible course.
     */
    //   The real preconditions, read out of the function rather than guessed
    //   at — which is what the vacuity control caught me doing twice:
    //     the collection is ACADEMY_COURSES, not COURSES
    //     the learner needs a PAID academy plan or the function returns early
    //     a `free` tier is open to everybody (lib/academy-plan)
    beforeEach(() => {
        store.seed(COLLECTIONS.USERS, LIVE, {
            email: 'learner@example.com',
            serviceRegistrations: { academy: { plan: 'standard', status: 'approved' } },
        });
        store.seed(COLLECTIONS.ACADEMY_COURSES, 'c1', { title: 'Export Readiness', tier: 'free' });
    });

    //   And the function that actually holds the code under test — line 477
    //   lives in autoEnrollPaidUser, not in the action I first reached for.
    async function sync() {
        const { autoEnrollPaidUser } = await import('@/app/actions/academy/_ac_enrollment');
        await autoEnrollPaidUser(LIVE, 'standard');
    }

    it('THE test — no second zero-progress row for a superseded learner', async () => {
        store.seed(COLLECTIONS.COURSE_PROGRESS, `${OLD}_c1`, {
            userId: OLD, courseId: 'c1', progressPercent: 80, completed: false,
        });
        store.seed(COLLECTIONS.COURSE_ENROLLMENTS, 'ce-1', { userId: OLD, courseId: 'c1' });

        await sync();

        //   Their real row is untouched...
        expect(store.get(COLLECTIONS.COURSE_PROGRESS, `${OLD}_c1`))
            .toMatchObject({ progressPercent: 80 });
        //   ...and no zero row was minted beside it under the live id.
        expect(store.get(COLLECTIONS.COURSE_PROGRESS, `${LIVE}_c1`)).toBeUndefined();
    });

    it('and a learner with NO progress anywhere still gets their row created', async () => {
        //   The vacuity control. A check that answered "already has progress"
        //   for everybody would pass the test above and break enrolment for
        //   every new learner on the platform.
        await sync();

        expect(store.get(COLLECTIONS.COURSE_PROGRESS, `${LIVE}_c1`)).toBeDefined();
    });
});

describe('and the module is swept', () => {
    it('NO BARE OWNER READ REMAINS IN ACADEMY', () => {
        const { execSync } = require('child_process');
        const out = execSync(
            `grep -rn '\\.where("\\(userId\\|resolvedUserId\\|memberId\\|studentId\\)", *"==" *,' `
            + `src/app/actions/academy --include=*.ts || true`,
            { encoding: 'utf8', cwd: process.cwd() },
        ).trim();

        expect({ remaining: out ? out.split('\n') : [] }).toEqual({ remaining: [] });
    });

    it('VACUITY GUARD: the same search still finds them elsewhere', () => {
        const { execSync } = require('child_process');
        const out = execSync(
            `grep -rn '\\.where("userId", *"==" *,' src/app/actions --include=*.ts || true`,
            { encoding: 'utf8', cwd: process.cwd() },
        ).trim();

        expect(out.length).toBeGreaterThan(0);
    });
});
