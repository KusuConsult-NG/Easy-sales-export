/**
 * @jest-environment jsdom
 */

/**
 *   #610 THE LAST SEVEN ADMIN SCREENS, EACH WITH ITS OWN SHAPE — AND THE GUARD
 *        THAT SITS ON THE OUTSIDE OF A NESTED READ, A FOURTH TIME.
 *
 *   #604 left eighteen admin screens unreached; #609 accounted for eleven. These
 *   are the seven that were left, and they are the case #601 predicted at the
 *   start: "each would need its own mocked action shape, and a shape guessed
 *   wrong is a vacuous pass rather than a finding."
 *
 *   A shared fixture cannot reach them because they are not lists of documents.
 *   They are settings forms and reports, and each reads one particular answer:
 *   `{ settings }` behind a `loadSettings`, `{ data: HealthReport }`, a
 *   compliance response of `{ stats, demographics, dataAvailability }`. So this
 *   file states each shape explicitly instead of guessing one for all of them.
 *
 * ── WHAT THAT FOUND ─────────────────────────────────────────────────────────
 *
 *   /admin/wave/compliance renders
 *
 *       {demographics && (
 *           …
 *           {Object.entries(demographics.ageGroups).map(([age, count]) => (
 *
 *   The `demographics &&` is a guard on the OUTER object and there is none on
 *   the read that actually throws. This is #601's `numberOrZero(stats.bySeverity
 *   .info)` and #603's `data?.services.firestore` in a third notation, and it is
 *   now the FOURTH instance in this audit — so it is a habit of this codebase
 *   rather than an oversight in one file.
 *
 *   A compliance response carrying `demographics` without `ageGroups`, `states`
 *   or `businessTypes` takes the page down. That page is the one WAVE's numbers
 *   are reported from.
 *
 *   AND ITS PERCENTAGES DIVIDE BY A FIGURE THAT CAN BE ZERO.
 *   `Math.round((stats.approved / stats.totalApplications) * 100)` renders
 *   "NaN%" before the first application arrives, and again whenever the answer
 *   omits the denominator. #598's finding, on a regulatory report.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';

jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
const router = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn(), back: jest.fn() };
jest.mock('next/navigation', () => ({
    useRouter: () => router, useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/admin', useParams: () => ({}),
}));
const session = { data: { user: { id: 'u1', name: 'A', email: 'a@b.c', roles: ['super_admin'] } }, status: 'authenticated' };
jest.mock('next-auth/react', () => ({ useSession: () => session, signOut: jest.fn() }));
jest.mock('@/hooks/useFeatureToggle', () => ({ useFeatureToggle: () => true }));

/** What the next render should receive, set per test. */
let ANSWER: any = {};
const act_ = async () => ANSWER;
function isNotAnAction(name: string | symbol): boolean {
    return typeof name === 'symbol' || name === 'then';
}
for (const m of ['admin', 'platform', 'health', 'telemetry', 'admin-analytics']) {
    jest.mock(`@/app/actions/${m}`, () => new Proxy({ __esModule: true }, {
        get: (_t, name: string | symbol) => (
            name === '__esModule' ? true : isNotAnAction(name) ? undefined : act_
        ),
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = jest.fn(async () => ({
        ok: true, status: 200,
        json: async () => ANSWER,
        text: async () => JSON.stringify(ANSWER),
    }));
});

async function show(mod: string) {
    const { default: Screen } = await import(mod);
    const r = render(<Screen />);
    await new Promise(res => setTimeout(res, 80));
    return r;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#610 — /admin/wave/compliance against a partial answer', () => {
    const WHOLE = {
        success: true,
        stats: {
            totalApplications: 40, approved: 10, pending: 20, rejected: 10,
            totalDisbursed: 5000, averageLoanSize: 500, repaymentRate: 90,
        },
        demographics: {
            ageGroups: { '25-34': 7 },
            states: { Lagos: 5 },
            businessTypes: { Farming: 3 },
        },
        dataAvailability: { disbursementTracked: true },
    };

    it('RENDERS THE WHOLE REPORT WHEN THE WHOLE REPORT ARRIVES', async () => {
        ANSWER = WHOLE;
        const { container } = await show('@/app/admin/wave/compliance/page');
        await waitFor(() => expect(container.textContent).toContain('Age Distribution'));
        //   The control for every case below: the figures really are read.
        expect(container.textContent).toContain('25-34');
        expect(container.textContent).toContain('Approved (25%)');
    });

    it('AND SURVIVES A demographics THAT CARRIES NONE OF ITS THREE BREAKDOWNS', async () => {
        //   `{demographics && …}` passes — the object is there — and the read
        //   inside it is what threw.
        ANSWER = { ...WHOLE, demographics: {} };
        const { container } = await show('@/app/admin/wave/compliance/page');
        await waitFor(() => expect(container.textContent).toContain('Age Distribution'));
    });

    it('AND WHEN ONLY ONE BREAKDOWN IS MISSING, WHICH IS THE LIKELIER SHAPE', async () => {
        ANSWER = { ...WHOLE, demographics: { ageGroups: { '25-34': 7 } } };
        const { container } = await show('@/app/admin/wave/compliance/page');
        await waitFor(() => expect(container.textContent).toContain('Age Distribution'));
        expect(container.textContent).toContain('25-34');
    });

    it('AND A REPORT WITH NO APPLICATIONS YET DOES NOT SAY "NaN%"', async () => {
        //   Before the first application arrives, every percentage on this page
        //   divided by zero. A regulatory report that reads NaN% is worse than one
        //   that reads 0%, because it looks like a fault rather than a fact.
        ANSWER = { ...WHOLE, stats: { ...WHOLE.stats, totalApplications: 0, approved: 0, pending: 0, rejected: 0 } };
        const { container } = await show('@/app/admin/wave/compliance/page');
        await waitFor(() => expect(container.textContent).toContain('Approved'));
        expect(container.textContent).not.toContain('NaN');
        expect(container.textContent).toContain('Approved (0%)');
    });

    it('AND A STATS OBJECT MISSING ITS FIGURES IS STILL A PAGE', async () => {
        ANSWER = { ...WHOLE, stats: {} };
        const { container } = await show('@/app/admin/wave/compliance/page');
        await waitFor(() => expect(container.textContent).toContain('Approved'));
        expect(container.textContent).not.toContain('NaN');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#610 — the other six, each given the answer it actually reads', () => {
    const CASES: [string, string, any][] = [
        ['settings/fees', '@/app/admin/settings/fees/page',
            { success: true, data: { platformFeePercentage: 5 } }],
        ['settings/general', '@/app/admin/settings/general/page',
            { success: true, data: { platformName: 'X', supportEmail: 'a@b.c' } }],
        ['settings/notifications', '@/app/admin/settings/notifications/page',
            { success: true, settings: { newUserEmail: true } }],
        ['settings/security', '@/app/admin/settings/security/page',
            { success: true, settings: { enforceMfa: true, sessionMinutes: 30 } }],
        ['system-health', '@/app/admin/system-health/page',
            { success: true, data: { totalScanned: 3, anomaliesFound: 0, timestamp: new Date().toISOString() } }],
        ['system-health/diagnostics', '@/app/admin/system-health/diagnostics/page',
            { success: true, data: { totalScanned: 3, anomaliesFound: 0, timestamp: new Date().toISOString() } }],
    ];

    it.each(CASES)('%s RENDERS AGAINST A REPORT THAT ANSWERS IN PART', async (_n, mod, whole) => {
        //   Every optional section absent at once — the shape a reader assembling
        //   its answer from several independent probes returns when some of them
        //   could not answer.
        ANSWER = whole;
        const { container } = await show(mod);
        expect(container.textContent).not.toBe('');

        ANSWER = { success: true, data: {}, settings: {} };
        const { container: bare } = await show(mod);
        expect(bare.textContent).not.toBe('');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     compliance: `demographics.ageGroups ?? {}` → unguarded         KILLED
 *     compliance: `demographics.states ?? {}` → unguarded            KILLED
 *     compliance: `demographics.businessTypes ?? {}` → unguarded     KILLED
 *     compliance: percentage() → the raw division back               KILLED
 *     diagnostics: `data.stats?.x` → `data.stats.x`                  KILLED
 *     percentage: drop the `w <= 0` refusal                          KILLED
 *     percentage: `w <= 0` → `w < 0` (so zero divides)               KILLED
 *     percentage: return 0 always                                    KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   No mutant survived. The `w < 0` one is the load-bearing case: a denominator
 *   of zero is the ordinary state of this page before the first application
 *   arrives, not an exotic one, and it is the difference between "0%" and "NaN%".
 */
