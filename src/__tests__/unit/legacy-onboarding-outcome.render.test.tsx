/**
 * @jest-environment jsdom
 */

/**
 *   #290 THE IMPORT SCREEN ANNOUNCED AN EMAIL NOBODY HAD SENT, AND THREW AWAY
 *        THE ONLY CREDENTIAL FOR THE ACCOUNT IT HAD JUST CREATED.
 *
 *        onboardLegacyMemberAction has always had THREE outcomes:
 *
 *          new member, email sent      the temporary PIN reached them
 *          new member, email FAILED    success:true, and the return says
 *                                      "Please share the temporary PIN (NNNNNN)
 *                                      with the member manually"
 *          existing member             profile updated, NO email sent at all,
 *                                      existing password untouched
 *
 *        ImportLegacyModal — the only caller, rendered by five admin pages
 *        (academy, export, wave, farm-nation, cooperative members) — read
 *        `result.success`, discarded everything else, and printed one hardcoded
 *        sentence for all three:
 *
 *            "A welcome email with a secure password setup link has been sent
 *             to {email}."
 *
 *        THREE THINGS WRONG WITH THAT.
 *
 *        1. IT IS NOT A SETUP LINK. sendLegacyMemberWelcomeEmail sends a
 *           six-digit PIN the member signs in with; getPostLoginRedirect then
 *           forces them through /auth/reset-legacy-password. An admin reading
 *           "setup link" tells the member to wait for something that does not
 *           exist.
 *
 *        2. FOR AN EXISTING MEMBER, NO EMAIL IS SENT. The send is guarded by
 *           `if (isNewUser)`. Re-importing somebody who already has an account
 *           updates their profile silently — and the screen said an email had
 *           gone out.
 *
 *        3. WHEN THE SEND FAILED, THE PIN WAS DESTROYED. This is the one that
 *           costs somebody their account. The action deliberately returns
 *           SUCCESS in that case, because the member really does exist, and
 *           hands back the PIN with instructions to relay it. The modal
 *           discarded it and claimed the email had been sent. The member never
 *           receives anything and cannot sign in; the admin has no idea and no
 *           reason to look.
 *
 *        The failure is not exotic — #217 was a missing email key that was
 *        silent in production, i.e. exactly this branch, firing for everybody.
 *
 * WHY THE ACTION GREW FIELDS
 * --------------------------
 * The outcome was already stated, in prose, in `message`. A caller that has to
 * parse English to find out what happened will not do it, and for the life of
 * this feature it did not. `message` is unchanged — the four existing
 * assertions on it still hold — and `isNewUser`, `emailSent` and
 * `temporaryPassword` now say the same thing in a form a screen can branch on.
 * That is #288's shape one screen over: a reason composed and never read.
 *
 * WHY THIS SUITE MOUNTS THE COMPONENT
 * -----------------------------------
 * Because on #287 a source ratchet was not enough — a dead `if (false)` branch
 * kept every text assertion passing while the screen stayed silent. Reading
 * text cannot tell live code from dead code. So this fills all six steps,
 * submits, and reads what an admin would actually see.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'fs';
import { join } from 'path';

const MODAL_FILE = 'src/components/admin/ImportLegacyModal.tsx';

const mockOnboard = jest.fn() as jest.Mock<any>;

jest.mock('@/app/actions/admin', () => ({
    onboardLegacyMemberAction: (...a: any[]) => mockOnboard(...a),
}));

/** The headless-ui dialog, flattened — this suite is about what is inside it. */
jest.mock('@/components/ui/Modal', () => ({
    __esModule: true,
    default: ({ isOpen, children }: any) => (isOpen ? <div>{children}</div> : null),
}));

jest.mock('@/components/shared/MasterUploader', () => ({
    __esModule: true,
    default: () => null,
}));

import ImportLegacyModal from '@/components/admin/ImportLegacyModal';

/** Fills the two validated steps and clicks through to the last one. */
async function walkToSubmit(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/full name/i), 'Ada Chidinma Obi');
    await user.type(screen.getByLabelText(/email address/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/phone number/i), '+2348012345678');
    await user.click(screen.getByRole('button', { name: /next/i }));

    await user.selectOptions(screen.getByLabelText(/^state/i), 'Enugu');
    await user.type(screen.getByLabelText(/lga|local government/i), 'Nsukka');
    await user.type(screen.getByLabelText(/address/i), '12 Ogui Road');
    await user.click(screen.getByRole('button', { name: /next/i }));

    // Next of Kin, Documents, Financial, Module Details — none of them validated.
    for (let i = 0; i < 3; i++) {
        await user.click(screen.getByRole('button', { name: /next/i }));
    }

    await waitFor(() => expect(screen.getByRole('button', { name: /complete onboarding/i })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /complete onboarding/i }));
}

function renderModal() {
    return render(
        <ImportLegacyModal module="cooperative" isOpen onClose={() => {}} onSuccess={() => {}} />
    );
}

describe('#290 — what the admin is told after an import', () => {
    beforeEach(() => jest.clearAllMocks());

    it('A NEW MEMBER WHOSE EMAIL WENT OUT: a temporary PIN, and no PIN on screen', async () => {
        const user = userEvent.setup();
        mockOnboard.mockResolvedValue({
            success: true, error: null, isNewUser: true, emailSent: true, temporaryPassword: null,
            message: 'Legacy member Ada Chidinma Obi successfully onboarded. Default PIN sent to ada@example.com.',
        });

        renderModal();
        await walkToSubmit(user);

        await screen.findByText(/successfully onboarded/i);
        // It is a PIN they sign in with, not a link they click.
        expect(document.body.textContent).toMatch(/temporary PIN/i);
        expect(document.body.textContent).not.toMatch(/password setup link/i);
        expect(document.body.textContent).toContain('ada@example.com');
        // Nothing to relay, so nothing alarming.
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('A FAILED EMAIL: the PIN IS SHOWN, and the admin is told to pass it on', async () => {
        // THE test. This used to render "a welcome email has been sent" and
        // drop the PIN, leaving an account nobody could get into.
        const user = userEvent.setup();
        mockOnboard.mockResolvedValue({
            success: true, error: null, isNewUser: true, emailSent: false, temporaryPassword: '481902',
            message: 'Legacy member Ada Chidinma Obi successfully onboarded, but the welcome email failed to send. Please share the temporary PIN (481902) with the member manually.',
        });

        renderModal();
        await walkToSubmit(user);

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toMatch(/did NOT send/i);
        expect(alert.textContent).toContain('481902');
        // And it must not simultaneously claim the email arrived.
        expect(document.body.textContent).not.toMatch(/has been sent to/i);
    });

    it('AN EXISTING MEMBER: updated, and NO email was sent', async () => {
        // The action guards the send with `if (isNewUser)`. Re-running the
        // import against somebody who already has an account changes their
        // profile and sends nothing — and the screen said otherwise.
        const user = userEvent.setup();
        mockOnboard.mockResolvedValue({
            success: true, error: null, isNewUser: false, emailSent: false, temporaryPassword: null,
            message: 'Legacy member Ada Chidinma Obi successfully updated.',
        });

        renderModal();
        await walkToSubmit(user);

        await screen.findByText(/profile updated/i);
        expect(document.body.textContent).toMatch(/no email was sent/i);
        expect(document.body.textContent).toMatch(/existing password is unchanged/i);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('and a refusal is still shown as a refusal', async () => {
        // Vacuity guard from the other side: this component always handled the
        // failure branch correctly, and rewriting the success panel must not
        // have cost that.
        const user = userEvent.setup();
        mockOnboard.mockResolvedValue({ success: false, error: 'Only a super admin can onboard a member with admin roles' });

        renderModal();
        await walkToSubmit(user);

        await screen.findByText(/only a super admin/i);
        expect(document.body.textContent).not.toMatch(/successfully onboarded/i);
    });

    it('a server that reports no outcome fields is treated as unconfirmed, not as sent', async () => {
        // Fail toward the truthful half. If the fields go missing — an older
        // deployment, a proxy that strips them — the screen must not resume
        // announcing an email it cannot know about.
        const user = userEvent.setup();
        mockOnboard.mockResolvedValue({ success: true, error: null, message: 'Done.' });

        renderModal();
        await walkToSubmit(user);

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toMatch(/did NOT send/i);
        // No PIN was returned, so it says what to do instead of showing nothing.
        expect(alert.textContent).toMatch(/password reset/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#290 — the sentence that was never true', () => {
    it('"password setup link" appears nowhere in the component', () => {
        // Both the success panel AND the banner at the top of the form said it,
        // so fixing one would have left the other. Asserted over the whole file
        // rather than one panel for exactly that reason.
        const src = readFileSync(join(process.cwd(), MODAL_FILE), 'utf-8');
        const live = src.split('\n')
            .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
            .join('\n');

        expect(live).not.toMatch(/password setup link/i);
    });
});
