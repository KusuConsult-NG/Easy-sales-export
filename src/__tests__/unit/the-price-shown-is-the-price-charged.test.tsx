/**
 * @jest-environment jsdom
 */

/**
 *   #577 THE BUTTON SAID "Pay ₦X" AND THE SERVER CHARGED ₦Y.
 *
 *   /export/buyer/cart priced the order in naira like this:
 *
 *       // Convert cart total from USD to Naira for Paystack (approximate rate)
 *       const USD_TO_NGN_RATE = 1650;
 *       const totalInNaira = cartTotal * USD_TO_NGN_RATE;
 *
 *   and put that number in the three places a buyer reads as a price: the
 *   "Total (NGN)" line, the note "Rate: $1 = ₦1,650", and the button — "Pay
 *   ₦94,050,000".
 *
 *   initializeExportOrderPaymentAction charges
 *   `totalUSD * (await getExchangeRates()).usdToNgn`, an OWNER-EDITABLE SETTING
 *   with a screen at /admin, bounds checks and cache invalidation behind it.
 *
 *   #381's whole point was that an FX rate frozen in source "is wrong the day
 *   after it is written". It took the constant out of the ACTION — the corpse
 *   is still there, commented, at the top of export-payment.ts — AND LEFT THE
 *   COPY IN THE SCREEN. One rule, two doors, one of them fixed: the commonest
 *   shape in this audit, this time on the door that quotes the price.
 *
 *   The default is 1650, so the two agree until the owner uses the screen that
 *   was built for exactly this. Then the buyer approves one number and Paystack
 *   debits another — and the only local record of the purchase (#569's key)
 *   stored the number they were SHOWN, so the support conversation afterwards
 *   started from the wrong figure too.
 *
 *   THE GOODS DRIFT THE SAME WAY. `cartTotal` sums prices snapshotted into
 *   localStorage when each item was added; the action re-prices every line from
 *   the catalogue row. A price edited in between moves the charge and not the
 *   button.
 *
 * ── THE FIX IS IN TWO HALVES AND NEITHER IS ENOUGH ALONE ────────────────────
 *
 *   THE RATE IS SEEDED FROM THE SERVER, so the screen displays the rate this
 *   application will charge at rather than a second copy of it. That closes the
 *   steady state and nothing else: a rate can still move between the render and
 *   the click.
 *
 *   SO THE DISPLAYED TOTAL IS SENT WITH THE CHECKOUT, and the action refuses
 *   unless its own total agrees to the kobo. A refusal hands back what the
 *   server computed, the summary re-prices itself, and the buyer accepts the
 *   new figure or does not — instead of finding out from their statement.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   This is not a security fix and saying so would be the louder, falser claim.
 *   The server has always priced the order itself, so a lying client could
 *   never pay less than the catalogue says; the quote can only make a charge
 *   NOT HAPPEN. What was broken is honesty about the price, in the direction
 *   that costs the buyer.
 *
 *   Nor is the seed a waterfall fix. This screen never fetched on mount — the
 *   basket lives in localStorage — and it is on #545's ledger as not
 *   convertible for that reason. It comes off the ledger here without a round
 *   trip being removed, which is recorded there in those words.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the quote comparison removed                   KILLED (4 tests)
 *     the screen back to a hard-coded 1650            KILLED (5)
 *     the displayed total not sent to the action      KILLED (3)
 *     the re-quote ignored by the screen              KILLED (3)
 *     the tolerance widened to a naira                KILLED (1)
 *     the server page seeding a constant              KILLED (1)
 *     the re-quote held loosely across baskets        KILLED (1)
 *     reword the finding comment                      SURVIVED, as intended
 *
 *   No mutant survived and none was discarded as equivalent. Two INSTRUMENT
 *   faults were found on the way and are recorded where they were made: jsdom's
 *   location cannot be replaced, so the redirect is observed as a hash change;
 *   and clearCart leaves an empty array rather than an absent key, so the
 *   "basket kept" assertion counts items.
 */

import React from 'react';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';

// ─────────────────────────────────────────────────────────────────────────────
// The screen
// ─────────────────────────────────────────────────────────────────────────────

const initializeExportOrderPaymentAction = jest.fn() as jest.Mock<any>;

jest.mock('@/app/actions/export-payment', () => ({
    initializeExportOrderPaymentAction: (...a: any[]) => initializeExportOrderPaymentAction(...a),
}));
jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: { user: { id: 'buyer-1' } }, status: 'authenticated' }),
    signOut: jest.fn(),
}));
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/export/buyer/cart',
}));

/** One product, $2,500/MT, 10 MT — $25,000. */
const CART = [{
    product: {
        id: 'cocoa', name: 'Cocoa Beans', icon: '🫘', origin: 'Ondo', season: 'Sep',
        category: 'nuts', grades: ['A'], certifications: [], pricePerMT: 2_500, minOrderMT: 1,
    },
    grade: 'A',
    quantityMT: 10,
}];

const CART_USD = 25_000;

/**
 * The real ExportCartProvider, seeded through localStorage — the basket has to
 * come from where the screen actually reads it, or the thing under test is a
 * stub of the defect rather than the defect.
 */
async function renderCart(usdToNgn: number) {
    localStorage.setItem('export_cart', JSON.stringify(CART));

    const { ExportCartProvider } = await import('@/contexts/ExportCartContext');
    const { default: ExportCartClient } = await import('@/app/export/buyer/cart/ExportCartClient');

    const utils = render(
        <ExportCartProvider>
            <ExportCartClient usdToNgn={usdToNgn} />
        </ExportCartProvider>
    );

    //   The provider restores the basket in a timer callback (#347).
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    return utils;
}

/** Walk from the cart step to the payment step, filling in what is required. */
async function goToPayment(container: HTMLElement) {
    const click = async (re: RegExp) => {
        const button = Array.from(container.querySelectorAll('button'))
            .find(b => re.test(b.textContent || ''));
        if (!button) throw new Error(`no button matching ${re}`);
        await act(async () => { button.click(); });
    };

    await click(/continue to details/i);

    for (const [placeholder, value] of [
        ['Your company name', 'A Co'],
        ['Full name', 'A Person'],
        ['buyer@company.com', 'b@e.com'],
    ] as const) {
        const input = container.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;
        await act(async () => { fireEvent.change(input, { target: { value } }); });
    }
    //   Country is required too, and is the one field without a placeholder of
    //   its own shape — found by label rather than guessed at.
    const country = Array.from(container.querySelectorAll('input, select'))
        .find(el => /country/i.test(
            el.closest('div')?.parentElement?.textContent?.slice(0, 40) || ''
        )) as HTMLInputElement;
    await act(async () => { fireEvent.change(country, { target: { value: 'Germany' } }); });

    await click(/continue to payment/i);
}

function payButton(container: HTMLElement): HTMLButtonElement {
    const b = Array.from(container.querySelectorAll('button'))
        .find(el => /^pay ₦/i.test((el.textContent || '').trim()));
    if (!b) throw new Error('no pay button');
    return b as HTMLButtonElement;
}

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    /**
     *   THE REDIRECT IS OBSERVED AS A HASH CHANGE, DELIBERATELY.
     *
     *   The screen redirects with `window.location.href = authorizationUrl`.
     *   jsdom's location cannot be replaced (defineProperty throws "Cannot
     *   redefine property") and it will not navigate, so an https URL leaves
     *   href at "http://localhost/" and the assertion tests nothing. A
     *   same-document hash is the one assignment jsdom really performs, so
     *   `location.hash` afterwards is evidence the line ran rather than a
     *   value the harness set itself.
     */
    initializeExportOrderPaymentAction.mockResolvedValue({
        success: true, error: null, data: { authorizationUrl: '#paystack', reference: 'ref-1' },
    });
    window.location.hash = '';
});

describe('#577 — the screen quotes the rate the server charges at', () => {
    it('THE RATE SHOWN IS THE ONE THE SERVER GAVE IT, NOT 1,650', async () => {
        //   THE test. With the constant in place this said ₦41,250,000 and
        //   "Rate: $1 = ₦1,650" while the server charged at 1,900.
        const { container } = await renderCart(1_900);

        expect(container.textContent).toContain('₦47,500,000');
        expect(container.textContent).toContain('Rate: $1 = ₦1,900');
        expect(container.textContent).not.toContain('₦1,650');
    });

    it('AND SO IS THE NUMBER ON THE BUTTON', async () => {
        const { container } = await renderCart(1_900);
        await goToPayment(container);

        expect(payButton(container).textContent).toContain('₦47,500,000');
    });

    it('AND THAT NUMBER IS WHAT THE CHECKOUT SENDS', async () => {
        //   The claim the whole fix rests on: the server is told what the buyer
        //   was shown, so it can refuse to charge anything else.
        const { container } = await renderCart(1_900);
        await goToPayment(container);

        await act(async () => { payButton(container).click(); });

        await waitFor(() => expect(initializeExportOrderPaymentAction).toHaveBeenCalled());
        const [, , quoted] = initializeExportOrderPaymentAction.mock.calls[0] as any[];
        expect(quoted).toBe(CART_USD * 1_900);
    });

    it('AND A REFUSED QUOTE RE-PRICES THE SCREEN INSTEAD OF THE STATEMENT', async () => {
        //   The rate moved between the render and the click. Nothing charged,
        //   and the buyer is looking at the new total before agreeing to it.
        initializeExportOrderPaymentAction.mockResolvedValue({
            success: false,
            error: 'The price of this order has changed',
            data: undefined,
            meta: { quote: { totalUSD: CART_USD, totalNGN: CART_USD * 2_000, usdToNgn: 2_000 } },
        });

        const { container } = await renderCart(1_900);
        await goToPayment(container);
        await act(async () => { payButton(container).click(); });

        await waitFor(() => expect(container.textContent).toContain('₦50,000,000'));
        expect(container.textContent).toContain('Rate: $1 = ₦2,000');
        expect(await screen.findByText(/updated to the current price/i)).toBeInTheDocument();
        //   Nowhere was gone to, and the basket is still the buyer's — checked
        //   by its CONTENTS, because clearCart leaves an empty array behind
        //   rather than an absent key.
        expect(window.location.hash).toBe('');
        expect(JSON.parse(localStorage.getItem('export_cart') || '[]')).toHaveLength(1);
    });

    it('AND THE SECOND PRESS SENDS THE RE-QUOTED TOTAL', async () => {
        //   A re-quote that the next request does not use would leave the buyer
        //   pressing a button that can only be refused.
        initializeExportOrderPaymentAction.mockResolvedValueOnce({
            success: false, error: 'changed', data: undefined,
            meta: { quote: { totalUSD: CART_USD, totalNGN: CART_USD * 2_000, usdToNgn: 2_000 } },
        });

        const { container } = await renderCart(1_900);
        await goToPayment(container);
        await act(async () => { payButton(container).click(); });
        await waitFor(() => expect(container.textContent).toContain('₦50,000,000'));

        await act(async () => { payButton(container).click(); });

        await waitFor(() => expect(initializeExportOrderPaymentAction).toHaveBeenCalledTimes(2));
        const [, , quoted] = initializeExportOrderPaymentAction.mock.calls[1] as any[];
        expect(quoted).toBe(CART_USD * 2_000);
    });

    it('AND EDITING THE BASKET DISCARDS THE QUOTE', async () => {
        //   The trap in holding a re-quote: it is a price for ONE basket. Held
        //   loosely it would price a bigger order at the smaller one's total —
        //   which the server would refuse, but the screen would be lying again
        //   in the meantime.
        initializeExportOrderPaymentAction.mockResolvedValueOnce({
            success: false, error: 'changed', data: undefined,
            meta: { quote: { totalUSD: CART_USD, totalNGN: CART_USD * 2_000, usdToNgn: 2_000 } },
        });

        const { container } = await renderCart(1_900);
        await goToPayment(container);
        await act(async () => { payButton(container).click(); });
        await waitFor(() => expect(container.textContent).toContain('₦50,000,000'));

        //   Back to the cart, and one more step of 5 MT — a different basket.
        const back = Array.from(container.querySelectorAll('button'))
            .find(b => /back to details/i.test(b.textContent || ''))!;
        await act(async () => { back.click(); });
        const backToCart = Array.from(container.querySelectorAll('button'))
            .find(b => /back to cart/i.test(b.textContent || ''))!;
        await act(async () => { backToCart.click(); });

        const plus = container.querySelectorAll('button.w-8')[1] as HTMLButtonElement;
        await act(async () => { plus.click(); });

        //   15 MT at the SEEDED rate, not 10 MT at the re-quoted one.
        await waitFor(() => expect(container.textContent).toContain('₦71,250,000'));
        expect(container.textContent).toContain('Rate: $1 = ₦1,900');
    });

    it('AND A SUCCESSFUL CHECKOUT STILL REDIRECTS TO PAYSTACK', async () => {
        //   VACUITY GUARD. Every claim above is satisfied by a checkout that
        //   refuses everything, which would take the export module offline —
        //   the exact failure mode this audit exists to avoid.
        const { container } = await renderCart(1_900);
        await goToPayment(container);
        await act(async () => { payButton(container).click(); });

        await waitFor(() => expect(window.location.hash).toBe('#paystack'));
        //   Emptied, not removed: clearCart deletes the key and the provider's
        //   persist effect writes the empty basket straight back. Asserting
        //   `toBeNull()` here failed for that reason, which is the honest
        //   version of the claim.
        expect(JSON.parse(localStorage.getItem('export_cart') || 'null')).toEqual([]);
    });

    it('AND THE LOCAL RECORD HOLDS THE FIGURES THAT WERE CHARGED', async () => {
        //   #569's key is the only local record of the basket at the moment of
        //   payment, kept for the support conversation afterwards. It stored
        //   the browser's guess.
        const { container } = await renderCart(1_900);
        await goToPayment(container);
        await act(async () => { payButton(container).click(); });

        await waitFor(() => expect(window.location.hash).toBe('#paystack'));

        const record = JSON.parse(localStorage.getItem('export_buyer_details_buyer-1') as string);
        expect(record.totalNGN).toBe(CART_USD * 1_900);
        expect(record.usdToNgn).toBe(1_900);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The server half
// ─────────────────────────────────────────────────────────────────────────────

describe('#577 — the rate reaches the screen from the settings', () => {
    it('THE PAGE SEEDS THE CLIENT WITH THE CONFIGURED RATE', async () => {
        //   Not a constant, and not the default: the value an admin saved.
        jest.doMock('@/lib/system-settings', () => ({
            getExchangeRates: jest.fn(async () => ({ usdToNgn: 2_222 })),
        }));

        const { default: ExportCartPage } = await import('@/app/export/buyer/cart/page');
        const element: any = await ExportCartPage();

        expect(element.props.usdToNgn).toBe(2_222);

        jest.dontMock('@/lib/system-settings');
    });
});
