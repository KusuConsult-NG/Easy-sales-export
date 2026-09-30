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
describe('#973 — a signed-in buyer reaches checkout, member or not', () => {
    /**
     *   #814's TWO DESCRIBES WERE HERE, AND THE OWNER OVERRULED THE RULE THEY
     *   PINNED.
     *
     *   "there is a gate that tells them they are not part of cooperative which
     *   is not supposed to be so."
     *
     *   #814 was right that the old refusal was silent — a buyer pressed Buy,
     *   landed back on the listing and was told nothing — and it gave the
     *   refusal words. It never asked whether the refusal was correct. It was
     *   not: app/actions/farm-nation-payment.ts traces the rule to a February
     *   2026 audit commit's `tier !== "Premium"` check, a cooperative tier this
     *   platform has since deleted.
     *
     *   INVERTED RATHER THAN DELETED. Each test below fails if the gate, or its
     *   "we could not check your membership" sibling, comes back.
     */
    it('THE test: A NON-MEMBER SEES THE CHECKOUT FORM', async () => {
        //   The tier action is still mocked and still answers "not a member".
        //   The form must render anyway.
        getUserTierAction.mockResolvedValue({ success: true, data: { tier: null, totalContributions: 0 } });

        render(<CheckoutClient initial={null} />);

        await waitFor(() =>
            expect(screen.getByText(/Complete your purchase request/i)).toBeInTheDocument());
    });

    it('AND IS NOT SHOWN A MEMBERSHIP REFUSAL', async () => {
        getUserTierAction.mockResolvedValue({ success: true, data: { tier: null, totalContributions: 0 } });

        render(<CheckoutClient initial={null} />);

        await waitFor(() =>
            expect(screen.getByText(/Complete your purchase request/i)).toBeInTheDocument());
        expect(screen.queryByText(/Cooperative membership is required/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Join the cooperative/i)).not.toBeInTheDocument();
    });

    it('AND A TIER READ THAT FAILS DOES NOT STOP THEM EITHER', async () => {
        /*
         *   #814 gave a failed read its own screen with a retry, which was right
         *   while the rule existed — a read that did not answer is not a pass.
         *   With no rule there is nothing to read, so a cooperative outage must
         *   not close land sales.
         */
        getUserTierAction.mockResolvedValue({ success: false, error: 'Action failed', data: null });

        render(<CheckoutClient initial={null} />);

        await waitFor(() =>
            expect(screen.getByText(/Complete your purchase request/i)).toBeInTheDocument());
        expect(screen.queryByText(/could not check your membership/i)).not.toBeInTheDocument();
    });

    it('AND THE SCREEN DOES NOT ASK THE COOPERATIVE ANYTHING', async () => {
        //   The assertion that catches a gate reworded rather than removed.
        getUserTierAction.mockResolvedValue({ success: true, data: { tier: null, totalContributions: 0 } });

        render(<CheckoutClient initial={null} />);

        await waitFor(() =>
            expect(screen.getByText(/Complete your purchase request/i)).toBeInTheDocument());
        expect(getUserTierAction).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#814 — and the paths that still hold', () => {
    /**
     * The direction that must not move. #973 removed a gate; it must not have
     * removed the form, and it must not have changed where a visitor with no
     * account is sent.
     */
    it('POSITIVE CONTROL: A MEMBER STILL SEES THE CHECKOUT FORM', async () => {
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
