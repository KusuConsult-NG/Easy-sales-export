/**
 * @jest-environment node
 */

/**
 *   #800 A REFUSED APPLICANT WAS TOLD THEY WERE STILL UNDER REVIEW.
 *
 *   The five "Application Under Review" screens act on the status they poll.
 *   Two of them acted on some of the statuses their own module writes:
 *
 *       export    approved ✓  revision_required ✓  rejected ✗
 *       academy   approved ✓  revision_required ✓  rejected ✗
 *
 *   Both modules set "rejected" — export in the admin refusal path, academy in
 *   _rejectAcademyApplicationAction — and both screens fell through to their
 *   default body: "Application Under Review … currently being reviewed by our
 *   team". Indefinitely, because nothing else ever changes it.
 *
 * ── WHAT MAKES EACH ONE WORSE THAN A MISSING REDIRECT ───────────────────────
 *
 *   EXPORT: /export/onboarding/rejected already existed, and its own header
 *   says "Shown when user's application is rejected". Nothing in the codebase
 *   ever navigated to it. A page written for this exact moment, unreachable
 *   for as long as it has existed.
 *
 *   ACADEMY: the rejection EMAIL tells the learner what to do — a list headed
 *   "What You Can Do" ending in "Re-apply after making necessary
 *   improvements" — and an earlier finding did the work to make re-applying
 *   possible. The screen then gave them nowhere to do it.
 *
 * ── AND IT WAS INVISIBLE UNTIL #799 ─────────────────────────────────────────
 *
 *   While export's lookup was missing from the allowlist, `applicationStatus`
 *   never updated at all, so every branch on that screen was equally dead and
 *   no amount of staring at it would have shown which ones were missing.
 *   Fixing the read is what made the gap in the write visible — and finding
 *   #799 without this would have been a partial fix of exactly the kind this
 *   audit keeps naming.
 *
 * ── THE ASSERTION IS COUNTED, PER MODULE ────────────────────────────────────
 *
 *   Not "does this screen mention rejected" — that is the shape of test that
 *   let #795 and #799 both look complete. Each screen is checked against the
 *   statuses ITS OWN module can produce, so a module that later gains a status
 *   fails here until its screen learns it.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     export's rejected branch removed (the defect)                    KILLED
 *     academy's rejected branch removed (the defect)                   KILLED
 *     export's approved branch removed                                 KILLED
 *     export's revision_required branch removed                        KILLED
 *     academy's revision_required branch removed                       KILLED
 *     wave's rejected handling removed                                 KILLED
 *     farm-nation's rejected branch removed                            KILLED
 *     marketplace's suspended branch removed                           KILLED
 *     reword this header                                   SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), 'utf8'));

/**
 * Each waiting screen, and the statuses its module actually writes.
 *
 *   MEASURED, not assumed. Marketplace is the reason this list is per-module
 *   rather than one shared set: seller verification only ever takes approved,
 *   rejected and suspended — it has no revision_required — so demanding one
 *   would report a screen as broken for not handling a state that cannot
 *   occur. The first draft of this finding nearly did exactly that.
 */
const SCREENS: ReadonlyArray<{ module: string; file: string; statuses: string[] }> = [
    {
        module: 'export',
        file: 'src/app/export/onboarding/pending/page.tsx',
        statuses: ['approved', 'revision_required', 'rejected'],
    },
    {
        module: 'academy',
        file: 'src/app/academy/application/pending/page.tsx',
        statuses: ['approved', 'revision_required', 'rejected'],
    },
    {
        module: 'wave',
        file: 'src/app/wave/application/review-pending/page.tsx',
        statuses: ['approved', 'revision_required', 'rejected'],
    },
    {
        module: 'farm-nation',
        file: 'src/app/farm-nation/onboarding/pending/page.tsx',
        statuses: ['approved', 'revision_required', 'rejected'],
    },
    {
        module: 'marketplace',
        file: 'src/app/marketplace/onboarding/pending/page.tsx',
        statuses: ['approved', 'rejected', 'suspended'],
    },
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#800 — a waiting screen acts on every answer its module can give', () => {
    it('the five screens are real and still poll a status', () => {
        //   Vacuity guard: every assertion below passes trivially against a
        //   file that has moved or stopped polling.
        expect(SCREENS.length).toBe(5);
        for (const { module, file } of SCREENS) {
            expect({ module, polls: read(file).includes('applicationStatus') })
                .toEqual({ module, polls: true });
        }
    });

    it.each(SCREENS)('$module ACTS ON EVERY STATUS ITS MODULE WRITES', ({ module, file, statuses }) => {
        /*
         *   THE test. "Acts on" means the screen names the status somewhere it
         *   can change what the applicant sees — a redirect or a branch. A
         *   screen that never mentions it renders the waiting body instead,
         *   which is the defect.
         */
        const src = read(file);
        const missing = statuses.filter(s => !src.includes(`"${s}"`));

        expect({ module, missing }).toEqual({ module, missing: [] });
    });

    it('EXPORT SENDS A REFUSED APPLICANT TO THE PAGE BUILT FOR THEM', () => {
        //   /export/onboarding/rejected existed and was unreachable. Asserted
        //   by destination, because "mentions rejected" would also be true of
        //   a branch that sent them back to the form they cannot resubmit.
        const src = read('src/app/export/onboarding/pending/page.tsx');
        const branch = src.slice(src.indexOf('"rejected"'));

        expect(branch).toMatch(/\/export\/onboarding\/rejected/);
    });

    it('ACADEMY SENDS A REFUSED LEARNER WHERE RE-APPLYING HAPPENS', () => {
        //   The rejection email promises "Re-apply after making necessary
        //   improvements", and a prior finding made that possible. The screen
        //   has to offer the door.
        const src = read('src/app/academy/application/pending/page.tsx');
        const effect = src.slice(src.indexOf('useEffect('), src.indexOf('}, [applicationStatus'));

        expect(effect).toContain('"rejected"');
        expect(effect).toMatch(/\/academy\/application/);
    });

    it('CONTROL: none of them lost "approved", which is the common case', () => {
        /*
         *   Or this finding would have fixed the refusal path by breaking the
         *   one that every successful applicant takes — strictly worse than
         *   the defect, and the shape #797 shipped one finding ago.
         */
        for (const { module, file } of SCREENS) {
            const src = read(file);
            expect({ module, approves: src.includes('"approved"') })
                .toEqual({ module, approves: true });
        }
    });

    it('CONTROL: marketplace is NOT required to handle revision_required', () => {
        //   Seller verification never takes that status. Asserting it would
        //   report a correct screen as broken — the instrument error this
        //   audit has made often enough to test for deliberately.
        const src = read('src/app/marketplace/onboarding/pending/page.tsx');
        expect(src.includes('"revision_required"')).toBe(false);
    });
});
