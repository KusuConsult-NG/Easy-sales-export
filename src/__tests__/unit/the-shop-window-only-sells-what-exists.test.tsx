/**
 * @jest-environment jsdom
 */

/**
 *   #579 THE EXPORT CATALOGUE SOLD FROM A BROCHURE.
 *
 *   /export/buyer keeps eight products in the bundle — cashew nuts, sesame,
 *   hibiscus, cocoa — with prices, grades and minimum tonnages. They are the
 *   page's initial state AND its fallback, and every one of them carried a
 *   working "Add to Cart".
 *
 *   None of them is an offer. Checkout prices each line from the export_catalog
 *   row with a matching id, so when there is no such row the order dies at
 *   "Product not found: cashew-nuts" — after the buyer has chosen a grade, set
 *   a tonnage, filled in their company details and pressed Pay. The banner said
 *   "Pricing shown is indicative", which is true of a quotation and not of a
 *   card payment.
 *
 *   AND AN EMPTY CATALOGUE WAS REPORTED AS AN UNREACHABLE ONE:
 *
 *       if (data.success && data.products?.length) { ...live... }
 *       else setCatalogError("Using cached product list — live catalog unavailable.")
 *
 *   A perfectly good response saying "nothing is listed" was read as "I could
 *   not tell", and the answer to both was the same eight phantom products. This
 *   audit's most repeated shape — "could not tell" and "no" collapsed into one
 *   branch — landing on the shop window.
 *
 *   The brochure stays: it is a real product range and removing it would empty
 *   the page for a buyer who is browsing. What it no longer does is take money.
 *
 *   #581 AND ONE MISSING ARRAY TOOK THE WHOLE CATALOGUE DOWN.
 *
 *   The card renders `useState(product.grades[0])`, `certifications.map(...)`
 *   and `pricePerMT.toLocaleString()` on values that come off a catalogue
 *   document. The public route copied a field only when it was defined, so a
 *   row that had never been given `grades` published without one, and the
 *   dereference threw DURING useState — unmounting the grid, not the card.
 *
 *   The same file already knew: its search filter reads
 *   `...(product.grades || [])`. The author guarded the arrays where they are
 *   filtered and dereferenced them where they are drawn.
 *
 *   #442 examined `product.grades[0]` and recorded it as safe "because grades
 *   comes from a hardcoded array literal in that file, not from a document".
 *   That was untrue when it was written — the fetch predates it, and the
 *   literal is only the fallback. The verdict is corrected in that suite rather
 *   than deleted.
 *
 *   #578 AND THE LEDGER COULD NOT SEE THIS SCREEN AT ALL.
 *
 *   #545's scan required `await fetch(`; this page uses a `.then()` chain, so
 *   the one screen that rendered a full-screen spinner and NOTHING else until
 *   its own API answered was invisible to the instrument that counts exactly
 *   that. Same fault as #568 in a different spelling. Widened, measured, and
 *   the page converted to a server seed in the same change.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   Nothing here removes a product, a price or a listing. The brochure is
 *   unchanged and still rendered; a row missing a field is published with the
 *   EMPTY version of it rather than an invented default — no default grade, no
 *   default certification, and a price of 0, which the card shows as "Price on
 *   request" and checkout has always refused as "not priced for sale".
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the seed ignored, always fetching                     KILLED (6 tests)
 *     the card's own array guard removed                    KILLED (2)
 *     the empty catalogue folded back into "unavailable"    KILLED (1)
 *     the brochure orderable again                          KILLED (1)
 *     an unpriced row orderable                             KILLED (1)
 *     the reader's grades normalisation removed             KILLED (1)
 *     an empty seed treated as a failed one                 KILLED (1)
 *     the ledger predicate back to `await fetch(`           KILLED (1)
 *     reword the finding comment                            SURVIVED, as intended
 *
 * ── THREE MUTANTS SURVIVED THE FIRST RUN AND ALL THREE WERE REAL GAPS ───────
 *
 *   None was equivalent, and each was a different way of testing the fix
 *   rather than the defect:
 *
 *     THE EMPTY BRANCH I NEVER REACHED. Every empty-catalogue case arrived as
 *     a SEED, so folding the FETCH path's "empty" back into "unavailable"
 *     changed nothing — and the fetch path is the one the defect was written
 *     in. Covered now, over the wire.
 *
 *     THE SERVER PAGE NOBODY CALLED. Coercing `[]` to null in page.tsx broke
 *     no test, because everything here rendered the client directly. The page
 *     is exercised now, through the real reader.
 *
 *     AND A WIDENING THAT COULD NOT FAIL. Reverting the ledger's scan to
 *     `await fetch(` changed no count, because the page that exposed the blind
 *     spot was converted in the same change. That is a check that cannot fail
 *     — this audit's most common defect — living inside the instrument that
 *     counts the others. The predicate is exercised directly now, on samples
 *     of each spelling.
 */

import React from 'react';
import { render, act, waitFor } from '@testing-library/react';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/export/buyer',
}));
jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: null, status: 'unauthenticated' }),
    signOut: jest.fn(),
}));

/** A live catalogue row, as the public reader hands one over. */
function row(overrides: Record<string, any> = {}) {
    return {
        id: 'live-cocoa',
        name: 'Live Cocoa',
        icon: '🫘',
        origin: 'Ondo',
        season: 'Sep - Feb',
        category: 'nuts',
        grades: ['Grade A'],
        certifications: ['NAFDAC'],
        pricePerMT: 3_000,
        minOrderMT: 10,
        ...overrides,
    };
}

async function renderCatalogue(initial: any[] | null) {
    const { ExportCartProvider } = await import('@/contexts/ExportCartContext');
    const { default: ExportBuyerClient } = await import('@/app/export/buyer/ExportBuyerClient');

    const utils = render(
        <ExportCartProvider>
            <ExportBuyerClient initial={initial} />
        </ExportCartProvider>
    );
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    return utils;
}

const addToCartButtons = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('button')).filter(b => /add to cart|update cart/i.test(b.textContent || ''));

/** Open every card's details panel, which is where ordering lives. */
async function openEveryCard(container: HTMLElement) {
    const togglers = Array.from(container.querySelectorAll('button'))
        .filter(b => /select grade & quantity/i.test(b.textContent || ''));
    for (const t of togglers) await act(async () => { t.click(); });
    return togglers.length;
}

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    global.fetch = jest.fn(async () => ({
        json: async () => ({ success: true, products: [row()] }),
    })) as any;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#579 — the brochure is a brochure', () => {
    it('AN EMPTY CATALOGUE SAYS SO, AND SELLS NOTHING', async () => {
        //   THE test. A successful "nothing is listed" was reported as the live
        //   catalogue being unavailable, and answered with eight products that
        //   could not be bought.
        const { container } = await renderCatalogue([]);

        expect(container.textContent).toMatch(/nothing is listed for online ordering/i);
        expect(container.textContent).not.toMatch(/could not load the live catalogue/i);

        //   The range is still on the page — this is not a takedown.
        expect(container.textContent).toContain('Cashew Nuts');
        //   And not one card offers to sell it.
        expect(await openEveryCard(container)).toBe(0);
        expect(addToCartButtons(container)).toEqual([]);
        expect(container.textContent).toMatch(/not available to order online right now/i);
    });

    it('AND AN UNREADABLE ONE SAYS SOMETHING ELSE', async () => {
        //   Two different facts about the world, two messages. Folding them
        //   back together is the defect.
        (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));

        const { container } = await renderCatalogue(null);

        await waitFor(() => expect(container.textContent).toMatch(/could not load the live catalogue/i));
        expect(container.textContent).not.toMatch(/nothing is listed/i);
        expect(addToCartButtons(container)).toEqual([]);
    });

    it('AND AN EMPTY ANSWER OVER THE WIRE SAYS THE SAME AS AN EMPTY SEED', async () => {
        /**
         *   THE GAP A SURVIVING MUTANT FOUND.
         *
         *   Folding the fetch path's "empty" branch back into "unavailable"
         *   changed no test, because every empty-catalogue case above arrives
         *   as a SEED and never touches this branch — and the fetch path is
         *   the one that existed when the defect was written.
         */
        (global.fetch as jest.Mock).mockResolvedValue({
            json: async () => ({ success: true, products: [] }),
        });

        const { container } = await renderCatalogue(null);

        await waitFor(() => expect(container.textContent).toMatch(/nothing is listed for online ordering/i));
        expect(container.textContent).not.toMatch(/could not load the live catalogue/i);
        expect(addToCartButtons(container)).toEqual([]);
    });

    it('AND A REFUSAL IS NOT AN EMPTY CATALOGUE EITHER', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            json: async () => ({ success: false, error: 'Failed to fetch export catalog' }),
        });

        const { container } = await renderCatalogue(null);

        await waitFor(() => expect(container.textContent).toMatch(/could not load the live catalogue/i));
    });

    it('AND A LIVE CATALOGUE SELLS, WITH NO WARNING ON IT', async () => {
        //   VACUITY GUARD. Every claim above is satisfied by a page that never
        //   sells anything, which would take the export shopfront offline.
        const { container } = await renderCatalogue([row()]);

        expect(container.textContent).toContain('Live Cocoa');
        expect(container.textContent).not.toMatch(/nothing is listed|could not load/i);

        expect(await openEveryCard(container)).toBe(1);
        expect(addToCartButtons(container)).toHaveLength(1);
    });

    it('AND A ROW WITH NO PRICE IS NOT SOLD EITHER', async () => {
        //   Checkout has always refused an unpriced row as "not priced for
        //   sale". Offering it is the same lie one level up.
        const { container } = await renderCatalogue([row({ pricePerMT: 0 })]);

        expect(container.textContent).toContain('Price on request');
        expect(await openEveryCard(container)).toBe(0);
        expect(addToCartButtons(container)).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#581 — a row missing an array does not take the page down', () => {
    it('A LISTING WITH NO GRADES AND NO CERTIFICATIONS STILL RENDERS', async () => {
        //   THE defect: `useState(product.grades[0])` threw during render, so
        //   React unmounted the whole grid rather than one card.
        const { container } = await renderCatalogue([
            { id: 'bare', name: 'Bare Listing', origin: 'Kano', season: 'Year-round', category: 'other', pricePerMT: 1_000 } as any,
        ]);

        expect(container.textContent).toContain('Bare Listing');
        //   Still orderable — it has a price. It just names no grades.
        expect(await openEveryCard(container)).toBe(1);
        expect(addToCartButtons(container)).toHaveLength(1);
        expect(container.textContent).not.toMatch(/select grade/i);
    });

    it('AND THE OTHER CARDS SURVIVE IT', async () => {
        //   The claim that matters: one bad row used to cost every good one.
        const { container } = await renderCatalogue([
            { id: 'bare', name: 'Bare Listing', pricePerMT: 1_000 } as any,
            row(),
        ]);

        expect(container.textContent).toContain('Live Cocoa');
        expect(container.textContent).toContain('Bare Listing');
    });

    it('AND THE READER GIVES THE CARD THE SHAPE IT PROMISES', async () => {
        //   The boundary, not just the card. A stored document with no arrays
        //   and a price it cannot use comes out as the EMPTY version of each —
        //   never an invented default.
        //   No jest.resetModules() here: it re-instantiates React for every
        //   later test in the file, and the three #578 cases below then failed
        //   with "Cannot read properties of null (reading 'useState')" —
        //   a harness fault reading exactly like a defect in the seed.
        const stored = { name: 'Half A Row', pricePerMT: 'not a number', grades: 'W320', certifications: null };
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            empty: false,
            docs: [{ id: 'half', data: () => stored }],
        }));

        const { readPublicExportCatalog } = await import('@/lib/export-catalog-reader');
        const [product] = await readPublicExportCatalog();

        expect(product).toEqual({
            id: 'half',
            name: 'Half A Row',
            icon: '📦',
            origin: '',
            season: '',
            category: 'other',
            grades: [],
            certifications: [],
            pricePerMT: 0,
            minOrderMT: 0,
        });
        //   And nothing the seller stored beyond the allow-list came with it.
        expect(Object.keys(product)).toHaveLength(10);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#578 — the catalogue arrives with the page', () => {
    it('A SEEDED CATALOGUE ASKS THE SERVER NOTHING', async () => {
        //   The waterfall: the HTML, then the bundle, then a round trip for a
        //   list the server that rendered the page already had — behind a
        //   full-screen spinner the whole time.
        const { container } = await renderCatalogue([row()]);

        expect(global.fetch).not.toHaveBeenCalled();
        //   And the first paint is the catalogue, not a spinner.
        expect(container.querySelector('.animate-spin')).toBeNull();
        expect(container.textContent).toContain('Live Cocoa');
    });

    it('AND AN EMPTY SEED IS AN ANSWER, NOT A MISSING ONE', async () => {
        //   `[]` and `null` mean different things. Coercing the first to the
        //   second would send the screen off to re-ask a question that had
        //   already been answered.
        await renderCatalogue([]);

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('THE SERVER PAGE HANDS DOWN WHAT IT READ, EMPTY INCLUDED', async () => {
        /**
         *   THE SECOND GAP A SURVIVING MUTANT FOUND. Coercing `[]` to null in
         *   page.tsx broke nothing, because everything above renders the CLIENT
         *   directly and no test had ever called the page.
         *
         *   The distinction is the whole of #579 on the server side: an empty
         *   catalogue is an answer, and a failed read is not.
         */
        //   Driven through the real reader and the global database mock, not a
        //   spy: jest.spyOn cannot redefine an export on a module namespace,
        //   and going through the reader exercises the path the page uses.
        const { default: ExportBuyerPage } = await import('@/app/export/buyer/page');
        const get = (global as any).mockFirestoreGet;

        get.mockImplementation(() => Promise.resolve({ empty: true, docs: [] }));
        expect((await ExportBuyerPage() as any).props.initial).toEqual([]);

        get.mockImplementation(() => Promise.resolve({
            empty: false,
            docs: [{ id: 'live-cocoa', data: () => row() }],
        }));
        expect((await ExportBuyerPage() as any).props.initial).toEqual([row()]);

        //   And only a real failure seeds null.
        get.mockImplementation(() => Promise.reject(new Error('no database')));
        expect((await ExportBuyerPage() as any).props.initial).toBeNull();
    });

    it('AND A FAILED SEED STILL FETCHES, EXACTLY AS BEFORE', async () => {
        //   The seed is an optimisation. It is never a new way for the screen
        //   to be empty.
        const { container } = await renderCatalogue(null);

        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/export/catalog'));
        await waitFor(() => expect(container.textContent).toContain('Live Cocoa'));
    });
});
