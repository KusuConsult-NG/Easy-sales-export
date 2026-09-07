/**
 * @jest-environment jsdom
 */

/**
 *   #475 ONE FINDING WAS BURIED IN A HUNDRED AND NINETY.
 *
 *   The owner's forensics report:
 *
 *       Fail — WAVE — Eligibility Paradox (Gender/Age)
 *       Scanned 200 participants. Found 1 ineligible. 186 have no gender
 *       recorded — a gap in the records, not a finding about them. 3 could not
 *       be age-checked — no readable date of birth on record.
 *
 *       Affected records (190)
 *       0avEMgtAcJN2Hu8rEuZkiIAE3D52 (Gender: male)
 *       00c60db9-… (gender not recorded: absent)
 *       … 188 more …
 *
 *   The summary line says which is which. The LIST does not, and the list is
 *   what a reader scrolls. One participant needs a decision; 189 records simply
 *   could not be evaluated, and they were presented identically under a heading
 *   that called all 190 "affected".
 *
 *   #464 PUT THEM THERE ON PURPOSE, and that reason is still right: a scan that
 *   quietly narrowed to the records it could read would report a clean bill of
 *   health on a fraction of the population — which is the #331 failure this
 *   whole file exists because of. So the unchecked are still shown. What changed
 *   is that they are shown as what they are: separately, folded, counted apart,
 *   and never called a finding.
 *
 *   A SOURCE RATCHET CANNOT ASSERT THIS. `if (false)` keeps every string a grep
 *   looks for, which is why #266 built this suite to RENDER the page. So does
 *   this one: it renders the owner's actual report shape and asserts what a
 *   person reading the screen would see.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     notCheckedIds folded back into affectedIds   KILLED
 *     the unchecked block deleted from the page    KILLED
 *     the unchecked rendered as "Affected records" KILLED
 *     the unchecked block rendered open, not folded KILLED
 *     reword this header                           SURVIVED, as intended
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const mockRunScan = jest.fn() as jest.Mock<any>;

jest.mock('@/app/actions/forensics', () => ({
    runForensicScanAction: (...a: any[]) => mockRunScan(...a),
}));

import ForensicsPage from '@/app/admin/forensics/page';

const ROOT = process.cwd();
const PAGE = 'src/app/admin/forensics/page.tsx';
const ACTION = 'src/app/actions/forensics.ts';
const source = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

/** The owner's report, at its real proportions. */
const THE_ONE_FINDING = '0avEMgtAcJN2Hu8rEuZkiIAE3D52 (Gender: male)';
const UNCHECKED = [
    ...Array.from({ length: 186 }, (_, i) => `gender-gap-${i} (gender not recorded: absent)`),
    ...Array.from({ length: 3 }, (_, i) => `undated-${i} (no date of birth on record)`),
];

const waveResult = () => ({
    module: 'WAVE',
    check: 'Eligibility Paradox (Gender/Age)',
    status: 'fail',
    details:
        'Scanned 200 participants. Found 1 ineligible. 186 have no gender recorded — ' +
        'a gap in the records, not a finding about them. 3 could not be age-checked — ' +
        'no readable date of birth on record.',
    affectedIds: [THE_ONE_FINDING],
    notCheckedIds: UNCHECKED,
});

async function renderReport(results: any[]) {
    mockRunScan.mockResolvedValue({ success: true, results });
    render(<ForensicsPage />);
    (await screen.findByRole('button', { name: /run scan|scan/i })).click();
    await waitFor(() => expect(mockRunScan).toHaveBeenCalled());
}

beforeEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
describe('#475 — the one finding is not buried', () => {
    it('THE AFFECTED-RECORDS HEADING COUNTS 1, NOT 190', async () => {
        //   The assertion the finding is about. 190 was the number on the
        //   owner's screen, over a single actionable record.
        await renderReport([waveResult()]);

        expect(await screen.findByText(/Affected records \(1\)/)).toBeInTheDocument();
        expect(screen.queryByText(/Affected records \(190\)/)).not.toBeInTheDocument();
    });

    it('AND THE ONE RECORD THAT NEEDS A DECISION IS THERE', async () => {
        await renderReport([waveResult()]);

        expect(await screen.findByText(new RegExp(THE_ONE_FINDING.replace(/[()]/g, '\\$&')))).toBeInTheDocument();
    });

    it('AND THE 189 ARE STILL SHOWN — hiding them is the other failure', async () => {
        //   #464's reason, preserved. A scan that silently dropped what it could
        //   not read would report a clean result on a fraction of the
        //   population, which is #331 exactly.
        await renderReport([waveResult()]);

        expect(await screen.findByText(/Could not be checked \(189\)/)).toBeInTheDocument();
    });

    it('AND THEY ARE LABELLED AS A GAP, NOT AS A FINDING', async () => {
        await renderReport([waveResult()]);

        expect(
            await screen.findByText(/a gap in the records, not a finding about these people/),
        ).toBeInTheDocument();
    });

    it('AND THEY ARE FOLDED AWAY, so 189 ids do not swamp the card', async () => {
        //   The heading being right is not enough: 189 lines rendered open push
        //   every other check off the screen, which is how the one finding got
        //   lost in the first place.
        await renderReport([waveResult()]);

        await screen.findByText(/Could not be checked \(189\)/);
        const details = document.querySelector('details');

        expect(details).not.toBeNull();
        expect((details as HTMLDetailsElement).open).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#475 — and a check with nothing unchecked is unchanged', () => {
    it('NO "COULD NOT BE CHECKED" BLOCK APPEARS WHEN THERE IS NOTHING IN IT', async () => {
        //   Control: without this, a page that always rendered the block would
        //   pass every test above and add noise to every other check.
        await renderReport([
            {
                module: 'Cooperative',
                check: 'Financial Reconciliation (Balance vs Txs)',
                status: 'fail',
                details: 'Two members hold balances the ledger does not account for.',
                affectedIds: ['member-1', 'member-2'],
            },
        ]);

        expect(await screen.findByText(/Affected records \(2\)/)).toBeInTheDocument();
        expect(screen.queryByText(/Could not be checked/)).not.toBeInTheDocument();
    });

    it('and a pass with no records at all renders neither block', async () => {
        await renderReport([
            {
                module: 'Marketplace',
                check: 'Orphaned Product Scan',
                status: 'pass',
                details: 'Scanned 50 products. None orphaned.',
                affectedIds: [],
            },
        ]);

        await waitFor(() => expect(screen.queryByText(/Affected records/)).not.toBeInTheDocument());
        expect(screen.queryByText(/Could not be checked/)).not.toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#475 — the scan itself separates them', () => {
    it('THE WAVE CHECK NO LONGER CONCATENATES THE THREE LISTS', () => {
        //   The page can only separate what the scan hands it separately. This
        //   is the line that produced 190.
        const code = source(ACTION);

        expect(code).not.toContain('[...ineligibleIds, ...unknownGenderIds, ...undatedIds]');
        expect(code).toContain('affectedIds: ineligibleIds');
        expect(code).toContain('notCheckedIds: [...unknownGenderIds, ...undatedIds]');
    });

    it('AND THE STATUS STILL DISTINGUISHES A FINDING FROM A GAP', () => {
        //   #464's rule, which this must not undo: nothing but gaps is
        //   "inconclusive", not "pass" and not "fail".
        const code = source(ACTION);

        expect(code).toContain('ineligibleIds.length > 0');
        expect(code).toContain('"inconclusive"');
    });

    it('AND THE COOPERATIVE CHECK KEEPS ITS OWN — a missing membership IS a finding', () => {
        //   Checked rather than assumed: a cooperative_member with no
        //   membership row is a defect somebody must fix, not a record that
        //   could not be read. It belongs in affectedIds and stays there.
        const code = source(ACTION);

        expect(code).toContain('unreadableMembers.map((id) => `${id} (no membership record)`)');
    });

    it('and the type says which is which', () => {
        const code = source(ACTION);

        expect(code).toContain('notCheckedIds?: string[]');
    });
});
