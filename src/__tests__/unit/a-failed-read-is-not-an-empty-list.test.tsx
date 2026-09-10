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
 *
 * ── #592: 30 → 23, AND THE INSTRUMENT WAS OVER-COUNTING BY ONE ──────────────
 *
 *   Six more screens learned the difference — the wallet's transaction history,
 *   the disputes list, the escrow chat, WAVE shipments, both certificate lists
 *   and the exporter's own products. Their finding, their behaviour tests and
 *   their mutation table are in six-more-screens-learned-a-failed-read.
 *
 *   AND ONE OF THE THIRTY WAS NEVER AN OFFENDER. MessagesClient distinguishes
 *   with a `listError` and has for some time; the predicate below missed it
 *   because it accepted one spelling of an error state. That is this audit's own
 *   rule turned on itself — AUDIT THE INSTRUMENT BEFORE BELIEVING THE
 *   MEASUREMENT — and the correction is deliberately narrow: see
 *   `emptyStateConsultsError`, and the measurement that rejected the wider fix.
 *
 * ── #594: 23 → 17, AND THE COUNTS WERE THE LOUDER HALF ──────────────────────
 *
 *   Six more: fixed savings, cooperative history, notifications, reviews, and
 *   both marketplace dashboards. Their finding and mutation table are in
 *   the-numbers-on-a-dashboard-were-zero-because-nobody-asked.
 *
 *   THE PREDICATE ONLY SEES LISTS, AND TWO OF THESE SCREENS LIED IN NUMBERS.
 *   A dashboard's `stats` initialised to all zeroes is the same defect as a
 *   list initialised to `[]` — "we could not read this" rendered as an answer —
 *   but it has no `.length === 0` for the scan to find. Every screen this
 *   ratchet counts is a real offender; it is not the whole class, and this note
 *   is here so that is not mistaken for one.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
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
 * 35 when this was written. 30 after the five in the first batch. 23 after
 * #592's six, and after this predicate stopped over-counting MessagesClient —
 * see the note on `emptyStateConsultsError` below. 17 after #594's six.
 */
const CAP = 17;

/**
 * An empty-state condition that consults an error is a distinction.
 *
 *   #592 AND THE INSTRUMENT WAS OVER-COUNTING, BY ONE, IN THE DIRECTION THAT
 *   FLATTERS IT. MessagesClient keeps a `listError`, shows "This list may be out
 *   of date" over a list it could not refresh, and draws its empty state as
 *
 *       conversations.length === 0 && !listError ? "No conversations yet" : …
 *
 *   which is precisely the reading this ratchet exists to ask for. It counted as
 *   an offender anyway, because the check below accepted the literal spelling
 *   `setError(` and the bare identifier `error` and nothing else.
 *
 *   THE OBVIOUS WIDENING WAS TRIED FIRST AND REJECTED, and the measurement is
 *   the reason. Accepting any `set*Error(` or any `*Error &&` also excuses
 *   ProfileClient's `setPasswordError` and FinancialStep's `setBvnError` — form
 *   errors that say nothing about whether a list was read. Measured across
 *   src/app, that swap trades one false positive for nineteen false negatives.
 *
 *   So the clause is about USE and not spelling: the condition that decides
 *   whether to draw the empty state must itself mention an error.
 */
function emptyStateConsultsError(src: string): boolean {
    const conditions = src.match(/[A-Za-z0-9_.[\]]+\.length\s*(?:===\s*0|>\s*0)?[^?\n]{0,70}\?/g) ?? [];
    return conditions.some(c => /error/i.test(c));
}

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
    return !distinguishes.test(src) && !emptyStateConsultsError(src);
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

/**
 * Every screen taught so far, named so the claim is checkable.
 *
 * The first five behave-tested at the foot of this file; #592's six in
 * six-more-screens-learned-a-failed-read, which holds their finding and their
 * mutation table. Both halves matter: this list proves they left the COUNT, and
 * the render tests prove they actually changed what a person sees.
 */
const FIXED = [
    //   #588's five.
    'src/app/marketplace/seller/products/SellerProductsClient.tsx',
    'src/app/marketplace/seller/orders/SellerOrdersClient.tsx',
    'src/app/marketplace/buyer/orders/BuyerOrdersClient.tsx',
    'src/app/cooperatives/(member)/my-savings/MySavingsClient.tsx',
    'src/app/export/(app)/portfolio/ExportPortfolioClient.tsx',
    //   #592's six.
    'src/app/dashboard/wallet/WalletClient.tsx',
    'src/app/dashboard/disputes/DisputesClient.tsx',
    'src/app/escrow/[id]/chat/EscrowChatClient.tsx',
    'src/app/wave/(member)/shipments/WaveShipmentsClient.tsx',
    'src/app/dashboard/certificates/CertificatesClient.tsx',
    'src/app/export/(app)/products/MyExportProductsClient.tsx',
    //   #592 also found this one had distinguished all along, and the predicate
    //   was mis-reading it. It is here so a regression that removes `listError`
    //   fails a test rather than quietly raising the cap.
    'src/app/messages/MessagesClient.tsx',
    //   #594's six. Two of them are dashboards, where the STAT CARDS were the
    //   louder half of the lie: a failed read left them at the zeroes they were
    //   initialised with, so a live business rendered as a dead one.
    'src/app/cooperatives/(member)/fixed-savings/FixedSavingsClient.tsx',
    'src/app/cooperatives/(member)/history/CooperativeHistoryClient.tsx',
    'src/app/dashboard/notifications/NotificationsClient.tsx',
    'src/app/dashboard/reviews/MyReviewsClient.tsx',
    'src/app/marketplace/buyer/dashboard/BuyerDashboardClient.tsx',
    'src/app/marketplace/seller/dashboard/SellerDashboardClient.tsx',
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

    it('AND EVERY SCREEN ALREADY TAUGHT IS OUT OF THE COUNT', () => {
        /**
         *   THE LIST IS CHECKED BEFORE IT IS USED. A loop over an emptied — or
         *   mistyped — FIXED array passes without asserting anything, which is
         *   this audit's own "a check that cannot fail" wearing the ledger's
         *   clothes. So: every path must exist on disk, and there must be as
         *   many as have been claimed.
         */
        expect(FIXED).toHaveLength(18);
        for (const f of FIXED) {
            expect({ f, exists: existsSync(join(ROOT, f)) }).toEqual({ f, exists: true });
        }

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

    it('AND SO IS AN EMPTY STATE THAT CONSULTS AN ERROR BY ANY NAME', () => {
        //   #592: MessagesClient's own spelling, which this predicate used to
        //   read as an offender.
        expect(cannotTellEmptyFromFailed(`"use client";
            useEffect(() => { getThingsAction().catch(e => setListError("no")); }, []);
            return things.length === 0 && !listError ? <p>No things yet</p> : <List/>;`
        )).toBe(false);
    });

    it('AND A FORM ERROR IS NOT — WHICH IS WHY IT IS THE CONDITION AND NOT THE SPELLING', () => {
        /**
         *   The widening that was rejected. `setPasswordError` and `setBvnError`
         *   say nothing about whether a LIST was read, and accepting any
         *   `set*Error(` would have excused ProfileClient and FinancialStep —
         *   nineteen screens in all, measured across src/app.
         */
        expect(cannotTellEmptyFromFailed(
            READS_A_LIST + '\nconst [passwordError, setPasswordError] = useState("");'
                         + '\n{passwordError && <p>{passwordError}</p>}'
        )).toBe(true);
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
