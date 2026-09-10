/**
 * @jest-environment jsdom
 */

/**
 *   #588 THIRTY-SIX SCREENS TOLD PEOPLE THEIR THINGS WERE GONE — MEASURED,
 *        CAPPED, AND ONLY ALLOWED TO GO DOWN.
 *
 *   SellerProductsClient is the plainest example, and the shape is the same
 *   everywhere:
 *
 *       if (result.success && result.data?.products) {
 *           setProducts(...);
 *       } else if (result.error) {
 *           logger.error("Failed to load products:", { error: result.error });
 *       }
 *       } catch (error) {
 *           logger.error("Failed to load products:", { error });
 *       } finally {
 *           setLoading(false);
 *       }
 *
 *   A refusal or a thrown error writes a line to a log nobody reads, the
 *   spinner stops, and the list state is still the `[]` it was initialised
 *   with — so the screen renders its EMPTY STATE. A seller with forty live
 *   listings is told "No products found. Add your first product". A member
 *   whose savings could not be read is told "No Savings Plans Yet — start
 *   saving today". An investor is told "No investments found".
 *
 *   THE COOPERATIVE SAVINGS SCREEN WROTE THE FAILURE IN, rather than merely
 *   failing to record it: `catch { setSavings([]) }` and `else { setSavings([]) }`.
 *
 *   This is #579's finding — "could not tell" and "nothing" collapsed into one
 *   branch — which this audit has now hit on the export catalogue, the export
 *   orders screen and here. It is the codebase's single most repeated defect,
 *   so it gets an instrument rather than another one-screen fix.
 *
 * ── WHAT THE NUMBER MEANS, EXACTLY ──────────────────────────────────────────
 *
 *   A client component that (a) reads a list through an action or a fetch,
 *   (b) has a `catch`, and (c) renders an empty state — and does NOT
 *   distinguish a failed read from an empty one.
 *
 *   "Distinguishes" means: it uses ListLoadFailed, or it carries its own
 *   named state for the difference. Both are accepted, because #579's export
 *   catalogue built a three-way state machine of its own that is better than
 *   the shared panel would be there, and a ratchet that only accepts one
 *   spelling is a ratchet people work around.
 *
 *   It is deliberately a SHAPE and not a judgement. A screen whose empty state
 *   is harmless still counts, because a check that tried to tell those apart
 *   would be guessing — and #545 records what a guessing ratchet costs.
 *
 * ── AND THE SCAN IS EXERCISED, NOT JUST RUN ─────────────────────────────────
 *
 *   #578's lesson, which was itself #568's: both times this codebase's ledgers
 *   went blind, the widening was UNFALSIFIABLE the day it was made. So the
 *   predicate is a named function with its own tests below, on samples of each
 *   spelling, and the five screens fixed in this batch are also asserted to
 *   BEHAVE — rendered with a failing read, and checked not to claim emptiness.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     ListLoadFailed no longer counted as a distinction KILLED (3 tests)
 *     the cap raised to 100                             KILLED
 *     the cap lowered to 25                             KILLED
 *     the scan pointed at a directory with no screens   KILLED
 *     any one of the five reverted to the empty state   KILLED (one each)
 *     the failure written into the list again           KILLED
 *     the failure never recorded in the catch           KILLED
 *     reword this header                                SURVIVED, as intended
 *
 * ── SIX MUTANTS SURVIVED THE FIRST RUN, AND THEY WERE ONE FAULT ─────────────
 *
 *   THE RATCHET WAS CHECKING FOR THE WORD, NOT THE BEHAVIOUR. Reverting four
 *   of the five fixed screens to their empty state changed nothing, because
 *   `loadFailed` was still declared in each file and the scan reads text; and
 *   only one screen was rendered by a test. So the scan and the suite together
 *   proved that five files CONTAINED a fix, not that any of them applied it.
 *
 *   That is this audit's most common defect wearing the instrument's clothes,
 *   and it is the second time in two sessions — #578's widening could not fail
 *   either. All five are rendered with a failing read now, and each mutant
 *   dies on its own screen.
 *
 *   AND THE CAP COULD BE RAISED WITHOUT A SINGLE TEST FAILING, because
 *   `toBeLessThanOrEqual` passes for any larger number. It is exact equality
 *   now: the number in this file is the truth, in both directions.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * MOCKED AT THE TOP, WITH MUTABLE IMPLEMENTATIONS — NOT jest.doMock.
 *
 * doMock needs jest.resetModules() to take effect, and that re-instantiates
 * React for anything imported afterwards, so the component renders against a
 * different React than the one this file holds: "Cannot read properties of null
 * (reading 'useState')". That is the THIRD time this session — #579's suite and
 * #587's both lost tests to it — so it is written down here rather than
 * rediscovered a fourth time.
 */
const getSellerProductsAction = jest.fn() as jest.Mock<any>;
const getSellerOrdersAction = jest.fn() as jest.Mock<any>;
const getBuyerOrdersAction = jest.fn() as jest.Mock<any>;
const getMembershipAction = jest.fn() as jest.Mock<any>;
const getUserExportInvestmentsAction = jest.fn() as jest.Mock<any>;
const getUserExportStatsAction = jest.fn() as jest.Mock<any>;

jest.mock('@/app/actions/marketplace', () => ({
    getSellerProductsAction: (...a: any[]) => getSellerProductsAction(...a),
    getSellerOrdersAction: (...a: any[]) => getSellerOrdersAction(...a),
    getBuyerOrdersAction: (...a: any[]) => getBuyerOrdersAction(...a),
    deleteProductAction: jest.fn(async () => ({ success: true, error: null, data: null })),
    confirmOrderReceiptAction: jest.fn(),
    cancelOrderAction: jest.fn(),
}));
jest.mock('@/app/actions/cooperative', () => ({
    getMembershipAction: (...a: any[]) => getMembershipAction(...a),
    getTransactionsAction: jest.fn(async () => ({ success: true, error: null, data: [] })),
}));
jest.mock('@/app/actions/export', () => ({
    getUserExportInvestmentsAction: (...a: any[]) => getUserExportInvestmentsAction(...a),
    getUserExportStatsAction: (...a: any[]) => getUserExportStatsAction(...a),
}));
jest.mock('@/contexts/ToastContext', () => ({
    useToast: () => ({ showToast: jest.fn() }),
}));
jest.mock('sonner', () => ({
    toast: { error: jest.fn(), success: jest.fn() },
}));
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/',
}));

const ROOT = process.cwd();

/**
 * The high-water mark. Lower it when a screen learns the difference; never
 * raise it.
 *
 * 35 when this was written. 30 after the five in this batch.
 */
const CAP = 30;

/**
 * Does this source read a list and render an empty state without being able to
 * say the read failed?
 *
 * Exercised directly below, so that widening or narrowing it cannot be a
 * silent no-op.
 */
export function cannotTellEmptyFromFailed(src: string): boolean {
    if (!src.includes('"use client"')) return false;
    //   It reads something, and it has somewhere for a failure to land.
    if (!/catch\s*[({]/.test(src)) return false;
    if (!/(Action\s*\(|fetch\()/.test(src)) return false;
    //   It draws an empty state.
    if (!/\.length\s*===\s*0|\.length\s*\?|\.length\s*>\s*0\s*\?/.test(src)) return false;
    //   And it cannot say "I could not read this".
    const distinguishes = /ListLoadFailed|loadFailed|readFailed|catalogState|loadError|setError\(|\berror\s*&&/;
    return !distinguishes.test(src);
}

function screensThatCannotTell(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                //   Admin screens are a separate pass — a handful of staff, not
                //   every member. Same exclusion as #545.
                if (entry !== 'admin') walk(full);
            } else if (entry.endsWith('.tsx')) {
                if (cannotTellEmptyFromFailed(readFileSync(full, 'utf-8'))) {
                    found.push(full.slice(ROOT.length + 1));
                }
            }
        }
    };
    walk(join(ROOT, 'src/app'));
    return found.sort();
}

/** The five this batch taught, named so the claim is checkable. */
const FIXED = [
    'src/app/marketplace/seller/products/SellerProductsClient.tsx',
    'src/app/marketplace/seller/orders/SellerOrdersClient.tsx',
    'src/app/marketplace/buyer/orders/BuyerOrdersClient.tsx',
    'src/app/cooperatives/(member)/my-savings/MySavingsClient.tsx',
    'src/app/export/(app)/portfolio/ExportPortfolioClient.tsx',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#588 — the screens that cannot tell are counted', () => {
    it('THE COUNT IS EXACTLY THE RECORDED NUMBER', () => {
        /**
         *   EXACT, NOT `<=`, AND A SURVIVING MUTANT IS WHY.
         *
         *   With `expect(count).toBeLessThanOrEqual(CAP)` the cap can be raised
         *   to any number without a single test failing — the ratchet's own
         *   loophole, and precisely the "check that cannot fail" this audit
         *   keeps finding. Exact equality means the number in this file is
         *   always the truth: a regression fails it, and so does a fix, which
         *   is a one-character edit by whoever earned it.
         */
        const screens = screensThatCannotTell();

        //   Reported by name on failure, so a change says WHICH screens.
        expect({ count: screens.length, cap: CAP, screens })
            .toEqual({ count: CAP, cap: CAP, screens });
    });

    it('AND THE SCAN ACTUALLY FINDS SCREENS — the guard on the measurement', () => {
        //   #484's shape: a scan pointed at the wrong directory reports zero
        //   offenders for the same reason it reports nothing at all.
        const screens = screensThatCannotTell();

        expect(screens.length).toBeGreaterThan(10);
        expect(screens.every(s => s.startsWith('src/app/'))).toBe(true);
        expect(screens.every(s => !s.includes('/admin/'))).toBe(true);
    });

    it('AND EVERY SCREEN THIS BATCH FIXED IS OUT OF THE COUNT', () => {
        const screens = new Set(screensThatCannotTell());

        for (const f of FIXED) {
            expect({ f, stillCannotTell: screens.has(f) }).toEqual({ f, stillCannotTell: false });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#588 — the predicate itself', () => {
    const READS_A_LIST = `"use client";
        useEffect(() => { getThingsAction().then(r => setThings(r.data)).catch(e => log(e)); }, []);
        return things.length === 0 ? <p>No things yet</p> : <List/>;`;

    it('POSITIVE CONTROL: A SCREEN THAT LOGS AND SHOWS THE EMPTY STATE COUNTS', () => {
        expect(cannotTellEmptyFromFailed(READS_A_LIST)).toBe(true);
    });

    it('AND THE SHARED PANEL IS A DISTINCTION', () => {
        expect(cannotTellEmptyFromFailed(
            READS_A_LIST + '\n<ListLoadFailed what="your things" />'
        )).toBe(false);
    });

    it('AND SO IS A SCREEN\'S OWN NAMED STATE', () => {
        //   #579's export catalogue built a three-way machine of its own, which
        //   is better there than the shared panel would be. A ratchet that
        //   accepted one spelling only is one people work around.
        expect(cannotTellEmptyFromFailed(
            READS_A_LIST + '\nconst [catalogState, setCatalogState] = useState("live");'
        )).toBe(false);
    });

    it('NEGATIVE CONTROL: AND A SCREEN THAT READS NOTHING DOES NOT COUNT', () => {
        //   Without these the predicate is satisfied by returning true.
        expect(cannotTellEmptyFromFailed(
            '"use client";\nreturn items.length === 0 ? <p>none</p> : <List/>;'
        )).toBe(false);
        //   A server component, whatever it contains.
        expect(cannotTellEmptyFromFailed(
            'export default async function Page() { try { await read(); } catch {} }'
        )).toBe(false);
        //   A client screen with no empty state to get wrong.
        expect(cannotTellEmptyFromFailed(
            '"use client";\nuseEffect(() => { fetch("/api/x").catch(e => {}); }, []);'
        )).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#588 — and the fixed screens behave', () => {
    /**
     * Rendered with a read that FAILS, and checked not to claim emptiness.
     * A static scan alone would be satisfied by a screen that merely mentions
     * the word.
     */
    beforeEach(() => {
        jest.clearAllMocks();
    });

    async function sellerProducts() {
        const { default: SellerProductsClient } =
            await import('@/app/marketplace/seller/products/SellerProductsClient');
        return render(<SellerProductsClient initial={null} />);
    }

    it('A SELLER WITH A FAILED READ IS NOT TOLD TO ADD THEIR FIRST PRODUCT', async () => {
        getSellerProductsAction.mockResolvedValue({
            success: false, error: 'Database unavailable', data: null,
        });

        const { container } = await sellerProducts();

        await waitFor(() => expect(container.textContent).toMatch(/could not load your products/i));
        expect(container.textContent).not.toMatch(/add your first product/i);
        expect(container.textContent).toMatch(/nothing is lost/i);
    });

    it('AND A THROWN READ IS THE SAME', async () => {
        //   The other half: a refusal and an exception are one outcome to the
        //   person looking at the screen.
        getSellerProductsAction.mockRejectedValue(new Error('network down'));

        const { container } = await sellerProducts();

        await waitFor(() => expect(container.textContent).toMatch(/could not load your products/i));
        expect(container.textContent).not.toMatch(/add your first product/i);
    });

    it('AND A SUCCESSFUL EMPTY READ STILL SAYS THE LIST IS EMPTY', async () => {
        //   THE vacuity guard. A screen that showed the failure panel whenever
        //   a list was empty would be the same defect wearing the fix's clothes.
        getSellerProductsAction.mockResolvedValue({
            success: true, error: null, data: { products: [], lastId: undefined, hasMore: false },
        });

        const { container } = await sellerProducts();

        await waitFor(() => expect(container.textContent).toMatch(/add your first product/i));
        expect(container.textContent).not.toMatch(/could not load/i);
    });

    it('A SELLER ORDERS READ THAT FAILS DOES NOT SAY "No orders found"', async () => {
        getSellerOrdersAction.mockResolvedValue({ success: false, error: 'unavailable', data: null });

        const { default: SellerOrdersClient } =
            await import('@/app/marketplace/seller/orders/SellerOrdersClient');
        const { container } = render(<SellerOrdersClient initial={null} />);

        await waitFor(() => expect(container.textContent).toMatch(/could not load your orders/i));
        expect(container.textContent).not.toMatch(/no orders found/i);
    });

    it('AND A BUYER IS NOT INVITED TO BUY WHAT THEY MAY ALREADY OWN', async () => {
        getBuyerOrdersAction.mockResolvedValue({ success: false, error: 'unavailable', data: null });

        const { default: BuyerOrdersClient } =
            await import('@/app/marketplace/buyer/orders/BuyerOrdersClient');
        const { container } = render(<BuyerOrdersClient initial={null} />);

        await waitFor(() => expect(container.textContent).toMatch(/could not load your orders/i));
        expect(container.textContent).not.toMatch(/no orders found|browse marketplace/i);
    });

    it('AND A MEMBER IS NOT TOLD TO START SAVING OVER MONEY THEY HAVE SAVED', async () => {
        //   This screen wrote the failure INTO the list — setSavings([]) in the
        //   catch and in the else — which is the loudest version of the defect.
        getMembershipAction.mockResolvedValue({ success: true, data: { membership: { id: 'm1' } } });
        (global as any).fetch = jest.fn(async () => ({ ok: false, json: async () => ({ success: false }) }));

        const { default: MySavingsClient } =
            await import('@/app/cooperatives/(member)/my-savings/MySavingsClient');
        const { container } = render(<MySavingsClient initial={null} />);

        await waitFor(() => expect(container.textContent).toMatch(/could not load your savings plans/i));
        expect(container.textContent).not.toMatch(/no savings plans yet|start saving today/i);
    });

    it('AND AN INVESTOR IS NOT TOLD THEY HAVE NO INVESTMENTS', async () => {
        //   A toast is not a state: it goes after a few seconds and leaves
        //   "No investments found" over money in escrow.
        getUserExportInvestmentsAction.mockResolvedValue({ success: false, error: 'unavailable', data: null });
        //   The four fields the action always returns — it coerces each with
        //   `|| 0`, so a partial shape is not reachable through it. A `{}` here
        //   blanks the screen on `stats.totalValue.toLocaleString()`, which is
        //   a fixture that tests the harness rather than the finding.
        getUserExportStatsAction.mockResolvedValue({
            success: true, error: null,
            data: { totalInvested: 0, activeInvestments: 0, totalReturns: 0, pendingReturns: 0 },
        });

        const { default: ExportPortfolioClient } =
            await import('@/app/export/(app)/portfolio/ExportPortfolioClient');
        const { container } = render(<ExportPortfolioClient initial={null} />);

        await waitFor(() => expect(container.textContent).toMatch(/could not load your investments/i));
        expect(container.textContent).not.toMatch(/no investments found/i);
    });

    it('AND A SUCCESSFUL READ WITH ROWS SHOWS THE ROWS', async () => {
        getSellerProductsAction.mockResolvedValue({
            success: true, error: null,
            data: {
                products: [{
                    id: 'p1', title: 'Ofada Rice', status: 'active', availableQuantity: 120,
                    unit: 'kg', pricingTiers: [{ type: 'retail', price: 1500 }],
                }],
                lastId: undefined, hasMore: false,
            },
        });

        const { container } = await sellerProducts();

        await waitFor(() => expect(container.textContent).toContain('Ofada Rice'));
        expect(container.textContent).not.toMatch(/could not load|add your first product/i);
    });
});
