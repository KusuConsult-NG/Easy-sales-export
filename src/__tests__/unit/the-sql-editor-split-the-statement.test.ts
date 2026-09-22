/**
 * @jest-environment node
 */

/**
 *   THE DIAGNOSTIC RAN LOCALLY AND WOULD NOT RUN WHERE IT WAS FOR.
 *
 *   THE OWNER, pasting the Supabase SQL Editor's answer:
 *
 *       ERROR: 42601: syntax error at or near "'module_registration_counts'"
 *       LINE 1:     ('module_registration_counts',
 *
 *   LINE 1 is the whole finding. PostgreSQL numbers lines within the statement
 *   it was handed, so the server was given a FRAGMENT beginning at that line —
 *   not the file. The editor's statement splitter had cut the VALUES list in
 *   half at a blank line, and each half is a syntax error on its own.
 *
 *   `psql -f` does not do that, which is why it passed here and failed there.
 *   A script written for the SQL Editor has to survive the SQL Editor; testing
 *   it only through psql tests the wrong client.
 *
 *   ── WHAT THIS PINS ─────────────────────────────────────────────────────────
 *
 *   The one statement carries no blank line and no string literal spanning a
 *   line break, so a splitter that cuts on blank lines cannot cut it. Prose
 *   goes above the statement, in `--` comments, where a split is harmless.
 *
 *   Non-ASCII is excluded from the statement too. That was a second variable —
 *   the first draft had em dashes inside the literals — and with two suspects
 *   and one failure, removing both is cheaper than deciding which it was.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The scripts written to be PASTED INTO THE SUPABASE SQL EDITOR.
 *
 * Named explicitly rather than globbed over scripts/*.sql, and that is a
 * judgement rather than laziness: payments-that-nobody-made.sql is a
 * multi-section sweep meant for psql, where blank lines between sections are
 * correct and readable. The constraint below is the editor's, so it applies to
 * the files that go to the editor.
 *
 * A new one added here and not to this list is the regression this suite
 * exists for — so the vacuity guard at the bottom checks the list is the size
 * it claims.
 */
const EDITOR_SCRIPTS = [
    'scripts/why-is-the-dashboard-slow.sql',
    'scripts/export-registration-statuses.sql',
    'scripts/cooperative-members-who-never-paid.sql',
    'scripts/entitlements-nobody-paid-for.sql',
    'scripts/academy-paid-twice.sql',
];

/** Everything that is not a leading `--` comment: the executable statement. */
function statementOf(sql: string): string[] {
    const lines = sql.split('\n');
    const start = lines.findIndex((l) => l.trim().length > 0 && !l.trim().startsWith('--'));
    expect({ foundAStatement: start > -1 }).toEqual({ foundAStatement: true });

    const out: string[] = [];
    for (let i = start; i < lines.length; i += 1) {
        out.push(lines[i]);
        if (lines[i].trimEnd().endsWith(';')) break;
    }
    return out;
}

describe.each(EDITOR_SCRIPTS)('#910 — %s survives the SQL Editor that has to run it', (SCRIPT) => {
    const source = readFileSync(join(process.cwd(), SCRIPT), 'utf-8');
    const statement = statementOf(source);

    it('THE STATEMENT CARRIES NO BLANK LINE', () => {
        /*
         *   THE defect. The editor split the VALUES list at a blank line and
         *   handed PostgreSQL half a statement.
         */
        const blanks = statement
            .map((l, i) => ({ line: i + 1, text: l }))
            .filter(({ text }) => text.trim() === '');

        expect({ blankLinesInsideTheStatement: blanks }).toEqual({ blankLinesInsideTheStatement: [] });
    });

    it('AND NO STRING LITERAL SPANS A LINE BREAK', () => {
        /*
         *   The other way a naive splitter goes wrong: a literal left open at
         *   the end of a line means the splitter's idea of "inside a string"
         *   and PostgreSQL's disagree from there on.
         *
         *   Counted per line, with '' (an escaped quote) removed first so
         *   "A person''s own rows" is not read as an odd number of quotes.
         */
        const unbalanced = statement
            .map((l, i) => ({ line: i + 1, quotes: (l.replace(/''/g, '').match(/'/g) ?? []).length }))
            .filter(({ quotes }) => quotes % 2 !== 0);

        expect({ linesLeavingAStringOpen: unbalanced }).toEqual({ linesLeavingAStringOpen: [] });
    });

    it('AND IS PLAIN ASCII', () => {
        //   The second suspect, removed rather than argued about.
        const nonAscii = statement
            .map((l, i) => ({ line: i + 1, found: (l.match(/[^\x00-\x7F]/g) ?? []).join('') }))
            .filter(({ found }) => found.length > 0);

        expect({ nonAsciiInsideTheStatement: nonAscii }).toEqual({ nonAsciiInsideTheStatement: [] });
    });

    it('AND SPLITTING THE FILE ON BLANK LINES NEVER CUTS IT — the mechanism, run', () => {
        /*
         *   THE control, and the only assertion here that reproduces what the
         *   editor did. Cut the whole file the way the editor cut it; the
         *   statement must land in exactly one piece.
         */
        //   The statement's own first line, whatever it is, so this holds for
        //   every script in the list rather than one of them.
        const firstLine = statement[0].trim();
        const fragments = source.split(/\n\s*\n/);
        const opening = fragments.filter((f) => f.includes(firstLine));

        //   Exactly one fragment begins the statement …
        expect({ fragmentsOpeningTheStatement: opening.length })
            .toEqual({ fragmentsOpeningTheStatement: 1 });

        /*
         *   … and it also carries the END of it. That is the property, stated
         *   directly: if any blank line fell between `WITH` and the final
         *   `ORDER BY`, these would be two fragments and this fails.
         *
         *   NOT a parenthesis count over the fragment: the header comment sits
         *   in the same fragment (its "blank" lines are `--`, so nothing splits
         *   there) and carries prose parens of its own. The balanced-paren
         *   check belongs on the extracted statement, which is what `statement`
         *   above already is.
         */
        const lastLine = statement[statement.length - 1].trim();
        expect({ andCarriesTheEnd: opening[0].includes(lastLine) })
            .toEqual({ andCarriesTheEnd: true });

        const body = statement.join('\n');
        const opens = (body.match(/\(/g) ?? []).length;
        const closes = (body.match(/\)/g) ?? []).length;

        expect({ parens: opens === closes, terminated: body.trimEnd().endsWith(';') })
            .toEqual({ parens: true, terminated: true });
    });

    it('AND IT STILL ASKS A REAL QUESTION — the vacuity guard', () => {
        /*
         *   A file trimmed until it could not be split would pass everything
         *   above and diagnose nothing. Both scripts read the same two places,
         *   so those are the names each must mention.
         */
        const body = statement.join('\n');

        /*
         *   Per script, because they ask different questions: one reads the
         *   catalogue (pg_proc, pg_indexes) and never touches a data table;
         *   the other reads the data and never touches the catalogue. A shared
         *   marker list would have to be the intersection, which is nothing.
         */
        const MUST_MENTION: Record<string, string[]> = {
            'scripts/why-is-the-dashboard-slow.sql': [
                'count_module_registrations', 'service_regs', 'pg_indexes', 'pg_proc',
            ],
            'scripts/export-registration-statuses.sql': [
                'service_regs', 'export_onboarding_applications', 'export_participant',
            ],
            //   The cooperative pair. One asks which MEMBER ROWS have a
            //   settled payment behind them; the other asks which ROLE HOLDERS
            //   do — the entitlement, which is what actually opens the module.
            'scripts/cooperative-members-who-never-paid.sql': [
                'cooperative_members', 'processed_payments', '_repairSource', '_roleGrantedBy',
            ],
            'scripts/entitlements-nobody-paid-for.sql': [
                'cooperative_member', 'processed_payments', '_roleGrantedBy',
            ],
            /*
             *   The refund sweep after #258's gate refused learners who had
             *   already paid. `distinct reference` is named because the whole
             *   query turns on it: two ROWS can be one charge replayed by a
             *   webhook, and refunding on a row count would hand back money
             *   that was never taken twice. `users` is named because the
             *   grouping is by PERSON, not by userId -- #888's split accounts
             *   put the second charge on the sibling row, which is the case
             *   this exists to catch.
             */
            'scripts/academy-paid-twice.sql': [
                'processed_payments', 'academy_registration', 'distinct reference', 'users',
                //   The third verdict. The FIRST row this query ever returned
                //   was a fabricated E2E row labelled "refund candidate", so
                //   the classifier that tells a minted reference from a real
                //   one is the part most worth keeping honest.
                'looks_fabricated',
            ],
        };

        const expected = MUST_MENTION[SCRIPT];
        //   A script with no entry would silently check nothing.
        expect({ script: SCRIPT, hasMarkers: Array.isArray(expected) && expected.length > 0 })
            .toEqual({ script: SCRIPT, hasMarkers: true });

        for (const name of expected) {
            expect({ script: SCRIPT, checks: name, present: body.includes(name) })
                .toEqual({ script: SCRIPT, checks: name, present: true });
        }
        expect(body.length).toBeGreaterThan(400);
    });
});

describe('#910 — and the list of editor scripts is the list', () => {
    it('EVERY EDITOR SCRIPT IS COVERED', () => {
        /*
         *   describe.each over an empty or truncated list passes every
         *   assertion above by running none of them. This is the guard on the
         *   guard, and it fails the day a third editor script is written and
         *   not added.
         */
        expect({ covered: EDITOR_SCRIPTS.length }).toEqual({ covered: 5 });
        for (const rel of EDITOR_SCRIPTS) {
            expect({ rel, exists: readFileSync(join(process.cwd(), rel), 'utf-8').length > 0 })
                .toEqual({ rel, exists: true });
        }
    });
});
