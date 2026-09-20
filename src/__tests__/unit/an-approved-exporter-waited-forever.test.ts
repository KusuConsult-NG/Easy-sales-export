/**
 * @jest-environment node
 */

/**
 *   #799 AN APPROVED EXPORTER SAT ON "APPLICATION UNDER REVIEW" FOREVER.
 *
 *   /export/onboarding/pending polls getMyApplicationStatus and redirects to
 *   /export/dashboard when the answer is "approved". It asks for
 *
 *       COLLECTIONS.EXPORT_APPLICATIONS : "status"
 *       → "export_onboarding_applications:status"
 *
 *   and that key was not in APPLICATION_QUERIES. Four entries, five screens.
 *
 * ── TRACED, NOT GUESSED ─────────────────────────────────────────────────────
 *
 *     getMyApplicationStatus       no spec → UNKNOWN, and logs
 *                                  "called with an unlisted lookup"
 *     usePendingApplicationStatus  on "unknown" sets checkFailed and RETURNS
 *                                  EARLY — deliberately, so a non-answer
 *                                  cannot overwrite the last real status
 *     status                       never leaves its initial "pending"
 *     the redirect on "approved"   NEVER FIRES
 *
 *   Not intermittent. The lookup could never succeed, so this was every
 *   approved exporter, on every visit, since the allowlist was introduced.
 *   The warning has been printing on every end-to-end run the whole time —
 *   visible in CI output, in a log nobody reads as a failure.
 *
 * ── AND #415 NAMED EXPORT ITSELF ────────────────────────────────────────────
 *
 *   From that finding's own header, still in my-data.ts:
 *
 *       "AND IT DECIDES A REDIRECT. All five pending screens (wave, academy,
 *        export, marketplace, farm-nation) leave the 'Application Under
 *        Review' page on `applicationStatus === "approved"`."
 *
 *   Five named in the prose, four wired in the table. A correct rule applied
 *   to some of the places it names — this audit's most repeated finding, and
 *   the reason the assertion below COUNTS the screens rather than sampling
 *   one. #795 was the same lesson: "does this file contain a guard" is exactly
 *   the shape of test that lets a partial fix look complete.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the export entry removed again (the defect)                      KILLED
 *     the academy entry removed                                        KILLED
 *     the wave entry removed                                           KILLED
 *     the marketplace (seller_verifications) entry removed             KILLED
 *     the farm-nation entry removed                                    KILLED
 *     export mapped to the wrong serviceRegistrations key              KILLED
 *     reword this header                                   SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { COLLECTIONS } from '@/lib/types/firestore';

const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), 'utf8'));

/**
 * Every screen that waits for an application decision, and the lookup it asks
 * for. These are the five #415's header names.
 */
const PENDING_SCREENS: ReadonlyArray<{ module: string; file: string }> = [
    { module: 'export', file: 'src/app/export/onboarding/pending/page.tsx' },
    { module: 'marketplace', file: 'src/app/marketplace/onboarding/pending/page.tsx' },
    { module: 'academy', file: 'src/app/academy/application/pending/page.tsx' },
    { module: 'wave', file: 'src/app/wave/application/review-pending/page.tsx' },
    { module: 'farm-nation', file: 'src/app/farm-nation/onboarding/pending/page.tsx' },
    //   FIVE BECAME SIX. The dashboard built /cooperatives/onboarding/pending
    //   for cooperative members and the route did not exist — a 404 observed
    //   in production, twice in thirty-two seconds from one phone. The screen
    //   was added with its APPLICATION_QUERIES entry in the same change,
    //   because #799 is precisely the finding that a pending screen without
    //   one polls for ever and never redirects an approved applicant.
    { module: 'cooperatives', file: 'src/app/cooperatives/onboarding/pending/page.tsx' },
];

const MY_DATA = 'src/app/actions/my-data.ts';

/** The `COLLECTIONS.X` and statusField a screen passes to the hook. */
function lookupOf(file: string): { collection: string; statusField: string } {
    const src = read(file);
    const block = src.slice(src.indexOf('usePendingApplicationStatus({'));
    const collection = /collectionName:\s*COLLECTIONS\.([A-Z_]+)/.exec(block)?.[1] ?? '';
    const statusField = /statusField:\s*"([^"]+)"/.exec(block)?.[1] ?? '';
    return { collection, statusField };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#799 — every pending screen can actually be answered', () => {
    it('the six screens are real files that still use the hook', () => {
        //   Vacuity guard. Every assertion below is trivially true of a screen
        //   whose file has moved or which no longer polls at all.
        expect(PENDING_SCREENS.length).toBe(6);
        for (const { module, file } of PENDING_SCREENS) {
            expect({ module, polls: read(file).includes('usePendingApplicationStatus({') })
                .toEqual({ module, polls: true });
        }
    });

    it.each(PENDING_SCREENS)('$module\'s lookup IS ON THE ALLOWLIST', ({ module, file }) => {
        /*
         *   THE test, and it is COUNTED per screen rather than sampled.
         *
         *   A lookup missing here does not throw and does not fail a request.
         *   It returns "unknown", the hook swallows it by design, and the
         *   screen waits forever — which is why nothing caught it for so long.
         */
        const { collection, statusField } = lookupOf(file);
        expect({ module, resolved: collection !== '' && statusField !== '' })
            .toEqual({ module, resolved: true });

        const collectionValue = (COLLECTIONS as Record<string, string>)[collection];
        expect({ module, known: typeof collectionValue === 'string' })
            .toEqual({ module, known: true });

        //   The key the action builds, asserted against the table's source.
        const key = `${collectionValue}:${statusField}`;
        const table = read(MY_DATA);
        const start = table.indexOf('const APPLICATION_QUERIES');
        const entries = table.slice(start, table.indexOf('\n};', start));

        //   Keys are written as template literals, so the assertion resolves
        //   the same way the action does rather than matching the source text.
        const listed = new RegExp(
            `\\[\`\\$\\{COLLECTIONS\\.${collection}\\}:${statusField}\`\\]`
        ).test(entries);

        expect({ module, key, listed }).toEqual({ module, key, listed: true });
    });

    it('AND THE TABLE HAS AN ENTRY FOR EVERY SCREEN, not a superset that hides a gap', () => {
        //   The count is the half that made this finding possible: five screens
        //   named in #415's prose, four entries in its table, and nothing
        //   compared the two numbers.
        const table = read(MY_DATA);
        const start = table.indexOf('const APPLICATION_QUERIES');
        const entries = table.slice(start, table.indexOf('\n};', start));
        const count = (entries.match(/\[`\$\{COLLECTIONS\./g) ?? []).length;

        expect({ entries: count, screens: PENDING_SCREENS.length })
            .toEqual({ entries: PENDING_SCREENS.length, screens: PENDING_SCREENS.length });
    });

    it('EXPORT READS THE FIELD EVERY TRANSITION WRITES', () => {
        /*
         *   serviceRegistrations.export.status, not the application row.
         *
         *   Both are written on approval, but only the registration is written
         *   on all four transitions this screen cares about — pending_approval,
         *   approved, rejected, and revision_required, which the page also
         *   redirects on. Picking the row would have fixed "approved" and left
         *   a member told to revise still waiting.
         */
        const table = read(MY_DATA);
        const start = table.indexOf('const APPLICATION_QUERIES');
        const entries = table.slice(start, table.indexOf('\n};', start));
        const exportEntry = entries.slice(entries.indexOf('EXPORT_APPLICATIONS'));

        expect(exportEntry).toMatch(/fromServiceRegistrations:\s*"export"/);
    });

    it('CONTROL: the four that already worked still resolve the same way', () => {
        //   Or this finding would have fixed export by breaking its siblings.
        const table = read(MY_DATA);
        for (const key of ['SELLER_VERIFICATIONS', 'ACADEMY_APPLICATIONS', 'WAVE_APPLICATIONS']) {
            expect({ key, present: table.includes(`\${COLLECTIONS.${key}}:status`) })
                .toEqual({ key, present: true });
        }
        expect(table).toMatch(/fromServiceRegistrations:\s*"farmNation"/);
    });
});
