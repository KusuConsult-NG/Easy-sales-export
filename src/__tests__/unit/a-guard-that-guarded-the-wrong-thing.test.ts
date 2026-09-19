/**
 * @jest-environment node
 */

/**
 *   #891 `x?.toDate()` DEFENDS AGAINST ABSENT, NOT AGAINST A STRING — AND IT IS
 *        THE IDIOM THAT LOOKS SAFEST.
 *
 *   Found while sweeping #890. `a?.b()` means `a == null ? undefined : a.b()`.
 *   For a stored ISO string, `a` is NOT null — so it evaluates `a.toDate`, gets
 *   undefined, and calls it:
 *
 *       TypeError: data.startedAt.toDate is not a function
 *
 *   The `?.` reads as a guard and defends only the one case that was never the
 *   problem. That is this audit's second-commonest defect class — a control that
 *   looks like it does something and does not — applied to the exact crash the
 *   owner reported in #884.
 *
 *   NINE SITES, in two files, and two of them inside a `.map()`:
 *
 *       _ex_investments.ts   the export window's start, end and delivery dates;
 *                            "my investments" (a .map()); and the escrow
 *                            release-date extension, which WRITES the value it
 *                            reads back
 *       chatbot-db.ts        both session readers, one of them a .map()
 *
 *   One of them had no guard at all — `wData.endDate.toDate()` — on the line
 *   directly beneath two that at least tried.
 *
 * ── WHY A RATCHET AND NOT ONLY A FIX ────────────────────────────────────────
 *
 *   Because the idiom is not obviously wrong on sight, and three separate
 *   findings in this audit are now the same crash: #884 (a seller's listings),
 *   #890 (escrow, a product edit, a loan repayment) and this one. Fixing nine
 *   lines does not stop the tenth being written next week by somebody who reads
 *   `?.` as safety. The sweep below is the part that lasts.
 */

import { describe, it, expect } from '@jest/globals';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { toDateOrNull, safeToISOStringOptional } from '@/lib/date-utils';

/**
 * Files that legitimately call `.toDate()` — they are the ones that have
 * ALREADY established the value is a Timestamp, and they are what everything
 * else is asked to go through.
 */
const IMPLEMENTATIONS = [
    'src/lib/date-utils.ts',
    'src/lib/firestore-serialize.ts',
    'src/lib/supabase-db.ts',
    'src/lib/supabase-client-db.ts',
    'src/lib/firestore-compat.ts',
    'src/lib/testing/fake-db.ts',
];

function sourceFiles(): string[] {
    const out = execSync(
        `grep -rl '\\.toDate()' src --include=*.ts --include=*.tsx || true`,
        { encoding: 'utf8' },
    ).trim();
    if (!out) return [];
    return out.split('\n')
        .filter((f) => f && !f.includes('__tests__') && !IMPLEMENTATIONS.includes(f));
}

/** Lines calling `.toDate()` through optional chaining, which guards nothing. */
function falseGuards(file: string): string[] {
    const hits: string[] = [];
    readFileSync(join(process.cwd(), file), 'utf8').split('\n').forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
        if (!/\?\.\s*toDate\s*\(\)/.test(line)) return;
        //   A line that ALSO proves it is callable is genuinely guarded.
        if (/typeof\s+[^;]*\.toDate\s*===\s*["']function["']/.test(line)) return;
        hits.push(`${file}:${i + 1}  ${t.slice(0, 100)}`);
    });
    return hits;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#891 — the false guard, swept and kept out', () => {
    it('THE RULE: no source reads a stored date through `x?.toDate()`', () => {
        /*
         *   Reported as the offending lines rather than a count, so a failure
         *   names the file to open. `toDateOrNull` and `safeToISOStringOptional`
         *   are what to use instead — they read all four shapes a stored
         *   timestamp takes here.
         */
        const offenders = sourceFiles().flatMap(falseGuards);

        expect(offenders).toEqual([]);
    });

    it('AND THE SWEEP LOOKS AT A REAL POPULATION — the vacuity guard', () => {
        /*
         *   Without this, deleting the grep or breaking the filter makes the
         *   rule above pass over nothing at all. This codebase has a named
         *   finding about exactly that ("an assertion that cannot fail").
         */
        const files = sourceFiles();

        expect(files.length).toBeGreaterThan(20);
        expect(files.some((f) => f.startsWith('src/app/actions/'))).toBe(true);
    });

    it('AND THE DETECTOR REALLY CATCHES THE SHAPE — asked with a known answer', () => {
        //   The other half: prove the regex fires on the idiom and not on the
        //   genuine guard, rather than trusting that it does.
        const bad = 'startedAt: d.startedAt?.toDate() ?? new Date(),';
        const good = 'const t = typeof v?.toDate === "function" ? v.toDate() : null;';
        const alsoGood = 'const t = raw?.toDate ? raw.toDate() : new Date(raw);';

        expect(/\?\.\s*toDate\s*\(\)/.test(bad)).toBe(true);
        expect(/\?\.\s*toDate\s*\(\)/.test(alsoGood)).toBe(false);
        expect(
            /\?\.\s*toDate\s*\(\)/.test(good)
            && !/typeof\s+[^;]*\.toDate\s*===\s*["']function["']/.test(good),
        ).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#891 — and what replaced it reads every shape', () => {
    it('THE FOUR SHAPES A STORED TIMESTAMP TAKES HERE', () => {
        const iso = '2026-09-12T10:32:43.735Z';

        expect(toDateOrNull(iso)?.toISOString()).toBe(iso);
        expect(toDateOrNull('2026-09-12')).toBeInstanceOf(Date);
        expect(toDateOrNull(1_757_672_000_000)).toBeInstanceOf(Date);
        expect(toDateOrNull(new Date(iso))?.toISOString()).toBe(iso);
        expect(toDateOrNull({ toDate: () => new Date(iso) })?.toISOString()).toBe(iso);
    });

    it('AND AN UNREADABLE VALUE IS null RATHER THAN A THROW OR THE EPOCH', () => {
        //   #608: the epoch is this codebase's word for "unknown" and screens
        //   read it aloud as 1 January 1970.
        for (const bad of ['not a date at all', '', null, undefined, {}, NaN]) {
            expect({ bad, out: toDateOrNull(bad) }).toEqual({ bad, out: null });
        }
        expect(safeToISOStringOptional('not a date at all')).toBeUndefined();
    });

    it('AND THE STRING A `?.toDate()` WOULD HAVE THROWN ON IS HANDLED', () => {
        /*
         *   The case, stated directly. `'2026-09-12'?.toDate()` throws because
         *   the value is not null and has no such method.
         */
        expect(() => ('2026-09-12' as any).toDate()).toThrow(TypeError);
        expect(toDateOrNull('2026-09-12')).toBeInstanceOf(Date);
    });
});
