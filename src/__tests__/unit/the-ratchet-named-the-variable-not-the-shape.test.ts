/**
 * @jest-environment node
 */

/**
 *   #507 THE RATCHET NAMED THE VARIABLE, SO THE BANNED EXPRESSION MOVED HOUSE
 *        AND WALKED PAST IT — ELEVEN TIMES.
 *
 *   most-recent-sort-key.test.ts exists to stop one broken date expression
 *   coming back. It refused it three ways:
 *
 *       not.toMatch(/createdAt\?\.toMillis\?\.\(\)\s*\|\|/)
 *       not.toMatch(/createdAt\?\.seconds\s*\*\s*1000/)
 *       grep -rl "createdAt?.toMillis?.() ||" src/
 *
 *   Every one names the IDENTIFIER. Auditing _ex_onboarding.ts — a file on that
 *   ratchet's own AFFECTED list, reported clean for as long as it has existed —
 *   found this inside it:
 *
 *       const aVal = a.data().submittedAt || a.data().createdAt;
 *       const aTime = aVal?.toMillis?.() || aVal?.seconds * 1000
 *                  || (aVal ? new Date(aVal).getTime() : 0);
 *
 *   The same expression, assigned to a local first. `createdAt?.` was never
 *   going to match it.
 *
 *   MATCHING THE SHAPE INSTEAD FOUND FOUR MORE FILES IN ONE RUN:
 *
 *       export/_ex_onboarding.ts       the copy that started this
 *       wave/_wv_membership.ts         on AFFECTED, reported clean
 *       academy/_ac_applications.ts    on AFFECTED, reported clean
 *       academy/_ac_enrollment.ts      NOT ON THE LIST AT ALL
 *
 *   The last one is the argument for a sweep over a list: a list records what
 *   was known when it was written, and that file was not.
 *
 * ── AND THE EXPRESSION REALLY IS BROKEN ─────────────────────────────────────
 *
 *   `new Date(x).getTime()` is NaN for an unparseable string. So aTime becomes
 *   NaN, the comparator returns NaN, and Array.prototype.sort's ordering is then
 *   implementation-defined — a member's applications come back in no particular
 *   order, and every door that takes `[0]` gets whichever one that leaves first.
 *
 *   toMillis guards exactly this: `Number.isNaN(parsed) ? 0 : parsed`.
 *
 * ── ELEVEN COPIES, ONE RULE ─────────────────────────────────────────────────
 *
 *   #412 retired the first. #504 the second and third (cooperative), #505 the
 *   fourth through sixth (Farm Nation), #506 the seventh and eighth (WAVE), and
 *   this the ninth through twelfth — four in _ex_onboarding.ts alone, in THREE
 *   different implementations, plus the three the widened sweep exposed.
 *
 *   AUDIT THE INSTRUMENT BEFORE BELIEVING THE MEASUREMENT is this audit's own
 *   standing rule, and here the instrument was the defect: a green ratchet was
 *   the reason nobody looked.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the export status door reverted                KILLED
 *     reword this header                             SURVIVED, as intended
 *
 *   TWO MUTANTS, NOT FOUR. Narrowing the refusal back to `createdAt` and
 *   narrowing the sweep back to the literal are not mutation-tested, and saying
 *   so is the point: they are asserted DIRECTLY instead, by the first three
 *   tests below, which run the two patterns against the exact line that sat in
 *   _ex_onboarding.ts. A pattern that can be executed should be executed, not
 *   approximated by breaking a file and watching a suite go red.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { toMillis } from '@/lib/firestore-serialize';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
    revalidateTag: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

/** The pattern the ratchet uses now — asserted directly, as a pattern. */
const SHAPE = /[A-Za-z_$][A-Za-z0-9_$]*\?\.toMillis\?\.\(\) *\|\|/;
/** What it used to use. */
const OLD = /createdAt\?\.toMillis\?\.\(\)\s*\|\|/;

// ─────────────────────────────────────────────────────────────────────────────
describe('#507 — the refusal matches the shape, under any name', () => {
    it('THE ALIASED FORM IS CAUGHT NOW AND WAS NOT BEFORE', () => {
        //   THE test, and it is a test OF THE TEST. This is the line that sat in
        //   _ex_onboarding.ts while the ratchet listing that file passed.
        const aliased = 'const aTime = aVal?.toMillis?.() || aVal?.seconds * 1000 || 0;';

        expect(OLD.test(aliased)).toBe(false);
        expect(SHAPE.test(aliased)).toBe(true);
    });

    it('AND THE ORIGINAL FORM IS STILL CAUGHT', () => {
        //   The control: widening a refusal must not stop it refusing what it
        //   already refused.
        const original = 'const aTime = a.data().createdAt?.toMillis?.() || 0;';

        expect(SHAPE.test(original)).toBe(true);
    });

    it('and an ordinary call to the shared reader is not mistaken for it', () => {
        //   The vacuity guard. A pattern that matched `toMillis(` would condemn
        //   every corrected file.
        expect(SHAPE.test('const aTime = toMillis(a.data().createdAt);')).toBe(false);
        expect(SHAPE.test('appDoc = latestApplication(snap.docs);')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#507 — and the expression it refuses really is broken', () => {
    it('AN UNPARSEABLE DATE MAKES THE OLD COMPARATOR RETURN NaN', () => {
        //   NaN from a comparator leaves Array.prototype.sort's ordering
        //   implementation-defined, and every one of these doors takes [0].
        const oldKey = (v: any) =>
            v?.toMillis?.() || v?.seconds * 1000 || (v ? new Date(v).getTime() : 0);

        expect(Number.isNaN(oldKey('12 Market Road'))).toBe(true);
        expect(Number.isNaN(oldKey('12 Market Road') - oldKey('2026-01-01'))).toBe(true);
    });

    it('WHILE THE SHARED READER ANSWERS ZERO', () => {
        expect(toMillis('12 Market Road')).toBe(0);
        expect(Number.isNaN(toMillis('12 Market Road'))).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#507 — every door that carried a copy now asks the shared rule', () => {
    const RETIRED: Array<[string, number]> = [
        ['src/app/actions/export/_ex_onboarding.ts', 4],
        ['src/app/actions/wave/_wv_membership.ts', 1],
        ['src/app/actions/academy/_ac_applications.ts', 1],
        ['src/app/actions/academy/_ac_enrollment.ts', 1],
    ];

    it.each(RETIRED)('%s asks it %i time(s)', (rel, times) => {
        //   Comments stripped: each fix's header quotes the banned shape in
        //   order to explain it.
        const body = stripComments(readFileSync(rel, 'utf-8'), { label: rel });

        expect(SHAPE.test(body)).toBe(false);
        expect(body.match(/latestApplication\(/g)?.length).toBe(times);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#507 — behaviourally, the export status door picks the newest', () => {
    let store: FakeDbHandle;
    const MEMBER = 'exporter-1';

    beforeEach(() => {
        jest.clearAllMocks();
        store = installFakeDb();
        (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: { user: { id: MEMBER, roles: ['general_user'], email: 'ada@example.com' } },
            error: null,
        }));
        store.seed(COLLECTIONS.USERS, MEMBER, { email: 'ada@example.com' });
    });

    const checkStatus = async () =>
        (await import('@/app/actions/export/_ex_onboarding')).checkExportStatusAction();

    it('A ROW WITH submittedAt AND NO createdAt IS NOT THE OLDEST', async () => {
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'older', {
            userId: MEMBER, status: 'rejected', createdAt: '2026-01-01T00:00:00.000Z',
        });
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'newest', {
            userId: MEMBER, status: 'pending', submittedAt: '2026-06-01T00:00:00.000Z',
        });

        expect(await checkStatus()).toBe('pending');
    });

    it('and a single application still reports its own status', async () => {
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'only', {
            userId: MEMBER, status: 'approved', submittedAt: '2026-03-01T00:00:00.000Z',
        });

        expect(await checkStatus()).toBe('approved');
    });
});
