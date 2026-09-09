/**
 * @jest-environment jsdom
 */

/**
 *   #557 THE ELIGIBILITY DOOR ON /wave/resources ONLY EVER OPENED THE WRONG WAY.
 *
 *   The screen's first act was:
 *
 *       const eligibility = await checkWaveEligibilityAction(userId);
 *       if (!eligibility.success) {
 *           router.push("/wave/application");
 *           return;
 *       }
 *
 *   `eligibility.data.eligible` is never read. And checkWaveEligibilityAction
 *   returns three different things:
 *
 *       eligible        { success: true,  data: { eligible: true } }
 *       NOT eligible    { success: true,  data: { eligible: false, reason } }
 *       no such user    { success: true,  data: null }
 *       COULD NOT TELL  { success: false, error: "...", data: null }
 *
 *   So the branch fired on exactly the one outcome that is not a "no", and did
 *   not fire on the one that is. A member whose check hit a transient failure
 *   was thrown out of the member area to the application page — the platform
 *   telling a member to apply for something they are already in — while an
 *   answer of "not eligible" walked straight through, because that answer comes
 *   back success: true.
 *
 *   #323 in the same module was the same reading of the same shape, and #316
 *   before it. This is the third page in that family.
 *
 * ── WHAT THIS DEFECT DID *NOT* DO, STATED PLAINLY ───────────────────────────
 *
 *   It did not expose the library. Saying so would be the more dramatic claim
 *   and it would be false, and a false claim in an audit is worth less than no
 *   claim.
 *
 *   /wave/resources sits under `wave/(member)/layout.tsx`, which resolves the
 *   session and calls checkModuleAccess before any of this renders. The
 *   contents come from getResourcesAction, which gates on
 *   callerMayAccessResources — an ACTIVE wave_members row, or an admin. Two
 *   gates, both server-side, both correct.
 *
 *   This was a third copy of a contract already enforced twice, which is the
 *   defect class this audit keeps finding. Its only effect on anyone was to
 *   eject members over a failed read. It now tells the three states apart: a
 *   real "not eligible" goes to the application page, a failed check says so
 *   and stays put, and a member gets their library.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the failure branch made to redirect again          KILLED (1 test)
 *     the `eligible === false` branch deleted            KILLED (1)
 *     `data && data.eligible === false` -> `!data?.eligible`   KILLED (1)
 *     the toast dropped from the failure branch          KILLED (1)
 *     the seed ignored so the client fetches anyway      KILLED (1)
 *     reword this header                                 SURVIVED, as intended
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

const push = jest.fn();
const showToast = jest.fn();
const mockUseSession = jest.fn();

const a = {
    checkWaveEligibilityAction: jest.fn(),
    getResourcesAction: jest.fn(),
    downloadResourceAction: jest.fn(),
};

jest.mock('next-auth/react', () => ({ useSession: () => mockUseSession() }));
//   ONE router object, not a fresh one per render.
//
//   AUDIT THE INSTRUMENT BEFORE BELIEVING THE MEASUREMENT. The first version of
//   this mock returned `{ push }` from a literal, so `router` changed identity
//   on every render, the eligibility effect re-ran three times and the seeded
//   test reported the seed as ignored. Next's own useRouter is stable across
//   renders; the mock was the thing that was not.
const router = { push, replace: push };
jest.mock('next/navigation', () => ({ useRouter: () => router }));
jest.mock('@/contexts/ToastContext', () => ({
    useToast: () => ({ showToast }),
    ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/app/actions/wave', () => ({
    checkWaveEligibilityAction: (...args: any[]) => a.checkWaveEligibilityAction(...args),
}));
jest.mock('@/app/actions/resource-actions', () => ({
    getResourcesAction: (...args: any[]) => a.getResourcesAction(...args),
    downloadResourceAction: (...args: any[]) => a.downloadResourceAction(...args),
}));

const LIBRARY = {
    success: true,
    error: null,
    data: [{
        id: 'r1',
        title: 'Phytosanitary certification, step by step',
        description: 'What the inspector asks for, in order.',
        category: 'guide',
        fileUrl: 'https://example.test/guide.pdf',
        fileName: 'guide.pdf',
        fileSize: 1024,
    }],
};

async function renderResources(initial: any = null) {
    const { default: WaveResourcesClient } =
        await import('@/app/wave/(member)/resources/WaveResourcesClient');
    render(<WaveResourcesClient initial={initial} />);
}

beforeEach(() => {
    jest.clearAllMocks();
    mockUseSession.mockReturnValue({
        data: { user: { id: 'u1', name: 'Ada', roles: ['user', 'wave_member'] } },
        status: 'authenticated',
    });
    a.getResourcesAction.mockResolvedValue(LIBRARY);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#557 — a failed eligibility check does not eject a member', () => {
    it('A REFUSAL LEAVES THE MEMBER WHERE THEY ARE AND SAYS WHAT HAPPENED', async () => {
        //   THE DEFECT. Before the fix this redirected to /wave/application.
        a.checkWaveEligibilityAction.mockResolvedValue({
            success: false, error: 'Failed to check eligibility', data: null,
        });

        await renderResources();

        await waitFor(() => expect(showToast).toHaveBeenCalled());
        expect(showToast.mock.calls[0][0]).toMatch(/eligibility/i);
        expect(push).not.toHaveBeenCalled();
    });

    it('AND A THROWN CHECK IS THE SAME — the action returns a refusal, not an exception', async () => {
        //   withFlexibleSafeAction turns a throw into { success: false }, so the
        //   refusal above IS the crash path. Pinned so the two cannot be
        //   assumed to differ.
        a.checkWaveEligibilityAction.mockResolvedValue({
            success: false, error: 'A temporary connection issue occurred. Please try again.', data: null,
        });

        await renderResources();

        await waitFor(() => expect(showToast).toHaveBeenCalled());
        expect(push).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#557 — and a real "not eligible" now actually turns someone away', () => {
    it('AN ANSWER OF eligible: false GOES TO THE APPLICATION PAGE', async () => {
        //   The other half, and the one the old branch never reached: this
        //   outcome comes back success: true, so `!success` was false and the
        //   visitor was let through.
        a.checkWaveEligibilityAction.mockResolvedValue({
            success: true, error: null, data: { eligible: false, reason: 'WAVE is for women' },
        });

        await renderResources();

        await waitFor(() => expect(push).toHaveBeenCalledWith('/wave/application'));
    });

    it('AND AN ELIGIBLE MEMBER IS NOT TURNED AWAY AND SEES THE LIBRARY', async () => {
        //   The vacuity guard. A "fix" that redirected everybody would pass the
        //   test above and lock every member out of their own resources.
        a.checkWaveEligibilityAction.mockResolvedValue({
            success: true, error: null, data: { eligible: true },
        });

        await renderResources();

        await waitFor(() => expect(a.getResourcesAction).toHaveBeenCalled());
        expect(await screen.findByText(/Phytosanitary certification/i)).toBeInTheDocument();
        expect(push).not.toHaveBeenCalled();
    });

    it('AND "NO SUCH USER ROW" IS NOT READ AS A NO EITHER', async () => {
        //   The action returns success: true with data: null when the user
        //   document is missing. That is another "could not tell", and
        //   `!data?.eligible` — the tempting shorter spelling — would treat it
        //   as a refusal to enter.
        a.checkWaveEligibilityAction.mockResolvedValue({ success: true, error: null, data: null });

        await renderResources();

        await waitFor(() => expect(a.getResourcesAction).toHaveBeenCalled());
        expect(push).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#556 — and the server seed removes both round trips', () => {
    it('A SEEDED SCREEN MAKES NO CALLS OF ITS OWN', async () => {
        await renderResources({
            eligibility: { success: true, error: null, data: { eligible: true } },
            resources: LIBRARY,
        });

        expect(await screen.findByText(/Phytosanitary certification/i)).toBeInTheDocument();
        expect(a.checkWaveEligibilityAction).not.toHaveBeenCalled();
        expect(a.getResourcesAction).not.toHaveBeenCalled();
        expect(push).not.toHaveBeenCalled();
    });

    it('AND A SEEDED REFUSAL STILL REACHES THE MEMBER AS A REFUSAL', async () => {
        //   The seed carries the RESULT, not a flattened answer, precisely so
        //   the three states stay readable on this side.
        await renderResources({
            eligibility: { success: false, error: 'Failed to check eligibility', data: null },
            resources: LIBRARY,
        });

        await waitFor(() => expect(showToast).toHaveBeenCalled());
        expect(push).not.toHaveBeenCalled();
        expect(a.checkWaveEligibilityAction).not.toHaveBeenCalled();
    });
});
