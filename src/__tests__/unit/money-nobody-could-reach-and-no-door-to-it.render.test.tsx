/**
 * @jest-environment jsdom
 */

/**
 *   #811 THE REPAIR FOR STRANDED MONEY HAD NO DOOR.
 *
 *   `findStrandedWalletsAction` and `consolidateWalletAction` were written,
 *   tested and shipped with NO CALLER. Money moves at the LIVE id and nowhere
 *   else — credit_wallet_once inserts at `p_user_id`, debit_wallet_once updates
 *   `WHERE id = p_user_id`, and that id is the session's, live by construction
 *   (#490 ranks a superseded row last at login). So a balance filed under a
 *   superseded profile cannot be received into, spent from or withdrawn, by the
 *   member or by anybody.
 *
 *   The platform could DETECT that, REFUSE to create more of it, and do nothing
 *   about what was already there. Migration 046 gave it the one safe way to
 *   move such a balance — one transaction, both sides or neither, with the
 *   pointer re-read inside it — and the only way to reach that function was a
 *   database console.
 *
 *   AN ADMIN WHO CANNOT REACH THE REPAIR REACHES FOR RAW SQL. Two hand-written
 *   UPDATE statements against two wallet rows is exactly what 046 exists to
 *   make unnecessary: a crash between them does not lose money, it MINTS it.
 *
 * ── WHAT IS ASSERTED, AND WHY IT IS RENDERED RATHER THAN GREPPED ────────────
 *
 *   The screen makes three promises that a source ratchet cannot check, because
 *   each is about what does or does not APPEAR:
 *
 *     a failed scan says so, and never renders as "no money is stranded"
 *     there is no destination field — the destination is read, not chosen
 *     `scanned` is shown beside the count, so a zero can be trusted
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const findStrandedWalletsAction = jest.fn() as jest.Mock<any>;
const consolidateWalletAction = jest.fn() as jest.Mock<any>;

jest.mock('@/app/actions/admin', () => ({
    findStrandedWalletsAction: (...a: any[]) => findStrandedWalletsAction(...a),
    consolidateWalletAction: (...a: any[]) => consolidateWalletAction(...a),
}));

import StrandedWalletsPage from '@/app/admin/forensics/stranded-wallets/page';

const STRANDED = {
    fromId: 'old-profile-1',
    toId: 'live-profile-1',
    balance: 42_500,
    email: 'ada@example.com',
    fullName: 'Ada Okonkwo',
};

const ok = (data: unknown) => ({ success: true, data });

beforeEach(() => {
    jest.clearAllMocks();
});

const load = async () => {
    render(<StrandedWalletsPage />);
    fireEvent.click(screen.getByRole('button', { name: /find stranded balances/i }));
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#811 — the door exists at all', () => {
    it('IT CALLS THE ACTION THAT HAD NO CALLER', async () => {
        findStrandedWalletsAction.mockResolvedValue(ok({ stranded: [], scanned: 0 }));

        await load();

        await waitFor(() => expect(findStrandedWalletsAction).toHaveBeenCalled());
    });

    it('AND NOT ON NAVIGATION — the scan pages the whole users table', async () => {
        //   Firing on mount charges a table walk to every visit. The forensic
        //   scan beside it makes the same choice for the same reason.
        findStrandedWalletsAction.mockResolvedValue(ok({ stranded: [], scanned: 0 }));

        render(<StrandedWalletsPage />);

        expect(findStrandedWalletsAction).not.toHaveBeenCalled();
    });

    it('AND MOVING A BALANCE REACHES THE OTHER ONE, with the pointer it read', async () => {
        findStrandedWalletsAction.mockResolvedValue(ok({ stranded: [STRANDED], scanned: 1 }));
        consolidateWalletAction.mockResolvedValue(ok({ moved: true, amount: 42_500, toBalance: 42_500 }));

        await load();
        await screen.findByText(/Ada Okonkwo/);

        fireEvent.change(screen.getByPlaceholderText(/Same person/i),
            { target: { value: 'Same person, duplicate settled on 12 March.' } });
        fireEvent.click(screen.getByRole('button', { name: /Move .* to the live profile/i }));

        await waitFor(() => expect(consolidateWalletAction).toHaveBeenCalledWith({
            fromId: 'old-profile-1',
            toId: 'live-profile-1',
            reason: 'Same person, duplicate settled on 12 March.',
        }));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#811 — a failed scan is a failure, not a clean bill of health', () => {
    /**
     * #313's rule, and it matters more here than almost anywhere: this is the
     * screen somebody reads to decide whether anybody's money is stuck.
     */
    it('A REFUSED SCAN SAYS SO, AND DOES NOT SAY "no money is stranded"', async () => {
        findStrandedWalletsAction.mockResolvedValue({ success: false, error: 'Forbidden', data: null });

        await load();

        expect(await screen.findByText('Forbidden')).toBeInTheDocument();
        expect(screen.queryByText(/No money is stranded/i)).not.toBeInTheDocument();
    });

    it('AND A THROWN SCAN DOES THE SAME', async () => {
        findStrandedWalletsAction.mockRejectedValue(new Error('network'));

        await load();

        expect(await screen.findByText(/Could not read the wallets/i)).toBeInTheDocument();
        expect(screen.queryByText(/No money is stranded/i)).not.toBeInTheDocument();
    });

    it('POSITIVE CONTROL: A GENUINELY EMPTY RESULT *DOES* SAY SO', async () => {
        //   Without this, the two assertions above could be measuring a screen
        //   that never renders the all-clear at all.
        findStrandedWalletsAction.mockResolvedValue(ok({ stranded: [], scanned: 272 }));

        await load();

        expect(await screen.findByText(/No money is stranded/i)).toBeInTheDocument();
    });

    it('AND THE ALL-CLEAR CARRIES THE NUMBER EXAMINED, so the zero can be trusted', async () => {
        //   "0 stranded" means something different when 272 wallets were read
        //   and when none were. The figure that tells those apart is the one an
        //   operator needs.
        findStrandedWalletsAction.mockResolvedValue(ok({ stranded: [], scanned: 272 }));

        await load();

        await screen.findByText(/No money is stranded/i);
        expect(screen.getByText('272')).toBeInTheDocument();
        expect(screen.getByText(/Superseded profiles with a wallet, examined/i)).toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#811 — the destination is read, never chosen', () => {
    /**
     * The design claim. Migration 046 refuses any pair the platform does not
     * already record as one person, so a destination field would be a form that
     * lies about what it can do — and a transfer primitive with an admin's hand
     * on it if the guard ever slipped.
     */
    beforeEach(() => {
        findStrandedWalletsAction.mockResolvedValue(ok({ stranded: [STRANDED], scanned: 1 }));
    });

    it('AND THE ALL-CLEAR IS ABSENT WHILE MONEY IS STRANDED', async () => {
        //   A mutant that rendered the all-clear unconditionally survived the
        //   first run of this suite: the error tests hold `report` at null, so
        //   the whole block is unrendered there and they cannot see it. The
        //   case that can is this one — money on the screen, and no banner
        //   above it saying there is none.
        await load();
        await screen.findByText(/Ada Okonkwo/);

        expect(screen.queryByText(/No money is stranded/i)).not.toBeInTheDocument();
    });

    it('THE LIVE PROFILE IS SHOWN AS A FACT, not as an input', async () => {
        await load();
        await screen.findByText(/Ada Okonkwo/);

        expect(screen.getByText('live-profile-1')).toBeInTheDocument();
        expect(screen.getByText(/read from the record, not chosen/i)).toBeInTheDocument();

        //   Exactly one text input on the card, and it is the reason.
        const inputs = screen.getAllByRole('textbox');
        expect(inputs).toHaveLength(1);
        expect(inputs[0]).toHaveAttribute('placeholder', expect.stringMatching(/Same person/i));
    });

    it('AND THE AMOUNT AND BOTH IDS ARE ON THE SCREEN BEFORE THE DECISION', async () => {
        //   TWO rows, with DIFFERENT balances, on purpose. With one row the
        //   total equals that row's balance and the same string appears twice —
        //   so the assertion could not tell the per-record figure from the
        //   headline, and the first version of this test failed on exactly that
        //   ambiguity rather than on anything about the screen.
        const second = { ...STRANDED, fromId: 'old-profile-2', balance: 7_500, fullName: 'Bola Adeyemi' };
        findStrandedWalletsAction.mockResolvedValue(ok({ stranded: [STRANDED, second], scanned: 2 }));

        await load();
        await screen.findByText(/Ada Okonkwo/);

        //   Each record's own amount, and the headline that is their sum.
        expect(screen.getByText('₦42,500')).toBeInTheDocument();
        expect(screen.getByText('₦7,500')).toBeInTheDocument();
        expect(screen.getByText('₦50,000')).toBeInTheDocument();

        expect(screen.getByText('old-profile-1')).toBeInTheDocument();
        expect(screen.getByText('old-profile-2')).toBeInTheDocument();
        expect(screen.getAllByText('live-profile-1')).toHaveLength(2);
    });

    it('A MOVE WITHOUT A REASON IS REFUSED BEFORE IT IS SENT', async () => {
        //   The server requires it too — this only saves the round trip. What
        //   matters is that the audit row can never be written without one.
        await load();
        await screen.findByText(/Ada Okonkwo/);

        fireEvent.click(screen.getByRole('button', { name: /Move .* to the live profile/i }));

        expect(await screen.findByText(/Say why this balance is being moved/i)).toBeInTheDocument();
        expect(consolidateWalletAction).not.toHaveBeenCalled();
    });

    it("AND THE SERVER'S OWN REFUSAL IS SHOWN, not flattened", async () => {
        //   Every refusal comes from migration 046 and each asks for something
        //   different. "Could not move" would take away the part that says what
        //   to do next.
        consolidateWalletAction.mockResolvedValue({
            success: false,
            error: 'Those two records are not linked. A balance can only be moved to the profile '
                + 'the old one already points at, so settle the duplicate first.',
            data: null,
        });

        await load();
        await screen.findByText(/Ada Okonkwo/);
        fireEvent.change(screen.getByPlaceholderText(/Same person/i),
            { target: { value: 'Settled last week.' } });
        fireEvent.click(screen.getByRole('button', { name: /Move .* to the live profile/i }));

        expect(await screen.findByText(/settle the duplicate first/i)).toBeInTheDocument();
    });

    it('and "nothing to move" reads as the ordinary answer it is', async () => {
        //   Not a failure: the balance reached zero between the read and the
        //   call, so the state asked for holds.
        consolidateWalletAction.mockResolvedValue(ok({ moved: false, amount: 0, toBalance: 0 }));
        findStrandedWalletsAction.mockResolvedValue(ok({ stranded: [STRANDED], scanned: 1 }));

        await load();
        await screen.findByText(/Ada Okonkwo/);
        fireEvent.change(screen.getByPlaceholderText(/Same person/i),
            { target: { value: 'Settled last week.' } });
        fireEvent.click(screen.getByRole('button', { name: /Move .* to the live profile/i }));

        expect(await screen.findByText(/already where it belongs/i)).toBeInTheDocument();
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Applied to src/app/admin/forensics/stranded-wallets/page.tsx alone, this
 *   suite re-run each time.
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   a failed scan leaves `error` null and       1   "A REFUSED SCAN SAYS SO"
 *   falls through to the all-clear
 *
 *   the all-clear renders whenever              1   "AND THE ALL-CLEAR IS
 *   `stranded.length === 0`, error or not           ABSENT WHILE MONEY IS
 *                                                   STRANDED"
 *
 *   drop the `scanned` card                     1   "AND THE ALL-CLEAR CARRIES
 *                                                   THE NUMBER EXAMINED"
 *
 *   send `toId` from a state field rather       1   "AND MOVING A BALANCE
 *   than from the scanned row                       REACHES THE OTHER ONE"
 *
 *   drop the reason check before sending        1   "A MOVE WITHOUT A REASON IS
 *                                                   REFUSED BEFORE IT IS SENT"
 *
 *   scan on mount (a useEffect) instead of      1   "AND NOT ON NAVIGATION"
 *   on the button
 *
 *   CONTROL — SHOULD SURVIVE
 *   reword the screen's header paragraph        0   SURVIVED ✓
 *
 *   THE SECOND SURVIVED THE FIRST RUN, and the reason is worth keeping: every
 *   test that asserts the all-clear is ABSENT was an error test, and an error
 *   holds `report` at null — so the whole block is unrendered and none of them
 *   could see the mutant. The case that can see it is the one with money on the
 *   screen, which is why that assertion now exists.
 */
