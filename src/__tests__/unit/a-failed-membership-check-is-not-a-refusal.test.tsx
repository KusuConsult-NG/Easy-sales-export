/**
 * @jest-environment jsdom
 */

/**
 *   #565 A FAILED MEMBERSHIP CHECK TOLD A PAID-UP MEMBER THEY WERE NOT ONE, AND
 *        OFFERED TO SELL THEM A MEMBERSHIP THEY ALREADY HAD.
 *
 *   /cooperatives/fixed-savings opened like this:
 *
 *       try {
 *           const data = await (await fetch("/api/cooperative/check-membership")).json();
 *           if (data.isMember) setMembershipStatus(data.status);
 *           else setMembershipStatus("not_member");
 *       } catch {
 *           setMembershipStatus("not_member");
 *       }
 *
 *   and the render turns "not_member" into a panel headed "To access this
 *   feature, you must first become an approved cooperative member", with the
 *   member's own savings plans hidden behind it.
 *
 *   TWO WAYS TO GET THERE WITHOUT BEING A NON-MEMBER. The catch — any network
 *   blip, any expired session. And a 500, which answers { success: false } with
 *   no `isMember` at all, so `data.isMember` was undefined and the else branch
 *   ran. Either one told a cooperative member, on a screen showing money they
 *   had locked away for a fixed term, that they had no membership.
 *
 *   #323 in WAVE, #316 in Academy, #557 on /wave/resources, and now here. The
 *   fourth page in this codebase to read "could not tell" as "no". The reason
 *   it keeps recurring is that the failure branch is written by whoever wrote
 *   the happy path, and "no" is the nearest safe-looking default.
 *
 *   It is its own state now, and says what actually happened.
 *
 *   #566 AND /cooperatives/withdrawals MADE AN HTTP ROUND TRIP TO ASK A
 *        QUESTION THE NEXT CALL ANSWERS ANYWAY.
 *
 *   It fetched /api/auth/session first, purely to check a user existed, and
 *   returned early if not. getMyWithdrawals resolves the session itself and
 *   returns [] without one — its own first two lines. So that request decided
 *   nothing, cost a whole round trip on every load, and its early `return` left
 *   the spinner running forever whenever the session endpoint was the thing
 *   that had failed.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the catch setting "not_member" again              KILLED (1 test)
 *     the 500 branch removed                            KILLED (1)
 *     the failure panel removed                         KILLED (2)
 *     readMembership letting everyone in                KILLED (1)
 *     the withdrawals seed ignored                      KILLED (1)
 *     reword this header                                SURVIVED, as intended
 *
 *   AND ONE MUTANT WAS DISCARDED AS EQUIVALENT, NOT RECORDED AS A SURVIVOR.
 *   Rewriting readMembership to trust `status` alone and ignore `isMember`
 *   changed no test — and could not, because the route answers a real
 *   non-member with BOTH `isMember: false` and `status: "not_member"`. The two
 *   fields agree, so the narrower reading is the same reading. Noted rather
 *   than dressed up as coverage: a mutant that cannot change behaviour proves
 *   nothing about the test that fails to kill it.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

const showToast = jest.fn();
const getMyWithdrawals = jest.fn();

jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: { user: { id: 'u1', roles: ['user'] } }, status: 'authenticated' }),
}));
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/cooperatives',
}));
jest.mock('@/contexts/ToastContext', () => ({
    useToast: () => ({ showToast }),
    ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/app/actions/cooperative', () => ({
    withdrawMaturedFixedSavingsAction: jest.fn(),
    getMembershipAction: jest.fn(),
}));
jest.mock('@/app/actions/my-data', () => ({
    getMyWithdrawals: (...a: any[]) => getMyWithdrawals(...a),
}));

async function renderFixedSavings(initial: any) {
    const { default: FixedSavingsClient } =
        await import('@/app/cooperatives/(member)/fixed-savings/FixedSavingsClient');
    render(<FixedSavingsClient initial={initial} />);
}

beforeEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = jest.fn();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#565 — a member is not told they are not a member', () => {
    it('A FAILED CHECK SAYS SO, AND DOES NOT OFFER A MEMBERSHIP', async () => {
        //   THE DEFECT. Before the fix this rendered the join panel.
        (global as any).fetch = jest.fn(async () => { throw new Error('network down'); });

        await renderFixedSavings(null);

        expect(await screen.findByText(/could not check your cooperative membership/i))
            .toBeInTheDocument();
        expect(screen.queryByText(/must first become an approved cooperative member/i))
            .not.toBeInTheDocument();
    });

    it('AND A 500 IS A FAILURE TOO, NOT A "NO"', async () => {
        //   The second door. { success: false } carries no isMember at all, so
        //   `data.isMember` was undefined and the else branch ran.
        (global as any).fetch = jest.fn(async (url: string) => ({
            ok: false,
            json: async () => url.includes('check-membership')
                ? { success: false, message: "Internal server error" }
                : { success: true, plans: [] },
        }));

        await renderFixedSavings(null);

        expect(await screen.findByText(/could not check your cooperative membership/i))
            .toBeInTheDocument();
    });

    it('AND A REAL NON-MEMBER IS STILL SHOWN THE JOIN PANEL', async () => {
        //   The vacuity guard. A "fix" that never showed the panel would let
        //   anyone straight into a members-only screen.
        (global as any).fetch = jest.fn(async (url: string) => ({
            ok: true,
            json: async () => url.includes('check-membership')
                ? { success: true, isMember: false, status: 'not_member' }
                : { success: true, plans: [] },
        }));

        await renderFixedSavings(null);

        expect(await screen.findByText(/must first become an approved cooperative member/i))
            .toBeInTheDocument();
    });

    it('AND AN APPROVED MEMBER SEES THEIR PLANS', async () => {
        //   The other vacuity guard: the whole point is that a member gets in.
        (global as any).fetch = jest.fn(async (url: string) => ({
            ok: true,
            json: async () => url.includes('check-membership')
                ? { success: true, isMember: true, status: 'approved' }
                : { success: true, plans: [] },
        }));

        await renderFixedSavings(null);

        await waitFor(() => {
            expect(screen.queryByText(/must first become an approved cooperative member/i))
                .not.toBeInTheDocument();
        });
        expect(screen.queryByText(/could not check your cooperative membership/i))
            .not.toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#564 — and the server made both reads before the page was sent', () => {
    it('A SEEDED SCREEN FETCHES NOTHING', async () => {
        await renderFixedSavings({
            membership: { isMember: true, status: 'approved' },
            plans: [],
        });

        await waitFor(() => {
            expect(screen.queryByText(/must first become an approved cooperative member/i))
                .not.toBeInTheDocument();
        });
        expect((global as any).fetch).not.toHaveBeenCalled();
    });

    it('AND A SEEDED NON-MEMBER IS STILL SHOWN THE JOIN PANEL', async () => {
        await renderFixedSavings({
            membership: { isMember: false, status: 'not_member' },
            plans: [],
        });

        expect(await screen.findByText(/must first become an approved cooperative member/i))
            .toBeInTheDocument();
        expect((global as any).fetch).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#566 — the withdrawal history asks for the withdrawals, and nothing else', () => {
    async function renderWithdrawals(initial: any) {
        const { default: WithdrawalsClient } =
            await import('@/app/cooperatives/(member)/withdrawals/WithdrawalsClient');
        render(<WithdrawalsClient initial={initial} />);
    }

    it('A SEEDED HISTORY MAKES NO CALL AT ALL', async () => {
        await renderWithdrawals([{
            id: 'w1', amount: 25000, status: 'completed',
            requestedAt: new Date(2026, 0, 1).toISOString(),
        }]);

        //   The amount appears in the total, the last-withdrawal card and the
        //   row, so findByText reports "multiple elements" — the seed working,
        //   not failing.
        expect((await screen.findAllByText(/25,000/)).length).toBeGreaterThan(0);
        expect(getMyWithdrawals).not.toHaveBeenCalled();
        expect((global as any).fetch).not.toHaveBeenCalled();
    });

    it('AND AN UNSEEDED ONE CALLS THE ACTION WITHOUT ASKING WHO IS SIGNED IN', async () => {
        //   THE CLAIM. Before the fix this fetched /api/auth/session first,
        //   every single time, to decide something the action decides itself.
        getMyWithdrawals.mockResolvedValue([]);

        await renderWithdrawals(null);

        await waitFor(() => expect(getMyWithdrawals).toHaveBeenCalled());
        expect((global as any).fetch).not.toHaveBeenCalled();
    });
});
