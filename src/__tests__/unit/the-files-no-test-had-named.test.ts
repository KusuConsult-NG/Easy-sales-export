/**
 * @jest-environment node
 */

/**
 *   THE OWNER: "in terms of %, how many perfect is left in the entire app to
 *   be audited" — and then "fix all the 137 files".
 *
 * ── THE DENOMINATOR WAS THE HARD PART, AND IT WAS SITTING THERE ─────────────
 *
 *   Twice in this audit the answer to "how much is left" has been "there is no
 *   denominator". #436 already showed that to be a dodge: it asked the same
 *   question about coverage, found `collectCoverageFrom` naming three roots out
 *   of eight, and the missing ones held every API route on the platform.
 *
 *   The filesystem is the denominator. Every shipping .ts/.tsx under src/ is a
 *   thing that can be wrong, and the honest numerator for "has anybody looked
 *   at this" is whether ANY test names the file — by import specifier or by
 *   repo path. This codebase's audit is source-assertion heavy, so a test that
 *   names a file is the cheapest true signal that somebody read it.
 *
 *   Measured: 1,272 shipping files, 137 named by no test at all.
 *
 * ── WHY THIS IS A LEDGER AND NOT A THRESHOLD ────────────────────────────────
 *
 *   Being named by a test is not being correct, and pretending otherwise is how
 *   #74's 70%-against-32% happened. What this number honestly measures is
 *   REACH: which parts of the application the audit has not visited even once.
 *   A file on this list has had nothing said about it by anybody.
 *
 *   It is a ledger, in the shape #743 settled: a ceiling absorbs progress
 *   silently — four of eighty-eight get converted, the ceiling stays at
 *   eighty-eight, and four NEW ones can appear with every test green.
 *   ledgerVerdict reports the improvement and asks for it to be recorded.
 *
 * ── WHAT IS EXEMPT, AND WHY ONLY THIS ───────────────────────────────────────
 *
 *   `.d.ts` files, and nothing else. A type declaration has no runtime: there
 *   is no behaviour for a test to name, and "cover the shim that declares
 *   firebase-admin's types" is ceremony that would make this number look better
 *   without anybody having looked at anything. Twelve of the files are these.
 *
 *   Everything else stays in — including the tiny layouts, the static legal
 *   pages and the developer scripts — because each of them is code that ships
 *   or runs, and several findings in this audit have been exactly that: a
 *   two-line layout with the wrong guard, a page whose only job was a redirect
 *   that went to the wrong place.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ledgerVerdict, LEDGER_HELD } from '@/lib/testing/ledger';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry !== 'node_modules') walk(full, out);
        } else if (/\.tsx?$/.test(full)) {
            out.push(full);
        }
    }
    return out;
}

const isTest = (f: string) => /__tests__|\.test\./.test(f);

/** A type declaration has no runtime — see the header. */
const isTypeOnly = (f: string) => f.endsWith('.d.ts');

/**
 * Computed once.
 *
 * The sweep reads every test file in the repository and joins them, which is
 * ~5 seconds. Calling it per assertion took this one file to a minute of the
 * suite's runtime — a test that is slow for no reason is a test somebody
 * eventually excludes.
 */
let cached: string[] | null = null;

function unreached(): string[] {
    if (cached) return cached;
    const all = walk(join(ROOT, 'src'));
    const corpus = [...all.filter(isTest), ...walk(join(ROOT, 'e2e'))]
        .map((f) => readFileSync(f, 'utf8'))
        .join('\n');

    const result = all
        .filter((f) => !isTest(f) && !isTypeOnly(f))
        .filter((f) => {
            const rel = relative(ROOT, f);
            const noExt = rel.replace(/\.tsx?$/, '');
            //   Either spelling a test would use: the repo path, or the `@/`
            //   import alias. A bare mention of the MODULE name is deliberately
            //   not enough — `lib/claim-outcome` appearing in a comment is what
            //   made that module look covered while nothing imported it.
            return !(corpus.includes(rel)
                || corpus.includes(noExt)
                || corpus.includes('@/' + noExt.replace(/^src\//, '')));
        })
        .map((f) => relative(ROOT, f))
        .sort();

    cached = result;
    return result;
}

describe('how much of the application no test has named', () => {
    it('THE SWEEP IS READING THE APPLICATION', () => {
        //   THE control, first. Every assertion below is about a list, and an
        //   empty or tiny list agrees with almost any expectation about it.
        const all = walk(join(ROOT, 'src'));

        expect(all.filter((f) => !isTest(f)).length).toBeGreaterThan(1_000);
        expect(all.filter(isTest).length).toBeGreaterThan(500);
    });

    it('AND IT FINDS A FILE THAT IS GENUINELY NAMED (control)', () => {
        //   The other half of the guard: a matcher that never matched would
        //   report every file as unreached and the ledger would read as a
        //   catastrophe rather than as a measurement.
        expect(unreached()).not.toContain('src/lib/export-returns.ts');
        expect(unreached()).not.toContain('src/lib/price-reduction.ts');
    });

    it('THE LEDGER — files with runtime that no test names', () => {
        /*
         *   This may only go DOWN. Reaching one costs a one-line edit here that
         *   RECORDS it, which is the whole of #743's argument against a ceiling.
         *
         *   Lowered from 128 as the first pass off the 137: lib/claim-outcome,
         *   write-guard, wave-resource-access, academy-purchased-courses,
         *   bounced-address, notice-email-address, cooperative-member-identity,
         *   postgrest-filters and server-seed. Two of the nine were not merely
         *   unnamed — claim-outcome's own header claimed a test asserted its
         *   constant against both writers and none did, and
         *   wave-resource-access gated admins on the session token beside a
         *   database row it was already reading.
         */
        expect(ledgerVerdict(unreached().length, 116)).toBe(LEDGER_HELD);
    });

    it('AND THE MONEY AND IDENTITY RULES ARE OFF IT', () => {
        //   Named individually because these are the ones where being unread
        //   costs somebody money or access, so they must not drift back on.
        for (const rel of [
            'src/lib/claim-outcome.ts',
            'src/lib/write-guard.ts',
            'src/lib/wave-resource-access.ts',
            'src/lib/academy-purchased-courses.ts',
            'src/lib/bounced-address.ts',
            'src/lib/cooperative-member-identity.ts',
            'src/lib/postgrest-filters.ts',
            'src/lib/server-seed.ts',
            'src/lib/notice-email-address.ts',
        ]) {
            expect({ rel, unreached: unreached().includes(rel) })
                .toEqual({ rel, unreached: false });
        }
    });
});
