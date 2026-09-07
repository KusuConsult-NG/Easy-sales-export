/**
 * @jest-environment jsdom
 */

/**
 *   #492 EIGHT LOADERS RENDERED A FAILED READ AS AN ANSWER.
 *
 *   #407 measured 41 handlers that reset a loading flag only on the success
 *   path. #491 fixed the twenty-one ACTION handlers and left these eight
 *   deliberately, for the reason #407 recorded and #408 and #409 proved twice:
 *
 *       "a blanket try/finally is the WRONG repair for a loader — it turns
 *        'spinner forever' into 'empty screen with no explanation'."
 *
 *   That is right, and it is only half of it. The stuck spinner was never the
 *   worst of these. What each of them actually did on a failed read was render
 *   a CONFIDENT, WRONG ANSWER:
 *
 *     admin/finance            Total Revenue ₦0, "0 successful payments"
 *     marketplace/sell         an approved seller told "verification required",
 *                              over a shop showing 0 products and 0 orders
 *     lms/CourseProgressCard   "0% complete" to a student who had finished
 *     village-market/[id]      "Event not found"
 *     academy quiz             "Quiz Not Found", on a timed assessment
 *     disputes/[id]            "No notes yet — add the first one below."
 *     wave/resources           a hard-coded default library, indistinguishable
 *                              from one the coordinator never filled
 *     admin/export/edit        a permanent skeleton, or a silent redirect away
 *
 *   Every one of those is a statement about the world — about the platform's
 *   takings, about a seller's standing, about a student's work, about whether
 *   anybody escalated a dispute — made on the strength of a request that did
 *   not return.
 *
 *   SO EACH ONE GAINED AN ERROR STATE, AND THE ORDER OF THE BRANCHES IS THE
 *   FIX. "Could not read" has to be answered BEFORE "there is nothing there",
 *   or the new state is unreachable behind the old lie. On the seller dashboard
 *   that ordering is the whole repair: the verification gate sits second now,
 *   so an approved seller is never sent to get verified again because a read
 *   failed.
 *
 *   AND ON THE FINANCE PAGE THE FIGURES ARE WITHHELD, not captioned. A banner
 *   above four cards still reading ₦0 is not a fix — an operator scanning a
 *   dashboard reads the number, not the notice above it.
 *
 *   WHAT IS KEPT: the WAVE default library still shows for a genuinely empty
 *   read, because a member with no materials is worse off without it. Only the
 *   FAILED case is told apart. And the export editor still redirects on a
 *   refusal — that is a real "this is not here" — while a throw keeps the admin
 *   on the page, because bouncing somebody off a page without explanation is how
 *   a transient failure comes to look like a deleted record.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the progress card rendering zero again         KILLED
 *     a refusal falling through silently             KILLED
 *     the seller error branch removed                KILLED
 *     the finance figures shown anyway               KILLED
 *     "No notes yet" restored on the disputes screen KILLED
 *     the WAVE defaults restored on a failed read    KILLED
 *     the quiz loader's finally removed              KILLED
 *     the checker's try-returns rule removed         KILLED
 *     reword this header                             SURVIVED, as intended
 *
 *   TWO THINGS WENT WRONG IN THAT RUN AND BOTH ARE WORTH RECORDING.
 *
 *   The first table was measured against a RED baseline: the population ratchet
 *   in loading-flags-survive-the-error-path still read 8 while these repairs had
 *   taken it to 0, so every mutant "failed" for a reason that had nothing to do
 *   with it — including the control. BASELINE GUARD FIRST is a rule this audit
 *   already had, and I skipped it.
 *
 *   The second: the quiz loader's mutant SURVIVED, and chasing it found a third
 *   hole in that checker. It accepted a reset placed after a try/catch without
 *   asking whether the TRY could leave early — and every loader here refuses
 *   with `setLoadError(...); return;`. Closing it flagged the broadcast screen,
 *   correctly-written code whose early return does `setSending(false); return;`
 *   first. So the rule is not "does the try return" but "does it return without
 *   resetting", and both directions are pinned by synthetic cases now.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

const mockGetProgress = jest.fn() as jest.Mock<any>;
const mockGenerateCert = jest.fn() as jest.Mock<any>;

jest.mock('@/app/actions/course-actions', () => ({
    getCourseProgress: (...a: any[]) => mockGetProgress(...a),
    generateCourseCertificate: (...a: any[]) => mockGenerateCert(...a),
}));

import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

import CourseProgressCard from '@/components/lms/CourseProgressCard';

const code = (rel: string) => stripComments(readFileSync(rel, 'utf-8'), { label: rel });

beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateCert.mockResolvedValue({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#492 — a student who finished the course is not shown 0%', () => {
    /**
     * RENDERED, not grepped. Every other assertion in this finding is a source
     * ratchet, and #490 and #491 both had source assertions that a NAME
     * satisfied while the rule was broken. This one runs the component, because
     * "the failed read is not rendered as an answer" is a claim about what
     * appears on screen.
     */
    it('A REJECTED READ SAYS SO, RATHER THAN RENDERING ZERO', async () => {
        //   THE test. `progress` stays null and the card computes
        //   `progress?.progressPercent || 0` — so the student was told, with a
        //   full progress bar's worth of confidence, that they had done none of
        //   the course.
        mockGetProgress.mockRejectedValue(new Error('network'));

        render(<CourseProgressCard courseId="c1" courseTitle="Export Basics" />);

        await waitFor(() =>
            expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument());
        expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
        //   And it says what the failure does NOT mean.
        expect(screen.getByText(/does not mean you have made none/i)).toBeInTheDocument();
    });

    it('AND A REFUSAL IS THE SAME — not an empty result', async () => {
        //   The branch that used to fall through silently: `success: false`
        //   left the initial state on screen exactly as a throw did.
        mockGetProgress.mockResolvedValue({ success: false, error: 'Unauthorized' });

        render(<CourseProgressCard courseId="c1" courseTitle="Export Basics" />);

        await waitFor(() =>
            expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument());
        expect(screen.getByText(/Unauthorized/)).toBeInTheDocument();
    });

    it('AND A REAL ZERO IS STILL SHOWN AS ZERO', async () => {
        //   The control, and the one that stops this becoming a screen that
        //   never renders progress at all. A student who genuinely has not
        //   started must still see 0%.
        mockGetProgress.mockResolvedValue({
            success: true,
            data: { progress: { progressPercent: 0, completed: false } },
        });

        render(<CourseProgressCard courseId="c1" courseTitle="Export Basics" />);

        await waitFor(() => expect(screen.getByText(/0%/)).toBeInTheDocument());
        expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
    });

    it('and a finished course still renders its real progress', async () => {
        mockGetProgress.mockResolvedValue({
            success: true,
            data: { progress: { progressPercent: 100, completed: true } },
        });

        render(<CourseProgressCard courseId="c1" courseTitle="Export Basics" />);

        await waitFor(() => expect(screen.getByText(/100%/)).toBeInTheDocument());
        expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#492 — and the other seven answer "could not read" before "nothing there"', () => {
    /**
     * Source assertions, and they pin the ORDER OF THE BRANCHES rather than the
     * presence of a name — because an error state rendered after the empty state
     * is unreachable, and because #490 and #491 both had assertions a name
     * satisfied while the rule was broken.
     *
     * Each entry is [file, the error branch, the claim it must precede].
     */
    const ORDERED: Array<[string, string, string]> = [
        [
            'src/app/marketplace/sell/page.tsx',
            'if (loadError) {',
            //   The one that sends an approved seller to get verified again.
            'if (!verification || verification.status !== "approved") {',
        ],
        [
            'src/app/marketplace/village-market/[id]/page.tsx',
            'if (loadError) {',
            'if (!event) {',
        ],
        [
            'src/app/academy/[courseId]/quiz/[moduleId]/page.tsx',
            'if (loadError) {',
            'if (!course || !currentModule || !quiz) {',
        ],
        [
            'src/app/admin/marketplace/disputes/[id]/page.tsx',
            ') : notesError ? (',
            ') : notes.length === 0 ? (',
        ],
        [
            'src/app/wave/(member)/resources/page.tsx',
            ') : loadError ? (',
            ') : filteredResources.length === 0 ? (',
        ],
    ];

    it.each(ORDERED)('%s asks the error first', (rel, errorBranch, emptyBranch) => {
        const body = code(rel);
        const err = body.indexOf(errorBranch);
        const empty = body.indexOf(emptyBranch);

        expect({ rel, hasError: err > -1 }).toEqual({ rel, hasError: true });
        expect({ rel, hasEmpty: empty > -1 }).toEqual({ rel, hasEmpty: true });
        expect({ rel, errorFirst: err < empty }).toEqual({ rel, errorFirst: true });
    });

    it('THE FINANCE FIGURES ARE WITHHELD, NOT CAPTIONED', () => {
        //   A banner above four cards still reading ₦0 is not a fix: an operator
        //   scanning a dashboard reads the number, not the notice above it. The
        //   summary cards must sit inside the branch the error excludes.
        const body = code('src/app/admin/finance/page.tsx');
        const guard = body.indexOf('{loadError ? (');
        const cards = body.indexOf('Total Revenue');
        const close = body.indexOf('</>\n                )}');

        expect(guard).toBeGreaterThan(-1);
        expect({ cardsInsideGuard: guard < cards && cards < close })
            .toEqual({ cardsInsideGuard: true });
    });

    it('AND THE NAVIGATION IS NOT WITHHELD WITH THEM', () => {
        //   Quick Actions are true whatever the figures did. Taking them away
        //   would strand an admin on a page with one error and no way onward.
        const body = code('src/app/admin/finance/page.tsx');
        const close = body.indexOf('</>\n                )}');
        const quickActions = body.indexOf('Process Withdrawals');

        expect({ navigationOutsideGuard: quickActions > close })
            .toEqual({ navigationOutsideGuard: true });
    });

    it('and the WAVE default library still shows for a genuinely empty read', () => {
        //   Kept on purpose: a member with no materials at all is worse off
        //   without it. Only the FAILED case is told apart.
        const body = code('src/app/wave/(member)/resources/page.tsx');

        expect(body).toContain('const defaultResources: WaveResource[]');
        expect(body).toContain('setResources(defaultResources)');
    });
});
