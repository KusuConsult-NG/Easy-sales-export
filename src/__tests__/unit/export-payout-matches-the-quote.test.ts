/**
 * @jest-environment node
 */

/**
 * The payout rate disagreed with the advertised one — #324.
 *
 * Three places decide an export return. Until now the two that only TALK about
 * it agreed, and the one that MOVES MONEY did not.
 *
 *   /export/windows/[id]        quotes exportWindowRoiPercent(...) — 20 for a
 *                               window recording nothing — at the moment the
 *                               investor commits.
 *   payments/service.ts         records expectedReturn = amount * 1.20
 *   export/_ex_investments.ts   records expectedReturn = amount * 1.20
 *   cron/release-escrow         PAID amount * 1.15
 *
 * The cron did:
 *
 *     const roiString = data.roi || "15%";
 *     let roiPercentage = 0.15;
 *     const match = roiString.match(/(\d+)%/);
 *     if (match) roiPercentage = parseInt(match[1]) / 100;
 *
 * Three failures in five lines:
 *
 *   1. Nothing writes an `roi` onto an export window. lib/export-window-status
 *      establishes that in its own doc, and the sweep below re-establishes it
 *      rather than trusting the comment. So the configured branch never ran.
 *   2. The default was therefore always in force, and it was 15, not 20.
 *   3. It never read `roiPercentage` — the field payments/service.ts's warning
 *      instructs the operator to add — so even a correctly configured window
 *      was paid the default.
 *
 * A five-percentage-point shortfall on every export return, silently, forever.
 *
 * The helper's own doc had already named this exact failure mode: 20 is the
 * default because "using anything else would have the page advertise one figure
 * and the payout compute another". The cron was the anything else — the one
 * path in the export module that never adopted this module. #38/#179/#183's
 * shape (one rule in N copies that disagree), landing on the copy that pays.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    exportWindowReturnMultiplier,
    exportWindowRoiPercent,
    DEFAULT_EXPORT_ROI_PERCENT,
} from '@/lib/export-window-status';
import { COLLECTIONS } from '@/lib/types/firestore';

function source(rel: string): string {
    return stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });
}

// ─────────────────────────────────────────────────────────────────────────────
// The helper
// ─────────────────────────────────────────────────────────────────────────────

describe('one rule for what a window pays back', () => {
    it('THE test: a window recording nothing pays the rate the page quotes', () => {
        // The contradiction, as one assertion. The left side is what the cron
        // now uses; the right is what /export/windows/[id] shows the investor
        // before they pay. Before the fix the left side was 1.15.
        expect(exportWindowReturnMultiplier({}))
            .toBeCloseTo(1 + exportWindowRoiPercent(undefined) / 100, 10);

        expect(exportWindowReturnMultiplier({})).toBeCloseTo(1.20, 10);
    });

    it('a recorded multiplier wins', () => {
        expect(exportWindowReturnMultiplier({ returnMultiplier: 1.35 })).toBe(1.35);
    });

    it('the legacy field name is still honoured', () => {
        // Both fulfilment paths read expectedReturnMultiplier as a fallback,
        // so dropping it here would change what they pay.
        expect(exportWindowReturnMultiplier({ expectedReturnMultiplier: 1.5 })).toBe(1.5);
    });

    it('the current name wins over the legacy one', () => {
        expect(exportWindowReturnMultiplier({
            returnMultiplier: 1.1, expectedReturnMultiplier: 1.9,
        })).toBe(1.1);
    });

    it('a nonsense multiplier falls back rather than paying it', () => {
        // A zero would pay the member nothing and a negative would take money
        // back. Neither may reach a credit.
        for (const bad of [0, -1, NaN, Infinity, 'lots', null, undefined, {}]) {
            expect(exportWindowReturnMultiplier({ returnMultiplier: bad as any }))
                .toBeCloseTo(1.20, 10);
        }
    });

    it('a missing window does not throw', () => {
        expect(exportWindowReturnMultiplier(null)).toBeCloseTo(1.20, 10);
        expect(exportWindowReturnMultiplier(undefined)).toBeCloseTo(1.20, 10);
    });

    it('it is tied to the advertised default, not to a second copy of 20', () => {
        // Vacuity guard on the whole finding: if DEFAULT_EXPORT_ROI_PERCENT is
        // ever changed, the payout must move with it. A hardcoded 1.20 here
        // would silently re-open the gap this test exists to close.
        expect(exportWindowReturnMultiplier({}))
            .toBeCloseTo(1 + DEFAULT_EXPORT_ROI_PERCENT / 100, 10);

        expect(source('src/lib/export-window-status.ts'))
            .toContain('return 1 + DEFAULT_EXPORT_ROI_PERCENT / 100;');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The cron, executed
// ─────────────────────────────────────────────────────────────────────────────

let DOCS: Record<string, Record<string, any>> = {};
let WRITES: Array<{ path: string; id: string; data: any }> = [];

function makeCollection(path: string): any {
    const q: any = {
        where: () => q, orderBy: () => q, limit: () => q, all: () => q, select: () => q,
        get: async () => {
            const rows = Object.entries(DOCS[path] ?? {});
            return {
                docs: rows.map(([id, data]) => ({ id, data: () => data })),
                empty: rows.length === 0,
            };
        },
        doc: (id?: string) => {
            const docId = id ?? `gen-${WRITES.length}`;
            return {
                id: docId,
                get: async () => ({
                    id: docId, exists: Boolean(DOCS[path]?.[docId]),
                    data: () => DOCS[path]?.[docId],
                }),
                set: async (d: any) => { WRITES.push({ path, id: docId, data: d }); (DOCS[path] ||= {})[docId] = { ...d }; },
                update: async (d: any) => { WRITES.push({ path, id: docId, data: d }); (DOCS[path] ||= {})[docId] = { ...(DOCS[path]?.[docId] ?? {}), ...d }; },
                collection: (sub: string) => makeCollection(`${path}/${docId}/${sub}`),
            };
        },
    };
    return q;
}

jest.mock('@/lib/supabase-db', () => ({
    supabaseDb: {
        collection: (name: string) => makeCollection(name),
        runTransaction: async (fn: any) => fn({
            get: (ref: any) => ref.get(),
            set: (ref: any, d: any) => ref.set(d),
            update: (ref: any, d: any) => ref.update(d),
        }),
    },
}));

jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(async () => ({ claimed: true })),
    claimStatusTransitionFromAny: jest.fn(async () => ({ claimed: true })),
}));

jest.mock('@/infrastructure/notifications/service', () => ({
    createNotification: jest.fn(async () => ({ success: true, error: null, data: null })),
}));

const SECRET = 'test-cron-secret';

async function runCron() {
    const { GET } = await import('@/app/api/cron/release-escrow/route');
    const res: any = await GET({
        headers: { get: (h: string) => (h.toLowerCase() === 'authorization' ? `Bearer ${SECRET}` : null) },
        nextUrl: new URL('https://x/api/cron/release-escrow'),
    } as any);
    return (await res.json()).exportWindows;
}

/** What the member's savings were actually credited. */
function credited(): number {
    const w = WRITES.find((x) => x.path === COLLECTIONS.COOPERATIVE_MEMBERS);
    const inc: any = w?.data?.savingsBalance ?? w?.data?.balance;
    return inc?._operand ?? inc?.operand ?? NaN;
}

function seedWindow(extra: Record<string, unknown>) {
    DOCS = {};
    WRITES = [];
    DOCS[COLLECTIONS.EXPORT_WINDOWS] = {
        w1: {
            userId: 'u1', amount: 100_000, status: 'delivered',
            commodity: 'Sesame', quantity: '10 tonnes',
            escrowReleaseDate: new Date(Date.now() - 86_400_000).toISOString(),
            ...extra,
        },
    };
    DOCS[COLLECTIONS.USERS] = { u1: { id: 'u1' } };
    DOCS[COLLECTIONS.COOPERATIVE_MEMBERS] = { u1: { userId: 'u1', savingsBalance: 0 } };
}

beforeEach(() => {
    jest.resetModules();
    // resetModules does NOT clear call history; both are needed.
    jest.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    DOCS = {};
    WRITES = [];
});

describe('what the cron actually credits', () => {
    it('THE test: a plain window pays 1.20x, not 1.15x', async () => {
        // The defect, executed. ₦100,000 invested returned ₦115,000 while the
        // investor was quoted 20%. It now returns ₦120,000.
        seedWindow({});

        const stats = await runCron();

        expect(credited()).toBe(120_000);
        expect(stats.totalValueReleased).toBe(120_000);
    });

    it('a configured multiplier is honoured', async () => {
        seedWindow({ returnMultiplier: 1.3 });

        await runCron();

        expect(credited()).toBe(130_000);
    });

    it('the roi STRING does not move the money, in either direction', async () => {
        // Deliberate, and the reason the helper does not read it: no money path
        // has ever done so, and making the string authoritative would change
        // what the two working fulfilment paths pay. Pinned so the asymmetry is
        // a recorded decision rather than a rediscovered surprise.
        seedWindow({ roi: '5%', roiPercentage: '45%' });

        await runCron();

        expect(credited()).toBe(120_000);
    });

    it('the old 15% default is gone', async () => {
        seedWindow({});

        await runCron();

        expect(credited()).not.toBe(115_000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// All three paths, one rule
// ─────────────────────────────────────────────────────────────────────────────

const MONEY_PATHS = [
    'src/app/api/cron/release-escrow/route.ts',
    'src/infrastructure/payments/service.ts',
    'src/app/actions/export/_ex_investments.ts',
];

describe('every path that computes an export return uses the same rule', () => {
    it('all three call the helper', () => {
        // COUNTED across the three, not matched in one. Membership cannot tell
        // "all three adopted it" from "one adopted it" — the trap this audit
        // has hit six times now.
        const adopted = MONEY_PATHS.filter((rel) =>
            source(rel).includes('exportWindowReturnMultiplier('),
        );

        expect(adopted).toEqual(MONEY_PATHS);
    });

    it('none of them still hardcodes its own multiplier', () => {
        for (const rel of MONEY_PATHS) {
            const src = source(rel);

            expect(src).not.toMatch(/\?\?\s*1\.20/);
            expect(src).not.toContain('roiPercentage = 0.15');
        }
    });

    it('nothing writes an roi onto an export window, still', () => {
        // The premise the whole finding rests on, re-established here rather
        // than taken from a comment. Checked against STRIPPED source: three
        // files now explain this defect and name the field while doing so, and
        // a raw grep counts the explanation as a writer — the comment-vs-code
        // trap, on its sixth outing in this audit.
        const candidates = execSync('grep -rln "roi" src/app/actions src/infrastructure || true', {
            encoding: 'utf-8', cwd: process.cwd(),
        }).split('\n').filter((f) => f.trim() && !f.includes('__tests__'));

        const windowWriters = candidates.filter((rel) => {
            const lines = source(rel).split('\n');
            return lines.some((l, i) => {
                if (!/\b(roi|roiPercentage)\s*:/.test(l)) return false;
                // Is this write aimed at an export WINDOW rather than a slot?
                const near = lines.slice(Math.max(0, i - 12), i + 2).join('\n');
                return near.includes('EXPORT_WINDOWS');
            });
        });

        expect(windowWriters).toEqual([]);
    });
});
