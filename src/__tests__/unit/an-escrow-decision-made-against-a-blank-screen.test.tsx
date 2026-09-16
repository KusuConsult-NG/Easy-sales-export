/**
 * @jest-environment jsdom
 */

/**
 *   #797 THE DISPUTE SCREEN OFFERED TO RESOLVE A DISPUTE IT COULD NOT READ.
 *
 *   /admin/marketplace/disputes/[id] is where an administrator releases escrow
 *   to a seller or refunds it to a buyer. It loads four things. The FIRST is
 *   guarded — a dispute that will not load bounces back to the list. The other
 *   three are not:
 *
 *       const orderResult = await getOrderByIdAction(d.orderId);
 *       if (orderResult.success && orderResult.data?.order) { … }   ← no else
 *
 *   So a failed read left `order` null, `escrowData` null and `refundAmount` at
 *   its initial "0", and the screen rendered anyway: the dispute, an empty
 *   order panel, an empty escrow panel, a context amount of ₦0, and a full-width
 *   "Resolve Dispute" button. Nothing said a read had failed.
 *
 * ── THE GUARD'S OWN COMMENT SAID WHAT IT SHOULD HAVE DONE ───────────────────
 *
 *       // Guard: dispute must exist; order OR escrowData must be set
 *       // (but not necessarily both)
 *       if (!dispute) return null;
 *
 *   The comment states the rule. The code implements the first clause of it.
 *   That is this audit's most repeated finding written out in two lines — a
 *   correct rule applied to some of the places it names — and here it is not
 *   even spread across files, it is the line under the sentence.
 *
 * ── WHAT IT COSTS, STATED ACCURATELY ────────────────────────────────────────
 *
 *   NOT a wrong payout, and the first draft of this finding said it was. The
 *   server does the arithmetic from the escrow row it fetches itself:
 *
 *       refund_buyer / release_seller   send NO amount; the server uses
 *                                       freshEscrow.amount
 *       partial_refund with 0           refused — "A partial refund needs a
 *                                       refund amount greater than zero"
 *       partial_refund above the escrow refused, naming the escrow amount
 *
 *   Measured against the action, not assumed. No wrong figure can leave this
 *   screen. What it costs is an ADMINISTRATOR DECIDING BLIND — choosing
 *   between a buyer and a seller on a screen showing ₦0 and two empty panels,
 *   with no indication that anything failed. #588's rule, "a refusal and an
 *   empty result collapsed into one branch", on the screen that moves escrow.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the order read's else removed (the original defect)              KILLED
 *     the standalone-escrow read's else removed                        KILLED
 *     contextFailed set but the Resolve button still offered           KILLED
 *     the warning panel loses its retry                                KILLED
 *     contextFailed initialised true, so a good load is blocked        KILLED
 *     reword a comment / unmutated baseline               SURVIVED, both intended
 *
 *     the panel stops saying WHY it matters                         SURVIVED
 *                                          → then, one assertion:   KILLED
 *
 *   The survivor is recorded because the wording is the whole fix here. The
 *   first draft asserted "could not load the order or escrow record" and
 *   nothing else, so deleting "resolving it from here would mean deciding
 *   without the figures" left the suite green. An administrator told that
 *   something failed, but not that the ₦0 above is a default rather than the
 *   record, is barely better off than one told nothing.
 *
 * ── AND THEN #797 ITSELF SHIPPED THE DEFECT IT IS ABOUT ─────────────────────
 *
 *   The first version required BOTH the order AND an escrow row, so every
 *   dispute WITHOUT an escrow transaction lost its Resolve button. CI found it:
 *   `Admin can resolve dispute` timed out on main waiting for a control that
 *   was no longer drawn.
 *
 *   These actions report "no row" as `success: false`, and my mocks answered
 *   the same `fails()` for both — so neither the code nor this suite could tell
 *   an ABSENCE from a FAILURE. That collapse is the finding this file is named
 *   for, and I made it while fixing it.
 *
 *   The rule, which the guard's comment always stated: a dispute NAMES an
 *   order, or NAMES an escrow. Only the named record failing to load is
 *   context-critical. The escrow looked up BY orderId may legitimately not
 *   exist, and its absence must not withhold the control that moves money.
 *
 * ── AND THE INSTRUMENT WAS WRONG TWICE BEFORE IT MEASURED ANYTHING ──────────
 *
 *   Worth recording, because both failures were silent in the direction that
 *   fakes a pass:
 *
 *   1. `jest` imported from '@jest/globals' is NOT hoisted by
 *      babel-plugin-jest-hoist, so every jest.mock() below ran after the
 *      imports and mocked nothing. The page's real import graph loaded and the
 *      suite died on an ESM package four levels down — loudly, by luck.
 *   2. `use(props.params)` on a plain Promise suspends and never re-rendered
 *      under act(), so the tree was empty and all nine cases failed
 *      identically. The CONTROLS failing is what said "instrument, not code" —
 *      a suite whose controls fail is not measuring anything, and one whose
 *      controls are missing cannot tell you that.
 */

import React from 'react';
//   `jest` is the GLOBAL here, deliberately. babel-plugin-jest-hoist refuses
//   to hoist jest.mock() above the imports when `jest` comes from
//   '@jest/globals', so every mock below silently did nothing and the page's
//   real import graph loaded — which is how this suite first failed, on an
//   ESM package four levels down rather than on anything it asserts.
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';

const BASE_DISPUTE = {
    id: 'dis-1',
    orderId: 'ord-1',
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    status: 'open',
    reason: 'not_as_described',
    description: 'The yams arrived spoiled.',
    createdAt: '2026-09-01T00:00:00.000Z',
};

const ORDER = {
    id: 'ord-1',
    totalAmount: 50000,
    status: 'delivered',
    items: [],
    createdAt: '2026-08-30T00:00:00.000Z',
};

const ESCROW = { id: 'esc-1', amount: 50000, status: 'disputed' };

//   Each read's answer for one render, set per test.
let orderAnswer: any;
let escrowByOrderAnswer: any;
let escrowByIdAnswer: any;
let dispute: any;

const ok = (data: any) => ({ success: true, data });
const fails = () => ({ success: false, error: 'Read failed', data: null });

//   The established stubs for the ESM-only transitive deps this page's import
//   graph reaches. Same three lines as every other screen test here.
jest.mock('@/lib/redis', () => require('@/lib/testing/sweep-stubs').libRedis());
jest.mock('@upstash/redis', () => require('@/lib/testing/sweep-stubs').upstashRedis());

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), refresh: jest.fn() }),
}));
jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('@/app/actions/orders', () => ({
    __esModule: true,
    getOrderByIdAction: async () => orderAnswer,
}));
jest.mock('@/app/actions/marketplace', () => ({
    __esModule: true,
    getEscrowTransactionByOrderIdAction: async () => escrowByOrderAnswer,
    getEscrowTransactionByIdAction: async () => escrowByIdAnswer,
    escalateDisputeAction: async () => ok(null),
}));
jest.mock('@/app/actions/escalation-notes', () => ({
    __esModule: true,
    addEscalationNoteAction: async () => ok(null),
    getEscalationNotesAction: async () => ok({ notes: [] }),
}));
jest.mock('@/app/actions/disputes', () => ({
    __esModule: true,
    getDisputeByIdAction: async () => ok({ dispute }),
    updateDisputeStatusAction: async () => ok(null),
}));

import DisputeDetailPage from '@/app/admin/marketplace/disputes/[id]/page';

/**
 * `params` as React.use() can unwrap WITHOUT suspending.
 *
 *   The page does `use(props.params)`. A plain resolved Promise still suspends
 *   on first render and, under RTL's act(), the ping never re-rendered the
 *   tree — every assertion here failed identically, CONTROLS INCLUDED, which
 *   is what said the instrument was broken rather than the code. A suite whose
 *   controls fail is not measuring anything.
 *
 *   `use` reads the thenable's `status`/`value` first and returns synchronously
 *   when they are already set, which is exactly what React itself writes onto a
 *   promise it has resolved before.
 */
const fulfilled = <T,>(value: T) =>
    Object.assign(Promise.resolve(value), { status: 'fulfilled', value });

const renderPage = () =>
    render(
        <React.Suspense fallback={null}>
            <DisputeDetailPage params={fulfilled({ id: 'dis-1' }) as any} />
        </React.Suspense>,
    );

/** The control that moves escrow. */
const RESOLVE = /resolve dispute/i;
const WARNING = /cannot be resolved right now/i;

beforeEach(() => {
    dispute = { ...BASE_DISPUTE };
    orderAnswer = ok({ order: ORDER });
    escrowByOrderAnswer = ok(ESCROW);
    escrowByIdAnswer = ok(ESCROW);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#797 — an escrow decision is not offered against a blank screen', () => {
    it('A FAILED ORDER READ WITHHOLDS THE RESOLVE BUTTON', async () => {
        //   THE test. The screen used to render this exact state with a
        //   full-width "Resolve Dispute" button and a context amount of ₦0.
        orderAnswer = fails();
        renderPage();

        await waitFor(() => expect(screen.getByText(WARNING)).toBeTruthy());
        expect(screen.queryAllByRole('button', { name: RESOLVE })).toHaveLength(0);
    });

    it('and it SAYS the figures are incomplete, rather than showing ₦0 silently', async () => {
        orderAnswer = fails();
        renderPage();

        await waitFor(() => expect(screen.getByText(WARNING)).toBeTruthy());
        expect(screen.getByText(/could not load the order or escrow record/i)).toBeTruthy();
        //   AND WHY IT MATTERS, which the first draft did not assert: dropping
        //   this clause survived the sweep. "Something failed" without "so the
        //   figures are not the record's" leaves an administrator free to
        //   believe the ₦0 above is real.
        expect(screen.getByText(/deciding without the figures/i)).toBeTruthy();
    });

    it('and it says NOTHING IS LOST, which is #588\'s sentence', async () => {
        //   The administrator's first fear on this screen is that they have
        //   half-resolved something. They have not.
        orderAnswer = fails();
        renderPage();

        await waitFor(() => expect(screen.getByText(/Nothing is lost/i)).toBeTruthy());
    });

    it('and it offers a retry, because the read may well succeed', async () => {
        orderAnswer = fails();
        renderPage();

        await waitFor(() => expect(screen.getByText(WARNING)).toBeTruthy());
        expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    });

    it('CONTROL: NO ESCROW ROW for an order-origin dispute is still resolvable', async () => {
        /*
         *   THE CASE THE FIRST VERSION OF THIS SUITE DID NOT HAVE, AND CI DID.
         *
         *   #797 shipped requiring BOTH the order and an escrow row, and
         *   `Admin can resolve dispute` in e2e/platform-flows.spec.ts timed out
         *   on main waiting for a Resolve button that was no longer drawn. The
         *   seeded dispute names an order and has no escrow transaction — which
         *   is a legitimate shape, not a broken read.
         *
         *   My mocks answered `fails()` for "no escrow", so the suite could not
         *   tell an ABSENCE from a FAILURE — and neither could the code. I wrote
         *   this finding about exactly that collapse and then made it.
         *
         *   A dispute NAMES an order; it does not name an escrow. Absence here
         *   must not withhold the control that moves the money.
         */
        escrowByOrderAnswer = { success: true, data: null };
        renderPage();

        await waitFor(() => expect(screen.getByRole('button', { name: RESOLVE })).toBeTruthy());
        expect(screen.queryAllByText(WARNING)).toHaveLength(0);
    });

    it('CONTROL: and a REFUSED escrow lookup does not withhold it either', async () => {
        //   The same point through the other door: these actions report "no
        //   row" as success:false, so a refusal on a lookup the dispute did not
        //   name is indistinguishable from an absence and must be treated as
        //   one. The ORDER read below is the one that is allowed to block.
        escrowByOrderAnswer = fails();
        renderPage();

        await waitFor(() => expect(screen.getByRole('button', { name: RESOLVE })).toBeTruthy());
        expect(screen.queryAllByText(WARNING)).toHaveLength(0);
    });

    it('A STANDALONE ESCROW DISPUTE is guarded on its own read', async () => {
        //   The OTHER branch — a dispute carrying an escrowId and no orderId,
        //   which takes a different read entirely. #793 was partial precisely
        //   because a second branch went unguarded, so this one is asserted
        //   rather than assumed.
        dispute = { ...BASE_DISPUTE, orderId: undefined, escrowId: 'esc-1' };
        escrowByIdAnswer = fails();
        renderPage();

        await waitFor(() => expect(screen.getByText(WARNING)).toBeTruthy());
        expect(screen.queryAllByRole('button', { name: RESOLVE })).toHaveLength(0);
    });

    it('CONTROL: a standalone escrow dispute that LOADS is still resolvable', async () => {
        dispute = { ...BASE_DISPUTE, orderId: undefined, escrowId: 'esc-1' };
        renderPage();

        await waitFor(() => expect(screen.getByRole('button', { name: RESOLVE })).toBeTruthy());
        expect(screen.queryAllByText(WARNING)).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#797 — and a dispute that loaded is still resolvable', () => {
    it('CONTROL: every read succeeding still offers Resolve Dispute', async () => {
        /*
         *   Or this finding would have replaced "resolved blind" with "cannot
         *   be resolved at all", which strands real money in escrow — strictly
         *   worse than the defect.
         */
        renderPage();

        await waitFor(() => expect(screen.getByRole('button', { name: RESOLVE })).toBeTruthy());
        expect(screen.queryAllByText(WARNING)).toHaveLength(0);
    });

    it('CONTROL: and the order total reaches the screen, not the "0" default', async () => {
        renderPage();

        await waitFor(() => expect(screen.getByRole('button', { name: RESOLVE })).toBeTruthy());
        //   ₦50,000 is ORDER.totalAmount. Seeing it proves the successful path
        //   still prefills, which is what the withheld button is protecting.
        expect(screen.getAllByText(/50,000/).length).toBeGreaterThan(0);
    });
});
