/**
 * @jest-environment jsdom
 */

/**
 *   #928 — THE THREE SCREENS, RENDERED.
 *
 *   The source ratchets in the suite beside this one pin the shape; this pins
 *   what an operator actually sees, which is the claim. Three things a grep
 *   cannot check, because each is about whether something APPEARS:
 *
 *     a bounded scan says so, naming both numbers
 *     a complete scan stays quiet — a permanent "this might be incomplete"
 *       banner is read once and then never again
 *     a report with NO scope at all — an older server — renders the screen
 *       rather than crashing it, and claims nothing in either direction
 *
 *   And on the wallet screen, the one that matters most: "No money is stranded"
 *   disappears when the walk stopped short. That panel is the false green
 *   forensic-scan-scope exists to prevent, on the screen somebody opens to find
 *   out whether anybody's money is stuck.
 *
 *   THE GLOBAL `jest`, NOT `@jest/globals`. These subjects are imported
 *   statically, and #392's mechanism is that importing `jest` from the package
 *   silently defeats `jest.mock` hoisting — the mock is installed after the
 *   module under test has already resolved its imports.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listMissingMembershipsAction = jest.fn() as jest.Mock<any>;
const createMissingMembershipAction = jest.fn() as jest.Mock<any>;
const listFarmNationApprovalCasesAction = jest.fn() as jest.Mock<any>;
const decideFarmNationApprovalAction = jest.fn() as jest.Mock<any>;
const findStrandedWalletsAction = jest.fn() as jest.Mock<any>;
const consolidateWalletAction = jest.fn() as jest.Mock<any>;

jest.mock('@/app/actions/admin', () => ({
    listMissingMembershipsAction: (...a: any[]) => listMissingMembershipsAction(...a),
    createMissingMembershipAction: (...a: any[]) => createMissingMembershipAction(...a),
    listFarmNationApprovalCasesAction: (...a: any[]) => listFarmNationApprovalCasesAction(...a),
    decideFarmNationApprovalAction: (...a: any[]) => decideFarmNationApprovalAction(...a),
    findStrandedWalletsAction: (...a: any[]) => findStrandedWalletsAction(...a),
    consolidateWalletAction: (...a: any[]) => consolidateWalletAction(...a),
}));

import CooperativeMembershipsPage from '@/app/admin/forensics/cooperative/page';
import FarmNationApprovalsPage from '@/app/admin/forensics/farm-nation/page';
import StrandedWalletsPage from '@/app/admin/forensics/stranded-wallets/page';

const ok = (data: unknown) => ({ success: true, data });

/**
 * A truncated run, with the two figures DIFFERENT so each is asserted on its
 * own. The module documents `>=` for the incomplete side precisely so an
 * adapter returning one row more than asked for cannot pass as complete.
 */
const TRUNCATED = { scanned: 201, ceiling: 200, complete: false };
const WHOLE = { scanned: 7, ceiling: 200, complete: true };

const NOTICE = /What this list does not cover/i;

beforeEach(() => {
    jest.clearAllMocks();
});

/** Render a screen and press its load button. */
const open = async (Page: React.ComponentType, button: RegExp, action: jest.Mock<any>) => {
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: button }));
    await waitFor(() => expect(action).toHaveBeenCalled());
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#928 — the cooperative worklist', () => {
    const load = (data: unknown) => {
        listMissingMembershipsAction.mockResolvedValue(ok(data));
        return open(CooperativeMembershipsPage, /load missing memberships/i, listMissingMembershipsAction);
    };

    const report = (scope?: unknown) => ({
        cases: [], fullyKnown: 0, needATier: 0, ...(scope ? { scope } : {}),
    });

    it('A BOUNDED SCAN SAYS SO, NAMING BOTH NUMBERS', async () => {
        await load(report(TRUNCATED));

        expect(await screen.findByText(NOTICE)).toBeInTheDocument();
        //   Both figures, each on its own — a notice that named one of them
        //   would pass a test looking only for the other.
        expect(screen.getByText(/201/)).toBeInTheDocument();
        expect(screen.getByText(/200-row limit/)).toBeInTheDocument();
        expect(screen.getByText(/membership row it never reached/)).toBeInTheDocument();
    });

    it('A COMPLETE SCAN STAYS QUIET — the control', async () => {
        await load(report(WHOLE));

        await waitFor(() => expect(screen.getByText(/Everything already known/)).toBeInTheDocument());
        expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    });

    it('AND A REPORT WITH NO SCOPE RENDERS THE SCREEN, claiming nothing', async () => {
        //   An older server. The counts still appear; the notice does not,
        //   because nothing was said about completeness either way.
        await load(report());

        await waitFor(() => expect(screen.getByText(/Everything already known/)).toBeInTheDocument());
        expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#928 — the Farm Nation worklist', () => {
    const load = (data: unknown) => {
        listFarmNationApprovalCasesAction.mockResolvedValue(ok(data));
        return open(FarmNationApprovalsPage, /load approval cases/i, listFarmNationApprovalCasesAction);
    };

    const report = (scope?: unknown) => ({
        cases: [], noApplication: 0, drift: 0, settled: 0, ...(scope ? { scope } : {}),
    });

    it('A BOUNDED SCAN SAYS SO, NAMING BOTH NUMBERS', async () => {
        await load(report(TRUNCATED));

        expect(await screen.findByText(NOTICE)).toBeInTheDocument();
        expect(screen.getByText(/201 farmers/)).toBeInTheDocument();
        expect(screen.getByText(/200-row limit/)).toBeInTheDocument();
        expect(screen.getByText(/floor/)).toBeInTheDocument();
    });

    it('A COMPLETE SCAN STAYS QUIET — the control', async () => {
        await load(report(WHOLE));

        await waitFor(() => expect(screen.getByText(/No application behind it/)).toBeInTheDocument());
        expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    });

    it('AND A REPORT WITH NO SCOPE RENDERS THE SCREEN, claiming nothing', async () => {
        await load(report());

        await waitFor(() => expect(screen.getByText(/No application behind it/)).toBeInTheDocument());
        expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#928 — the stranded wallet walk, where the green panel is the claim', () => {
    const load = (data: unknown) => {
        findStrandedWalletsAction.mockResolvedValue(ok(data));
        return open(StrandedWalletsPage, /find stranded balances/i, findStrandedWalletsAction);
    };

    const report = (scope?: unknown) => ({
        stranded: [], scanned: 272, ...(scope ? { scope } : {}),
    });

    it('NOTHING FOUND AND A TRUNCATED WALK IS NOT "No money is stranded"', async () => {
        await load(report({ scanned: 50_000, ceiling: 50_000, complete: false }));

        expect(await screen.findByText(NOTICE)).toBeInTheDocument();
        expect(screen.queryByText(/No money is stranded/)).not.toBeInTheDocument();
        expect(screen.getByText(/not a clean table/)).toBeInTheDocument();
    });

    it('NOTHING FOUND AND A COMPLETE WALK STILL IS — the control', async () => {
        //   Without this, the assertion above would be satisfied by a screen
        //   that had simply lost its green panel.
        await load(report({ scanned: 41_000, ceiling: 50_000, complete: true }));

        expect(await screen.findByText(/No money is stranded/)).toBeInTheDocument();
        expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    });

    it('AND A REPORT WITH NO SCOPE KEEPS THE SCREEN IT ALWAYS HAD', async () => {
        //   The report shape shipped before this change — which is what the
        //   #811 render suite still sends, and it must not start failing.
        await load(report());

        expect(await screen.findByText(/No money is stranded/)).toBeInTheDocument();
        expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    });
});

/**
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *   MUTANT                                          CAUGHT BY
 *   ──────────────────────────────────────────────  ───────────────────────────
 *   delete the notice block from a screen           that screen's "A BOUNDED
 *                                                   SCAN SAYS SO"
 *   render the notice unconditionally               that screen's "A COMPLETE
 *                                                   SCAN STAYS QUIET"
 *   `!scope?.complete` for the guard                "NO SCOPE … claiming
 *                                                   nothing" — an absent scope
 *                                                   makes it true
 *   `report.scope.complete === false` (no guard)    the same test, which
 *                                                   throws on an old report
 *   drop the ceiling from the sentence              "200-row limit"
 *   drop the scanned figure from the sentence       "201" / "201 farmers"
 *   un-gate the green "No money is stranded"        "NOTHING FOUND AND A
 *     panel                                        TRUNCATED WALK"
 *   gate it on the wrong side (hide it always)      "… A COMPLETE WALK STILL IS"
 */
