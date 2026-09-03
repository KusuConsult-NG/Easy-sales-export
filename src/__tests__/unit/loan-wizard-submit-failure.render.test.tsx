/**
 * @jest-environment jsdom
 */

/**
 *   #287 A REFUSED LOAN APPLICATION PRODUCED NOTHING AT ALL — MOUNTED AND
 *        OBSERVED.
 *
 *        The sibling suite, loan-application-refusal-is-visible.test.ts, pins
 *        the fix by reading the source. That was not enough, and the mutation
 *        run proved it: replacing the real catch with
 *
 *            } catch (swallowed) { void swallowed; }
 *            if (false) { try { void 0; } catch (err) { ... setSubmitError(...) } }
 *
 *        left every text assertion passing — `/\}\s*catch\s*\(/` still matched,
 *        `setSubmitError(` was still present — while the wizard was silent
 *        again. That is #276's M3/M4 lesson a second time: a source ratchet
 *        looking for a string cannot tell live code from dead code, because
 *        `if (false)` preserves the string.
 *
 *        So this file MOUNTS the wizard, fills all four steps, presses Submit
 *        against an onSubmit that rejects, and asserts the applicant is told.
 *        There is no way to satisfy it without the message actually reaching
 *        the screen.
 *
 * WHAT IT ALSO BUYS
 * -----------------
 * The component layer of this codebase sits at 0% executed statements for 104
 * of its 106 files, and LoanWizard was one of them. This is the first test that
 * runs it.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * framer-motion, flattened.
 *
 * The wizard wraps each step in `<AnimatePresence mode="wait">`, which holds
 * the outgoing step until its EXIT animation finishes. jsdom drives no
 * animation frames, so the exit never completes and the next step never mounts
 * — pressing Next left the screen on step 1 forever, which is a property of the
 * test environment and not of the component. Replacing motion elements with
 * plain ones removes the animation and changes nothing about the logic under
 * test.
 */
jest.mock('framer-motion', () => {
    const React = require('react');
    const strip = ({ children, ...rest }: any) => {
        const {
            initial, animate, exit, transition, whileHover, whileTap, whileInView,
            layout, layoutId, variants, custom, ...domProps
        } = rest;
        return React.createElement('div', domProps, children);
    };
    return {
        __esModule: true,
        AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
        motion: new Proxy({}, { get: () => strip }),
    };
});

const mockUpload = jest.fn() as jest.Mock<any>;

jest.mock('@/app/actions/upload', () => ({
    uploadDocumentAction: (...a: any[]) => mockUpload(...a),
}));

/**
 * Stubbed to a single button. The real DocumentUpload has a drag-and-drop
 * surface and its own validation; this suite is about what LoanWizard does with
 * a REFUSAL, and driving a file picker through four steps to get there would
 * make the test about the uploader instead.
 */
jest.mock('@/components/shared/DocumentUpload', () => ({
    __esModule: true,
    default: ({ label, onUpload }: any) => (
        <button
            type="button"
            onClick={() => onUpload(new File(['x'], 'id.pdf', { type: 'application/pdf' }))}
        >
            {`attach ${label}`}
        </button>
    ),
}));

import { LoanWizard } from '@/components/loans/LoanWizard';

/** Fills every step and stops on the review step, with Submit showing. */
async function walkToReview(user: ReturnType<typeof userEvent.setup>) {
    // Step 1 — the defaults (₦10,000, agriculture, 12 months) already satisfy
    // loanApplicationSchema, so nothing to type.
    await user.click(screen.getByRole('button', { name: /next/i }));

    // Step 2 — collateral.
    await user.type(screen.getByLabelText(/collateral type/i), 'Inventory');
    await user.clear(screen.getByLabelText(/estimated value/i));
    await user.type(screen.getByLabelText(/estimated value/i), '500000');
    await user.type(screen.getByLabelText(/description/i), 'Shop inventory held at the Enugu premises');
    await user.click(screen.getByRole('button', { name: /next/i }));

    // Step 3 — business details.
    await user.type(screen.getByLabelText(/business name/i), 'Ada Stores');
    await user.type(screen.getByLabelText(/business type/i), 'Retail');
    await user.type(screen.getByLabelText(/years in operation/i), '4');
    await user.type(screen.getByLabelText(/annual revenue/i), '4800000');
    await user.click(screen.getByRole('button', { name: /next/i }));

    // Step 4 — one document, which is what the schema asks for.
    await user.click(screen.getByRole('button', { name: /attach government-issued id/i }));
    await waitFor(() => expect(screen.getByText(/uploaded \(1\)/i)).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /submit application/i })).toBeTruthy());
}

describe('#287 — LoanWizard, mounted', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUpload.mockResolvedValue({ success: true, url: 'https://example.com/id.pdf' });
    });

    it('THE APPLICANT IS TOLD WHY THE APPLICATION WAS REFUSED', async () => {
        // THE test. Before the fix this rendered nothing at all: the button
        // returned to "Submit Application" and the screen was unchanged.
        const user = userEvent.setup();
        const onSubmit = jest.fn(async () => {
            throw new Error('You already have a loan application in progress.');
        });

        render(<LoanWizard onSubmit={onSubmit as any} />);
        await walkToReview(user);
        await user.click(screen.getByRole('button', { name: /submit application/i }));

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toContain('You already have a loan application in progress.');
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('and a failure with no message still says something', async () => {
        // A rejection that is not an Error, or an Error with an empty message,
        // must not render an empty red box.
        const user = userEvent.setup();
        const onSubmit = jest.fn(async () => { throw 'nope'; });

        render(<LoanWizard onSubmit={onSubmit as any} />);
        await walkToReview(user);
        await user.click(screen.getByRole('button', { name: /submit application/i }));

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toMatch(/could not be submitted/i);
    });

    it('the button comes back so the applicant can act on what they were told', async () => {
        // The finally was the one part that always worked. Pinned, because a
        // message beside a permanently disabled button is no better than
        // silence.
        const user = userEvent.setup();
        const onSubmit = jest.fn(async () => { throw new Error('Refused'); });

        render(<LoanWizard onSubmit={onSubmit as any} />);
        await walkToReview(user);
        await user.click(screen.getByRole('button', { name: /submit application/i }));

        await screen.findByRole('alert');
        expect(screen.getByRole('button', { name: /submit application/i })
            .hasAttribute('disabled')).toBe(false);
    });

    it('NOTHING IS SHOWN WHEN THE APPLICATION IS ACCEPTED', async () => {
        // Vacuity guard. A component that rendered the alert unconditionally
        // would pass every test above and tell every successful applicant their
        // application had failed.
        const user = userEvent.setup();
        const onSubmit = jest.fn(async () => { /* the page navigates away */ });

        render(<LoanWizard onSubmit={onSubmit as any} />);
        await walkToReview(user);
        await user.click(screen.getByRole('button', { name: /submit application/i }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('and a second attempt clears the first refusal', async () => {
        // Otherwise a stale message sits under a submission that has since
        // succeeded — the failure mode of adding error state without resetting
        // it.
        const user = userEvent.setup();
        const onSubmit = jest.fn()
            .mockImplementationOnce(async () => { throw new Error('First refusal'); })
            .mockImplementationOnce(async () => { /* accepted */ });

        render(<LoanWizard onSubmit={onSubmit as any} />);
        await walkToReview(user);

        await user.click(screen.getByRole('button', { name: /submit application/i }));
        await screen.findByRole('alert');

        await user.click(screen.getByRole('button', { name: /submit application/i }));
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    });
});
