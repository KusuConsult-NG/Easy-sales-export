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

const SCRIPT = 'scripts/why-is-the-dashboard-slow.sql';
const source = readFileSync(join(process.cwd(), SCRIPT), 'utf-8');

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

describe('#910 — the diagnostic survives the SQL Editor that has to run it', () => {
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
        const fragments = source.split(/\n\s*\n/);
        const opening = fragments.filter((f) => f.includes('WITH required AS ('));

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
        expect({ andCarriesTheEnd: opening[0].includes('ORDER BY 1, 2;') })
            .toEqual({ andCarriesTheEnd: true });

        const body = statement.join('\n');
        const opens = (body.match(/\(/g) ?? []).length;
        const closes = (body.match(/\)/g) ?? []).length;

        expect({ parens: opens === closes, terminated: body.trimEnd().endsWith(';') })
            .toEqual({ parens: true, terminated: true });
    });

    it('AND IT STILL ASKS ABOUT EVERY FAST PATH — the vacuity guard', () => {
        /*
         *   A file trimmed until it could not be split would pass everything
         *   above and diagnose nothing. These are the names it must check.
         */
        const body = statement.join('\n');

        for (const name of [
            'count_module_registrations', 'count_user_segments', 'module_registration_counts',
            'service_regs', 'idx_dc_collection_status', 'idx_users_created_at',
            'idx_users_migrated_to', 'idx_mo_payment_reference',
        ]) {
            expect({ checks: name, present: body.includes(name) }).toEqual({ checks: name, present: true });
        }
    });
});
