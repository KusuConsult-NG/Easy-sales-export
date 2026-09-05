/**
 * @jest-environment jsdom
 */

/**
 *   #415 "I COULD NOT CHECK" WAS ANSWERED AS "YOU ARE STILL WAITING" — ON THE
 *   PAGE THAT DECIDES WHETHER AN APPROVED APPLICANT EVER LEAVES IT.
 *
 *   From the untested-module sweep: usePendingApplicationStatus was one of the
 *   hooks no test named.
 *
 *   WHAT WAS THERE. getMyApplicationStatus returned PENDING — a definite state
 *   — for five different situations: a genuine pending row, no row at all, an
 *   unlisted lookup, NO SESSION, and a thrown query. The last three are not
 *   statuses; they are the absence of an answer.
 *
 *   AND IT DECIDES A REDIRECT. All five waiting screens — wave, academy,
 *   export, marketplace, farm-nation — leave the page on
 *   `applicationStatus === "approved"`. So while the read kept failing, an
 *   applicant who HAD been approved was held on a page telling them to wait,
 *   and one whose session had expired got the same page instead of a prompt to
 *   sign in. Third instance of a class this audit has already fixed twice:
 *   #313 (MFA reported "off" when it could not check), #316 (academy payment
 *   status answered "unpaid"), #323 (a failed membership check ejected real
 *   WAVE members).
 *
 *   ITS OWN NEIGHBOUR ALREADY DISAGREED, AND BOTH WERE TESTED. Seventy lines
 *   below in the same file, getMyMembershipStatus answers "unauthenticated"
 *   with no session and "unknown" when it finds nothing — asserted in
 *   lib/__tests__/my-data-status.test.ts in the describe block directly under
 *   the one that asserted, as its title, that this function "reports pending
 *   rather than throwing when the query fails". Two answers to one question,
 *   tested side by side, and the difference was the subject of neither test.
 *
 *   FIXED, in three parts.
 *
 *     1. The action answers "unauthenticated" with no session and "unknown"
 *        for an unlisted lookup or a thrown query. `snap.empty` still answers
 *        "pending" — no application row IS the pending state for a page you
 *        only reach by applying.
 *
 *     2. The hook does NOT write a non-answer into `status`. That would be the
 *        same defect wearing a different word: a screen showing "Approved"
 *        would drop back to the waiting page the moment one poll failed. The
 *        last status actually read stands, and `checkFailed` /
 *        `sessionExpired` carry the failure alongside it.
 *
 *     3. The five screens say so, through one shared component rather than
 *        five wordings (#390's lesson).
 *
 *   ALSO: rejectionReason was only ever SET, never cleared, so an applicant who
 *   reapplied and was approved kept seeing the reason for the first rejection.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the action answers pending on a thrown query again   KILLED
 *     the action answers pending with no session again     KILLED
 *     the hook writes "unknown" into status                KILLED
 *     the hook stops clearing rejectionReason              KILLED
 *     a screen drops the notice                            KILLED
 *     reword the header prose                              SURVIVED, as intended
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { renderHook, waitFor, render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { usePendingApplicationStatus } from '@/hooks/usePendingApplicationStatus';
import { StatusCheckNotice } from '@/components/application/StatusCheckNotice';
import { getMyApplicationStatus } from '@/app/actions/my-data';

jest.mock('@/app/actions/my-data', () => ({
    getMyApplicationStatus: jest.fn(),
}));

const asMock = getMyApplicationStatus as unknown as jest.Mock;

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: relative(ROOT, p) });

/** The five screens that leave their waiting page on an "approved" status. */
const WAITING_SCREENS = [
    'src/app/wave/application/review-pending/page.tsx',
    'src/app/academy/application/pending/page.tsx',
    'src/app/export/onboarding/pending/page.tsx',
    'src/app/marketplace/onboarding/pending/page.tsx',
    'src/app/farm-nation/onboarding/pending/page.tsx',
];

const opts = { collectionName: 'wave_applications', userId: 'u1', statusField: 'status' };

beforeEach(() => { asMock.mockReset(); });

/**
 * Render the hook with its options as PROPS, so a rerender can change one and
 * make the effect run again. `rerender()` with no argument re-renders with the
 * same props, the dependency array is unchanged, and no second poll happens —
 * which is how the first draft of two of these tests asserted nothing.
 */
const poll = () =>
    renderHook((p: typeof opts) => usePendingApplicationStatus(p), { initialProps: opts });

// ─────────────────────────────────────────────────────────────────────────────
describe('#415 — a non-answer does not overwrite the last real one', () => {
    it('AN APPROVED APPLICANT STAYS APPROVED WHEN THE NEXT POLL CANNOT ANSWER', async () => {
        /**
         * The whole point. If "unknown" were written into `status`, the screen
         * would drop out of its approved branch and back to "Under Review" —
         * which is the defect, relocated.
         */
        asMock
            .mockResolvedValueOnce({ status: 'approved', createdAt: null, rejectionReason: null })
            .mockResolvedValue({ status: 'unknown', createdAt: null, rejectionReason: null });

        const { result, rerender } = poll();
        await waitFor(() => expect(result.current.status).toBe('approved'));

        // A real second poll: the effect re-runs only when a dependency
        // changes, so a bare rerender() would have tested nothing.
        rerender({ ...opts, userId: 'u1-again' });
        await waitFor(() => expect(asMock).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(result.current.checkFailed).toBe(true));

        expect(result.current.status).toBe('approved');
    });

    it('and a failed FIRST read is reported, not dressed as "pending"', async () => {
        asMock.mockResolvedValue({ status: 'unknown', createdAt: null, rejectionReason: null });

        const { result } = poll();
        await waitFor(() => expect(result.current.checkFailed).toBe(true));

        expect(result.current.sessionExpired).toBe(false);
        // `status` keeps its initial value — the screen shows the waiting page,
        // but now WITH the notice rather than a bare assertion that they wait.
        expect(result.current.status).toBe('pending');
    });

    it('and an expired session is reported as an expired session', async () => {
        asMock.mockResolvedValue({ status: 'unauthenticated', createdAt: null, rejectionReason: null });

        const { result } = poll();
        await waitFor(() => expect(result.current.sessionExpired).toBe(true));
        expect(result.current.checkFailed).toBe(true);
    });

    it('and a THROWN action is a failed check too', async () => {
        asMock.mockRejectedValue(new Error('socket hang up'));

        const { result } = poll();
        await waitFor(() => expect(result.current.checkFailed).toBe(true));
        await waitFor(() => expect(result.current.isLoading).toBe(false));
    });

    it('and a real answer clears the failure flag again', async () => {
        asMock
            .mockResolvedValueOnce({ status: 'unknown', createdAt: null, rejectionReason: null })
            .mockResolvedValue({ status: 'rejected', createdAt: null, rejectionReason: 'no proof of address' });

        const { result, rerender } = poll();
        await waitFor(() => expect(result.current.checkFailed).toBe(true));

        rerender({ ...opts, userId: 'u1-again' });
        await waitFor(() => expect(result.current.status).toBe('rejected'));
        expect(result.current.checkFailed).toBe(false);
        expect(result.current.rejectionReason).toBe('no proof of address');
    });

    it('and a rejection reason does not outlive the rejection', async () => {
        /**
         * `if (result.rejectionReason) setRejectionReason(...)` only ever set
         * it. Reapply after a rejection, be approved, and the screen still
         * displayed why you were turned down the first time.
         */
        asMock
            .mockResolvedValueOnce({ status: 'rejected', createdAt: null, rejectionReason: 'incomplete' })
            .mockResolvedValue({ status: 'approved', createdAt: null, rejectionReason: null });

        const { result, rerender } = poll();
        await waitFor(() => expect(result.current.rejectionReason).toBe('incomplete'));

        rerender({ ...opts, userId: 'u1-again' });
        await waitFor(() => expect(result.current.status).toBe('approved'));
        expect(result.current.rejectionReason).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#415 — and the screen admits it', () => {
    it('THE NOTICE SAYS WHICH KIND OF FAILURE IT IS', () => {
        const { rerender } = render(<StatusCheckNotice checkFailed sessionExpired={false} />);
        expect(screen.getByText(/could not confirm your status/i)).toBeTruthy();
        expect(screen.getByText(/last status we were able to read/i)).toBeTruthy();

        rerender(<StatusCheckNotice checkFailed sessionExpired />);
        expect(screen.getByText('Please sign in again')).toBeTruthy();
        expect(screen.queryByText(/could not confirm your status/i)).toBeNull();
    });

    it('and shows nothing at all when the check succeeded', () => {
        const { container } = render(<StatusCheckNotice checkFailed={false} sessionExpired={false} />);
        expect(container.firstChild).toBeNull();
    });

    it('and ALL FIVE waiting screens render it', () => {
        // The point of a shared component: the class was fixed on five screens
        // at once, and a sixth waiting screen that forgets it will fail here.
        for (const path of WAITING_SCREENS) {
            const src = code(path);
            expect({ screen: path, renders: src.includes('<StatusCheckNotice') })
                .toEqual({ screen: path, renders: true });
            expect({ screen: path, wired: /checkFailed[,\s}]/.test(src) })
                .toEqual({ screen: path, wired: true });
        }
    });

    it('and every one of them still leaves the page on "approved" — which is why this matters', () => {
        for (const path of WAITING_SCREENS) {
            const src = code(path);
            expect({ screen: path, redirects: /applicationStatus === "(approved|active)"/.test(src) })
                .toEqual({ screen: path, redirects: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#415 — the two neighbours now agree', () => {
    it('ONE FILE, ONE ANSWER FOR "NOTHING WAS READ"', () => {
        const src = code('src/app/actions/my-data.ts');
        // Both vocabularies present, and the pending constant no longer used
        // for the no-session or thrown-query paths.
        expect(src).toMatch(/const UNKNOWN: MyApplicationStatus = \{ status: "unknown"/);
        expect(src).toMatch(/const UNAUTHENTICATED: MyApplicationStatus = \{ status: "unauthenticated"/);
        expect(src).toMatch(/if \(!userId\) return UNAUTHENTICATED;/);
        expect(src).toMatch(/getMyApplicationStatus failed[\s\S]{0,120}?return UNKNOWN;/);
        // …and the neighbour it was made to match is unchanged.
        expect(src).toMatch(/if \(!userId\) return \{ status: "unauthenticated", data: null \};/);
    });
});
