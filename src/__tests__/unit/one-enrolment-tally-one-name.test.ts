/**
 * @jest-environment node
 */

/**
 *   #336 ONE ENROLMENT TALLY, FOUR NAMES — AND THE ONE THE TYPE REQUIRES WAS
 *        THE ONE NO CREATOR WROTE.
 *
 *        Found by the reverse of #335: fields written to a collection that no
 *        code anywhere reads back. 437 written fields, 77 never read. Most are
 *        legitimate audit breadcrumbs — `_repairedAt`, `grantedBy`,
 *        `deletedBy` — written for a human looking at the row, not for code.
 *        This one was not a breadcrumb. It was a number the product is supposed
 *        to know, kept in four places.
 *
 *            enrolledCount    lib/types/academy.ts declares it REQUIRED;
 *                             _ac_enrollment.ts increments it on a FREE or
 *                             auto enrolment (two sites)
 *            students         _payment.ts increments it on a PAID enrolment
 *            studentsCount    _ac_admin_catalog.ts initialises it to 0 at
 *                             course creation
 *            enrollmentCount  declared on types/index.ts's Course beside
 *                             `enrolledCount`, and written by nothing at all
 *
 *        So: every course was born violating its own required field; the second
 *        creator (_ac_catalog.ts) initialised no counter whatsoever; and the
 *        two enrolment paths kept two different halves of the answer, neither
 *        of which was ever the whole number.
 *
 *        WHY IT LOOKED FINE. No screen shows an enrolment count, so nothing
 *        visibly disagreed with anything. That is what makes it worth fixing
 *        NOW rather than when a screen is added: whoever adds one will read
 *        `enrolledCount` — the declared field, the one the type requires — and
 *        get a number that counts free enrolments only, on courses created by
 *        one of the two creators. The bug would arrive already shipped.
 *
 *        NOTHING IS STRANDED. `students` and `studentsCount` keep being written
 *        where they already were, so no row loses a value it carries — the same
 *        treatment #183 gave `message`/`content`. `enrollmentCount` is the one
 *        removal, and it is a type property no writer ever produced, so there
 *        is no data behind it.
 *
 *        RECORDED: courses enrolled before this commit have their paid
 *        enrolments only in `students`, so `enrolledCount` under-counts them
 *        until a one-off backfill. That is a migration, not an audit fix, and
 *        it is stated in the code rather than left to be discovered.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const CREATOR_A = 'src/app/actions/academy/_ac_admin_catalog.ts';
const CREATOR_B = 'src/app/actions/academy/_ac_catalog.ts';
const PAID = 'src/app/actions/academy/_payment.ts';
const FREE = 'src/app/actions/academy/_ac_enrollment.ts';
const TYPE = 'src/lib/types/academy.ts';
const INDEX_TYPE = 'src/types/index.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#336 — the declared name is the one every path uses', () => {
    it('THE TYPE STILL REQUIRES enrolledCount', () => {
        // The premise. If this stops being the declared tally, the choice of
        // canonical name below has to be revisited rather than silently kept.
        expect(source(TYPE)).toMatch(/enrolledCount:\s*number;/);
    });

    it('BOTH COURSE CREATORS INITIALISE IT', () => {
        // THE test. One of them wrote a different name and the other wrote no
        // counter at all.
        expect(source(CREATOR_A)).toMatch(/enrolledCount:\s*0,/);
        expect(source(CREATOR_B)).toMatch(/enrolledCount:\s*0,/);
    });

    it('and BOTH enrolment paths increment it', () => {
        expect(source(PAID)).toMatch(/enrolledCount:\s*FieldValue\.increment\(1\)/);
        expect(source(FREE)).toMatch(/enrolledCount:\s*FieldValue\.increment\(1\)/);
    });

    it('the free path increments it at BOTH of its enrolment sites', () => {
        // Vacuity guard on the sibling: _ac_enrollment.ts has two, and a fix
        // that reached one of them is the shape this audit keeps finding.
        const hits = source(FREE).match(/enrolledCount:\s*FieldValue\.increment\(1\)/g) ?? [];
        expect(hits.length).toBe(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#336 — nothing that already exists is stranded', () => {
    it('the paid path still writes `students` alongside', () => {
        // Rows carry it. Dropping the write would freeze those counts at
        // whatever they held, for a field somebody may yet read.
        expect(source(PAID)).toMatch(/students:\s*FieldValue\.increment\(1\)/);
    });

    it('and the creator still writes `studentsCount`', () => {
        expect(source(CREATOR_A)).toMatch(/studentsCount:\s*0,/);
    });

    it('THE FOURTH NAME IS GONE, AND IT NEVER HAD DATA BEHIND IT', () => {
        // enrollmentCount was a type property no writer produced — the slot a
        // fifth writer would have fallen into.
        expect(source(INDEX_TYPE)).not.toMatch(/enrollmentCount\?:/);

        const { execSync } = require('child_process');
        const writers = execSync(
            "grep -rl 'enrollmentCount' src packages --include=*.ts --include=*.tsx || true",
            { encoding: 'utf-8' },
        )
            .split('\n')
            .filter(Boolean)
            .filter((f: string) => !f.includes('__tests__'))
            .filter((f: string) => source(f).includes('enrollmentCount'));

        expect(writers).toEqual([]);
    });

    it('POSITIVE CONTROL: that search still finds the name that IS declared', () => {
        const { execSync } = require('child_process');
        const declared = execSync(
            "grep -rl 'enrolledCount' src --include=*.ts --include=*.tsx || true",
            { encoding: 'utf-8' },
        ).split('\n').filter(Boolean);
        expect(declared.length).toBeGreaterThan(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#336 — the record the next reader needs', () => {
    it('the paid path says which field a screen should read, and names the backfill', () => {
        // The finding is only half-closed by code: historical paid enrolments
        // sit in `students` alone. Saying so beside the write is what stops the
        // next person trusting the number.
        const raw = readFileSync(PAID, 'utf-8');
        expect(raw).toContain('enrolledCount');
        expect(raw).toMatch(/backfill/i);
    });

    it('and both creators explain why two names are still written', () => {
        expect(readFileSync(CREATOR_A, 'utf-8')).toContain('#336');
        expect(readFileSync(CREATOR_B, 'utf-8')).toContain('#336');
    });

    it('VACUITY GUARD: these are real files with real course writes', () => {
        for (const f of [CREATOR_A, CREATOR_B, PAID, FREE]) {
            expect(source(f)).toContain('COLLECTIONS.ACADEMY_COURSES');
        }
    });
});
