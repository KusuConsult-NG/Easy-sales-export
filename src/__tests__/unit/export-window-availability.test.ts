/**
 * @jest-environment node
 */

/**
 *   #352 THE INVESTMENT PAGE SHOWED A NEGATIVE NUMBER OF AVAILABLE SPOTS.
 *
 *        `totalSpots` HAS NO WRITER anywhere in this repository. Not in src,
 *        not in supabase/, not in scripts/. It is a type declaration in
 *        types/index.ts and four readers:
 *
 *          _ex_investments.ts     a funding-limit guard
 *          export-investments.ts  the list mapper and the by-id mapper
 *          export/windows/[id]    the availability panel
 *
 *        `spotsFilled` beside it IS written — incremented in three places, on
 *        every verified investment. So the numerator grew against a
 *        denominator nobody set, and
 *
 *            spotsLeft: (data.totalSpots || 0) - (data.spotsFilled || 0)
 *
 *        went NEGATIVE. The page then rendered `{spotsLeft}/{totalSpots}` —
 *        "-3/0" — and sized its progress bar with
 *        `(spotsLeft / totalSpots) * 100`, which is `-3 / 0 * 100`:
 *        `-Infinity%`, not a CSS length. Every export window that had ever
 *        taken an investment displayed a negative availability count to the
 *        next investor deciding whether to put money in.
 *
 *        WHAT ACTUALLY BOUNDS A WINDOW, and this is why the finding is a
 *        display defect and not a money hole: `fundedAmount` is raised against
 *        `fundingGoal` through incrementWithinCeiling in
 *        verifyExportInvestmentAction, which locks the row and refuses past the
 *        goal. That is enforced. The spots model is a parallel, half-built
 *        third counter, and its guard has never fired because
 *        `exportData?.totalSpots &&` short-circuits on undefined — #274's
 *        shape, a control that reads as present and is none.
 *
 *        The guard is KEPT and corrected rather than removed, per the standing
 *        instruction to fix rather than delete: it would now work if a window
 *        ever carried a real spots limit. The screens report the model that
 *        exists.
 *
 *        OWNER DECISION: build the spots model, or retire it? It duplicates a
 *        bound that already works, and nothing has ever set its denominator.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const ACTION = 'src/app/actions/export-investments.ts';
const INVEST = 'src/app/actions/export/_ex_investments.ts';
const PAGE = 'src/app/export/windows/[id]/page.tsx';

const WINDOW = 'win-1';

/** The document a window read returns. */
let windowData: Record<string, any>;

beforeEach(() => {
    jest.clearAllMocks();
    windowData = {
        commodity: 'Sesame', status: 'open', amount: 50_000, roi: '18%',
        startDate: '2026-01-01', endDate: '2026-06-01',
        fundingGoal: 1_000_000, fundedAmount: 250_000,
        spotsFilled: 3,           // written on every investment...
        // ...and totalSpots is absent, because nothing writes it.
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [{ id: WINDOW, data: () => windowData }],
        data: () => windowData,
    }));
});

async function byId() {
    const { getExportOpportunityById } = await import('@/app/actions/export-investments');
    return getExportOpportunityById(WINDOW) as any;
}

async function list() {
    const { getExportOpportunities } = await import('@/app/actions/export-investments');
    return getExportOpportunities(12) as any;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#352 — availability is never a negative number', () => {
    it('A WINDOW WITH INVESTMENTS AND NO SPOTS LIMIT REPORTS 0, NOT -3', async () => {
        // THE test. This is the shape of every window in production: a
        // spotsFilled that grows against a totalSpots nobody writes.
        const result = await byId();

        expect(result.success).toBe(true);
        /**
         * `null`, not 0 — the merge of two fixes for one defect.
         *
         * This asserted 0, from flooring the subtraction: `Math.max(0,
         * totalSpots - spotsFilled)`. That stops the NEGATIVE count, which was
         * the defect, and leaves an uncapped window reporting "0 of 0" — read
         * by a buyer as sold out, which is the other audit's #250 in the same
         * two fields.
         *
         * capacityOf returns null where there is no cap, so "no limit" and
         * "none left" stop being the same number. The screens guard on
         * `typeof === "number"` and fall through to the funding model — the
         * bound that actually holds — or to "Open".
         *
         * What this test was for still holds and is asserted below: never
         * negative, never NaN.
         */
        expect(result.data.spotsLeft).toBeNull();
        expect(result.data.totalSpots).toBeNull();
    });

    it('AND SO DOES THE LIST, which is the other mapper', async () => {
        // Two mappers, one shape — the pattern that has produced a finding
        // every time only one of a pair was corrected. A mutant that unfloored
        // the LIST survived the first version of this file, which tested the
        // by-id path only.
        const result = await list();

        expect(result.success).toBe(true);
        const [row] = result.data;
        // Same reasoning as the mapper above: null is "no cap", not "none left".
        expect(row.spotsLeft).toBeNull();
        expect(row.totalSpots).toBeNull();
        expect(row.fundingGoal).toBe(1_000_000);
        expect(row.fundedAmount).toBe(250_000);
    });

    it('and the list floors an over-filled window too', async () => {
        windowData.totalSpots = 2;
        windowData.spotsFilled = 5;

        expect((await list()).data[0].spotsLeft).toBe(0);
    });

    it('and it carries the funding model, which IS maintained', async () => {
        const result = await byId();

        expect(result.data.fundingGoal).toBe(1_000_000);
        expect(result.data.fundedAmount).toBe(250_000);
    });

    it('a window that really does declare spots reports them properly', async () => {
        // The other side: the floor must not flatten a real spots model.
        windowData.totalSpots = 10;
        windowData.spotsFilled = 3;

        const result = await byId();

        expect(result.data.totalSpots).toBe(10);
        expect(result.data.spotsLeft).toBe(7);
    });

    it('and an over-filled one floors at 0 rather than going negative', async () => {
        windowData.totalSpots = 2;
        windowData.spotsFilled = 5;

        expect((await byId()).data.spotsLeft).toBe(0);
    });

    it('the legacy field names are read too', async () => {
        // `goal` and `currentFunding` are the older names for the same two
        // figures; both are still written by paths this codebase carries.
        delete windowData.fundingGoal;
        delete windowData.fundedAmount;
        windowData.goal = 800_000;
        windowData.currentFunding = 100_000;

        const result = await byId();

        expect(result.data.fundingGoal).toBe(800_000);
        expect(result.data.fundedAmount).toBe(100_000);
    });

    it('and a non-numeric value reads as 0 or null rather than NaN', async () => {
        // A NaN here reaches a width calculation and a currency format.
        // fundingGoal is a real figure, so garbage reads as 0; spotsLeft is a
        // capacity that this window does not have, so it reads as null. Neither
        // is NaN, which is what this test is for.
        windowData.fundingGoal = 'lots';
        windowData.spotsFilled = undefined;

        const result = await byId();

        expect(result.data.fundingGoal).toBe(0);
        expect(result.data.spotsLeft).toBeNull();
        expect(Number.isNaN(result.data.spotsLeft)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#352 — the page cannot divide by zero', () => {
    const page = source(PAGE);

    it('NO WIDTH IS COMPUTED FROM totalSpots WITHOUT A GUARD', () => {
        // THE test for the render. `-3 / 0 * 100` is `-Infinity%`.
        expect(page).not.toContain('(window.spotsLeft / window.totalSpots) * 100');
        expect(page).toContain('window.totalSpots > 0 ?');
    });

    it('and every width it does compute is clamped to 0-100', () => {
        const widths = [...page.matchAll(/width: `\$\{([^`]+)\}%`/g)].map((m) => m[1]);

        expect(widths.length).toBeGreaterThan(0);          // vacuity guard
        for (const w of widths) {
            expect(w).toContain('Math.min(100, Math.max(0,');
        }
    });

    it('it falls back to the FUNDING model, not to a blank panel', () => {
        expect(page).toMatch(/window\.fundingGoal > 0 \?/);
        expect(page).toContain('window.fundedAmount / window.fundingGoal');
    });

    it('and the "Total Spots" row is omitted rather than printed as 0', () => {
        // The guard gained a `typeof === "number"` because the mapper now
        // returns null for an uncapped window, and `null > 0` is false but does
        // not narrow for TypeScript. Same intent: no row without a model.
        expect(page).not.toContain('windowData.totalSpots.toString()');
        expect(page).toMatch(/typeof windowData\.totalSpots === "number" && windowData\.totalSpots > 0/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#352 — the spots guard is kept, corrected, and honest', () => {
    const code = source(INVEST);

    it('IT NO LONGER SHORT-CIRCUITS ON A MISSING DENOMINATOR', () => {
        expect(code).not.toContain('exportData?.totalSpots && exportData?.spotsFilled >= exportData?.totalSpots');
        expect(code).toContain('if (declaredSpots > 0 && takenSpots >= declaredSpots) {');
    });

    it('and it still refuses, so the branch was kept not dropped', () => {
        expect(code).toContain('error: "Investment slots are full"');
    });

    it('THE BOUND THAT ACTUALLY HOLDS IS STILL THE FUNDING CEILING', () => {
        // The reason this finding is a display defect and not a money hole.
        // Vacuity guard on the whole write-up.
        expect(code).toMatch(/incrementWithinCeiling\(\{[\s\S]{0,220}?field: "fundedAmount"/);
        expect(code).toContain('ceilingField');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#352 — the claim the finding rests on, measured', () => {
    it('NOTHING IN THE REPOSITORY WRITES totalSpots', () => {
        // If someone builds the spots model, this fails and the write-up above
        // has to be revisited — which is the point.
        const hits: string = execSync(
            "grep -rn 'totalSpots' --include='*.ts' --include='*.tsx' --include='*.sql' "
            + "src supabase scripts 2>/dev/null | grep -v __tests__ || true",
            { encoding: 'utf-8' },
        );

        const writes = hits.split('\n').filter((l) => l && /totalSpots\s*[:=]\s*[^=]/.test(l)
            // The type declaration and the two mappers' own output keys are
            // not writes to the DOCUMENT.
            && !/types\/index\.ts/.test(l)
            && !/export-investments\.ts/.test(l));

        expect(writes).toEqual([]);
        expect(hits.length).toBeGreaterThan(100);   // vacuity guard on the grep
    });

    it('while spotsFilled IS written, which is what made it go negative', () => {
        const writers: string = execSync(
            "grep -rln 'spotsFilled: FieldValue.increment' --include='*.ts' src || true",
            { encoding: 'utf-8' },
        );

        expect(writers.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(3);
    });
});
