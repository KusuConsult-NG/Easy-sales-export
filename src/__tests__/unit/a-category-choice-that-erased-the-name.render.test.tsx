/**
 * @jest-environment jsdom
 */

/**
 *   THE OWNER: "when users enter a product name and select category in
 *   marketplace, it will clear the name the user entered."
 *
 *   Both product forms ask for the title FIRST and the category two fields
 *   below it, so the order that lost the work is the order the form itself
 *   sets out. Both handlers were the same three lines:
 *
 *       setCategory(e.target.value);
 *       setTitle("");
 *       setCustomTitle("");
 *
 *   Unconditional, whatever had been typed.
 *
 * ── WHAT THE RESET WAS GUARDING, AND WHY IT IS NOT NOTHING ──────────────────
 *
 *   /marketplace/sell/create offers a MENU of preset titles for a category
 *   that has them ("White Maize", "Yam", "Catfish"). A title picked from the
 *   old category's menu is not on the new category's menu, and leaving it
 *   selected submits a name the new category does not offer. That is real.
 *
 *   But a product's name is the seller's words, not a property of the
 *   category, so the name MOVES instead of dying: into the free-text box,
 *   which is the field carrying name="title" whenever the menu has nothing
 *   matching. Nothing the seller typed disappears, in either direction —
 *   menu category to free-text category, or the reverse.
 *
 * ── AND THE EDIT SCREEN WAS WORSE THAN THE REPORT ───────────────────────────
 *
 *   /marketplace/seller/products/[id]/edit renders a PLAIN TEXT BOX for the
 *   title — it has never had the menu. It still read the menu table, for one
 *   purpose: if the product's title was not among its category's presets, it
 *   loaded the title as the literal word "Other" and put the real name in
 *   state nothing on the screen renders.
 *
 *   1. A seller editing "Premium Yellow Maize" saw a product called "Other",
 *      with no way to read or correct its name.
 *   2. Changing the category then wrote "Other" into the title box — and the
 *      save's branch that put the real name back needed the OLD category's
 *      presets to still be there, so after a category change the product was
 *      renamed to "Other" in the database.
 *   3. The screen's error guard was `if (error || !title)`. Clearing the title
 *      — which the category handler did, and which a seller does by hand to
 *      retype a name — replaced the whole form with "Error Loading Product",
 *      taking every other unsaved change with it.
 *
 *   The sentinel is gone from that screen: no menu, nothing for it to stand in
 *   for. The guard now asks whether the product LOADED, which is the question
 *   it was trying to ask.
 *
 * ── WHY THIS MOUNTS BOTH FORMS ──────────────────────────────────────────────
 *
 *   Because a source ratchet cannot tell live code from dead code — the lesson
 *   #287 left in legacy-onboarding-outcome.render.test.tsx. This types a name,
 *   picks a category, and reads back what is on screen and what would be
 *   submitted.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockCreateProduct = jest.fn() as jest.Mock<any>;
const mockGetProductById = jest.fn() as jest.Mock<any>;
const mockUpdateProduct = jest.fn() as jest.Mock<any>;
const mockPush = jest.fn();

jest.mock('next-auth/react', () => {
    //   next-auth returns the SAME object from context on every render. A mock
    //   that rebuilds it hangs any effect that depends on the session.
    const session = { data: { user: { id: 'seller-1', email: 'ada@example.test' } }, status: 'authenticated' };
    return { useSession: () => session };
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush, back: jest.fn(), refresh: jest.fn() }),
    useParams: () => ({ id: 'prod-1' }),
    useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/contexts/ToastContext', () => ({
    useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock('@/hooks/use-storage', () => ({
    useStorage: () => ({ uploadFile: jest.fn(), uploadState: {} }),
}));

jest.mock('@/app/actions/marketplace', () => ({
    createProductAction: (...a: any[]) => mockCreateProduct(...a),
    getProductByIdAction: (...a: any[]) => mockGetProductById(...a),
    updateProductAction: (...a: any[]) => mockUpdateProduct(...a),
}));

import CreateProductPage from '@/app/marketplace/sell/create/page';
import EditProductClient from '@/app/marketplace/seller/products/[id]/edit/EditProductClient';

/** The box the seller types a product name into, whichever one is on screen. */
function titleBox(): HTMLInputElement {
    const free = document.querySelector('input[placeholder="e.g., Fresh Organic Tomatoes"]');
    const custom = document.querySelector('input[placeholder="e.g., Premium Yellow Maize"]');
    const box = (free ?? custom) as HTMLInputElement | null;
    if (!box) throw new Error('no product title box on screen');
    return box;
}

/** What the form would actually submit as the title. */
function submittedTitle(): string {
    const field = document.querySelector('[name="title"]') as HTMLInputElement | HTMLSelectElement | null;
    return field ? field.value : '';
}

/**
 * The category dropdown, found by what it OFFERS.
 *
 * The create form names the field (it posts a real FormData); the edit form is
 * fully controlled and builds its FormData by hand, so its select has no name.
 * Both offer the same eighteen categories.
 */
function categorySelect(): HTMLSelectElement {
    const selects = Array.from(document.querySelectorAll('select'));
    const found = selects.find((el) =>
        Array.from(el.options).some((o) => o.value === 'grains'),
    );
    if (!found) throw new Error('no category dropdown on screen');
    return found as HTMLSelectElement;
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('/marketplace/sell/create — picking a category keeps the name', () => {
    it('A TYPED NAME SURVIVES a category that has a preset menu', async () => {
        const user = userEvent.setup();
        render(<CreateProductPage />);

        await user.type(titleBox(), 'Premium Yellow Maize');
        expect(titleBox().value).toBe('Premium Yellow Maize');

        //   "grains" is one of the categories with presets, so the menu
        //   replaces the plain box — which is exactly where the name used to
        //   be dropped.
        await user.selectOptions(categorySelect(), 'grains');

        await waitFor(() => expect(titleBox().value).toBe('Premium Yellow Maize'));
        //   And it is the value that would be submitted, not just one on screen.
        expect(submittedTitle()).toBe('Premium Yellow Maize');
    });

    it('and a category with NO menu gets the name back in the plain box', async () => {
        const user = userEvent.setup();
        render(<CreateProductPage />);

        await user.type(titleBox(), 'Premium Yellow Maize');
        await user.selectOptions(categorySelect(), 'grains');
        //   "equipment" has no preset list, so the menu goes away again.
        await user.selectOptions(categorySelect(), 'equipment');

        await waitFor(() => expect(submittedTitle()).toBe('Premium Yellow Maize'));
        //   NOT the sentinel. The menu's "Other" is a marker for a hidden
        //   text box; with no menu on screen it would be the product's name.
        expect(titleBox().value).not.toBe('Other');
    });

    it('a PICK from one menu moves to the next category rather than vanishing', async () => {
        const user = userEvent.setup();
        render(<CreateProductPage />);

        await user.selectOptions(categorySelect(), 'grains');
        const menu = document.querySelector('select[name="title"]') as HTMLSelectElement;
        await user.selectOptions(menu, 'White Maize');
        expect(submittedTitle()).toBe('White Maize');

        //   Vegetables do not offer White Maize. The old behaviour deleted it.
        await user.selectOptions(categorySelect(), 'vegetables');

        await waitFor(() => expect(submittedTitle()).toBe('White Maize'));
    });

    it('and choosing a name the new menu DOES offer keeps it on the menu', async () => {
        const user = userEvent.setup();
        render(<CreateProductPage />);

        await user.selectOptions(categorySelect(), 'grains');
        await user.selectOptions(document.querySelector('select[name="title"]') as HTMLSelectElement, 'Sorghum');

        //   "Grains & Cereals" and the cereal list are the same table, so the
        //   pick is still valid and stays a pick.
        await user.selectOptions(categorySelect(), 'grains');

        await waitFor(() => expect(submittedTitle()).toBe('Sorghum'));
    });

    it('an empty form does not invent a name when a category is chosen', async () => {
        const user = userEvent.setup();
        render(<CreateProductPage />);

        await user.selectOptions(categorySelect(), 'grains');

        expect(submittedTitle()).toBe('');
    });
});

describe('/marketplace/seller/products/[id]/edit — the name is the name', () => {
    const seed = (title: string, category: string) => ({
        success: true as const,
        error: null,
        data: {
            id: 'prod-1',
            title,
            description: 'From the farm',
            category,
            unit: 'kg',
            availableQuantity: 10,
            minimumOrderQuantity: 1,
            images: [],
            pricingTiers: [{ type: 'retail', price: 1000, minQuantity: 1 }],
            //   Required on this screen, so a seed without it cannot submit.
            //   (Products created at /marketplace/sell/create have no nearest
            //   market — that form does not ask — which is its own problem.)
            location: { state: 'Enugu', lga: 'Nsukka', nearestMarket: 'Mile 12 Market' },
        },
    });

    it('SHOWS THE PRODUCT\'S NAME, not the word "Other"', async () => {
        //   "Premium Yellow Maize" is not one of the grain presets, which is
        //   the case that used to load as "Other".
        render(<EditProductClient initial={seed('Premium Yellow Maize', 'grains') as any} />);

        await waitFor(() => expect(titleBox().value).toBe('Premium Yellow Maize'));
    });

    it('and changing the category leaves the name alone', async () => {
        const user = userEvent.setup();
        render(<EditProductClient initial={seed('Premium Yellow Maize', 'grains') as any} />);

        await waitFor(() => expect(titleBox().value).toBe('Premium Yellow Maize'));
        await user.selectOptions(categorySelect(), 'vegetables');

        expect(titleBox().value).toBe('Premium Yellow Maize');
    });

    it('CLEARING THE TITLE TO RETYPE IT does not destroy the form', async () => {
        //   The guard asked `!title`, so an empty box read as "the product
        //   could not be loaded" and replaced the form — with the description,
        //   the prices and the stock the seller had just edited inside it.
        const user = userEvent.setup();
        render(<EditProductClient initial={seed('Premium Yellow Maize', 'grains') as any} />);

        await waitFor(() => expect(titleBox().value).toBe('Premium Yellow Maize'));
        await user.clear(titleBox());

        expect(screen.queryByText(/Error Loading Product/i)).toBeNull();
        expect(categorySelect()).toBeTruthy();

        await user.type(titleBox(), 'Yellow Maize (Premium)');
        expect(titleBox().value).toBe('Yellow Maize (Premium)');
    });

    it('but a product that genuinely did not load still says so', async () => {
        //   Vacuity guard: the fix must not have turned the error screen off.
        mockGetProductById.mockResolvedValue({ success: false, error: 'Product not found', data: null });

        render(<EditProductClient initial={null} />);

        await waitFor(() => expect(screen.getByText(/Error Loading Product/i)).toBeTruthy());
    });

    it('and the title it would SAVE is the one in the box', async () => {
        const user = userEvent.setup();
        mockUpdateProduct.mockResolvedValue({ success: true, error: null, data: null });

        render(<EditProductClient initial={seed('Premium Yellow Maize', 'grains') as any} />);
        await waitFor(() => expect(titleBox().value).toBe('Premium Yellow Maize'));

        //   The category change is the step that used to make the save write
        //   "Other" — hasCategoryTitles went false and the branch that
        //   restored the real name stopped applying.
        await user.selectOptions(categorySelect(), 'equipment');
        await user.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => expect(mockUpdateProduct).toHaveBeenCalled());
        //   updateProductAction(prevState, formData) — the useActionState
        //   shape, called directly here.
        const sent = mockUpdateProduct.mock.calls[0][1] as FormData;
        expect(sent.get('title')).toBe('Premium Yellow Maize');
        expect(sent.get('category')).toBe('equipment');
    });
});
