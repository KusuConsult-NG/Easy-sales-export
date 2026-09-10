/**
 * @jest-environment jsdom
 */

/**
 *   #593 THE ESCROW CHAT FETCHED THE TRANSACTION, PUT IT IN STATE, AND DREW
 *        NONE OF IT — AND THE AUTHORISATION IT WORKED OUT WAS READ BY NOTHING
 *        EITHER.
 *
 *   `checkAuthorization` reads the escrow row through
 *   getEscrowTransactionByIdAction — and #560 made the SERVER read it too, so
 *   the row arrives with the page and is paid for twice over — then:
 *
 *       setEscrowData(escrow);
 *       setAuthorized(true);
 *
 *   Neither state was ever read again. Grep the file: `escrowData` appears on
 *   the line that declares it and the line that sets it, and `authorized` the
 *   same. The header rendered:
 *
 *       Escrow Chat
 *       Transaction #a3f19c2b
 *
 *   So a buyer and a seller arguing about a consignment — and an admin dropping
 *   into the chat in Admin Mode to decide whether to release or refund — had
 *   eight hex characters to tell them WHICH transaction this is, WHAT it is for,
 *   HOW MUCH is held and WHETHER it has been released already. Every one of
 *   those was in `escrowData`, one screen away, unread.
 *
 *   THIS IS #348's AND #590's SHAPE, for the third time: a value collected,
 *   stored, handed to the screen and shown to nobody. #590's bill of lading was
 *   found by a field sweep; this one was found while fixing #592's failed-read
 *   panel on the same screen, which is the usual way — one defect is what makes
 *   you read the file that holds the next.
 *
 * ── WHAT IS NOT CLAIMED, AND THIS MATTERS ───────────────────────────────────
 *
 *   THE DEAD `authorized` FLAG IS NOT A SECURITY HOLE, AND SAYING IT WAS WOULD
 *   HAVE BEEN THE LOUDER, FALSER FINDING. Both reads are authorised on the
 *   server, and I checked before writing this: getEscrowMessagesAction
 *   re-fetches the escrow row and refuses anyone who is not the buyer, the
 *   seller or an overseer with "Access denied" — logging the attempt — and
 *   getEscrowTransactionByIdAction refuses the same set with "Not authorized to
 *   view this escrow". A non-participant who reached this URL got an empty
 *   chat frame and a redirect, never a message.
 *
 *   What the flag was worth is the seconds before that redirect lands: a chat
 *   shell with a working-looking composer, over a transaction that is not
 *   theirs. It is used now, which is also simply what a screen that decides
 *   something ought to do with the decision.
 *
 *   NO NEW PERMISSION AND NO NEW READ. The row was already fetched, already in
 *   state, and already seeded by the server; every field drawn here is one the
 *   viewer is a participant in.
 *
 *   THE STATUS VOCABULARY IS THE SHARED ONE. lib/escrow-status exists because
 *   two callers writing their own status sets is how the last two escrow
 *   defects happened, so the label map lives there and is EXHAUSTIVE by type: a
 *   ninth status cannot be added to ESCROW_STATUSES without a name a person can
 *   read. /escrow's own four-step STEPS array stays as it is — those name the
 *   stages of a stepper, not the statuses, and half the statuses have no stage.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';

import { escrowStatusLabel } from '@/lib/escrow-status';

const getEscrowMessagesAction = jest.fn() as jest.Mock<any>;
const getEscrowTransactionByIdAction = jest.fn() as jest.Mock<any>;
const push = jest.fn();

jest.mock('@/app/actions/marketplace', () => ({
    getEscrowMessagesAction: (...a: any[]) => getEscrowMessagesAction(...a),
    getEscrowTransactionByIdAction: (...a: any[]) => getEscrowTransactionByIdAction(...a),
    sendEscrowMessageAction: jest.fn(),
}));
jest.mock('@/contexts/ToastContext', () => ({
    useToast: () => ({ showToast: jest.fn() }),
}));
jest.mock('next-auth/react', () => ({
    useSession: () => ({
        data: { user: { id: 'buyer-1', name: 'Ada', email: 'ada@example.com', roles: [] } },
        status: 'authenticated',
    }),
}));
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: (...a: any[]) => push(...a), replace: jest.fn(), refresh: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/escrow/esc-1/chat',
    useParams: () => ({ id: 'esc-1' }),
}));

const ESCROW = {
    id: 'a3f19c2b-0000-4000-8000-000000000000',
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    amount: 480_000,
    productName: 'Grade A Sesame Seeds, 20MT',
    status: 'funded',
};

async function chat(escrow: any = ESCROW) {
    getEscrowTransactionByIdAction.mockResolvedValue(
        escrow === null
            ? { success: false, error: 'Not authorized to view this escrow', data: null }
            : { success: true, error: null, data: escrow }
    );
    getEscrowMessagesAction.mockResolvedValue({ success: true, error: null, data: [] });
    const { default: EscrowChatClient } =
        await import('@/app/escrow/[id]/chat/EscrowChatClient');
    return render(<EscrowChatClient escrowId={ESCROW.id} initial={null} />);
}

beforeEach(() => {
    jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#593 — the header says which escrow, and for how much', () => {
    it('THE PRODUCT, THE AMOUNT AND THE STATUS ARE ALL ON SCREEN', async () => {
        const { container } = await chat();

        await waitFor(() => expect(container.textContent).toContain('Grade A Sesame Seeds, 20MT'));
        //   The amount as the person's own currency reads it, not a bare number.
        expect(container.textContent).toMatch(/₦\s?480,000/);
        expect(container.textContent).toContain('Funds held in escrow');
    });

    it('AND THE TRANSACTION REFERENCE IS STILL THERE, BECAUSE IT IS WHAT SUPPORT ASKS FOR', async () => {
        const { container } = await chat();

        await waitFor(() => expect(container.textContent).toContain('a3f19c2b'));
    });

    it('AND A ROW WITH NOTHING ON IT DOES NOT PRINT "undefined" AT SOMEBODY', async () => {
        /**
         *   Older escrow rows exist and this screen must not become the place
         *   that breaks on them. Each field is drawn only when it is there:
         *   no product name falls back to the old title, no amount draws no
         *   amount, and an unrecognised status draws no status rather than a
         *   raw database value.
         */
        const { container } = await chat({ id: 'x', buyerId: 'buyer-1', sellerId: 'seller-1' });

        await waitFor(() => expect(container.textContent).toContain('Escrow Chat'));
        expect(container.textContent).not.toMatch(/undefined|NaN|\[object/);
        expect(container.textContent).not.toMatch(/held/);
    });

    it('AND A STATUS NOBODY WRITES DRAWS NO STATUS AT ALL', async () => {
        const { container } = await chat({ ...ESCROW, status: 'something_else' });

        await waitFor(() => expect(container.textContent).toContain('Grade A Sesame Seeds, 20MT'));
        expect(container.textContent).not.toContain('something_else');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#593 — and the authorisation it works out is used', () => {
    it('SOMEBODY WHO MAY NOT SEE THIS CHAT DOES NOT GET THE CHAT FRAME', async () => {
        /**
         *   NOT A SECURITY FIX — see the header. The messages were never
         *   readable: getEscrowMessagesAction refuses a non-participant on the
         *   server. This is about the composer that looked usable for the
         *   seconds before the redirect.
         */
        const { container } = await chat(null);

        await waitFor(() => expect(push).toHaveBeenCalledWith('/escrow'));
        expect(container.textContent).not.toMatch(/type your message|secure messaging|escrow chat/i);
    });

    it('AND A PARTICIPANT DOES', async () => {
        //   THE vacuity guard: a gate that never opens is not a gate.
        const { container } = await chat();

        await waitFor(() => expect(container.textContent).toMatch(/secure messaging/i));
        expect(push).not.toHaveBeenCalled();
    });

    it('AND SO DOES THE SELLER ON THE OTHER SIDE OF IT', async () => {
        const { container } = await chat({ ...ESCROW, buyerId: 'someone-else', sellerId: 'buyer-1' });

        await waitFor(() => expect(container.textContent).toMatch(/secure messaging/i));
        expect(push).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#593 — the shared status label', () => {
    it('EVERY STATUS THE APPLICATION WRITES HAS A NAME A PERSON CAN READ', async () => {
        const { ESCROW_STATUSES } = await import('@/lib/escrow-status');

        for (const status of ESCROW_STATUSES) {
            const label = escrowStatusLabel(status);
            expect({ status, label }).toEqual({ status, label: expect.any(String) });
            //   And it is not just the raw value with the underscore left in.
            expect(label).not.toContain('_');
        }
    });

    it('AND THE THREE NEAR-MISSES THE VOCABULARY ALREADY MAPS ARE MAPPED HERE TOO', async () => {
        //   normaliseEscrowStatus exists because "paid", "completed" and
        //   "shipped" have been confused with escrow statuses before. The label
        //   goes through it rather than round it.
        expect(escrowStatusLabel('paid')).toBe('Funds held in escrow');
        expect(escrowStatusLabel('completed')).toBe('Released to seller');
        expect(escrowStatusLabel('shipped')).toBe('In transit');
    });

    it('AND ANYTHING ELSE IS NULL, NOT ITSELF', async () => {
        //   Null rather than the raw string: a screen that prints whatever it
        //   was handed shows "undefined" or a stray database value to the person
        //   reading it.
        for (const value of [undefined, null, '', 'nonsense', 42, {}]) {
            expect({ value, label: escrowStatusLabel(value) }).toEqual({ value, label: null });
        }
    });
});

/**
 * ── THE MUTATION TABLE ──────────────────────────────────────────────────────
 *
 *   Against a green baseline, one anchored swap at a time, each restored and
 *   verified with `diff -q` before the next:
 *
 *     the product name dropped from the header      KILLED (2 tests)
 *     the amount dropped from the header            KILLED
 *     the status dropped from the header            KILLED
 *     the amount drawn without its guard            KILLED (the bare-row test)
 *     escrowStatusLabel returns the raw value       KILLED (5)
 *     escrowStatusLabel skips normaliseEscrowStatus KILLED
 *     one label emptied in the map                  KILLED
 *     the authorised gate removed                   KILLED
 *     the gate inverted to `if (authorized)`        KILLED (6 — the vacuity
 *                                                   guard, and #592's suite on
 *                                                   the same screen)
 *     reword this header                            SURVIVED, as intended
 *
 *   No mutant survived. #592's suite was run alongside this one throughout,
 *   because both change the same screen and a gate added here could have
 *   quietly broken the failed-read panel added there.
 */
