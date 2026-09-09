/**
 * @jest-environment jsdom
 */

/**
 *   #568 THE ONCE-GUARD REACHED THREE OF THE SIX PAYMENT CALLBACKS.
 *
 *   useOnce exists in this codebase for exactly one job — "any useEffect that
 *   makes a network call, verifies a payment, or submits a form will fire TWICE
 *   without this guard" — and its own header said "all three payment callbacks
 *   checked".
 *
 *   There are six: academy, cooperatives, marketplace, export,
 *   export/buyer/cart and farm-nation. The first three used it. The last three
 *   did not, and two of them were written as
 *
 *       useEffect(() => { ...verify... }, [searchParams])
 *
 *   where useSearchParams hands back a NEW ReadonlyURLSearchParams on every
 *   re-render. So the verification re-ran on re-renders, and again on React 18's
 *   Strict Mode probe mount.
 *
 * ── WHAT THIS COST, STATED ACCURATELY ───────────────────────────────────────
 *
 *   NOT MONEY, and it would be easy and wrong to claim otherwise. Every one of
 *   these verifiers claims the payment reference through claim_payment_once,
 *   and #259 made a LOST claim return SUCCESS — "a claim that loses means the
 *   payment was ALREADY APPLIED, by the webhook or by an earlier delivery of
 *   this same callback". So a duplicate never double-credited an investment,
 *   never double-transferred a property, and never told a charged buyer their
 *   payment had failed. The server was right.
 *
 *   What a duplicate DID cost was a whole extra Paystack verification API call
 *   and its database round trip, per redundant render, on the one screen where
 *   the user is already staring at a spinner being told not to close the page.
 *
 *   The audit's own habit is to say what a defect did and no more, so: this is
 *   waste, on the money path, in the place waste is least affordable.
 *
 *   #569 AND THE CART CALLBACK LEFT THE BUYER'S DETAILS ON THE MACHINE.
 *
 *   The export cart page writes `export_buyer_details_{userId}` before sending
 *   the buyer to Paystack — name, email, phone, delivery details, a snapshot of
 *   what they bought and what they paid — commented "for post-payment
 *   processing". NOTHING IN THIS CODEBASE EVER READS IT. Checked across every
 *   source file: one writer, no readers.
 *
 *   So it sat in localStorage indefinitely, on whatever machine they used. The
 *   callback is the post-payment moment it was written for, so that is where it
 *   is cleared — in a `finally`, because a failed verification is not a reason
 *   to keep somebody's address on a computer they may not own.
 *
 *   Nothing is lost. The order itself was created server-side by the
 *   verification, and that is the record that is kept.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the export callback back on useEffect([searchParams])   KILLED (1 test)
 *     the farm-nation callback back on useEffect              KILLED (1)
 *     the cart callback back on useEffect                     KILLED (1)
 *     the buyer-details clear removed                         KILLED (1)
 *     the clear moved out of `finally` onto success only      KILLED (1)
 *     reword this header                                      SURVIVED, as intended
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';

const verifiers = {
    verifyInvestmentPaymentAction: jest.fn(),
    verifyExportInvestmentAction: jest.fn(),
    verifyExportOrderPaymentAction: jest.fn(),
    verifyPropertyPaymentAction: jest.fn(),
};

let params = new URLSearchParams('reference=PS-REF-1');
const push = jest.fn();
const router = { push, replace: push, refresh: jest.fn() };

jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: { user: { id: 'u1' } }, status: 'authenticated' }),
}));
//   A NEW object every call, on purpose: that is what Next's useSearchParams
//   does, and it is the condition the missing guard turned into a second
//   verification. A stable mock here would prove nothing.
jest.mock('next/navigation', () => ({
    useRouter: () => router,
    useSearchParams: () => new URLSearchParams(params.toString()),
    usePathname: () => '/callback',
}));
jest.mock('@/app/actions/export-payment', () => ({
    verifyInvestmentPaymentAction: (...a: any[]) => verifiers.verifyInvestmentPaymentAction(...a),
    verifyExportOrderPaymentAction: (...a: any[]) => verifiers.verifyExportOrderPaymentAction(...a),
}));
jest.mock('@/app/actions/export', () => ({
    verifyExportInvestmentAction: (...a: any[]) => verifiers.verifyExportInvestmentAction(...a),
}));
jest.mock('@/app/actions/farm-nation-payment', () => ({
    verifyPropertyPaymentAction: (...a: any[]) => verifiers.verifyPropertyPaymentAction(...a),
}));

const OK = { success: true, error: null, data: { message: 'Done', orderId: 'o1', propertyId: 'p1' } };

beforeEach(() => {
    jest.clearAllMocks();
    params = new URLSearchParams('reference=PS-REF-1');
    localStorage.clear();
    verifiers.verifyInvestmentPaymentAction.mockResolvedValue(OK);
    verifiers.verifyExportInvestmentAction.mockResolvedValue(OK);
    verifiers.verifyExportOrderPaymentAction.mockResolvedValue(OK);
    verifiers.verifyPropertyPaymentAction.mockResolvedValue(OK);
});

/** Render, then force extra re-renders the way a real screen gets them. */
async function renderAndRerender(load: () => Promise<any>) {
    const { default: Page } = await load();
    const { rerender } = render(<Page />);
    await act(async () => { await Promise.resolve(); });
    //   Three more renders. Before the fix each one produced a fresh
    //   searchParams object and therefore another verification.
    for (let i = 0; i < 3; i++) {
        await act(async () => { rerender(<Page />); await Promise.resolve(); });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#568 — a payment is verified once, however often the screen renders', () => {
    it('THE EXPORT INVESTMENT CALLBACK VERIFIES ONCE', async () => {
        await renderAndRerender(() => import('@/app/export/payment/callback/page'));

        await waitFor(() => expect(verifiers.verifyInvestmentPaymentAction).toHaveBeenCalled());
        expect(verifiers.verifyInvestmentPaymentAction).toHaveBeenCalledTimes(1);
    });

    it('AND IT STILL PICKS THE RIGHT FLOW — the window verifier, when asked', async () => {
        //   The vacuity guard. A guard that verified NOTHING would pass the test
        //   above and leave every investor unfulfilled.
        params = new URLSearchParams('reference=PS-REF-1&flow=window');

        await renderAndRerender(() => import('@/app/export/payment/callback/page'));

        await waitFor(() => expect(verifiers.verifyExportInvestmentAction).toHaveBeenCalledTimes(1));
        expect(verifiers.verifyInvestmentPaymentAction).not.toHaveBeenCalled();
    });

    it('THE FARM NATION PROPERTY CALLBACK VERIFIES ONCE', async () => {
        await renderAndRerender(() => import('@/app/farm-nation/payment/callback/page'));

        await waitFor(() => expect(verifiers.verifyPropertyPaymentAction).toHaveBeenCalled());
        expect(verifiers.verifyPropertyPaymentAction).toHaveBeenCalledTimes(1);
    });

    it('THE EXPORT CART CALLBACK VERIFIES ONCE', async () => {
        await renderAndRerender(() => import('@/app/export/buyer/cart/payment-callback/page'));

        await waitFor(() => expect(verifiers.verifyExportOrderPaymentAction).toHaveBeenCalled());
        expect(verifiers.verifyExportOrderPaymentAction).toHaveBeenCalledTimes(1);
    });

    it('AND A MISSING REFERENCE IS STILL REPORTED, NOT VERIFIED', async () => {
        params = new URLSearchParams('');

        await renderAndRerender(() => import('@/app/farm-nation/payment/callback/page'));

        expect(verifiers.verifyPropertyPaymentAction).not.toHaveBeenCalled();
        expect(await screen.findByText(/No payment reference found/i)).toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#569 — the basket and the buyer details do not outlive the order', () => {
    it('BOTH KEYS ARE CLEARED ONCE THE ORDER EXISTS', async () => {
        localStorage.setItem('export_cart', '[{"id":"p1"}]');
        localStorage.setItem('export_buyer_details_u1', '{"email":"ada@example.test"}');

        await renderAndRerender(() => import('@/app/export/buyer/cart/payment-callback/page'));

        await waitFor(() => expect(localStorage.getItem('export_buyer_details_u1')).toBeNull());
        expect(localStorage.getItem('export_cart')).toBeNull();
    });

    it('AND ALSO WHEN THE VERIFICATION FAILS', async () => {
        //   A failed verification is not a reason to keep somebody's name,
        //   phone and address on a machine they may not own. The order is
        //   server-side either way; this copy is not the record.
        verifiers.verifyExportOrderPaymentAction.mockResolvedValue({
            success: false, error: 'Payment not completed', data: null,
        });
        localStorage.setItem('export_buyer_details_u1', '{"email":"ada@example.test"}');

        await renderAndRerender(() => import('@/app/export/buyer/cart/payment-callback/page'));

        await waitFor(() => expect(localStorage.getItem('export_buyer_details_u1')).toBeNull());
        expect(await screen.findByText(/Payment not completed/i)).toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#568 — and every payment callback in the app now uses the guard', () => {
    it('ALL OF THEM — so a new one cannot quietly be the seventh without it', () => {
        /**
         *   The ratchet. The hook's own header used to say "all three payment
         *   callbacks checked"; a count in a comment is a claim, and that one
         *   was checkable and wrong.
         *
         *   AND SO WAS MINE. The first version of this suite said SEVEN,
         *   because I counted the cooperative callback twice — once for itself
         *   and once for "the one behind the dedicated domain", which is the
         *   same file serving a second hostname. There are six. Caught by this
         *   very check, one line below, which is the argument for writing it:
         *   a number nothing counts is a number that drifts, whoever wrote it.
         *
         *   So this asserts against the DIRECTORY, not against a remembered
         *   total, and the floor only guards the walk itself.
         */
        const { readdirSync, statSync, readFileSync } = require('fs');
        const { join } = require('path');
        const ROOT = process.cwd();

        const callbacks: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) walk(full);
                else if (entry === 'page.tsx' && /callback/.test(full)) {
                    callbacks.push(full.slice(ROOT.length + 1));
                }
            }
        };
        walk(join(ROOT, 'src/app'));

        //   The guard on the measurement: a walk that found nothing would pass
        //   the assertion below for the wrong reason.
        expect(callbacks.length).toBeGreaterThanOrEqual(6);

        const unguarded = callbacks.filter((rel) => {
            const src = readFileSync(join(ROOT, rel), 'utf-8');
            //   Only screens that actually verify something.
            if (!/verify/i.test(src)) return false;
            return !src.includes('useOnce');
        });

        expect(unguarded).toEqual([]);
    });
});
