/**
 * @jest-environment node
 */

/**
 *   #373 A FOURTH FORENSIC CHECK THAT COULD NEVER FIND ANYTHING — AND THIS ONE
 *        GUARDED THE MONEY CEILING ON EXPORT WINDOWS.
 *
 *        #331 found two of the eight checks in actions/forensics.ts reporting
 *        "pass" for questions they could not ask. #372 found a third. This is
 *        the fourth, and the only one of the four watching money.
 *
 *        Export "Investment Cap Breach" read:
 *
 *            const cap = data.investmentCap || 0;
 *            const totalInvested = data.totalInvested || 0;
 *            if (totalInvested > (cap * 1.05)) { ...breach... }
 *
 *        NEITHER FIELD IS ON AN EXPORT WINDOW.
 *
 *          investmentCap   appears exactly TWICE in this repository: its
 *                          optional declaration in types/index.ts, and the line
 *                          that read it. No writer anywhere, no other reader.
 *          totalInvested   IS written — by export-payment.ts and
 *                          infrastructure/payments/service.ts — onto
 *                          INVESTOR_PORTFOLIOS. Never onto a window.
 *
 *        So both operands were 0 on every window and `0 > 0 * 1.05` is false.
 *        The check reported "pass" for every window ever scanned.
 *
 *        A CORRECTION TO MY OWN FIRST READING, which was that a missing cap
 *        makes the test `totalInvested > 0` and therefore flags every funded
 *        window — a false FAIL. That was wrong: `totalInvested` is not on the
 *        window either, so both sides are zero and the answer is a false PASS.
 *        Recorded because the difference matters — a check that cries wolf gets
 *        noticed, and one that says "clean" does not.
 *
 *        THE WINDOW DOES CARRY THE PAIR, UNDER THE NAMES THE MONEY PATHS USE.
 *        All three fulfilment paths — export-payment.ts, _ex_investments.ts and
 *        infrastructure/payments/service.ts — call incrementWithinCeiling with
 *        `field: "fundedAmount"` and a ceiling of `fundingGoal`, falling back to
 *        the legacy `goal`. That is the invariant a Postgres row lock enforces
 *        on the way in. This check is meant to be the audit that it held, and it
 *        was asking about two fields that never existed.
 *
 *        AN UNCAPPED WINDOW IS INCONCLUSIVE, NOT A PASS. `fundingGoal` was added
 *        to the window creator by an earlier finding, whose own note says the
 *        overfunding machinery was inert until then because "nothing wrote
 *        fundingGoal onto a window". Windows created before that carry neither
 *        name, and incrementWithinCeiling treats a missing ceiling as UNBOUNDED
 *        — so those windows really are uncapped, and reporting "no breach" for
 *        them is the same false green line. #55 is the open owner decision.
 *
 *        STILL NOBODY CALLS THIS FILE. #331's recorded owner decision, unchanged.
 *
 * These tests EXECUTE the scan against a seeded world, for #331's reason: what
 * the code intends tells you nothing about whether its comparison can fire.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { EXPORT_WINDOW_INVESTABLE_STATUSES } from '@/lib/export-window-status';
import { COLLECTIONS } from '@/lib/types/firestore';

const ADMIN = 'admin-1';
const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const FORENSICS = 'src/app/actions/forensics.ts';
const CHECK = 'Investment Cap Breach';

function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) {
            if (e.name === '__tests__') continue;
            walk(rel, out);
        } else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(rel);
    }
    return out;
}

const SRC = walk('src');

function setSession(uid: string, roles: string[]) {
    (global as any).mockRequireSession.mockResolvedValue({
        session: { user: { id: uid, roles, email: 'a@b.c' } },
        response: null,
    });
}

/** Seeds export_windows only; every other query the scan makes answers empty. */
function setWindows(windows: Array<{ id: string; data: any }>) {
    (global as any).mockFirestoreGet.mockImplementation((idOrCollection: string) => {
        const empty = { exists: false, empty: true, size: 0, docs: [], data: () => ({}) };

        // COLLECTIONS.EXPORT_WINDOWS, not a hand-typed string: the collection
        // is "exportWindows", and seeding "export_windows" fed the check an
        // empty world that reported a clean pass — the same false green line
        // this finding is about, reproduced in my own harness.
        if (idOrCollection === COLLECTIONS.EXPORT_WINDOWS) {
            return Promise.resolve({
                exists: false,
                empty: windows.length === 0,
                size: windows.length,
                truncated: false,
                docs: windows.map((w) => ({ id: w.id, data: () => w.data })),
                data: () => ({}),
            });
        }
        return Promise.resolve(empty);
    });

    (global as any).mockFirestoreTxGet.mockImplementation(() =>
        Promise.resolve({ exists: false, empty: true, size: 0, docs: [], data: () => ({}) }));
}

async function scan() {
    const { runForensicScanAction } = await import('@/app/actions/forensics');
    return runForensicScanAction();
}

function cap(result: any) {
    const results = result?.data?.results ?? result?.results ?? [];
    return results.find((r: any) => r.check === CHECK);
}

beforeEach(() => {
    jest.clearAllMocks();
    setSession(ADMIN, ['admin']);
    (global as any).adminAuthListUsers?.mockReset?.();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#373 — the cap check can now fail', () => {
    it('FINDS A WINDOW RAISED PAST ITS FUNDING GOAL', () => {
        // The whole defect in one case. Before the fix both operands were 0 on
        // this window and it reported "pass".
        setWindows([{ id: 'w1', data: { status: 'open', fundingGoal: 1_000_000, fundedAmount: 2_000_000 } }]);

        return scan().then((r) => {
            const c = cap(r);
            expect(c.status).toBe('warning');
            expect(c.affectedIds).toEqual(['w1 (raised: 2000000, goal: 1000000)']);
        });
    });

    it('and reads the LEGACY ceiling name too, as the money paths do', async () => {
        // All three fulfilment paths fall back from fundingGoal to `goal`. A
        // forensic that knew only the new name would clear every old window.
        setWindows([{ id: 'w1', data: { status: 'open', goal: 1_000_000, fundedAmount: 2_000_000 } }]);

        expect(cap(await scan()).status).toBe('warning');
    });

    it('a window inside its goal is a pass', async () => {
        setWindows([{ id: 'w1', data: { status: 'open', fundingGoal: 1_000_000, fundedAmount: 900_000 } }]);

        const c = cap(await scan());

        expect(c.status).toBe('pass');
        expect(c.affectedIds).toEqual([]);
    });

    it('and the 5% tolerance is honoured, not silently dropped', async () => {
        // Exactly at the tolerance is not a breach; a hair above it is.
        setWindows([{ id: 'w1', data: { status: 'open', fundingGoal: 1_000_000, fundedAmount: 1_050_000 } }]);
        expect(cap(await scan()).status).toBe('pass');

        setWindows([{ id: 'w2', data: { status: 'open', fundingGoal: 1_000_000, fundedAmount: 1_050_001 } }]);
        expect(cap(await scan()).status).toBe('warning');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#373 — an uncapped window is not a clean bill of health', () => {
    it('A WINDOW WITH NO FUNDING GOAL IS INCONCLUSIVE', async () => {
        // incrementWithinCeiling treats a missing ceiling as UNBOUNDED, so such
        // a window is genuinely uncapped. Saying "no breach" about it is the
        // false green line this whole file keeps producing.
        setWindows([{ id: 'w1', data: { status: 'open', fundedAmount: 5_000_000 } }]);

        const c = cap(await scan());

        expect(c.status).toBe('inconclusive');
        expect(c.affectedIds).toEqual(['w1 (no funding goal recorded — uncapped)']);
    });

    it('a goal of zero counts as no goal, not as a goal everything breaches', async () => {
        setWindows([{ id: 'w1', data: { status: 'open', fundingGoal: 0, fundedAmount: 100 } }]);

        expect(cap(await scan()).status).toBe('inconclusive');
    });

    it('and the two populations are counted separately in the details', async () => {
        setWindows([
            { id: 'w1', data: { status: 'open', fundingGoal: 1_000_000, fundedAmount: 900_000 } },
            { id: 'w2', data: { status: 'open', fundedAmount: 900_000 } },
            { id: 'w3', data: { status: 'open', fundingGoal: 100, fundedAmount: 900_000 } },
        ]);

        const c = cap(await scan());

        expect(c.details).toContain('2 with a funding goal');
        expect(c.details).toContain('1 without one');
        expect(c.details).toContain('Found 1 over-funded');
        // A real breach outranks an inconclusive: the operator must see it.
        expect(c.status).toBe('warning');
    });

    it('an empty collection is a pass, not an inconclusive', async () => {
        setWindows([]);

        expect(cap(await scan()).status).toBe('pass');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#373 — the fields it reads are the fields the money paths write', () => {
    const PATHS = [
        'src/app/actions/export-payment.ts',
        'src/app/actions/export/_ex_investments.ts',
        'src/infrastructure/payments/service.ts',
    ];

    it('ALL THREE FULFILMENT PATHS ACCUMULATE INTO fundedAmount', () => {
        for (const f of PATHS) {
            const src = source(f);
            const at = src.indexOf('incrementWithinCeiling({');

            expect({ f, calls: at > -1 }).toEqual({ f, calls: true });
            expect(src.slice(at, at + 400)).toContain('field: "fundedAmount"');
        }
    });

    it('and all three take the ceiling from fundingGoal, falling back to goal', () => {
        for (const f of PATHS) {
            expect({ f, fallback: /fundingGoal !== undefined \? "fundingGoal" : "goal"/.test(source(f)) })
                .toEqual({ f, fallback: true });
        }
    });

    it('THE OLD FIELDS ARE WRITTEN NOWHERE ON A WINDOW', () => {
        // The measurement that produced the finding. `investmentCap` has no
        // writer at all; `totalInvested` has writers, but they target
        // investor_portfolios.
        const capWriters = SRC.filter((f) => /\binvestmentCap\b/.test(source(f)));

        expect(capWriters).toEqual(['src/types/index.ts']);

        const investedOnWindows = SRC.filter((f) => {
            const s = source(f);
            if (!/\btotalInvested:/.test(s)) return false;
            const at = s.indexOf('totalInvested:');
            return s.slice(Math.max(0, at - 600), at).includes('EXPORT_WINDOWS');
        });

        expect(investedOnWindows).toEqual([]);
    });

    it('and the check no longer names either of them', () => {
        const src = source(FORENSICS);

        expect(src).not.toContain('data.investmentCap');
        expect(src).not.toContain('data.totalInvested');
        expect(src).toContain('data.fundingGoal ?? data.goal');
        expect(src).toContain('data.fundedAmount ?? 0');
    });

    it('the window creator really does write fundingGoal, so the fix has an input', () => {
        // Vacuity guard: reading the right field name is worth nothing if the
        // creator never sets it. An earlier finding added this line.
        expect(source('src/app/actions/export-aggregation.ts'))
            .toMatch(/fundingGoal:\s*targetVolume \* slotPrice/);
    });

    it('and the status filter is still the derived one, not a literal', () => {
        /**
         * The half an earlier finding fixed. Pinned so repairing the comparison
         * cannot quietly undo the query.
         *
         * A CORRECTION TO MY OWN FIRST DRAFT, which asserted the constant does
         * NOT contain "active". It does — the set is ["open", "active"]. The
         * earlier finding's point was narrower than I read it: the check used to
         * query the literal "active" ALONE, and it is `open` that nothing else
         * would have matched. The constant covers both, which is why deriving
         * from it rather than writing a literal is the fix.
         */
        const src = source(FORENSICS);
        const at = src.indexOf('COLLECTIONS.EXPORT_WINDOWS');
        const block = src.slice(at, at + 300);

        expect(at).toBeGreaterThan(-1);
        expect(block).toContain('EXPORT_WINDOW_INVESTABLE_STATUSES');
        expect([...EXPORT_WINDOW_INVESTABLE_STATUSES]).toContain('open');
        expect([...EXPORT_WINDOW_INVESTABLE_STATUSES]).toContain('active');

        // SCOPED to the export block, not the file. A file-wide version of this
        // caught the ACADEMY check's `where("status", "==", "active")` on
        // course_enrollments — where "active" is the correct enrolment status
        // and nothing is wrong. An assertion about one query has to look at
        // that query.
        expect(block).not.toMatch(/where\("status",\s*"==",\s*"active"\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#373 — the sweeps are not vacuous', () => {
    it('finds the source files', () => {
        expect(SRC.length).toBeGreaterThan(400);
    });

    it('and report writers where they exist', () => {
        // Guard on the "no writer" claims above: the same sweep must find the
        // field that IS written to a window.
        const funded = SRC.filter((f) => /field: "fundedAmount"/.test(source(f)));

        expect(funded.length).toBe(3);
    });

    it('measured on code, not on prose', () => {
        // The #373 note quotes `investmentCap` and `totalInvested` by name. A
        // raw-text sweep would count the tombstone as a live reference — the
        // trap has fired twelve times in this audit.
        const raw = readFileSync(FORENSICS, 'utf-8');

        expect(raw).toContain('investmentCap');
        expect(source(FORENSICS)).not.toContain('investmentCap');
    });

    it('and the file records this as its fourth false pass', () => {
        expect(readFileSync(FORENSICS, 'utf-8')).toContain('#373');
    });
});
