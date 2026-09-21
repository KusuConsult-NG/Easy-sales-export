/**
 * @jest-environment jsdom
 */

/**
 *   #814 THE ONE REFUSAL ON THE CHECKOUT PAGE THAT SAID NOTHING.
 *
 *   Farm Nation land is sold to cooperative members: `calculateUserTier`
 *   returns "Member" unconditionally, so `getUserTierAction` answers "Member"
 *   for anyone holding a cooperative_members row and `null` for anyone who does
 *   not. The checkout guard is `if (tier !== "Member")`.
 *
 *   What it did with that answer was this, and only this:
 *
 *       router.push(`/farm-nation/property/${propertyId}`);
 *
 *   A buyer pressed Buy on a verified property, arrived back at the listing,
 *   and was told NOTHING — not on the way out, and not when they got there. The
 *   property page does not mention membership either, so the only available
 *   reading is that the button is broken.
 *
 *   EVERY OTHER REFUSAL IN THAT FILE ALREADY SPEAKS. Eight `setError` calls:
 *   "This property is no longer available", "Phone number is required",
 *   "Please specify your intended use for this property". The one that blocks
 *   the PURCHASE was the silent one.
 *
 * ── AND THE SECOND SILENT CASE, WHICH IS WORSE ──────────────────────────────
 *
 *   `getUserTierAction` can answer `{ success: false }` — its own catch does
 *   that. The old guard tested `if (res.success && res.data)` and did nothing
 *   otherwise, so a membership check that FAILED TO ANSWER rendered the full
 *   checkout form. The buyer fills in their phone number, their intended use,
 *   agrees to the terms, and finds out at the payment step, if at all.
 *
 *   That is #313's rule on the money path: a read that did not answer is not a
 *   pass. It has its own message now, and a retry, rather than being folded
 *   into either real answer.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

const getUserTierAction = jest.fn() as jest.Mock<any>;
const getPropertyByIdAction = jest.fn() as jest.Mock<any>;
const push = jest.fn();
const replace = jest.fn();

jest.mock('@/app/actions/cooperative', () => ({
    getUserTierAction: (...a: any[]) => getUserTierAction(...a),
}));
jest.mock('@/app/actions/land-listings', () => ({
    getPropertyByIdAction: (...a: any[]) => getPropertyByIdAction(...a),
}));
jest.mock('@/app/actions/farm-nation-payment', () => ({
    initializePropertyPaymentAction: jest.fn(async () => ({ success: true, data: {} })),
}));
/*
 *   ONE router object, not a new one per render.
 *
 *   CheckoutClient's effect lists `router` in its dependencies, so a mock that
 *   returned a fresh `{ push, replace }` each call re-ran the effect on every
 *   render, which set state, which rendered again. The first version of this
 *   file did exactly that and hung the suite — not a defect in the component,
 *   a defect in the instrument.
 */
const router = { push, replace };
jest.mock('next/navigation', () => ({
    useRouter: () => router,
    useParams: () => ({ propertyId: 'plot-1' }),
    useSearchParams: () => new URLSearchParams(''),
}));

const session = { user: { name: 'Ada', email: 'ada@example.com', id: 'u1' } };
let authStatus = 'authenticated';
jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: session, status: authStatus }),
}));
/*
 *   useServerSeed returns a FUNCTION — `takeSeed()` is called inside
 *   loadProperty. Returning undefined made that call throw, the component fell
 *   into its "Failed to load property details" branch, and only the POSITIVE
 *   CONTROL noticed: the membership panel renders first and hid it from every
 *   other test in this file. Returning null here lets the read fall through to
 *   the mocked action, which is the path under test.
 */
jest.mock('@/hooks/useServerSeed', () => ({ useServerSeed: () => () => null }));
//   A span, not an <img>: the lint rule that pushes next/image applies to test
//   files too, and suppressing it would leave a directive to explain. Nothing
//   here asserts on the image.
jest.mock('next/image', () => ({
    __esModule: true,
    default: (p: any) => <span data-testid="next-image" aria-label={p.alt ?? ''} />,
}));

import CheckoutClient from '@/app/farm-nation/checkout/[propertyId]/CheckoutClient';

const PROPERTY = {
    id: 'plot-1',
    title: 'E2E Farmland Plot 1',
    status: 'verified',
    price: 6_250_000,
    images: [],
};

beforeEach(() => {
    jest.clearAllMocks();
    authStatus = 'authenticated';
    getPropertyByIdAction.mockResolvedValue({ success: true, data: PROPERTY });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#814 — a buyer who is not a member is told why', () => {
    beforeEach(() => {
        getUserTierAction.mockResolvedValue({ success: true, data: { tier: null, totalContributions: 0 } });
    });

    it('THE REASON IS ON THE SCREEN', async () => {
        render(<CheckoutClient initial={null} />);

        expect(await screen.findByText(/Cooperative membership is required/i)).toBeInTheDocument();
        expect(screen.getByText(/sold to cooperative members/i)).toBeInTheDocument();
    });

    it('AND SO IS THE WAY OUT OF IT', async () => {
        //   Naming the obstacle without naming the remedy is half a message.
        render(<CheckoutClient initial={null} />);

        expect(await screen.findByRole('button', { name: /join the cooperative/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /back to property/i })).toBeInTheDocument();
    });

    it('IT DOES NOT BOUNCE THEM SILENTLY — the defect', async () => {
        //   THE test. The old guard pushed to the property page and said
        //   nothing, so the buyer landed on a listing that also says nothing.
        render(<CheckoutClient initial={null} />);

        await screen.findByText(/Cooperative membership is required/i);
        expect(push).not.toHaveBeenCalledWith('/farm-nation/property/plot-1');
    });

    it('AND THE FORM IS NOT RENDERED BEHIND THE MESSAGE', async () => {
        //   Refusing on screen while still drawing the form would invite them
        //   to fill in a purchase that cannot complete.
        render(<CheckoutClient initial={null} />);

        await screen.findByText(/Cooperative membership is required/i);
        expect(screen.queryByText(/Complete your purchase request/i)).not.toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#814 — a check that could not answer is not a pass', () => {
    it('A FAILED MEMBERSHIP READ SAYS SO, rather than rendering the form', async () => {
        getUserTierAction.mockResolvedValue({ success: false, error: 'Action failed', data: null });

        render(<CheckoutClient initial={null} />);

        expect(await screen.findByText(/could not check your membership/i)).toBeInTheDocument();
        expect(screen.queryByText(/Complete your purchase request/i)).not.toBeInTheDocument();
    });

    it('AND SAYS NOTHING WAS CHARGED, which is the thing they will worry about', async () => {
        getUserTierAction.mockResolvedValue({ success: false, error: 'Action failed', data: null });

        render(<CheckoutClient initial={null} />);

        expect(await screen.findByText(/nothing has been charged/i)).toBeInTheDocument();
    });

    it('AND A THROWN READ IS THE SAME, not an unhandled rejection', async () => {
        getUserTierAction.mockRejectedValue(new Error('network'));

        render(<CheckoutClient initial={null} />);

        expect(await screen.findByText(/could not check your membership/i)).toBeInTheDocument();
    });

    it('and it is told apart from not being a member', async () => {
        //   Two different situations needing two different things said. Folding
        //   them together would tell a paying member to go and join.
        getUserTierAction.mockResolvedValue({ success: false, error: 'Action failed', data: null });

        render(<CheckoutClient initial={null} />);

        await screen.findByText(/could not check your membership/i);
        expect(screen.queryByText(/Cooperative membership is required/i)).not.toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#814 — and a member still reaches checkout', () => {
    /**
     * The direction that must not move. A guard that refused everybody would
     * pass every assertion above and close Farm Nation sales entirely.
     */
    it('POSITIVE CONTROL: A MEMBER SEES THE CHECKOUT FORM', async () => {
        getUserTierAction.mockResolvedValue({ success: true, data: { tier: 'Member', totalContributions: 50_000 } });

        render(<CheckoutClient initial={null} />);

        await waitFor(() =>
            expect(screen.getByText(/Complete your purchase request/i)).toBeInTheDocument());
        expect(screen.queryByText(/Cooperative membership is required/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/could not check your membership/i)).not.toBeInTheDocument();
    });

    it('and an unauthenticated visitor is still sent to register, not to login', async () => {
        //   Checkout is the one path the middleware deliberately sends to
        //   /auth/register rather than /auth/login — a buyer arriving at a
        //   purchase has no account yet.
        authStatus = 'unauthenticated';

        render(<CheckoutClient initial={null} />);

        await waitFor(() => expect(replace).toHaveBeenCalledWith(
            expect.stringContaining('/auth/register')));
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Applied to CheckoutClient.tsx alone, this suite re-run each time.
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   restore the silent router.push — the        4   "THE REASON IS ON THE
 *   defect                                          SCREEN"
 *
 *   a failed read falls through to the form     4   "A FAILED MEMBERSHIP READ
 *   (the `if (res.success && res.data)` shape)      SAYS SO"
 *
 *   both blocks share one message               3   "A FAILED MEMBERSHIP READ
 *                                                   SAYS SO"
 *
 *   CONTROL — SHOULD SURVIVE
 *   reword the comment above the guard          0   SURVIVED ✓
 *
 *   TWO FAULTS IN THIS FILE, BOTH MINE, BOTH WORTH KEEPING. The router mock
 *   returned a NEW object per render and the component's effect depends on
 *   `router`, so the suite hung rather than failed. And `useServerSeed` was
 *   mocked as returning undefined when the component CALLS what it returns —
 *   which threw, dropped the component into its "Failed to load property"
 *   branch, and was invisible to every test except the positive control,
 *   because the membership panel renders first and hid it.
 *
 *   The server half is mutation-tested in a-purchase-gate-only-the-buttons-obeyed.
 */
