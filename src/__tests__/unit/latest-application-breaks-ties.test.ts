/**
 * @jest-environment node
 */

/**
 *   #412 THE "LATEST APPLICATION" RULE HANDED THE DECISION BACK TO THE QUERY
 *   PLANNER WHENEVER IT COULD NOT READ A DATE — AND AT THE WRONG END.
 *
 *   From the untested-module sweep. src/lib/latest-application.ts was never
 *   named in any test: it is exercised only indirectly, through
 *   module-access-latest-application.test.ts importing module-access-check.
 *
 *   WHAT #227/#228 BUILT IT FOR. Every fallback layer in module-access-check,
 *   and the academy branch of the Paystack webhook, used to read
 *   `.where("userId","==",userId).limit(1)` with no orderBy and trust the
 *   answer. Two consequences: which application answered was arbitrary (#227),
 *   and an old approval could be found and written back over a new rejection
 *   (#228). This module is the one place the rule now lives.
 *
 *   WHAT WAS STILL THERE. The comparator was one subtraction:
 *   `submittedMillis(b) - submittedMillis(a)`. `toMillis` answers 0 for a value
 *   it cannot read, so if NO candidate carries a readable submittedAt or
 *   createdAt every key is 0, every comparison is 0, the sort is a no-op, and
 *   the function returned docs[0] — the snapshot's incidental order. #49's "key
 *   is 0" shape, inside the fix for #227.
 *
 *   AND IT WAS THE OLDEST, NOT A RANDOM ONE. A query with no orderBy falls
 *   through to `.order('id')` ASCENDING in supabase-db.ts, and the ids this
 *   codebase mints for applications embed the clock — the academy document id
 *   IS `ACADEMY-${Date.now()}-…`. Lowest id is the oldest application. So in
 *   the one case it could not read a date, the function returned the inverse of
 *   its own rule: #228's exact scenario, in the code written to stop it.
 *
 *   HOW REACHABLE, STATED HONESTLY. Every application writer under
 *   src/app/actions that this audit read stamps submittedAt or createdAt, so no
 *   code path in this repository produces the all-unreadable set. The rows that
 *   would are the legacy/bulk-imported ones those fallback layers exist for,
 *   written outside this codebase, and with no live database there is no way to
 *   check them from here. Recorded as a contract the module did not keep, not
 *   as a defect seen biting somebody.
 *
 *   FIXED: submitted time, then the most recent recorded DECISION (the max of
 *   updatedAt / reviewedAt / approvedAt / rejectedAt — a max, not a
 *   first-present chain, because the academy reviewer writes reviewedAt and no
 *   updatedAt), then document id DESCENDING. The last step is a determinism
 *   guarantee rather than a correctness one, and it now warns when it is
 *   reached, because that repair belongs in the data.
 *
 *   ALSO: TWO MORE COPIES OF THE RULE. _coop_identity.ts sorted
 *   COOPERATIVE_MEMBERS by hand, twice, with `createdAt?.toMillis?.() ?? 0` —
 *   narrower than the shared reader (0 for a date-only string or an epoch
 *   number), no tiebreak, and sorting `snapshot.docs` in place. The same
 *   collection Layer 2.6 of module-access-check reads through the shared rule.
 *   #390's class; both now call it.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     drop the decided-time tiebreak                KILLED
 *     flip the id tiebreak back to ascending        KILLED
 *     drop the copy before sort (mutate the input)  KILLED
 *     _coop_identity sorts by hand again            KILLED
 *     reword the header prose                       SURVIVED, as intended
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { Timestamp } from '@/lib/firestore-compat';
import {
    latestApplication,
    sortApplicationsNewestFirst,
    APPLICATION_SCAN_LIMIT,
} from '@/lib/latest-application';
import { logger } from '@/lib/logger';

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: relative(ROOT, p) });

/** A stand-in for a snapshot: an id and a .data(), which is all the module reads. */
const doc = (id: string, data: Record<string, unknown> = {}) => ({ id, data: () => data });

const ISO = (s: string) => s;

let warn: any;
beforeEach(() => { warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined as any); });
afterEach(() => { warn.mockRestore(); });

// ─────────────────────────────────────────────────────────────────────────────
describe('#412 — the rule it already had', () => {
    it('THE NEWEST submittedAt WINS', () => {
        const older = doc('a', { submittedAt: Timestamp.fromMillis(1_000) });
        const newer = doc('b', { submittedAt: Timestamp.fromMillis(9_000) });
        expect(latestApplication([older, newer])?.id).toBe('b');
        expect(latestApplication([newer, older])?.id).toBe('b');
    });

    it('and createdAt is the fallback, because not every writer sets submittedAt', () => {
        const withCreated = doc('a', { createdAt: Timestamp.fromMillis(9_000) });
        const withSubmitted = doc('b', { submittedAt: Timestamp.fromMillis(1_000) });
        expect(latestApplication([withSubmitted, withCreated])?.id).toBe('a');
    });

    it('and it reads every timestamp shape the adapter can hand back (#49)', () => {
        /**
         * The reason the module uses toMillis rather than `?.toMillis?.()`:
         * the same field arrives as a revived Timestamp, an ISO string, an
         * epoch number or a Date depending on which path wrote and read it.
         */
        const shapes = [
            doc('ts', { submittedAt: Timestamp.fromMillis(1_000) }),
            doc('iso', { submittedAt: ISO('2024-01-01T00:00:02.000Z') }),
            doc('num', { submittedAt: 3_000 }),
            doc('date', { submittedAt: new Date(4_000) }),
        ];
        // Newest of the four is the Date at 4000ms; if any shape scored 0 the
        // answer would be decided by the tiebreak instead.
        expect(latestApplication(shapes)?.id).toBe('iso');
        expect(latestApplication([shapes[0], shapes[2], shapes[3]])?.id).toBe('date');
    });

    it('and an empty or absent set is null, not a throw', () => {
        expect(latestApplication([])).toBeNull();
        expect(latestApplication(null)).toBeNull();
        expect(latestApplication(undefined)).toBeNull();
    });

    it('and the caller\'s snapshot order is not disturbed', () => {
        const docs = [doc('a', { submittedAt: 1 }), doc('b', { submittedAt: 9 })];
        const before = docs.map((d) => d.id);
        latestApplication(docs);
        sortApplicationsNewestFirst(docs);
        expect(docs.map((d) => d.id)).toEqual(before);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#412 — and the tie it used to lose', () => {
    it('THE MOST RECENTLY DECIDED RECORD WINS WHEN NEITHER CARRIES A SUBMITTED TIME', () => {
        /**
         * #228's scenario with the timestamps missing: an old approval and a
         * newer rejection. The rejection is the one an admin touched last.
         */
        const oldApproval = doc('ACADEMY-1000-aaa', {
            status: 'approved',
            reviewedAt: Timestamp.fromMillis(1_000),
        });
        const newRejection = doc('ACADEMY-2000-bbb', {
            status: 'rejected',
            reviewedAt: Timestamp.fromMillis(2_000),
        });
        expect(latestApplication([oldApproval, newRejection])?.data().status).toBe('rejected');
        // …and from the other incoming order, too.
        expect(latestApplication([newRejection, oldApproval])?.data().status).toBe('rejected');
    });

    it('and the decided time is the MAX of the four, not the first one present', () => {
        /**
         * markAcademyApplicationUnderReview writes reviewedAt AND updatedAt;
         * the manual-enrolment path writes reviewedAt alone; legacy
         * provisioning writes approvedAt and updatedAt. A first-present-wins
         * chain would compare one row's updatedAt against another's reviewedAt.
         */
        const touchedLate = doc('a', { reviewedAt: Timestamp.fromMillis(9_000) });
        const touchedEarly = doc('b', { updatedAt: Timestamp.fromMillis(5_000) });
        expect(latestApplication([touchedEarly, touchedLate])?.id).toBe('a');

        const rejectedLate = doc('c', { rejectedAt: 9_500 });
        expect(latestApplication([touchedLate, rejectedLate])?.id).toBe('c');
    });

    it('and with NOTHING readable the id decides — descending, the opposite end from before', () => {
        /**
         * The academy document id IS `ACADEMY-${Date.now()}-…`, so descending
         * is the newest for that scheme. For a uuidv4 auto-id it is arbitrary,
         * but arbitrary in a way this module states rather than inherited from
         * the query plan.
         */
        const oldest = doc('ACADEMY-1000-aaa', { status: 'approved' });
        const newest = doc('ACADEMY-3000-ccc', { status: 'rejected' });
        const middle = doc('ACADEMY-2000-bbb', { status: 'pending' });

        // Presented in the ascending order the adapter's `.order('id')` produces.
        expect(latestApplication([oldest, middle, newest])?.id).toBe('ACADEMY-3000-ccc');
        // The pre-#412 code returned docs[0] here, which is the OLDEST.
        expect(latestApplication([oldest, middle, newest])?.id).not.toBe('ACADEMY-1000-aaa');
    });

    it('and it SAYS SO, because the repair for that is in the data', () => {
        latestApplication([doc('a'), doc('b')]);
        expect(warn).toHaveBeenCalledTimes(1);
        const [message, detail] = warn.mock.calls[0];
        expect(String(message)).toMatch(/no candidate carries a readable/i);
        expect(detail).toEqual({ candidates: ['b', 'a'], chose: 'b' });
    });

    it('and it stays quiet when there is a real date to compare, or only one candidate', () => {
        latestApplication([doc('a', { submittedAt: 1 }), doc('b')]);
        latestApplication([doc('lonely')]);
        expect(warn).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#412 — the premise, from the adapter and the id schemes', () => {
    it('AN UNORDERED QUERY FALLS THROUGH TO `.order(\'id\')` — ASCENDING', () => {
        /**
         * The fact the finding rests on. If this fallback ever changes, the
         * reasoning in the header stops describing the code and this says so.
         */
        expect(code('src/lib/supabase-db.ts')).toMatch(/query\s*=\s*query\.order\('id'\)/);
    });

    it('and the application ids these callers read embed the clock', () => {
        // The academy one is the document id itself, which is what makes
        // ascending-by-id equal to oldest-first for that collection.
        const academy = code('src/app/actions/academy/_ac_applications.ts');
        expect(academy).toMatch(/const applicationId = `ACADEMY-\$\{Date\.now\(\)\}/);
        expect(academy).toMatch(/collectionsContext\.doc\(applicationId\)/);
    });

    it('and every caller reads a WINDOW of applications, not one row', () => {
        // latestApplication cannot pick the newest out of a set of one. The
        // scan limit is what makes the rule reachable at all.
        expect(APPLICATION_SCAN_LIMIT).toBe(25);
        for (const p of ['src/lib/module-access-check.ts', 'src/infrastructure/payments/service.ts']) {
            const src = code(p);
            expect({ file: p, uses: src.includes('.limit(APPLICATION_SCAN_LIMIT)') })
                .toEqual({ file: p, uses: true });
            expect({ file: p, hardLimit1: /where\("userId", "==", userId\)\s*\.limit\(1\)/.test(src) })
                .toEqual({ file: p, hardLimit1: false });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#412 — stated once', () => {
    it('THE COOPERATIVE IDENTITY SCREEN NO LONGER SORTS BY HAND', () => {
        const src = code('src/app/actions/cooperative/_coop_identity.ts');
        expect(src).not.toMatch(/createdAt\?\.toMillis\?\.\(\)/);
        expect(src).toMatch(/import \{ sortApplicationsNewestFirst \} from "@\/lib\/latest-application"/);
        const uses = src.match(/sortApplicationsNewestFirst\(memberSnapshot\.docs\)/g) ?? [];
        expect(uses.length).toBe(2);
    });

    it('and no other module keeps a private copy of the key', () => {
        /**
         * The narrow reader this replaced. `createdAt?.toMillis?.()` is the #49
         * shape: it scores 0 for a date-only string and for an epoch number,
         * both of which toMillis reads. Bounded to the two files that decide
         * which of a member's records is current — the sweep for the shape
         * across the whole repository is #49's, already closed.
         */
        for (const p of [
            'src/lib/module-access-check.ts',
            'src/infrastructure/payments/service.ts',
        ]) {
            expect({ file: p, handRolled: /\.sort\(\(a, b\) => \{[\s\S]{0,200}?createdAt/.test(code(p)) })
                .toEqual({ file: p, handRolled: false });
        }
    });
});
