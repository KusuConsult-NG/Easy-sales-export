/**
 * @jest-environment node
 */

/**
 *   THE ANSWER TO A SCAN THAT TIMED OUT WAS TO RUN IT FIFTEEN MORE TIMES.
 *
 *   From the owner's production log, beside the registration failures:
 *
 *       [ERROR] ... module_registration_counts ... [57014] canceling
 *       statement due to statement timeout
 *
 *   `public.users` is 42,845 rows and 106 MB, and every query the platform
 *   makes runs under `statement_timeout=8s` — inherited at login from the
 *   `authenticator` role, which `SET ROLE service_role` does not reset
 *   (service_role itself carries no setting; measured against the live
 *   database).
 *
 * ── WHY THE FALLBACK MADE IT WORSE ──────────────────────────────────────────
 *
 *   #850 added `module_registration_counts` to replace five-to-fifteen
 *   sequential scans of `users` with one, and kept the old path behind:
 *
 *       const viaOneScan = await countFromRegistrationRollup(keys, since);
 *       if (viaOneScan) return viaOneScan;
 *       ... fifteen count() queries, each a sequential scan ...
 *
 *   Its own comment says exactly what that fallback is for: "Code reaches
 *   production before a migration does — that is the normal order on this
 *   platform." True, and it is the ONLY case where fifteen scans are an
 *   improvement on nothing.
 *
 *   `countFromRegistrationRollup` returned null on EVERY failure, so a
 *   TIMEOUT — which happens precisely because the scan is too expensive —
 *   fell through to the same scan another five to fifteen times, each under
 *   the same 8s cap. One cooperative admin page load could spend two minutes
 *   of database time failing, from a single failure.
 *
 *   And 039's own header records what that costs everything else: "The
 *   production log shows LOGINS timing out ... That query is
 *   where("email","==",…) limit 1, on an indexed native column. A cheap query
 *   timing out is what a saturated database looks like."
 *
 * ── WHAT REPLACES IT ────────────────────────────────────────────────────────
 *
 *   The fallback fires only on the condition it was written for — PGRST202
 *   and 42883, the function not being there. Everything else reports
 *   `counted: false`, which these screens already render as "—" rather than 0
 *   (#835, lib/admin-stat-display). An unknown figure is a worse answer than
 *   a real one and a far better one than a stampede.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockRpc = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/supabase', () => ({
    supabaseAdmin: { rpc: (...a: any[]) => mockRpc(...a) },
}));

const mockError = jest.fn();
const mockWarn = jest.fn();
jest.mock('@/lib/logger', () => ({
    logger: {
        error: (...a: any[]) => mockError(...a),
        warn: (...a: any[]) => mockWarn(...a),
        info: jest.fn(), debug: jest.fn(),
    },
}));

/** How many times the per-bucket fallback opened the users collection. */
function usersScansIssued(): number {
    const calls = (globalThis as any).mockFirestoreCollection?.mock?.calls ?? [];
    return calls.filter(([name]: any[]) => name === 'users').length;
}

async function count(module = 'cooperative') {
    const { countModuleApplicants } = await import('@/lib/module-applicant-count');
    return await countModuleApplicants(module as any);
}

/** What a healthy rollup returns: one row per set of statuses. */
const ROWS = [
    { statuses: ['approved'], people: '14668' },
    { statuses: ['not_started'], people: '16997' },
    { statuses: ['pending'], people: '900' },
];

beforeEach(() => {
    jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('when the rollup answers', () => {
    it('uses it, and issues no per-bucket scans at all', async () => {
        mockRpc.mockResolvedValue({ data: ROWS, error: null });

        const res = await count();

        expect(res.counted).toBe(true);
        expect(res.approved).toBe(14668);
        expect(usersScansIssued()).toBe(0);
    });
});

describe('when the function is NOT THERE — the case the fallback was written for', () => {
    it('falls back to the per-bucket scans', async () => {
        //   THE CONTROL. Without this the fix could be "never fall back",
        //   which breaks every deploy that lands before its migration.
        mockRpc.mockResolvedValue({
            data: null,
            error: { code: 'PGRST202', message: 'Could not find the function' },
        });

        await count();

        expect(usersScansIssued()).toBeGreaterThan(0);
    });

    it('and says so at warn, not error — it is expected between deploys', async () => {
        mockRpc.mockResolvedValue({
            data: null, error: { code: 'PGRST202', message: 'Could not find the function' },
        });

        await count();

        expect(mockWarn).toHaveBeenCalledWith(
            expect.stringContaining('falling back'), expect.anything(),
        );
    });

    it('42883 — Postgres’s own undefined_function — counts as absent too', async () => {
        mockRpc.mockResolvedValue({
            data: null, error: { code: '42883', message: 'function does not exist' },
        });

        await count();

        expect(usersScansIssued()).toBeGreaterThan(0);
    });
});

describe('when the rollup TIMES OUT', () => {
    it('THE REPORTED DEFECT: does not run the same scan fifteen more times', async () => {
        mockRpc.mockResolvedValue({
            data: null,
            error: { code: '57014', message: 'canceling statement due to statement timeout' },
        });

        await count();

        expect(usersScansIssued()).toBe(0);
    });

    it('and reports the figures as UNKNOWN rather than zero', async () => {
        //   #835's rule, which the screens depend on: a failed count is null,
        //   never 0, because 0 says the programme is empty.
        mockRpc.mockResolvedValue({
            data: null,
            error: { code: '57014', message: 'canceling statement due to statement timeout' },
        });

        const res = await count();

        expect(res.counted).toBe(false);
        expect(res.total).toBeNull();
        expect(res.approved).toBeNull();
    });

    it('and says WHY at error level, naming the timeout', async () => {
        //   Nothing else in the log would explain a screen full of dashes.
        mockRpc.mockResolvedValue({
            data: null,
            error: { code: '57014', message: 'canceling statement due to statement timeout' },
        });

        await count();

        expect(mockError).toHaveBeenCalledWith(
            expect.stringContaining('TIMED OUT'),
            expect.objectContaining({ code: '57014' }),
        );
    });
});

describe('every other failure is treated the same way', () => {
    it('an unrecognised error code does not stampede', async () => {
        mockRpc.mockResolvedValue({
            data: null, error: { code: '08006', message: 'connection failure' },
        });

        const res = await count();

        expect(usersScansIssued()).toBe(0);
        expect(res.counted).toBe(false);
    });

    it('a THROWN error is transport, not a missing function', async () => {
        //   A missing function arrives as PGRST202 in `error`, never as a
        //   throw. Retrying fifteen times over the same broken transport is
        //   the stampede by another route.
        mockRpc.mockRejectedValue(new Error('socket hang up'));

        const res = await count();

        expect(usersScansIssued()).toBe(0);
        expect(res.counted).toBe(false);
    });

    it('a non-array payload with no error is a failure, not an absence', async () => {
        mockRpc.mockResolvedValue({ data: { unexpected: true }, error: null });

        const res = await count();

        expect(usersScansIssued()).toBe(0);
        expect(res.counted).toBe(false);
    });
});
