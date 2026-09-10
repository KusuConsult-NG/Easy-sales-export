/**
 * @jest-environment jsdom
 */

/**
 *   #604 ONE UN-JOINED APPLICATION EMPTIED THE WHOLE WAVE MEMBER REGISTER, AND
 *        THE SCREEN CALLED IT "NO WAVE MEMBERS YET".
 *
 *   /admin/wave/members builds its rows from approved applications, and each
 *   application arrives as two JOINED halves:
 *
 *       const docs = (result.data || []).map((item: any) => {
 *           const data = item.data;
 *           return { id: item.user.id || item.id, email: item.user.email, ... };
 *       });
 *
 *   Both halves were read unguarded, inside the LOADER rather than the render.
 *   An approved application whose user record did not join threw a TypeError
 *   there, `useAdminData` caught it, and the member list came back empty. Not
 *   one member missing — every member, on the register that says who is
 *   enrolled in WAVE.
 *
 *   #601 found this shape on /admin/wave/applications, #602 on
 *   /admin/academy/applications and /admin/farm-nation/applications. THIS IS
 *   THE REGISTER THOSE THREE APPROVAL QUEUES FEED, and it had the fault twice:
 *   the CSV export carries a SECOND, hand-maintained copy of the same mapping,
 *   with the same two unguarded reads, so the export failed wholesale on the
 *   same row. Two copies of one contract, wrong in the same place — #439's
 *   lesson, which this codebase keeps paying for.
 *
 * ── AND THE SCREEN COULD NOT TELL EMPTY FROM FAILED ─────────────────────────
 *
 *   `error` was destructured from `useAdminData` and never rendered. So the
 *   crash above, a network failure, and a genuinely empty register all produced
 *   the same page:
 *
 *       No WAVE members yet
 *       Approved applications will appear here automatically
 *
 *   That is #588's ledger entry — "cannot tell empty from failed" — and it is
 *   why the crash could sit here unnoticed. An administrator checking whether
 *   an approval went through was told, in a reassuring tone, that nobody is
 *   enrolled.
 *
 * ── WHY THIS FILE EXISTS SEPARATELY FROM THE BARE-ROW PROBE ─────────────────
 *
 *   Both mutants SURVIVED the admin bare-row suite, which reports this screen
 *   as REACHED. Reaching a screen proves the fixture gets in; it does not prove
 *   the screen is right. The differential check asks only whether the output
 *   DIFFERS with a row and without one — and a crash differs from an empty
 *   state just as loudly as a rendered member does. The instrument was measuring
 *   the wrong thing for this defect, so this file measures the right one.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';

let ANSWER: any = { success: true, data: [], meta: {} };
jest.mock('@/app/actions/wave', () => ({
    __esModule: true,
    getStandardWaveApplicationsAction: async () => ANSWER,
}));
jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
const router = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn(), back: jest.fn() };
jest.mock('next/navigation', () => ({
    useRouter: () => router, useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/admin/wave/members', useParams: () => ({}),
}));
jest.mock('@/components/admin/ImportLegacyModal', () => ({ __esModule: true, default: () => null }));

/** A member whose two halves both joined — the control for every case below. */
const WHOLE = {
    id: 'APP-1',
    user: { id: 'U-1', email: 'ada@example.com', phone: '0800', state: 'Lagos', lga: 'Ikeja' },
    data: { surname: 'Okafor', firstName: 'Ada', bankName: 'GTB', farmSize: '2ha' },
};

async function screen() {
    const { default: Screen } = await import('@/app/admin/wave/members/page');
    return render(<Screen />);
}

describe('#604 — the WAVE register against an application that half-joined', () => {
    it('LISTS THE MEMBERS WHEN BOTH HALVES ARRIVED', async () => {
        ANSWER = { success: true, data: [WHOLE], meta: {} };
        const { container } = await screen();
        await waitFor(() => expect(container.textContent).toContain('Okafor'));
        expect(container.textContent).not.toContain('No WAVE members yet');
    });

    it('AND ONE APPLICATION WITHOUT ITS USER RECORD DOES NOT EMPTY THE REGISTER', async () => {
        //   The defect, exactly: a whole member and a half one, together.
        ANSWER = { success: true, data: [WHOLE, { id: 'APP-2', data: { surname: 'Bello' } }], meta: {} };
        const { container } = await screen();
        await waitFor(() => expect(container.textContent).toContain('Okafor'));
        //   The un-joined row is still shown — one member short is a bug worth
        //   fixing separately; a blank register is the one that misleads.
        expect(container.textContent).toContain('Bello');
        expect(container.textContent).not.toContain('No WAVE members yet');
    });

    it('AND A ROW WITH NOTHING ON IT AT ALL IS STILL NOT A CRASH', async () => {
        ANSWER = { success: true, data: [{}], meta: {} };
        const { container } = await screen();
        //   Waiting on the ROW, not on the heading. The heading sits outside the
        //   table and renders before the load resolves and whether or not the
        //   loader threw — a mutant that put back the unguarded `item.data`
        //   survived against it twice: once because it proved nothing, and once
        //   because the assertion ran before the answer arrived.
        await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(1));
        expect(container.textContent).not.toContain('Could not load WAVE members');
    });

    it('A FAILED READ SAYS SO INSTEAD OF SAYING NOBODY IS ENROLLED', async () => {
        ANSWER = { success: false, error: 'Firestore is unavailable' };
        const { container } = await screen();
        await waitFor(() => expect(container.textContent).toContain('Could not load WAVE members'));
        //   The sentence that used to appear here, and the reason the crash hid.
        expect(container.textContent).not.toContain('No WAVE members yet');
        expect(container.textContent).toContain('Firestore is unavailable');
    });

    it('AND AN EMPTY REGISTER STILL SAYS IT IS EMPTY', async () => {
        //   Or the fix would be the same fault in the other direction.
        ANSWER = { success: true, data: [], meta: {} };
        const { container } = await screen();
        await waitFor(() => expect(container.textContent).toContain('No WAVE members yet'));
        expect(container.textContent).not.toContain('Could not load WAVE members');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one mutation at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     loader: `item?.user ?? {}` → `item.user`                       KILLED
 *     loader: `item?.data ?? {}` → `item.data`                       KILLED
 *     getDisplayName: drop the "Unnamed member" fallback             KILLED
 *     render: delete the `error ?` branch                            KILLED
 *     render: take the error branch unconditionally                  KILLED (the
 *                   empty-register test is the other direction)
 *
 *     CONTROL — SHOULD SURVIVE
 *     the "Try again" button label reworded                          SURVIVED ✓
 *
 *   TWO OF THOSE SURVIVED THE FIRST ROUND AND ARE THE REASON THE THIRD DEFECT
 *   IS IN THIS FILE. `item.data` lived through a test that waited for the page
 *   HEADING — which sits outside the table and renders whether the loader threw
 *   or not — and through the same test asserting too early, before the answer
 *   had arrived. Waiting for the ROW instead turned the test red against the
 *   FIXED code, and that is how `getDisplayName(member).charAt(0)` was found:
 *   the assertion that could not fail was hiding a live crash, not just a weak
 *   proof. AUDIT THE INSTRUMENT BEFORE BELIEVING THE MEASUREMENT.
 */
