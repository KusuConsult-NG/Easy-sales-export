/**
 * @jest-environment jsdom
 */

/**
 *   #604 A HEALTH REPORT MISSING ONE SECTION BLANKED THE HEALTH PAGE.
 *
 *   /admin/system-health reads its report like this:
 *
 *       {report.services?.redis ? 'Connected' : 'Disconnected'}
 *       {Object.entries(report.featureToggles ?? {}).map(...)}
 *       {report.issues?.length === 0 ? ... }
 *       {report.stats.orphanedApplications}          ← four tiles up, no guard
 *
 *   #603 guarded `report.services` and `report.featureToggles` on this very
 *   screen and left `report.stats` alone. THE FIX REACHED SOME OF THE DOORS —
 *   the same shape as #601's `numberOrZero(stats.bySeverity.info)`, where the
 *   guard sat outside the read that actually threw, and #595's academy
 *   catalogue, fixed for the learner and not for the administrator.
 *
 *   `runSystemHealthDiagnostic` assembles its answer from independent probes of
 *   Redis, Firestore, Paystack and Resend, so returning what it managed to
 *   gather is its ordinary behaviour, not a corruption. When the section
 *   carrying `stats` was not among them, the page threw during render and
 *   showed nothing — the screen an administrator opens BECAUSE the platform is
 *   behaving oddly, blank precisely when it is needed.
 *
 *   THIS TEST EXISTS BECAUSE A MUTANT SURVIVED. Reverting the guard left the
 *   whole admin bare-row suite green: /admin/system-health is one of the
 *   eighteen screens that suite still cannot reach, so it was proving nothing
 *   about this file. A fix nothing can fail is a fix nobody can trust.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';

let REPORT: any = null;
jest.mock('@/app/actions/health', () => ({
    __esModule: true,
    runSystemHealthDiagnostic: async () => ({ success: true, data: REPORT }),
}));
jest.mock('@/hooks/useFeatureToggle', () => ({ useFeatureToggle: () => true }));

const FULL = {
    totalScanned: 12,
    anomaliesFound: 0,
    timestamp: new Date('2026-01-01T00:00:00Z').toISOString(),
    stats: { orphanedApplications: 4242 },
    services: { redis: true, firestore: true, paystack: true, resend: true },
    featureToggles: { wave: true },
    issues: [],
};

/** The Orphaned Apps tile's own number, so an assertion cannot pass on some other zero. */
function orphanedTile(container: HTMLElement): string {
    //   Anchored from the NUMBER outwards, not from the caption inwards. Every
    //   ancestor of the tile also contains the caption, so searching downwards
    //   returned whichever `.text-4xl` came first in the document — which is how
    //   this helper reported 12 for a report whose orphan count was 4242.
    const number = Array.from(container.querySelectorAll('.text-4xl')).find(
        e => e.parentElement?.textContent?.includes('Orphaned Apps'),
    );
    return number?.textContent?.trim() ?? '<no tile>';
}

describe('#604 — the health page against a report that answered in part', () => {
    it('RENDERS THE WHOLE REPORT WHEN THE WHOLE REPORT ARRIVES', async () => {
        REPORT = FULL;
        const { default: Screen } = await import('@/app/admin/system-health/page');
        const { container } = render(<Screen />);
        await waitFor(() => expect(container.textContent).toContain('Orphaned Apps'));
        //   The control for every case below: the number really is read and shown.
        //   A distinctive value, and read from the tile itself — a bare
        //   `toContain('0')` passed against a page full of other zeros, and a
        //   mutant that dropped `numberOrZero` survived because of it.
        expect(orphanedTile(container)).toBe('4242');
    });

    it('AND STILL RENDERS WHEN THE SECTION CARRYING `stats` IS ABSENT', async () => {
        REPORT = { ...FULL, stats: undefined };
        const { default: Screen } = await import('@/app/admin/system-health/page');
        const { container } = render(<Screen />);
        //   The assertion is that the page is THERE. Before the fix this threw
        //   during render and there was no page at all.
        await waitFor(() => expect(container.textContent).toContain('Orphaned Apps'));
        //   And it reads 0, not blank: an empty tile where a count belongs is a
        //   different lie from a crash, but it is still one.
        expect(orphanedTile(container)).toBe('0');
    });

    it('AND WHEN EVERY OPTIONAL SECTION IS ABSENT AT ONCE', async () => {
        REPORT = { totalScanned: 1, anomaliesFound: 1, timestamp: FULL.timestamp };
        const { default: Screen } = await import('@/app/admin/system-health/page');
        const { container } = render(<Screen />);
        await waitFor(() => expect(container.textContent).toContain('Orphaned Apps'));
        expect(orphanedTile(container)).toBe('0');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *     MUTANT                                                        RESULT
 *     numberOrZero(report.stats?.orphanedApplications)
 *         → report.stats.orphanedApplications                       KILLED
 *     numberOrZero(report.stats?.x) → report.stats?.x               KILLED
 *     report.services?.redis → report.services.redis                KILLED
 *     Object.entries(report.featureToggles ?? {}) → (…featureToggles) KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     the "Missing User Linkages" caption reworded                  SURVIVED ✓
 *
 *   THE SECOND MUTANT SURVIVED THE FIRST ROUND. The absent-stats test asserted
 *   `toContain('0')` against a page carrying several other zeros, so dropping
 *   `numberOrZero` changed nothing it could see. Reading the tile's own number
 *   fixed that — and the helper that reads it was itself wrong first, searching
 *   downwards from the caption and returning the FIRST `.text-4xl` on the page,
 *   because every ancestor of the tile contains the caption too. It reported 12
 *   for a report whose orphan count was 4242. The helper is anchored from the
 *   number outwards now.
 */
