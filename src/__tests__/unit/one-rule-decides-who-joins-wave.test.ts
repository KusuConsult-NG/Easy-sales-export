/**
 * @jest-environment node
 */

/**
 *   #817 THE WAVE ELIGIBILITY RULE HAD BEEN WRITTEN SEVEN TIMES.
 *
 *   The owner asked a plain question — "when a user creates an account as a
 *   male will the user have access to the WAVE registration? how are male users
 *   blocked from the WAVE registration?" — and answering it turned up three
 *   more screens deciding it on their own.
 *
 *   lib/wave-eligibility.ts exists because this rule had been written FOUR
 *   times and the copies had drifted; its header names all four and says why
 *   the strictest was made canonical. Swept for the cutoff literal, there were
 *   three MORE that no consolidation had ever touched:
 *
 *       src/middleware.ts                the /wave route gate itself
 *       src/app/dashboard/page.tsx       the module card every user lands on
 *       src/app/auth/get-started/page.tsx  the module picker
 *
 *   each re-declaring `const CUTOFF_DATE = new Date("2026-06-17...")` and
 *   re-deriving the decision. All three ask the one function now.
 *
 *   AND THE SWEEP IS THE POINT. Four consolidations had each fixed the copies
 *   they knew about, by name. A grep for the date finds the ones nobody listed.
 *
 *   HOW THEY DIFFERED FROM THE CANONICAL RULE:
 *
 *     NO ADMIN EXEMPTION      checkWaveEligibility admits platform admins and
 *                             Academy Elite members outright. This did not, so
 *                             a male admin had the WAVE card hidden from his
 *                             own dashboard while every server path admitted
 *                             him.
 *
 *     ONE DATE SHAPE          `new Date(createdAt)` reads a string. The shared
 *                             rule reads the four shapes createdAt actually
 *                             arrives in, because a shape a copy missed
 *                             answered "before the cutoff" — the PERMISSIVE
 *                             direction.
 *
 *   The dashboard filter is not the gate and was never the thing stopping
 *   anybody; the refusals are on the server. What it must not do is disagree
 *   with them, and it did.
 *
 * ── AND THE ANSWER TO THE QUESTION ITSELF ───────────────────────────────────
 *
 *   Registration REQUIRES gender — registerSchema's `gender` is a non-optional
 *   enum — so a male account created today has it recorded, falls after the
 *   2026-06-17 cutoff, and is refused by all four server call sites.
 *
 *   The gap worth stating: an account whose gender is NOT RECORDED is admitted,
 *   deliberately and by every copy of the rule. Registration cannot produce
 *   one, but a legacy import or an admin-created account can. That is asserted
 *   below rather than left implicit, because it is the one way a man reaches
 *   WAVE and it should fail loudly if somebody changes it by accident.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the dashboard's own CUTOFF_DATE literal restored                 KILLED
 *     the dashboard filter inverted                                    KILLED
 *     the admin exemption removed from the shared rule                 KILLED
 *     the cutoff comparison flipped to `<`                             KILLED
 *     describesAMan made case-sensitive                                KILLED
 *     the rejected-registration tightening reverted                    KILLED
 *     reword this header                                   SURVIVED, intended
 *
 * ── AND ONE TIGHTENING THAT CAME OUT OF THE CONSOLIDATION ───────────────────
 *
 *   middleware asked the STRICTER question all along. Its status list, through
 *   lib/wave-access, refuses a REJECTED wave registration; checkWaveEligibility
 *   accepted `status !== undefined` — any status at all.
 *
 *   So a pre-cutoff male whose application had been rejected was refused the
 *   pages and admitted by the four server call sites: a gate refusing what the
 *   action behind it allows, which wave-eligibility's own header calls the
 *   worst arrangement of the two. The rule moved toward the middleware, not the
 *   other way.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { checkWaveEligibility, WAVE_MALE_CUTOFF_DATE } from '@/lib/wave-eligibility';
import { registerSchema } from '@/lib/schemas';

const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), 'utf8'));

const DASHBOARD = 'src/app/dashboard/page.tsx';

/** A man who signed up today: after the cutoff, no roles, no registrations. */
const newMale = {
    roles: [],
    gender: 'male',
    createdAt: new Date(WAVE_MALE_CUTOFF_DATE.getTime() + 86_400_000).toISOString(),
    serviceRegistrations: {},
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#817 — a man who registers today cannot join WAVE', () => {
    it('THE RULE REFUSES HIM', () => {
        expect(checkWaveEligibility(newMale).eligible).toBe(false);
    });

    it.each([
        ['male', 'male'],
        ['Male', 'Male'],
        ['  MALE  ', '  MALE  '],
    ])('AND THE SPELLING DOES NOT LET HIM THROUGH: %s', (_label, gender) => {
        //   Three spellings live rows actually hold. A case-sensitive compare
        //   would admit two of them.
        expect(checkWaveEligibility({ ...newMale, gender }).eligible).toBe(false);
    });

    it('AND REGISTRATION CANNOT CREATE AN ACCOUNT WITHOUT A GENDER', () => {
        /*
         *   This is what makes the rule above bite for new accounts: the value
         *   it tests is always present. Executed against the schema, not read
         *   off it.
         */
        const base = {
            fullName: 'Ada Okafor', email: 'ada@example.com', phone: '08031234567',
            password: 'Str0ng!Passw0rd', confirmPassword: 'Str0ng!Passw0rd',
        };
        expect(registerSchema.safeParse({ ...base, gender: 'Male' }).success).toBe(true);
        expect(registerSchema.safeParse(base).success).toBe(false);
        expect(registerSchema.safeParse({ ...base, gender: '' }).success).toBe(false);
    });

    it('CONTROL: a woman registering today IS eligible', () => {
        //   Or every assertion above would pass against a rule that refuses
        //   everybody, which would close the programme rather than gate it.
        expect(checkWaveEligibility({ ...newMale, gender: 'female' }).eligible).toBe(true);
    });

    it('CONTROL: a male PLATFORM ADMIN is still eligible', () => {
        /*
         *   The exemption the dashboard's private copy did not have. Asserted
         *   so the consolidation cannot quietly drop it either.
         */
        expect(checkWaveEligibility({ ...newMale, roles: ['super_admin'] }).eligible).toBe(true);
    });

    it('AND AN UNRECORDED GENDER IS ADMITTED — stated, because it is the one way in', () => {
        /*
         *   Every copy of this rule has behaved this way on purpose: the block
         *   exists to stop men enrolling, not to refuse an incomplete profile.
         *   Registration cannot produce such an account, but a legacy import or
         *   an admin-created one can.
         *
         *   Pinned so it is a DECISION rather than an oversight: changing it
         *   fails here and whoever changes it has to mean it.
         */
        expect(checkWaveEligibility({ ...newMale, gender: undefined }).eligible).toBe(true);
        expect(checkWaveEligibility({ ...newMale, gender: '' }).eligible).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#817 — and exactly one place decides it', () => {
    it('THE DASHBOARD ASKS THE SHARED RULE', () => {
        expect(read(DASHBOARD)).toContain('checkWaveEligibility(');
    });

    it('AND CARRIES NO CUTOFF OR GENDER TEST OF ITS OWN', () => {
        /*
         *   THE assertion. "The file imports the rule" would be satisfied by a
         *   file that imports it and then decides for itself anyway — the #741
         *   shape, met repeatedly in this audit.
         */
        const src = read(DASHBOARD);

        expect(src).not.toMatch(/CUTOFF_DATE/);
        expect(src).not.toMatch(/2026-06-17/);
        expect(src).not.toMatch(/gender\?\.toLowerCase\(\)\s*===\s*["']male["']/);
    });

    it('AND NO OTHER FILE STILL CARRIES THE CUTOFF', () => {
        /*
         *   Swept, not listed. An enumerated list of screens is what let this
         *   copy survive four consolidations — the same lesson #811 produced on
         *   the acronym an hour earlier.
         */
        const { execSync } = require('child_process');
        const files: string[] = execSync(
            "find src -type f \\( -name '*.ts' -o -name '*.tsx' \\)",
            { encoding: 'utf8' },
        ).split('\n').filter(Boolean);

        expect(files.length).toBeGreaterThan(500);

        const ALLOWED = new Set([
            //   The rule itself: the one place the date may be written.
            'src/lib/wave-eligibility.ts',
            //   This suite, and the two that already pin the consolidation.
            //   Allowed BY FILENAME rather than by "it is a test", because a
            //   test file is exactly where a seventh copy could sit unnoticed.
            'src/__tests__/unit/one-rule-decides-who-joins-wave.test.ts',
            'src/__tests__/unit/wave-eligibility-one-rule.test.ts',
            'src/__tests__/unit/wave-applications-behaviour.test.ts',
        ]);

        const offenders = files
            .filter((f) => !ALLOWED.has(f))
            .filter((f) => /2026-06-17/.test(read(f)));

        expect(offenders).toEqual([]);
    });
});
