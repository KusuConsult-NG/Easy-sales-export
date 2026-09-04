/**
 * @jest-environment jsdom
 */

/**
 *   #266 THE FORENSIC SCAN HAD NO WAY IN — DECIDED, AND THE SCREEN IS BUILT.
 *
 *        runForensicScanAction is 747 lines of cross-module integrity
 *        checking: ghost auth users, orphaned products, phone drift between a
 *        seller's profile and their verification, WAVE eligibility paradoxes,
 *        cooperative balance against the ledger, Farm Nation badge against
 *        approval, export funding against its ceiling, academy access against
 *        plan.
 *
 *        Nothing called it. FOUR findings in this audit repaired checks inside
 *        it that could never fail — #331 (two of them), #372 and #373, the last
 *        being the only one guarding money — and every one of those repairs was
 *        invisible, because there was no screen for an operator to read them
 *        on. That is also WHY they survived: a false pass nobody sees is never
 *        questioned.
 *
 *        #331 recorded "build the screen or drop it" as an owner decision.
 *        Dropping it would have meant deleting eight repaired checks that four
 *        suites execute, on a platform whose owner's complaint is that it keeps
 *        breaking. Reachability was the only thing missing, which is #362's
 *        shape exactly.
 *
 * WHAT THIS SUITE IS FOR
 * ----------------------
 * The screen's whole job is to tell an operator whether the data is sound, so
 * the one thing it must never do is render "could not check" as "nothing
 * found". That is #313 on the screen whose entire purpose is assurance, and a
 * source ratchet cannot assert it — `if (false)` keeps every string a grep
 * looks for. So the page is RENDERED, against a refusal and against a result.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const mockRunScan = jest.fn() as jest.Mock<any>;

jest.mock('@/app/actions/forensics', () => ({
    runForensicScanAction: (...a: any[]) => mockRunScan(...a),
}));

import ForensicsPage from '@/app/admin/forensics/page';

const ROOT = process.cwd();
const source = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const PAGE = 'src/app/admin/forensics/page.tsx';

function result(over: Partial<any> = {}) {
    return {
        module: 'Cooperative',
        check: 'Financial Reconciliation (Balance vs Txs)',
        status: 'fail',
        details: 'Two members hold balances the ledger does not account for.',
        affectedIds: ['member-1', 'member-2'],
        ...over,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

async function runIt() {
    render(<ForensicsPage />);
    fireEvent.click(screen.getByRole('button', { name: /run scan/i }));
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#266 — a refusal is never shown as a clean result', () => {
    it('A REFUSED SCAN SAYS IT DID NOT RUN, AND SHOWS NO RESULTS', async () => {
        // THE test. The action refuses anyone who is not a platform admin, and
        // the admin layout admits ten roles — so this is the ordinary case, not
        // an edge. Rendering it as an empty result set would tell an operator
        // the platform is clean when nothing was looked at.
        mockRunScan.mockResolvedValue({
            success: false, error: 'Unauthorized: Admin access required', results: [], data: null,
        });

        await runIt();

        await waitFor(() => expect(screen.getByText(/the scan did not run/i)).toBeInTheDocument());
        expect(screen.getByText(/Unauthorized: Admin access required/)).toBeInTheDocument();
        expect(screen.getByText(/this is not a clean result/i)).toBeInTheDocument();
        // And no summary tiles, which is what "nothing found" would look like.
        expect(screen.queryByText(/checks run at/i)).not.toBeInTheDocument();
    });

    it('and so does a scan that threw', async () => {
        mockRunScan.mockRejectedValue(new Error('network'));

        await runIt();

        await waitFor(() => expect(screen.getByText(/the scan did not run/i)).toBeInTheDocument());
        expect(screen.queryByText(/checks run at/i)).not.toBeInTheDocument();
    });

    it('and a success carrying no result array is a refusal too, not zero findings', async () => {
        // A success whose payload is missing is not "eight checks passed".
        mockRunScan.mockResolvedValue({ success: true, error: null, data: null });

        await runIt();

        await waitFor(() => expect(screen.getByText(/the scan did not run/i)).toBeInTheDocument());
    });

    it('before any scan is run it says so, rather than showing a clean board', async () => {
        render(<ForensicsPage />);

        expect(screen.getByText(/no scan has been run in this session/i)).toBeInTheDocument();
        expect(screen.queryByText(/checks run at/i)).not.toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#266 — what it shows when the scan does run', () => {
    it('RENDERS THE FINDINGS, WITH THE AFFECTED RECORDS', async () => {
        mockRunScan.mockResolvedValue({
            success: true, error: null, results: [result()], data: null,
        });

        await runIt();

        await waitFor(() =>
            expect(screen.getByText('Financial Reconciliation (Balance vs Txs)')).toBeInTheDocument());
        expect(screen.getByText(/the ledger does not account for/i)).toBeInTheDocument();
        expect(screen.getByText(/member-1/)).toBeInTheDocument();
        expect(screen.getByText(/affected records \(2\)/i)).toBeInTheDocument();
    });

    it('"could not check" IS ITS OWN STATE, not folded in with pass', async () => {
        // The status exists because two checks reported "pass" for a question
        // they could not ask (#331). Collapsing it into pass on the screen
        // would undo that repair at the last step, which is the only step the
        // operator sees.
        mockRunScan.mockResolvedValue({
            success: true,
            error: null,
            results: [result({ status: 'inconclusive', check: 'Ghost Users', affectedIds: [] })],
            data: null,
        });

        await runIt();

        // Counted per status, not "does the word Pass appear" — the summary
        // renders all four tiles, so the Pass TILE is there either way and its
        // presence proves nothing. What matters is which bucket the check
        // landed in.
        await waitFor(() => expect(screen.getByTestId('count-inconclusive')).toHaveTextContent('1'));
        expect(screen.getByTestId('count-pass')).toHaveTextContent('0');
        // And the result row itself is labelled, not left blank.
        expect(screen.getAllByText(/could not check/i).length).toBeGreaterThanOrEqual(2);
    });

    it('and the worst findings are listed first', async () => {
        // An operator reads top-down. A failure below eight passes is a failure
        // they scroll past.
        mockRunScan.mockResolvedValue({
            success: true,
            error: null,
            results: [
                result({ status: 'pass', check: 'Orphaned Products', affectedIds: [] }),
                result({ status: 'fail', check: 'Balance Mismatch', affectedIds: [] }),
                result({ status: 'warning', check: 'Phone Drift', affectedIds: [] }),
            ],
            data: null,
        });

        await runIt();

        await waitFor(() => expect(screen.getByText('Balance Mismatch')).toBeInTheDocument());

        const order = ['Balance Mismatch', 'Phone Drift', 'Orphaned Products']
            .map((name) => document.body.textContent!.indexOf(name));

        expect(order[0]).toBeLessThan(order[1]);
        expect(order[1]).toBeLessThan(order[2]);
    });

    it('a second run replaces the previous answers rather than adding to them', async () => {
        mockRunScan.mockResolvedValue({
            success: true, error: null, results: [result({ check: 'First Check' })], data: null,
        });
        await runIt();
        await waitFor(() => expect(screen.getByText('First Check')).toBeInTheDocument());

        mockRunScan.mockResolvedValue({
            success: true, error: null, results: [result({ check: 'Second Check' })], data: null,
        });
        fireEvent.click(screen.getByRole('button', { name: /run scan/i }));

        await waitFor(() => expect(screen.getByText('Second Check')).toBeInTheDocument());
        expect(screen.queryByText('First Check')).not.toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#266 — it runs on demand, and only reads', () => {
    it('MOUNTING DOES NOT RUN THE SCAN', async () => {
        // It reads across eight collections. Firing on navigation would charge
        // that to every visit to the admin area, and it is not the kind of cost
        // that should be spent without somebody asking for it.
        render(<ForensicsPage />);

        await waitFor(() => expect(screen.getByRole('button', { name: /run scan/i })).toBeInTheDocument());
        expect(mockRunScan).not.toHaveBeenCalled();
    });

    it('and the button is what runs it', async () => {
        mockRunScan.mockResolvedValue({ success: true, error: null, results: [], data: null });

        await runIt();

        await waitFor(() => expect(mockRunScan).toHaveBeenCalledTimes(1));
    });

    it('the screen tells the operator the scan changes nothing and samples', async () => {
        // Both are true of the action and both matter to how its answers should
        // be read: an empty result is evidence about a sample, not a guarantee
        // about the platform.
        render(<ForensicsPage />);

        expect(screen.getByText(/only reads/i)).toBeInTheDocument();
        expect(screen.getByText(/samples each/i)).toBeInTheDocument();
    });

    it('and it does not offer to fix anything, because the action cannot', async () => {
        // A "repair" button on a read-only scan would be #337's shape — a
        // control that does not perform the operation it names.
        const src = source(PAGE);

        expect(src).not.toMatch(/\b(fix|repair|resolve|purge|delete)[A-Za-z]*Action\b/i);
    });
});
