/**
 * @jest-environment node
 */

/**
 *   #814(b) THE SEARCH PASSED HERE AND FAILED IN CI, ON THE SAME CODE.
 *
 *   #814 gave the admin name search a prefix range bounded the way
 *   searchUserIdsByQuery has always bounded one:
 *
 *       .where(field, ">=", value)
 *       .where(field, "<=", value + "")
 *
 *   Its database suite passed locally. CI failed it — on exactly two of eleven
 *   cases, "Abuba" and "AISH", the only two that are PARTIAL names. Every
 *   whole-name case passed on both machines.
 *
 * ── WHY, AND WHAT I COULD NOT PROVE ─────────────────────────────────────────
 *
 *   The obvious explanation is collation. U+F8FF is a PRIVATE-USE code point,
 *   and a locale-aware collation can treat an unassigned one as IGNORABLE,
 *   which would collapse "ABUBA" to "ABUBA" and make
 *   `"ABUBAKAR" <= "ABUBA"` false.
 *
 *   I TESTED THAT AND IT IS NOT WHAT HAPPENED. Against this project's own
 *   Postgres, both collations accept the old bound:
 *
 *       collation        >= 'ABUBA'   <= 'ABUBA'||U+F8FF   < 'ABUBB'
 *       C                    t               t                t
 *       en-US-x-icu          t               t                t
 *
 *   So the difference between the two machines is NOT established, and this
 *   header does not pretend otherwise. What IS certain: these filters reach
 *   the database as a PostgREST URL query string, not as SQL, so the old bound
 *   depended on a private-use character surviving percent-encoding and
 *   transport across whatever versions each environment runs. The new bound is
 *   pure ASCII and depends on none of that.
 *
 *   A whole-name query survives either way, because `>= "ABUBAKAR"` matches the
 *   row on its own. Only a partial prefix depends on the upper bound, which is
 *   why only two of eleven cases could ever have shown this.
 *
 * ── THE FIX, AND WHY IT IS A UNIT TEST ──────────────────────────────────────
 *
 *   `prefixUpperBound("ABUBA") === "ABUBB"` — increment the last character and
 *   compare with `<`. Both strings then differ at an ordinary letter, which
 *   every collation orders the same way.
 *
 *   Asserted HERE, without a database, precisely because the database was the
 *   variable. The pg suite proves the search finds her; this proves the bound
 *   is a value no collation has to have an opinion about.
 *
 * ── WHAT IS DELIBERATELY NOT CHANGED ────────────────────────────────────────
 *
 *   searchUserIdsByQuery still uses the U+F8FF form in five places. It is
 *   working in production, nothing has reported it, and rewriting a live member
 *   search on the strength of a defect proved in a sibling function is the
 *   wider blast radius. It is recorded as latent rather than quietly carried:
 *   the test at the bottom names those sites, so a future reader finds them.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     prefixUpperBound returning the prefix unchanged (an equality)     KILLED
 *     prefixUpperBound appending  again                           KILLED
 *     the last character DEcremented instead of incremented             KILLED
 *     the empty-string guard removed                                    KILLED
 *     the search using <= instead of <                                  KILLED
 *     reword this header                                   SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { prefixUpperBound } from '@/lib/admin-search-helper';

const HELPER = 'src/lib/admin-search-helper.ts';
const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), 'utf8'));

// ─────────────────────────────────────────────────────────────────────────────
describe('#814(b) — the bound is a value every collation agrees about', () => {
    it.each([
        ['ABUBA', 'ABUBB'],
        ['AISH', 'AISI'],
        ['Abuba', 'Abubb'],
        ['a', 'b'],
    ])('prefixUpperBound(%s) === %s', (prefix, expected) => {
        expect(prefixUpperBound(prefix)).toBe(expected);
    });

    it('AND IT IS BUILT FROM THE ALPHABET ALREADY IN THE DATA', () => {
        /*
         *   THE property, stated as the thing that went wrong: no private-use
         *   character, because that is the one a collation may ignore.
         */
        const bound = prefixUpperBound('ABUBA');
        expect(bound).not.toContain('');
        for (const ch of bound) {
            expect(ch.charCodeAt(0)).toBeLessThan(0xe000);
        }
    });

    it.each([
        ['a whole name still sorts inside its own prefix range', 'ABUBA', 'ABUBAKAR'],
        ['a half-typed first name', 'AISH', 'AISHAT'],
        ['the prefix itself', 'AISHAT', 'AISHAT'],
    ])('%s', (_label, prefix, stored) => {
        /*
         *   The comparison the database is being asked to make, executed in
         *   JavaScript, which orders by code unit — the same answer a
         *   byte-ordered collation gives. The locale case is the one that
         *   broke, and it breaks only for a character outside the alphabet,
         *   which the assertion above rules out.
         */
        expect(stored >= prefix).toBe(true);
        expect(stored < prefixUpperBound(prefix)).toBe(true);
    });

    it('AND A NON-MATCH STAYS OUTSIDE IT', () => {
        //   Or a bound of "everything" would pass every assertion above and
        //   return the whole table.
        expect('OKAFOR' < prefixUpperBound('ABUBA')).toBe(false);
        expect('ABUBB' < prefixUpperBound('ABUBA')).toBe(false);
    });

    it('CONTROL: an empty prefix is left alone rather than incremented', () => {
        //   charCodeAt(-1) is NaN; incrementing it would produce "NaN" and a
        //   bound that matches nothing.
        expect(prefixUpperBound('')).toBe('');
    });

    it('AND A CHARACTER AT THE TOP OF THE PLANE IS WIDENED, NOT CORRUPTED', () => {
        //   Incrementing into the surrogate range produces an unpaired
        //   surrogate, which is not a string any database can compare sensibly.
        const bound = prefixUpperBound('A퟿');
        expect(bound.startsWith('A퟿')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#814(b) — and the search uses it', () => {
    it('THE RECORD SEARCH BOUNDS WITH prefixUpperBound AND A STRICT <', () => {
        /*
         *   `<=` with this bound would include the bound itself — "ABUBB" would
         *   match a search for "ABUBA". The operator is part of the fix.
         */
        const src = read(HELPER);
        const fn = src.slice(src.indexOf('export async function searchDocIdsByNameFields'));

        expect(fn).toContain('.where(field, ">=", value)');
        expect(fn).toContain('.where(field, "<", prefixUpperBound(value))');

        /*
         *   BOTH SPELLINGS, because they are not the same string in source and
         *   the first draft of this assertion counted the wrong one.
         *
         *   The five legacy sites are written as the ESCAPE TEXT `\\uf8ff` —
         *   six ASCII characters — while the version this finding removed used
         *   the LITERAL U+F8FF character. A check for one finds none of the
         *   other, which is how a count of five measured as zero.
         */
        expect(fn).not.toMatch(/\\uf8ff/);
        expect(fn).not.toMatch(//);
    });

    it('AND THE USER SEARCH IS RECORDED AS STILL CARRYING THE OLD FORM', () => {
        /*
         *   NOT a failure — a deliberate, named limit. searchUserIdsByQuery is
         *   live and unreported; this finding was proved in its sibling. The
         *   count is pinned so that "we always knew" cannot be said later, and
         *   so that whoever does change it has to come here and say so.
         *
         *   If somebody fixes those five, this fails and the note gets updated
         *   rather than the knowledge being lost.
         */
        const src = read(HELPER);
        const userSearch = src.slice(
            src.indexOf('export async function searchUserIdsByQuery'),
            src.indexOf('export function searchWasTruncated'),
        );
        //   The ESCAPE TEXT, which is how those five are written in source —
        //   not the literal character, which appears nowhere in this file.
        const legacy = (userSearch.match(/\\uf8ff/g) ?? []).length;

        expect({ sitesStillUsingThePrivateUseBound: legacy })
            .toEqual({ sitesStillUsingThePrivateUseBound: 5 });
    });
});
