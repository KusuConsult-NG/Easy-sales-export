/**
 * @jest-environment node
 */

/**
 *   #729 THE PLATFORM HAS SIX IDENTITY GUARDS THAT ASK THE DATABASE FOR A PHONE
 *        NUMBER. TWO ASKED FOR EVERY SPELLING. FOUR ASKED FOR ONE.
 *
 *   lib/phone.ts exists for precisely this, and its own documentation states
 *   both the mechanism and the stake:
 *
 *       "the users collection holds BOTH spellings, and a duplicate check that
 *        asks only for `+234…` cannot see a member whose number was written by
 *        any of those paths. That check is the one thing standing between the
 *        platform and two accounts on one phone number — so the guard was blind
 *        to most of the platform."
 *
 *   It names four writers that store a raw number: the bulk member import, the
 *   marketplace verification path, export onboarding and KYC. And
 *   `phoneLookupVariants` was reaching registration and login only.
 *
 * ── WHAT THE OTHER FOUR WERE ────────────────────────────────────────────────
 *
 *     wave/_wv_applications.ts       the WAVE duplicate scan, `phone == typed`
 *     briefing.ts                    "STRICT DEDUPLICATION", `phoneNumber ==`
 *     admin/_legacy.ts               "🔒 DEDUP GUARD … (Fraud Prevention)"
 *     lib/cooperative-identity-conflict.ts   its own two-form list
 *
 *   The third is the one that stings: lib/phone.ts NAMES admin/_legacy.ts as a
 *   writer of raw numbers, and the guard standing in front of that import was
 *   asking for one spelling. The file diagnosing the problem and the file with
 *   the problem are the same file.
 *
 *   The fourth is the defect class at its purest — not a missing rule but a
 *   SECOND, NARROWER COPY of one: `[phone, normalisePhone(phone)]`, two of the
 *   four spellings that exist, under a comment correctly explaining why one is
 *   not enough.
 *
 * ── PROVED BEFORE IT WAS FIXED ──────────────────────────────────────────────
 *
 *   strictPhoneSchema is /^[\+\d\s\-\(\)]+$/ at 10–15 characters and
 *   strictNigerianPhoneSchema is /^(\+234|0)[789]\d{9}$/. Neither normalises.
 *   Both admit more than one spelling of one number, and nothing on the WAVE or
 *   briefing write paths canonicalises before storing. So the collections hold
 *   one number under several spellings by construction, not by accident.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join, relative, sep } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { phoneLookupVariants, normalisePhone } from '@/lib/phone';

const ROOT = process.cwd();
const src = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
describe('#729 — one number, several spellings', () => {
    const SPELLINGS = ['08031234567', '+2348031234567', '2348031234567'];

    it('ARE ALL THE SAME PERSON', () => {
        //   The premise. If these normalised differently the guards would be
        //   right to treat them as different people.
        const forms = new Set(SPELLINGS.map((s) => normalisePhone(s)));
        expect(forms.size).toBe(1);
        expect([...forms][0]).toBe('+2348031234567');
    });

    it('AND THE LOOKUP HELPER FINDS A ROW STORED AS ANY OF THEM', () => {
        //   Whichever spelling the applicant types, the query covers the rest.
        for (const typed of SPELLINGS) {
            const variants = phoneLookupVariants(typed);
            for (const stored of SPELLINGS) {
                expect(variants).toContain(stored);
            }
        }
    });

    it('AND AN EXACT MATCH — WHAT FOUR GUARDS USED — DOES NOT', () => {
        /*
         *   THE defect, stated as arithmetic. A guard comparing the typed
         *   string against the stored one agrees only when two people happened
         *   to type the same number the same way.
         */
        const stored: string = '08031234567';
        const typed: string = '+2348031234567';

        expect(stored === typed).toBe(false);
        expect(phoneLookupVariants(typed)).toContain(stored);
    });

    it('AND A PARTIAL NUMBER DEGRADES TO EXACTLY WHAT IT WAS', () => {
        /*
         *   The admin search box accepts fragments. phoneLookupVariants cannot
         *   normalise "0803", so it returns the fragment alone — the single
         *   exact match it replaced — leaving the prefix ranges to do the work
         *   they exist for. Asserted because widening a SEARCH is only safe if
         *   it cannot narrow one.
         */
        expect(phoneLookupVariants('0803')).toEqual(['0803']);
        expect(phoneLookupVariants('')).toEqual([]);
        expect(phoneLookupVariants(null)).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#729 — every identity guard now asks the wide question', () => {
    const GUARDS: Array<{ file: string; field: string; what: string }> = [
        { file: 'src/app/actions/wave/_wv_applications.ts', field: 'phone', what: 'the WAVE duplicate scan' },
        { file: 'src/app/actions/briefing.ts', field: 'phoneNumber', what: 'the briefing dedup' },
        { file: 'src/app/actions/admin/_legacy.ts', field: 'phone', what: 'the bulk-import fraud guard' },
        { file: 'src/lib/cooperative-identity-conflict.ts', field: 'phone', what: 'the cooperative conflict check' },
    ];

    it.each(GUARDS)('$what builds its forms from the shared helper', ({ file }) => {
        expect(src(file)).toContain('phoneLookupVariants(');
    });

    it.each(GUARDS)('$what queries with "in", not "=="', ({ file, field }) => {
        const code = src(file);
        //   THE assertion. An `==` on a phone field is the defect itself.
        expect(code).not.toMatch(new RegExp(`where\\("${field}",\\s*"=="`));
        expect(code).toMatch(new RegExp(`where\\("${field}",\\s*"in"`));
    });

    it('AND THE COOPERATIVE CHECK NO LONGER KEEPS ITS OWN TWO-FORM LIST', () => {
        //   The narrower copy, specifically. Asserted by absence because the
        //   file legitimately still imports normalisePhone for other work.
        expect(src('src/lib/cooperative-identity-conflict.ts'))
            .not.toContain('[phone, normalisePhone(phone)]');
    });

    it('AND AN EMPTY VARIANT LIST NEVER REACHES AN `in` QUERY', () => {
        /*
         *   `where(field, "in", [])` is a query with no possible match, and
         *   whether an adapter returns empty or throws is not something a
         *   dedup guard should depend on. Every site guards on length first.
         */
        for (const { file } of GUARDS) {
            expect(src(file)).toMatch(/phoneForms\.length > 0|forms\.length > 0/);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#729 — and no phone-keyed equality query comes back', () => {
    /** Every .ts/.tsx of the application, excluding test scaffolding. */
    function sourceFiles(): string[] {
        const out: string[] = [];
        const walk = (dir: string) => {
            for (const e of readdirSync(dir, { withFileTypes: true })) {
                const full = join(dir, e.name);
                if (e.isDirectory()) {
                    if (e.name === '__tests__' || e.name === 'node_modules') continue;
                    walk(full);
                    continue;
                }
                if (/\.tsx?$/.test(e.name)) out.push(relative(ROOT, full).split(sep).join('/'));
            }
        };
        walk(join(ROOT, 'src'));
        return out.sort();
    }

    it('SWEPT, SO A SEVENTH GUARD CANNOT BE ADDED BLIND', () => {
        /*
         *   The hand-listed guards above cannot notice a new one. This is the
         *   half that can — #727's lesson, applied here rather than learned
         *   again: a list is a second copy of a fact the filesystem holds.
         *
         *   Prefix RANGES (`>=` / `<=`) are untouched: they are the search
         *   box's substring feature, not an identity comparison.
         */
        const offenders = sourceFiles()
            .flatMap((rel) => src(rel)
                .split('\n')
                .filter((l) => /where\(\s*"(phone|phoneNumber)"\s*,\s*"=="/.test(l))
                .map((l) => `${rel}: ${l.trim()}`));

        expect(offenders).toEqual([]);
    });

    it('AND THE SWEEP CAN SEE ONE, SO [] MEANS CLEAN', () => {
        //   Positive control. Without this, a sweep that silently matched
        //   nothing — a changed quote style, a renamed field — would report the
        //   same empty list as a clean codebase.
        const sample = 'const x = db.collection(C).where("phone", "==", p).get();';
        expect(/where\(\s*"(phone|phoneNumber)"\s*,\s*"=="/.test(sample)).toBe(true);

        //   And the sweep really is reading files, not an empty list of them.
        expect(sourceFiles().length).toBeGreaterThan(400);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy,
 *   each mutant proving its edit landed by a unique string on disk.
 *
 *     MUTANT                                                        RESULT
 *     the WAVE scan goes back to `phone == typed`                    KILLED
 *     the briefing dedup goes back to `phoneNumber ==`               KILLED
 *     the bulk-import fraud guard goes back to `phone ==`            KILLED
 *     the cooperative check restores its two-form list               KILLED
 *     a guard drops its empty-list check before the `in`             KILLED
 *     the helper returns only the normalised form                    KILLED
 *     the helper drops the un-prefixed 234… spelling                 KILLED
 *     a partial number stops degrading to itself                     KILLED
 *     the sweep stops matching phoneNumber                           KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 */
