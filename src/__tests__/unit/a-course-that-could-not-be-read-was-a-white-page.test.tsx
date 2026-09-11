/**
 * @jest-environment jsdom
 */

/**
 *   #620 THE COURSE MANAGER TURNED A FAILED READ INTO A WHITE PAGE.
 *
 *   admin/academy/[courseId] loads its course on mount and has two failure
 *   paths. Only one of them was finished:
 *
 *     the read ANSWERS "not found"   toast, then redirect to the course list.
 *                                    A real answer, delivered properly.
 *
 *     the read THROWS                toast.error("Failed to load course"), no
 *                                    redirect, `setIsLoading(false)` — and then
 *                                    `if (!course) return null`.
 *
 *   The second is a white page. The toast fades in seconds and leaves an
 *   administrator looking at nothing: no heading, no error, no retry, no way
 *   back. They cannot tell a deleted course from a broken application, so they
 *   report the application — which is the thing this whole audit was started
 *   over.
 *
 *   ITS SIBLING HAS THE IDENTICAL LINE AND IS SAFE.
 *   admin/marketplace/disputes/[id] also ends `if (!dispute) return null`, and
 *   never reaches it blank, because ITS catch redirects as well as its
 *   not-found branch. Same shape, one door weaker — the pattern this audit
 *   keeps finding, and the reason the fix is a real failure STATE rather than
 *   copying the sibling's redirect.
 *
 *   WHY A STATE AND NOT A REDIRECT. "We could not read this" is not "this does
 *   not exist". Sending an admin back to the course list on a transient failure
 *   tells them the course is gone, and they will act on that. The screen now
 *   says which of the two happened and offers the read again.
 *
 * ── WHY THIS FILE EXISTS SEPARATELY FROM THE SWEEP ──────────────────────────
 *
 *   every-screen-shows-something-or-goes-somewhere renders all 127 client pages
 *   and is where this defect was found. It CANNOT hold the regression test: in
 *   that environment getCourseByIdAction resolves, so the page takes the
 *   not-found branch and redirects, and the throw path is never entered.
 *
 *   Mutation testing said so plainly — restoring `return null` on the page
 *   SURVIVED the entire 127-page sweep. A net that cannot catch the fish it was
 *   woven for still has to be told so. The read is forced to throw here.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';

const getCourseByIdAction = jest.fn();

jest.mock('@/app/actions/academy', () => ({
    getCourseByIdAction: (...args: any[]) => getCourseByIdAction(...args),
    updateCourseAction: jest.fn(),
    updateCourseModulesAction: jest.fn(),
}));

const ROUTER = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() };
jest.mock('next/navigation', () => ({
    useParams: () => ({ courseId: 'course-1' }),
    useRouter: () => ROUTER,
    usePathname: () => '/admin/academy/course-1',
    useSearchParams: () => new URLSearchParams(),
}));

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/storage-upload', () => ({ uploadFile: jest.fn() }));
jest.mock('@/components/shared/MasterUploader', () => ({ __esModule: true, default: () => null }));

async function mountCourseManager() {
    const Page = require('@/app/admin/academy/[courseId]/page').default;
    await act(async () => { render(React.createElement(Page)); });
}

beforeEach(() => {
    jest.clearAllMocks();
    ROUTER.push.mockClear();
});

describe('#620 — a course that could not be read', () => {
    it('SAYS SO, INSTEAD OF RENDERING NOTHING', async () => {
        getCourseByIdAction.mockRejectedValue(new Error('upstream unavailable'));

        await mountCourseManager();

        //   The part that was missing: something on the screen.
        expect(screen.getByText('Could not load this course')).toBeInTheDocument();
        expect(screen.getByText(/could not be read. This is usually temporary/i)).toBeInTheDocument();
    });

    it('AND OFFERS THE READ AGAIN, rather than only a toast that fades', async () => {
        getCourseByIdAction.mockRejectedValue(new Error('upstream unavailable'));

        await mountCourseManager();

        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
        //   And a way out that is not the browser's back button.
        expect(screen.getByRole('link', { name: /back to courses/i })).toBeInTheDocument();
    });

    it('AND DOES NOT SEND THE ADMIN AWAY — "could not read" is not "does not exist"', async () => {
        /*
         *   The distinction the whole fix rests on. A redirect to the course
         *   list on a transient failure tells an administrator the course is
         *   gone. They will believe it, because the list will not show it
         *   either — the same read backs both screens.
         */
        getCourseByIdAction.mockRejectedValue(new Error('upstream unavailable'));

        await mountCourseManager();

        expect(ROUTER.push).not.toHaveBeenCalled();
    });

    it('WHILE A COURSE THAT REALLY IS GONE STILL REDIRECTS, as it did before', async () => {
        //   The fix must not have turned a real answer into an error panel.
        getCourseByIdAction.mockResolvedValue({ success: false, error: 'not found' });

        await mountCourseManager();

        expect(ROUTER.push).toHaveBeenCalledWith('/admin/academy');
    });

    it('AND A COURSE THAT LOADS IS UNAFFECTED', async () => {
        //   Vacuity guard on the whole file: if the page could not render a
        //   course at all, every assertion above would pass for the wrong
        //   reason.
        getCourseByIdAction.mockResolvedValue({
            success: true,
            data: { id: 'course-1', title: 'Export Fundamentals', instructor: 'A. Teacher', tier: 'foundation', modules: [] },
        });

        await mountCourseManager();

        expect(screen.getByText('Export Fundamentals')).toBeInTheDocument();
        expect(screen.queryByText('Could not load this course')).not.toBeInTheDocument();
        expect(ROUTER.push).not.toHaveBeenCalled();
    });

    it('AND THE RETRY ACTUALLY RE-READS', async () => {
        //   A "Try again" button that does not try again is worse than none: it
        //   spends the administrator's trust and their time.
        getCourseByIdAction.mockRejectedValue(new Error('upstream unavailable'));
        await mountCourseManager();

        expect(getCourseByIdAction).toHaveBeenCalledTimes(1);

        const { fireEvent } = require('@testing-library/react');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /try again/i })); });

        expect(getCourseByIdAction).toHaveBeenCalledTimes(2);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT ITSELF: `return null` back on the course manager    KILLED
 *     the page stops recording that the read failed                  KILLED
 *     a failed read redirects, so it reads as "does not exist"       KILLED
 *     the retry button does not re-read                              KILLED
 *     a real "not found" stops redirecting                           KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   THE FIRST OF THOSE IS THE WHOLE REASON THIS FILE EXISTS: it survived the
 *   127-page sweep that found the defect, because that sweep never enters the
 *   throw path. A finding and the test that holds it are not always the same
 *   instrument, and assuming they are is how a fix regresses under a green
 *   suite.
 *
 *   The third is the one that would look like a fix and be a different bug —
 *   redirecting on a failed read tells an administrator the course is gone.
 */
