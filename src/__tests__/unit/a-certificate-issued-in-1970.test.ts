/**
 *   #608 THE EPOCH IS THIS CODEBASE'S WORD FOR "UNKNOWN", AND SCREENS READ IT
 *        ALOUD AS 1 JANUARY 1970.
 *
 *   `the-last-seeded-screen.test.tsx` named three questions the bare-row probe
 *   does not answer: a field of the wrong type (#606), a negative amount (#607),
 *   and A DATE FROM 1970. This is the third, and the answer is not the one I
 *   expected — nothing here computes a 1970 date by accident. It is written on
 *   purpose, eight times, as a sentinel:
 *
 *       createdAt: safeToISOString(data.createdAt, new Date(0).toISOString()),
 *       issuedAt: … ?? new Date(0).toISOString(),
 *
 *   That is a CORRECT choice for ORDERING. A descending sort puts the epoch
 *   last, which is where an undated row belongs, and the certificates reader
 *   even records why it was preferred to the obvious alternative:
 *
 *       // Only when the row genuinely carries no date. Defaulting to
 *       // "now" silently made every certificate look freshly issued.
 *
 *   Right about "now", and nobody followed the value to the screen. The same
 *   string is handed to the client and rendered by an ordinary date formatter,
 *   so a certificate with no issue date reads "Issued 01/01/1970" and a user
 *   with no createdAt joined this platform in 1970.
 *
 *   A SENTINEL IS A VALUE THAT MEANS "NO VALUE". It is right in the comparison
 *   it was chosen for and wrong everywhere it is read as itself, and nothing in
 *   the code separated those two uses.
 *
 * ── AND THE TWO COMPOUND, WHICH IS HOW IT REACHES REAL ROWS ────────────────
 *
 *   `safeToISOString` — the shared reader those fallbacks are passed to — knew
 *   TWO of the four shapes this codebase stores. It was
 *   `val.toDate?.() ?? new Date(val)`, so a `{ seconds }` or `{ _seconds }`
 *   object made an Invalid Date and it returned THE FALLBACK — the epoch — for a
 *   date sitting right there in the row.
 *
 *   `{ _seconds }` is not exotic. It is what an admin-side Timestamp becomes
 *   once it has crossed the server boundary, and the ordinary shape of a date
 *   stored in JSONB. So this is not "an undated row shows 1970"; it is "a dated
 *   row shows 1970".
 *
 *   #605 found sixty-five DISPLAY sites not using `toDateOrNull`. These are the
 *   two SERIALISING ones, and they are the two whose callers hand them a
 *   sentinel — so the cost was not a dash, it was a confident wrong date.
 *
 * ── AND WHERE THE SAME BLIND SPOT THROWS ───────────────────────────────────
 *
 *   `.toISOString()` on an Invalid Date THROWS a RangeError; `.toLocaleDateString()`
 *   returns the string "Invalid Date". #605 swept the spelling that does not
 *   throw. Two sites built a Date the same two-shape way and then serialised it:
 *
 *     wave earnings     `new Date(escrow.createdAt ?? Date.now())`, then
 *                       `t.date.toISOString()` twelve lines later. One escrow row
 *                       whose createdAt crossed as `{ _seconds }` took down the
 *                       whole earnings action — no balance, no transactions, no
 *                       page.
 *     content approval  the same, three times in one file, on the queue where
 *                       staff approve submissions.
 *
 *   Both also read `?? Date.now()`, dating an undated row TODAY — the elapsed-time
 *   lie `toDateOrNull` exists to prevent, and the very thing the certificates
 *   comment above warns against, two files away.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { execSync } from 'child_process';
import {
    safeToISOString,
    safeToISOStringOptional,
    formatShortDateOrDash,
    formatDateOrDash,
    isUnknownDate,
    UNKNOWN_DATE_ISO,
} from '@/lib/date-utils';

const INSTANT = Date.UTC(2026, 2, 14, 9, 30);

describe('#608 — a date the reader could have read is not the epoch', () => {
    it.each([
        ['a live Timestamp', { toDate: () => new Date(INSTANT) }],
        ['a plain { seconds }', { seconds: INSTANT / 1000 }],
        ['an admin { _seconds }', { _seconds: INSTANT / 1000 }],
        ['an ISO string', new Date(INSTANT).toISOString()],
        ['a number', INSTANT],
        ['a Date', new Date(INSTANT)],
    ])('safeToISOString READS %s RATHER THAN FALLING BACK', (_n, value) => {
        expect(safeToISOString(value, UNKNOWN_DATE_ISO)).toBe(new Date(INSTANT).toISOString());
        expect(safeToISOStringOptional(value)).toBe(new Date(INSTANT).toISOString());
    });

    it('AND THE OLD READER REALLY DID FALL BACK ON TWO OF THEM — THE CONTROL', () => {
        //   The shipped code, run as it ran. Without this the tests above would
        //   pass just as well against a reader that was never broken.
        const old = (val: any) => {
            if (!val) return 'FALLBACK';
            const d = val.toDate && typeof val.toDate === 'function' ? val.toDate() : new Date(val);
            return isNaN(d.getTime()) ? 'FALLBACK' : d.toISOString();
        };
        expect(old({ seconds: INSTANT / 1000 })).toBe('FALLBACK');
        expect(old({ _seconds: INSTANT / 1000 })).toBe('FALLBACK');
        //   And it handled the two it knew, which is why it looked finished.
        expect(old(new Date(INSTANT).toISOString())).toBe(new Date(INSTANT).toISOString());
        expect(old({ toDate: () => new Date(INSTANT) })).toBe(new Date(INSTANT).toISOString());
    });

    it('A ROW THAT GENUINELY CARRIES NO DATE STILL GETS THE SENTINEL', () => {
        //   The sort still needs it. This is not a change to ordering.
        for (const nothing of [null, undefined, '', 'not a date', {}]) {
            expect(safeToISOString(nothing, UNKNOWN_DATE_ISO)).toBe(UNKNOWN_DATE_ISO);
            //   THE CALLER'S fallback, not the sentinel. Every other test here
            //   passes UNKNOWN_DATE_ISO, so a version that ignored the argument and
            //   always returned the sentinel passed all of them — a mutant that did
            //   exactly that SURVIVED the first round.
            expect(safeToISOString(nothing, 'CALLER SAID THIS')).toBe('CALLER SAID THIS');
        }
        expect(safeToISOStringOptional(null)).toBeUndefined();
    });
});

describe('#608 — and the sentinel is not shown to a person', () => {
    it('THE EPOCH RENDERS AS "NO DATE", NOT AS 1 JANUARY 1970', () => {
        expect(formatShortDateOrDash(UNKNOWN_DATE_ISO)).toBe('—');
        expect(formatShortDateOrDash(0)).toBe('—');
        expect(formatShortDateOrDash(new Date(0))).toBe('—');
        expect(formatShortDateOrDash({ _seconds: 0 })).toBe('—');
        expect(formatDateOrDash(UNKNOWN_DATE_ISO)).toBe('—');
    });

    it('AND IT USED TO RENDER AS A DATE — THE CONTROL', () => {
        //   What a member saw on a certificate card with no issue date.
        expect(new Date(UNKNOWN_DATE_ISO).toLocaleDateString('en-NG')).toContain('1970');
    });

    it('A CALLER MAY STILL CHOOSE ITS OWN WORD FOR IT', () => {
        expect(formatShortDateOrDash(UNKNOWN_DATE_ISO, 'Unknown')).toBe('Unknown');
    });

    it('AND A REAL DATE IS UNTOUCHED, INCLUDING ONE THE DAY AFTER THE EPOCH', () => {
        //   The boundary this trade draws, stated as a test rather than a hope:
        //   one second is unknown, one day is a date. Nothing this platform
        //   records predates 2024, so the cost is theoretical and the benefit is
        //   on every screen.
        expect(formatShortDateOrDash(INSTANT)).toBe('14/03/2026');
        expect(formatShortDateOrDash(new Date(86_400_000))).toBe('02/01/1970');
        expect(isUnknownDate(new Date(86_400_000))).toBe(false);
        //   STRICTLY INSIDE a wider window, not on its edge. 86,400,000 is exactly
        //   one day, so a mutant widening the window to `< 86400000` left the
        //   assertion above true and SURVIVED. One hour past the epoch is a real
        //   instant under the rule as written and unknown under that mutant.
        expect(isUnknownDate(new Date(3_600_000))).toBe(false);
        expect(formatShortDateOrDash(new Date(3_600_000))).toBe('01/01/1970');
        //   And the far side of the boundary, so this is a window and not a floor.
        expect(isUnknownDate(new Date(-500))).toBe(true);
        //   And through the FORMATTER too, which is a different function and used
        //   to carry its own copy of this condition.
        expect(formatShortDateOrDash(new Date(-500))).toBe('—');
        expect(isUnknownDate(0)).toBe(true);
        expect(isUnknownDate(999)).toBe(true);
        expect(isUnknownDate(null)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

function sourceMatches(pattern: string): string[] {
    let out = '';
    try {
        out = execSync(
            `grep -rnE ${JSON.stringify(pattern)} src --include=*.ts --include=*.tsx || true`,
            { encoding: 'utf8', cwd: process.cwd() },
        );
    } catch {
        out = '';
    }
    return out.split('\n').map(l => l.trim()).filter(Boolean)
        .filter(l => !l.startsWith('src/lib/date-utils.ts:'))
        .filter(l => !l.startsWith('src/__tests__/'))
        //   The fake db mirrors Firestore's own serialisation and is not a reader.
        .filter(l => !l.startsWith('src/lib/testing/'));
}

describe('#608 — the sentinel is named wherever it is written', () => {
    it('NO FILE WRITES THE SENTINEL BY HAND', () => {
        //   Narrow on purpose. `new Date(0)` also means "already expired" on a
        //   cookie — auth.ts sets it three times to delete one — and that is the
        //   HTTP convention, not this codebase's word for "no date". A cap that
        //   dragged it in would be a cap somebody deletes.
        expect(sourceMatches('new Date\\(0\\)\\.toISOString\\(\\)')).toEqual([]);
        expect(sourceMatches('\\|\\| new Date\\(0\\)')).toEqual([]);
    });

    it('VACUITY GUARD: THE SAME SEARCH, AGAINST A SPELLING THAT IS STILL THERE', () => {
        //   #607's lesson: sharing the FUNCTION proves the search reaches the
        //   tree, not that the pattern finds anything — that file's cap used
        //   `\\s` inside `grep -E`, matched nothing, and passed. So this guard
        //   uses a pattern of the same SHAPE as the cap's, escaped parens and
        //   all, rather than a simpler one that would dodge the same mistake.
        expect(sourceMatches('UNKNOWN_DATE_ISO').length).toBeGreaterThan(0);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     safeToISOString: back to `val.toDate?.() ?? new Date(val)`     KILLED
 *     safeToISOString: ignore the caller's fallback                  KILLED
 *     safeToISOStringOptional: epoch instead of undefined            KILLED
 *     formatDateOrDash: skip the unknown-date rule                   KILLED
 *     isUnknownDate: window 1000ms → one day                         KILLED
 *     isUnknownDate: one-sided (`>= 0 &&`) instead of Math.abs       KILLED
 *     isUnknownDate: true for null                                   KILLED
 *     a sentinel site written out by hand again                      KILLED (cap)
 *     sourceMatches: return [] unconditionally                       KILLED
 *     sourceMatches: ignore the pattern it was given                 KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   THREE SURVIVED THE FIRST ROUND AND EACH ONE WAS A GAP WORTH THE ROUND:
 *
 *     Every test passed `UNKNOWN_DATE_ISO` as the fallback, so a reader that
 *     ignored the argument and always returned the sentinel passed all of them.
 *     One assertion with a caller-chosen word fixed it.
 *
 *     The window mutant widened 1000ms to one day and my boundary case was
 *     86,400,000 — EXACTLY one day, so `< 86400000` left it true. A case
 *     strictly inside the widened window was needed, not one on its edge.
 *
 *     The last was structural, and in my own code. The epoch rule was written
 *     TWICE — inline in `formatDateOrDash` and again in `isUnknownDate` — so a
 *     mutant making only one copy one-sided left the other correct and every
 *     test green. TWO HAND-MAINTAINED COPIES OF ONE CONTRACT is the defect this
 *     audit keeps finding in other people's code, and I had just written it. The
 *     formatter calls `isUnknownDate` now, so there is one rule to attack.
 */
