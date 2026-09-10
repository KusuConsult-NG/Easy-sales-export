/**
 *   #605 SIXTY-FIVE PLACES CALLED `new Date(x).toLocaleDateString()`, AND THIS
 *        CODEBASE STORES DATES IN FOUR SHAPES.
 *
 *   #597 replaced seven hand-built `Intl.DateTimeFormat` helpers because
 *   `Intl.DateTimeFormat.prototype.format` THROWS on an Invalid Date and a
 *   member screen went blank. It did not touch the far commoner spelling:
 *
 *       {new Date(order.createdAt).toLocaleDateString()}
 *
 *   `Date.prototype.toLocaleDateString` does not throw. It returns the literal
 *   string "Invalid Date". THAT IS THE ONLY REASON THIS SURVIVED A COMMIT WHOSE
 *   WHOLE SUBJECT WAS DATE FORMATTING — nothing fell over, so nothing pointed at
 *   it. A quiet wrong answer outlives a loud one.
 *
 * ── AND IT IS NOT A FALLBACK PROBLEM, IT IS A READING PROBLEM ───────────────
 *
 *   `new Date(x)` understands an ISO string and a number and nothing else. This
 *   codebase stores dates in four shapes, and every one of them appears on a
 *   client screen:
 *
 *       a live Firestore Timestamp with `.toDate()`
 *       a plain `{ seconds, nanoseconds }` object
 *       an admin-side `{ _seconds }` that lost its methods crossing the boundary
 *       an ISO string, which is what `serializeValue` produces
 *
 *   So these sites were not merely failing to guard an absent date. Handed any
 *   of the first three, they were printing "Invalid Date" to a person, next to a
 *   real value they could have shown.
 *
 * ── FIVE THAT ARE WORSE THAN A BAD DATE ────────────────────────────────────
 *
 *   /farm-nation/inquiries/[id]   "Date Received" said N/A, ALWAYS, on every
 *                                 inquiry that has ever loaded. The screen tests
 *                                 `inquiry.createdAt?.seconds` and the action
 *                                 returns `serializeValue(...)`, so the field is
 *                                 an ISO string and the test is false every time.
 *                                 SellerDashboardClient carries a comment saying
 *                                 exactly this, about exactly this mistake, fixed
 *                                 there and nowhere else.
 *
 *   /dashboard/notifications      a local copy of `toDate` whose "I cannot tell"
 *                                 answer is `new Date()`, feeding
 *                                 `formatDistanceToNow`. A notification with no
 *                                 usable date read "less than a minute ago" — a
 *                                 confident wrong answer, not a blank one.
 *
 *   /dashboard/disputes           the second copy of that same local `toDate`. A
 *                                 dispute whose date did not arrive was shown as
 *                                 opened TODAY, on the screen where both parties
 *                                 argue about how long it has been sitting.
 *
 *   /admin/farm-nation/applications  `let date = new Date()` before a four-line
 *                                 shape ladder, so an application with no
 *                                 submittedAt was listed as SUBMITTED TODAY on
 *                                 the queue where staff decide what is overdue.
 *                                 Its CSV export also still read `a.data` and
 *                                 `a.user` raw — the join fault #602 fixed in
 *                                 this same file's table and not in its export.
 *
 *   academy enrolled-courses      `new Date((progress.startedAt as Timestamp)
 *                                 .toDate())`. A cast is not a runtime check;
 *                                 `.toDate` exists on a Timestamp and on nothing
 *                                 else, so a startedAt that arrived as a string
 *                                 threw "toDate is not a function" and took the
 *                                 whole action down.
 *
 *   Three of those five answer "now" when they mean "unknown" — the elapsed-time
 *   lie `toDateOrNull` was written for and warns about in its own note, after
 *   reviews.ts made every review permanently editable that way.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import {
    formatDateOrDash,
    formatShortDateOrDash,
    formatDateTimeOrDash,
    formatTimeOrDash,
    toDateOrNull,
} from '@/lib/date-utils';

/** The four shapes, all meaning the same instant. */
const INSTANT = Date.UTC(2026, 2, 14, 9, 30);
const SHAPES: [string, unknown][] = [
    ['an ISO string', new Date(INSTANT).toISOString()],
    ['a number', INSTANT],
    ['a Date', new Date(INSTANT)],
    ['a live Timestamp', { toDate: () => new Date(INSTANT) }],
    ['a plain { seconds }', { seconds: INSTANT / 1000, nanoseconds: 0 }],
    ['an admin { _seconds }', { _seconds: INSTANT / 1000 }],
];

describe('#605 — one reading, and it knows every shape this codebase stores', () => {
    it.each(SHAPES)('READS %s', (_name, value) => {
        //   The whole finding in one assertion: `new Date(value)` renders three of
        //   these six as "Invalid Date".
        expect(formatShortDateOrDash(value)).toBe('14/03/2026');
    });

    it('AND `new Date(x)` REALLY DOES FAIL ON THREE OF THEM — THE CONTROL FOR THE ABOVE', () => {
        //   Without this, the test above would pass just as well against a reader
        //   that only ever handled ISO strings, because the ISO case dominates the
        //   list. This states what the old spelling actually did.
        const broken = SHAPES
            .filter(([, v]) => new Date(v as any).toString() === 'Invalid Date')
            .map(([name]) => name);
        expect(broken).toEqual(['a live Timestamp', 'a plain { seconds }', 'an admin { _seconds }']);
    });

    it('AND THERE IS NO DATE, IT SAYS SO RATHER THAN GUESSING', () => {
        for (const nothing of [null, undefined, '', 'not a date', {}, NaN, [] as unknown]) {
            expect(formatShortDateOrDash(nothing)).toBe('—');
            expect(formatDateTimeOrDash(nothing)).toBe('—');
            expect(formatTimeOrDash(nothing)).toBe('—');
            expect(formatDateOrDash(nothing)).toBe('—');
        }
    });

    it('AND IT NEVER ANSWERS "NOW" FOR "UNKNOWN" — THE LIE THAT MADE THIS WORTH DOING', () => {
        //   `toDate` falls back to the current moment, which is right for a label
        //   and catastrophic for an age. Three screens used a local copy of it for
        //   an age. `toDateOrNull` is the one these formatters are built on.
        expect(toDateOrNull(undefined)).toBeNull();
        expect(toDateOrNull('')).toBeNull();
        expect(toDateOrNull('not a date')).toBeNull();
        //   And a real value still comes back, or the guard above would be a
        //   formatter that never formats.
        expect(toDateOrNull(new Date(INSTANT).toISOString())?.getTime()).toBe(INSTANT);
    });

    it('A CALLER MAY CHOOSE ITS OWN WORD FOR "NO DATE"', () => {
        //   The inquiry screen keeps "N/A" and the CSV exports keep "" — the sweep
        //   preserved each site's existing wording rather than imposing a dash.
        expect(formatDateTimeOrDash(null, 'N/A')).toBe('N/A');
        expect(formatShortDateOrDash(null, '')).toBe('');
    });

    it('AND ITS OWN LOCALE, BECAUSE CHANGING ONE IS A PRODUCT DECISION', () => {
        //   Certificates read "March 14, 2026" and always have. Making them read
        //   "14 March 2026" would be a visible change to a document members
        //   download, and does not belong in a defect fix.
        const opts = { month: 'long', day: 'numeric', year: 'numeric' } as const;
        expect(formatDateOrDash(INSTANT, opts, '—', 'en-US')).toBe('March 14, 2026');
        expect(formatDateOrDash(INSTANT, opts, '—', 'en-NG')).toBe('14 March 2026');
    });
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE CAP. `new Date(x).toLocaleDateString()` is gone from src, and stays gone.
 *
 * Stated as a search rather than a list of files, because the defect is the
 * SPELLING: any new one is the same defect however it is named. `new Date()`
 * with no argument is the current moment and is not this.
 *
 * SCOPED TO SHIPPED CODE. The test tree is excluded because this very file
 * quotes the defect four times in its own header, and a cap that trips over its
 * own description of what it caps is a cap nobody will keep. The exclusion is
 * narrow and it is the reason the vacuity guard below exists: with the test tree
 * out, an empty answer has to be shown to mean "none left" rather than "nothing
 * searched".
 */
function sitesMatching(methodPattern: string): string[] {
    let out = '';
    try {
        out = execSync(
            String.raw`grep -rn "new Date([^)]" src --include=*.tsx --include=*.ts | ` +
            `grep -E ${JSON.stringify(methodPattern)} || true`,
            { encoding: 'utf8', cwd: process.cwd() },
        );
    } catch {
        out = '';
    }
    return out
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        //   date-utils is where the reading lives; it is allowed to build a Date.
        .filter(l => !l.startsWith('src/lib/date-utils.ts:'))
        .filter(l => !l.startsWith('src/__tests__/'));
}

const RAW_FORMATTER = String.raw`\.toLocale(Date|Time)?String`;

describe('#605 — the spelling does not come back', () => {
    it('NO FILE IN src FORMATS A DATE BY CALLING toLocale* ON A RAW `new Date(x)`', () => {
        expect(sitesMatching(RAW_FORMATTER)).toEqual([]);
    });

    it('VACUITY GUARD: THE SAME SEARCH, AGAINST A SPELLING THAT IS STILL THERE', () => {
        //   THE GUARD HAS TO GO THROUGH THE SAME FUNCTION, and the first version of
        //   it did not: it ran a grep of its own, so a `sitesMatching` that returned
        //   [] unconditionally passed both tests. The mutant that stubbed it out
        //   SURVIVED, which is how this was found — a ratchet whose vacuity guard
        //   cannot fail is two checks that cannot fail, not one.
        //
        //   `new Date(x).toISOString()` is a spelling this sweep deliberately did
        //   NOT remove: it serialises rather than displays, so it is correct where
        //   it appears. That makes it the right positive control — real code, still
        //   present, found by the same call.
        expect(sitesMatching(String.raw`\.toISOString`).length).toBeGreaterThan(0);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     toDateOrNull: drop the `_seconds` branch                       KILLED
 *     toDateOrNull: drop the `seconds` branch                        KILLED
 *     toDateOrNull: drop the `toDate()` branch                       KILLED
 *     toDateOrNull: return `new Date()` instead of null              KILLED
 *     formatDateOrDash: ignore the `locale` argument                 KILLED
 *     formatDateOrDash: ignore the `fallback` argument               KILLED
 *     formatShortDateOrDash: 2-digit month → long month              KILLED
 *     one swept site put back to `new Date(x).toLocaleDateString()`  KILLED (the
 *                   cap, which is why it is a search and not a list of files)
 *     sitesMatching: return [] unconditionally                       KILLED
 *     sitesMatching: ignore the pattern it was given                 KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   THE STUB-IT-OUT MUTANT SURVIVED THE FIRST ROUND, AND THAT IS THE ENTRY WORTH
 *   READING. The cap ran one grep and its vacuity guard ran a DIFFERENT one, so
 *   a `rawDateFormatters` that always answered [] passed both — the ratchet and
 *   the check on the ratchet were each vacuous, independently. The guard now goes
 *   through the same function with a pattern that must match. #441's rule was
 *   written for exactly this and I still had to be shown it by a mutant.
 */
