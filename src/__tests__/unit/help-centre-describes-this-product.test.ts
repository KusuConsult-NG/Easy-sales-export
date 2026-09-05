/**
 * @jest-environment node
 */

/**
 *   #334 THE HELP CENTRE DESCRIBED A CHECKOUT THIS PRODUCT DOES NOT HAVE, A
 *        PASS MARK IT DOES NOT USE, AND AN AUTHENTICATOR IT ONLY FALLS BACK TO.
 *
 *        /help is the page a confused buyer or learner is sent to. Three of its
 *        answers described something other than what the code does.
 *
 *        1. HOW TO PAY
 *
 *           "choose between Paystack (card payment) or Bank Transfer. For bank
 *            transfers, send payment to the provided account details and your
 *            order will be verified within 24 hours."
 *
 *           There is no choice: both checkouts declare
 *           `useState<"paystack">("paystack")` — a union with ONE member — and
 *           `setPaymentMethod` is never called anywhere in src/. There are no
 *           "provided account details": the only bank details the marketplace
 *           holds are the seller's, from onboarding. And there is no 24-hour
 *           verification: nothing reads a manual transfer.
 *
 *           Bank transfer DOES work — through Paystack, which issues the
 *           account and confirms the transfer itself, because
 *           initializePaystackPayment defaults to
 *           ["card","bank_transfer","bank","ussd"] and _payment_orders.ts
 *           passes no override. That is a different promise from the one the
 *           page made, and the difference is where a buyer's money sits while
 *           they wait for a confirmation step that does not exist.
 *
 *           The feature the copy described is three-quarters built, which is
 *           why it reads plausibly: createBankTransferOrderAction and
 *           createPaymentOnDeliveryOrderAction are session-guarded,
 *           cart-validated, #272 bounds-checked, and reached by NO screen. The
 *           three layers do not even share a vocabulary — the checkout schema
 *           accepts "payment_on_delivery" but not "bank_transfer", while
 *           marketplace-notifications.ts renders a "Pay on Delivery" label for
 *           a method no buyer can select. Wiring or retiring those two is a
 *           product decision, recorded for the owner rather than made here.
 *
 *        2. THE PASS MARK
 *
 *           "pass the final quiz with 70%+ score" — there is no 70% rule. Each
 *           quiz carries its own passingScore, QuizComponent prints it, and the
 *           platform DEFAULT is 95: _ac_progress.ts grades with
 *           `?? 95` and _ac_quiz.ts stores 95 for a module that never had one,
 *           deliberately aligned. The only 70 is the admin builder's blank-form
 *           default. A learner could be told 70 and meet 95.
 *
 *        3. WHAT SIGNS YOU IN
 *
 *           "We use Firebase Authentication" — Firebase is the FALLBACK.
 *           lib/auth.ts authenticates against Supabase and reaches for Firebase
 *           only to migrate a legacy account; its own comment says "Supabase is
 *           the primary authenticator", and a deployment with no Firebase
 *           credential is supported. The page named the component a deployment
 *           may not have, and omitted the one that checks the password.
 *
 * This is the #311/#312 treatment: the copy is corrected to what the product
 * does, and the feature question is recorded, not answered.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { OFFLINE_CHECKOUT_METHODS } from '@/lib/offline-checkout';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

/** Files under src/ whose RAW text mentions a name — comments included. */
function filesMentioning(name: string): string[] {
    const { execSync } = require('child_process');
    return execSync(
        `grep -rl '${name}' src --include=*.ts --include=*.tsx || true`,
        { encoding: 'utf-8' },
    )
        .split('\n')
        .filter(Boolean)
        .filter((f: string) => !f.includes('__tests__'));
}

const HELP = 'src/app/help/page.tsx';
const CHECKOUT = 'src/app/marketplace/checkout/page.tsx';
const EXPORT_CART = 'src/app/export/buyer/cart/page.tsx';
const ORDERS = 'src/app/actions/marketplace/_payment_orders.ts';
const PAYSTACK = 'src/lib/paystack-server.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#334 — the claims that were withdrawn', () => {
    const help = source(HELP);

    it('THE PAGE NO LONGER OFFERS A BANK-TRANSFER CHOICE AT CHECKOUT', () => {
        // THE test. The exact promise, gone.
        expect(help).not.toMatch(/choose between Paystack/i);
        expect(help).not.toMatch(/send payment to the provided account details/i);
        expect(help).not.toMatch(/verified within 24 hours/i);
    });

    it('nor a 70% pass mark the platform does not use', () => {
        expect(help).not.toMatch(/70%\+/);
    });

    it('nor Firebase as the thing that signs you in', () => {
        expect(help).not.toMatch(/We use Firebase Authentication/i);
    });

    it('VACUITY GUARD: the page is still the help centre, not an empty file', () => {
        // Every assertion above is a not.toMatch, all of which pass on "".
        expect(help.length).toBeGreaterThan(2000);
        expect(help).toContain('How do I make a purchase?');
        expect(help).toContain('Can I get a certificate?');
        expect(help).toContain('Is my data secure?');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#334 — and what it says instead is what the code does', () => {
    const help = source(HELP);

    it('payment goes through Paystack, which is the only initiator wired', () => {
        expect(help).toMatch(/pay through Paystack/i);
        expect(source(CHECKOUT)).toContain('initializeOrderPaymentAction');
    });

    it('names the confirmation step a buyer can actually reach', () => {
        // "Confirm Receipt" is a real button on the buyer order page, calling a
        // real action. (confirmDeliveryAction is NOT it — order-management.ts
        // says "DO NOT WIRE THIS UP" over a rejected payout model.)
        expect(help).toMatch(/Confirm Receipt/);
        const orderPage = source('src/app/marketplace/buyer/orders/[id]/page.tsx');
        expect(orderPage).toContain('confirmOrderReceiptAction');
    });

    it('and the route it sends them to is the one the navigation calls My Orders', () => {
        expect(help).toMatch(/My Orders/);
        expect(source('src/components/layout/ModuleSidebar.tsx'))
            .toContain('/marketplace/buyer/orders');
    });

    it('the pass mark is deferred to the quiz, which prints its own', () => {
        expect(help).toMatch(/passing score shown on that quiz/i);
        expect(source('src/components/academy/QuizComponent.tsx'))
            .toMatch(/Passing score/);
    });

    it('and sign-in is attributed to Supabase, which is what authenticates', () => {
        expect(help).toMatch(/Supabase Auth/);
        expect(source('src/lib/auth.ts')).toContain('Authenticated via Supabase Auth');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#334 — the facts the corrected copy rests on', () => {
    it('THERE IS NO PAYMENT-METHOD CHOOSER: both states are one-member unions', () => {
        // THE premise of the whole finding. If a chooser ever appears, this
        // fails and the copy should be revisited — which is the point.
        expect(source(CHECKOUT)).toContain('useState<"paystack">("paystack")');
        expect(source(EXPORT_CART)).toContain('useState<"paystack">("paystack")');
    });

    it('and the setter is never called anywhere in the codebase', () => {
        // CODE, not comments. The help page's own note names setPaymentMethod
        // while explaining that nothing calls it, and a raw grep counts that
        // sentence as a caller — the same trap the #333 suite hit.
        for (const file of filesMentioning('setPaymentMethod')) {
            const code = source(file);
            for (const line of code.split('\n')) {
                if (!line.includes('setPaymentMethod')) continue;
                // The only permitted occurrence is the useState destructuring.
                expect(line).toMatch(/useState/);
            }
        }
    });

    it('bank transfer reaches the buyer through Paystack, not through us', () => {
        // Why the corrected copy says Paystack "accepts" it rather than that we
        // offer it: the channel list is Paystack's, and the order initiator
        // passes no override, so it gets the default.
        expect(source(PAYSTACK))
            .toContain('channels: string[] = ["card", "bank_transfer", "bank", "ussd"]');
        expect(source(ORDERS)).toContain('initializePaystackPayment');
    });

    it('RECORDED: two order creators for methods no screen offers', () => {
        // Not a fix — an owner decision. Pinned so the finding is not lost: if
        // someone wires them, this test is where the copy question resurfaces.
        //
        // Comments stripped for the same reason as above: the help page names
        // both actions while explaining that no screen calls them.
        for (const name of ['createBankTransferOrderAction', 'createPaymentOnDeliveryOrderAction']) {
            expect(source(ORDERS)).toContain(name);
            const screens = filesMentioning(name)
                .filter((f) => f.endsWith('.tsx'))
                .filter((f) => source(f).includes(name));
            expect(screens).toEqual([]);
        }
    });

    it('POSITIVE CONTROL: that screen search does find an action that IS wired', () => {
        // Without this, the assertion above passes for a broken grep.
        const { execSync } = require('child_process');
        const screens = execSync(
            "grep -rln 'confirmOrderReceiptAction' src --include=*.tsx || true",
            { encoding: 'utf-8' },
        ).split('\n').filter(Boolean);
        expect(screens.length).toBeGreaterThan(0);
    });

    it('the three layers no longer disagree on the vocabulary — #379', () => {
        /**
         *   #379 THIS USED TO ASSERT THE DISAGREEMENT.
         *
         *        The order schema listed "payment_on_delivery" and not
         *        "bank_transfer", while _payment_orders.ts writes both — which
         *        is the drift #334 recorded as the reason the help copy looked
         *        plausible. It never bit, because the live order writer sets no
         *        paymentMethod at all and takes the schema's default; but both
         *        dashboards parse inside a try/catch that falls back to the RAW
         *        document, so a bank-transfer order would have skipped
         *        validation silently rather than failing visibly.
         *
         *        The read side is now spread from OFFLINE_CHECKOUT_METHODS, so
         *        it cannot drift from the write side again.
         */
        const validations = source('src/lib/validations/marketplace.ts');

        expect(validations).toMatch(/z\.enum\(\["escrow", "wallet", \.\.\.OFFLINE_CHECKOUT_METHODS\]\)/);
        expect(validations).toMatch(/from "@\/lib\/offline-checkout"/);
        // And the shared list really is the two the creators write.
        expect(OFFLINE_CHECKOUT_METHODS).toEqual(['bank_transfer', 'payment_on_delivery']);
    });

    it('the platform default pass mark is 95, not the 70 the page claimed', () => {
        expect(source('src/app/actions/academy/_ac_progress.ts'))
            .toMatch(/passingScore\s*\?\?\s*95/);
        // #386 named that literal DEFAULT_QUIZ_PASSING_SCORE and moved it beside
        // the grading rule, so the check follows it to its definition rather
        // than to a call site where a rename would silently satisfy it.
        expect(source('src/lib/academy-grading.ts'))
            .toContain('export const DEFAULT_QUIZ_PASSING_SCORE = 95;');
        expect(source('src/app/actions/academy/_ac_quiz.ts'))
            .toContain('DEFAULT_QUIZ_PASSING_SCORE');
    });
});
