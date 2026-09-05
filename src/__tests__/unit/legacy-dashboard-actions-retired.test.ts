/**
 * @jest-environment node
 */

/**
 *   #426 A SUPERSEDED DASHBOARD DATA LAYER, STILL REACHABLE, STILL CARRYING A
 *   WRONG COUNT.
 *
 *   Found from #424: chasing where enrolment rows live led to
 *   actions/dashboard.ts, whose Academy tile counts COLLECTIONS.ENROLLMENTS —
 *   the collection only the PAID flow writes.
 *
 *   Then the more basic fact: NOTHING IMPORTS THE MODULE. The apparent callers
 *   of getDashboardStatsAction are a NAME COLLISION with
 *   actions/admin-analytics.ts, which is what every admin screen imports. The
 *   member dashboard was rebuilt on session-scoped actions when six browser-side
 *   Supabase queries under the public anon key were closed; this module is what
 *   it was rebuilt away from, and it was left behind rather than retired.
 *
 *   All three exports are "use server", so all three are independently
 *   addressable endpoints regardless of whether a screen calls them — the
 *   property that made autoEnrollPaidUser a paid-content bypass. They are
 *   session-guarded and read only the caller's own rows, so this is not a
 *   security hole. It is #421's hazard: code that LOOKS like the dashboard's
 *   data layer, carrying a wrong number, waiting to be wired up.
 *
 *   An earlier fix in this same file — three queries filtering EXPORT_WINDOWS by
 *   a `userId` the collection does not have — delivered nothing for exactly the
 *   same reason. No screen reads it.
 *
 *   RETIRED, NOT DELETED, behind LEGACY_DASHBOARD_ACTIONS. #379's and #386's
 *   treatment. The enrolment count is RECORDED as wrong rather than repaired:
 *   fixing a number nothing displays would leave the revivable module exactly
 *   where it was, and whoever revives it now has the defect in front of them.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the stats door stops refusing              KILLED
 *     the activity door stops refusing           KILLED
 *     the escrow door stops refusing             KILLED
 *     the flag is read at module load            KILLED
 *     the flag accepts any truthy value          KILLED
 *     reword the header prose                    SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));
jest.mock('@/lib/auth', () => ({
    auth: async () => null, signIn: async () => undefined,
    signOut: async () => undefined, handlers: {},
}));

const ROOT = process.cwd();
const MODULE = 'src/app/actions/dashboard.ts';
const code = () => stripComments(readFileSync(join(ROOT, MODULE), 'utf-8'), { label: relative(ROOT, MODULE) });

const dashboard = () => import('@/app/actions/dashboard');

const ORIGINAL = process.env.LEGACY_DASHBOARD_ACTIONS;
beforeEach(() => { delete process.env.LEGACY_DASHBOARD_ACTIONS; });
afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.LEGACY_DASHBOARD_ACTIONS;
    else process.env.LEGACY_DASHBOARD_ACTIONS = ORIGINAL;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#426 — all three doors refuse by default', () => {
    it('THE STATS ACTION REFUSES', async () => {
        const { getDashboardStatsAction } = await dashboard();
        const r = await getDashboardStatsAction() as any;
        expect(r?.success).toBe(false);
        expect(String(r?.error)).toMatch(/retired \(#426\)/);
    });

    it('and the recent-activity action refuses', async () => {
        const { getRecentActivityAction } = await dashboard();
        const r = await getRecentActivityAction() as any;
        expect(r?.success).toBe(false);
        expect(String(r?.error)).toMatch(/retired \(#426\)/);
    });

    it('and the escrow-status action refuses', async () => {
        const { getEscrowStatusAction } = await dashboard();
        const r = await getEscrowStatusAction() as any;
        expect(r?.success).toBe(false);
        expect(String(r?.error)).toMatch(/retired \(#426\)/);
    });

    it('and they all say the SAME thing, naming the replacement', async () => {
        const m = await dashboard();
        const errors = await Promise.all([
            (m.getDashboardStatsAction() as any),
            (m.getRecentActivityAction() as any),
            (m.getEscrowStatusAction() as any),
        ]).then((rs) => rs.map((r: any) => String(r?.error)));

        expect(new Set(errors).size).toBe(1);
        expect(errors[0]).toMatch(/session-scoped actions/);
    });

    it('and a refusal is a RESOLVED value, not a throw (#406)', async () => {
        // Every caller in this codebase reads result.success. An action that
        // rejects instead would surface as an unhandled error.
        const { getDashboardStatsAction } = await dashboard();
        await expect(getDashboardStatsAction()).resolves.toBeDefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#426 — the flag revives it, and only the exact value', () => {
    it('ONLY "enabled" TURNS IT BACK ON', () => {
        const src = code();
        expect(src).toMatch(/process\.env\.LEGACY_DASHBOARD_ACTIONS === "enabled"/);
    });

    it('and the flag is read at CALL time, not module load', async () => {
        // Read at load, a test (or a runtime toggle) could never change it, and
        // the retirement could not be lifted without a redeploy.
        const src = code();
        expect(src).toMatch(/function legacyDashboardActionsEnabled\(\): boolean \{\s*return process\.env/);

        process.env.LEGACY_DASHBOARD_ACTIONS = 'enabled';
        const { getDashboardStatsAction } = await dashboard();
        const r = await getDashboardStatsAction() as any;
        // It gets past the door — what it does next needs a database, which is
        // not this test's subject. The point is that it is no longer refused.
        expect(String(r?.error ?? '')).not.toMatch(/retired \(#426\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#426 — nothing is deleted, and the defect is on the record', () => {
    it('THE IMPLEMENTATION IS STILL THERE', () => {
        const src = code();
        // Retiring means refusing at the door, not removing the code behind it.
        expect(src).toMatch(/COLLECTIONS\.EXPORT_SLOTS/);
        expect(src).toMatch(/COLLECTIONS\.ESCROW_TRANSACTIONS/);
        expect(src).toMatch(/readCooperativeBalance/);
    });

    it('and the wrong enrolment count is RECORDED, not silently repaired', () => {
        const raw = readFileSync(join(ROOT, MODULE), 'utf-8');
        // The comment must name the collection and say what it misses, so the
        // next person to wire this up has the defect in front of them.
        expect(raw).toMatch(/academyEnrollments` counts/);
        expect(raw).toMatch(/COURSE_ENROLLMENTS/);
        // And the code genuinely still has it — the note is not describing a
        // fix that quietly happened.
        expect(code()).toMatch(/collection\(COLLECTIONS\.ENROLLMENTS\)[\s\S]{0,120}\.count\(\)/);
    });

    it('and the premise holds — still no importer anywhere in src', () => {
        // If a screen ever imports this, the retirement is the wrong answer and
        // this test should fail so somebody decides again.
        const { execFileSync } = require('child_process') as typeof import('child_process');
        let out = '';
        try {
            out = execFileSync('grep', [
                '-rl', 'actions/dashboard', 'src/',
                '--include=*.ts', '--include=*.tsx',
            ], { cwd: ROOT, encoding: 'utf-8' });
        } catch {
            out = ''; // grep exits 1 when there are no matches
        }
        const importers = out.split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .filter((f) => f !== MODULE && !f.includes('__tests__'));

        expect({ importers }).toEqual({ importers: [] });
    });
});
