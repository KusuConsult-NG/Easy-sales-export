/**
 * @jest-environment node
 */

/**
 *   #427 THE ENROLMENT-COUNT REPAIR #336 RECORDED AS OUTSTANDING — AND THE TWO
 *   WAYS OF GETTING IT WRONG.
 *
 *   #336 collapsed four names for one enrolment tally onto `enrolledCount` and
 *   recorded that courses enrolled before that commit hold their PAID
 *   enrolments only in `students`, so the figure under-counts them until a
 *   one-off backfill. This is that backfill's arithmetic.
 *
 *   WRONG WAY ONE — enrolledCount + students. The obvious repair, and it
 *   double-counts: since #336 the paid path increments BOTH on the same
 *   enrolment. A counter cannot say when it was incremented, so no arithmetic
 *   over the two counters separates the eras. Rows can.
 *
 *   WRONG WAY TWO — count every row. ENROLLMENTS rows are written at CHECKOUT
 *   INITIATION with status "pending_payment", before any money moves; only a
 *   verified payment makes one "active". Counting rows blindly would add every
 *   abandoned checkout to a course's enrolment figure, and the product would
 *   then report that as demand.
 *
 *   So: DISTINCT LEARNERS, from rows, by status, across the three collections
 *   #424 mapped — deduplicated on (courseId, userId) so the admin mirror is
 *   harmless and a learner who arrived twice is one enrolment.
 *
 *   AND IT FAILS CLOSED ON THE ONE CASE THAT LOOKS LIKE BLINDNESS: a recount of
 *   zero against a stored count above zero. That is indistinguishable from
 *   "this script could not see the rows" — a renamed field, a collection it
 *   does not read — and one of the two readings destroys a real number. #245's
 *   rule: refuse and report.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     pending_payment starts counting              KILLED
 *     an unrecognised status starts counting       KILLED
 *     the tally stops deduplicating                KILLED
 *     the zero-recount refusal is removed          KILLED
 *     a missing courseId/userId is counted         KILLED
 *     reword the header prose                      SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    classifyRow,
    tallyEnrolments,
    decideForCourse,
    ENROLLED_STATUSES,
    NOT_ENROLLED_STATUSES,
} from '../../../scripts/academy-enrolment-tally';

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: relative(ROOT, p) });
const RUNNER = 'scripts/backfill-academy-enrolled-count.ts';

const row = (o: Record<string, unknown>) => o as { courseId?: unknown; userId?: unknown; status?: unknown };

// ─────────────────────────────────────────────────────────────────────────────
describe('#427 — an unpaid checkout is not an enrolment', () => {
    it('PENDING_PAYMENT DOES NOT COUNT', () => {
        const v = classifyRow(row({ courseId: 'c1', userId: 'u1', status: 'pending_payment' }));
        expect(v.counts).toBe(false);
    });

    it('and neither does dropped, cancelled or refunded', () => {
        for (const status of ['dropped', 'cancelled', 'refunded']) {
            expect({ status, counts: classifyRow(row({ courseId: 'c1', userId: 'u1', status })).counts })
                .toEqual({ status, counts: false });
        }
    });

    it('and active and completed DO', () => {
        for (const status of ENROLLED_STATUSES) {
            expect({ status, counts: classifyRow(row({ courseId: 'c1', userId: 'u1', status })).counts })
                .toEqual({ status, counts: true });
        }
    });

    it('and the two vocabularies do not overlap', () => {
        const overlap = ENROLLED_STATUSES.filter((s) => NOT_ENROLLED_STATUSES.includes(s));
        expect({ overlap }).toEqual({ overlap: [] });
    });

    it('and the premise holds — pending_payment really is what checkout writes', () => {
        // If the initiator ever stops writing it, this rule is measuring
        // nothing and should be revisited rather than silently kept.
        const src = code('src/app/actions/academy/_payment.ts');
        expect(src).toMatch(/status: "pending_payment"/);
        expect(src).toMatch(/collection\(COLLECTIONS\.ENROLLMENTS\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#427 — it refuses to guess', () => {
    it('AN UNRECOGNISED STATUS IS EXCLUDED AND REPORTED, NOT ASSUMED', () => {
        const v = classifyRow(row({ courseId: 'c1', userId: 'u1', status: 'something_new' }));
        expect(v.counts).toBe(false);
        expect((v as { reason: string }).reason).toMatch(/unrecognised status "something_new"/);
    });

    it('and so is a row with no status, no courseId or no userId', () => {
        expect(classifyRow(row({ courseId: 'c1', userId: 'u1' })).counts).toBe(false);
        expect(classifyRow(row({ userId: 'u1', status: 'active' })).counts).toBe(false);
        expect(classifyRow(row({ courseId: 'c1', status: 'active' })).counts).toBe(false);
        expect(classifyRow(row({ courseId: '  ', userId: 'u1', status: 'active' })).counts).toBe(false);
    });

    it('and every exclusion reason reaches the report', () => {
        const { excluded } = tallyEnrolments([
            row({ courseId: 'c1', userId: 'u1', status: 'pending_payment' }),
            row({ courseId: 'c1', userId: 'u2', status: 'pending_payment' }),
            row({ courseId: 'c1', userId: 'u3', status: 'mystery' }),
            row({ userId: 'u4', status: 'active' }),
        ]);
        expect(excluded.get('status "pending_payment"')).toBe(2);
        expect(excluded.get('unrecognised status "mystery"')).toBe(1);
        expect(excluded.get('no courseId')).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#427 — distinct learners, not rows', () => {
    it('THE SAME LEARNER IN TWO COLLECTIONS IS ONE ENROLMENT', () => {
        // enrollments and its academy_enrollments mirror carry the same
        // enrolment. Counting rows would double every paid learner.
        const { byCourse } = tallyEnrolments([
            row({ courseId: 'c1', userId: 'u1', status: 'active' }),
            row({ courseId: 'c1', userId: 'u1', status: 'active' }),
            row({ courseId: 'c1', userId: 'u1', status: 'completed' }),
        ]);
        expect(byCourse.get('c1')?.size).toBe(1);
    });

    it('and different learners on one course add up', () => {
        const { byCourse } = tallyEnrolments([
            row({ courseId: 'c1', userId: 'u1', status: 'active' }),
            row({ courseId: 'c1', userId: 'u2', status: 'active' }),
            row({ courseId: 'c1', userId: 'u3', status: 'completed' }),
            row({ courseId: 'c1', userId: 'u4', status: 'pending_payment' }),
        ]);
        expect(byCourse.get('c1')?.size).toBe(3);
    });

    it('and courses do not bleed into each other', () => {
        const { byCourse } = tallyEnrolments([
            row({ courseId: 'c1', userId: 'u1', status: 'active' }),
            row({ courseId: 'c2', userId: 'u1', status: 'active' }),
        ]);
        expect(byCourse.get('c1')?.size).toBe(1);
        expect(byCourse.get('c2')?.size).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#427 — it never zeroes a live figure', () => {
    it('A RECOUNT OF 0 AGAINST A STORED COUNT IS REFUSED', () => {
        const d = decideForCourse(12, 0);
        expect(d.action).toBe('refuse');
        expect((d as { reason: string }).reason).toMatch(/refusing to zero/);
    });

    it('and 0 against 0 is simply unchanged', () => {
        expect(decideForCourse(0, 0).action).toBe('unchanged');
        expect(decideForCourse(undefined, 0).action).toBe('unchanged');
    });

    it('and a genuine increase is applied — the whole point of the backfill', () => {
        const d = decideForCourse(3, 11);
        expect(d).toMatchObject({ action: 'update', stored: 3, counted: 11 });
    });

    it('and a genuine DECREASE to a non-zero figure is applied', () => {
        // Only the zero case is ambiguous; 9 -> 7 is a recount, not blindness.
        expect(decideForCourse(9, 7)).toMatchObject({ action: 'update', counted: 7 });
    });

    it('and an unreadable stored count is treated as 0, not as NaN', () => {
        for (const stored of [undefined, null, 'x', -4, NaN]) {
            expect({ stored, action: decideForCourse(stored, 5).action })
                .toEqual({ stored, action: 'update' });
        }
    });

    it('and running it again changes nothing — idempotent', () => {
        expect(decideForCourse(11, 11).action).toBe('unchanged');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#427 — the runner is report-only until told otherwise', () => {
    it('IT WRITES NOTHING WITHOUT --apply', () => {
        const src = code(RUNNER);
        // From the shared guard, not restated. The first draft hand-rolled all
        // four helpers and #329's ratchet caught it.
        expect(src).toMatch(/const APPLY = isApply\(\)/);
        // The early return must come before any update call.
        const guard = src.indexOf('if (!APPLY)');
        const write = src.indexOf('.update({ raw_data: merged })');
        expect(guard).toBeGreaterThan(-1);
        expect(write).toBeGreaterThan(guard);
    });

    it('and it NAMES THE TARGET DATABASE before reading a single row', () => {
        // The safety rule the ratchet taught me: a repair script that does not
        // say which database it is pointed at is one wrong shell variable away
        // from repairing the wrong one. targetHost() throws rather than
        // defaulting, so an unknown target stops the run.
        const src = code(RUNNER);
        const banner = src.indexOf('modeBanner(');
        const firstRead = src.indexOf('await readAll(');
        expect(banner).toBeGreaterThan(-1);
        expect(src).toMatch(/targetHost\(\)/);
        expect(banner).toBeLessThan(firstRead);
    });

    it('and a failure exits non-zero rather than logging and reporting success', () => {
        // runScript exists because three scripts ended in .catch(console.error),
        // which logs and exits 0 — a failed repair reporting success.
        expect(code(RUNNER)).toMatch(/runScript\('Academy enrolledCount backfill', main\)/);
        expect(code(RUNNER)).not.toMatch(/main\(\)\.catch/);
    });

    it('and it reads all three enrolment collections', () => {
        const src = code(RUNNER);
        for (const c of ['course_enrollments', 'enrollments', 'academy_enrollments']) {
            expect(src).toContain(`'${c}'`);
        }
    });

    it('and it writes ONLY enrolledCount, leaving students/studentsCount alone', () => {
        const src = code(RUNNER);
        expect(src).toMatch(/enrolledCount: \(u\.decision as \{ counted: number \}\)\.counted/);
        expect(src).not.toMatch(/students:/);
        expect(src).not.toMatch(/studentsCount:/);
    });

    it('and it takes the arithmetic from the shared module, not a second copy', () => {
        expect(code(RUNNER)).toMatch(/from '\.\/academy-enrolment-tally'/);
    });

    it('and npm can actually run it', () => {
        const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
        expect(pkg.scripts['backfill:enrolledcount'])
            .toBe('tsx scripts/backfill-academy-enrolled-count.ts');
    });
});
