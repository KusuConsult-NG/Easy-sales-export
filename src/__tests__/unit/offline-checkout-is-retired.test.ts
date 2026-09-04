/**
 * @jest-environment node
 */

/**
 *   #379 #334's OWNER DECISION, TAKEN: THE TWO OFFLINE CHECKOUTS ARE RETIRED,
 *        AND RETIRING THEM MEANT REFUSING THEM, NOT NOTING THEM.
 *
 *        #334 corrected a help-centre page that described a checkout the
 *        product does not have — "choose between Paystack or Bank Transfer;
 *        for bank transfers, send payment to the provided account details and
 *        your order will be verified within 24 hours" — and left the product
 *        question open, because _payment_orders.ts really does export two
 *        finished-looking order creators that no screen calls.
 *
 *        THE DECISION IS TO RETIRE BOTH, and each has its own measured reason.
 *
 *        BANK TRANSFER HAS NO SECOND HALF. It writes
 *        `paymentStatus: "pending_verification"` on the order, and nothing in
 *        this codebase reads that value on a marketplace order. No screen,
 *        route or action moves it on. Wiring it would take a buyer's cart,
 *        decrement the stock, mark the order "processing" and strand it. And
 *        Paystack's own page already accepts bank transfer and confirms it
 *        automatically, so this would replace a working channel with a broken
 *        one.
 *
 *        PAYMENT ON DELIVERY BYPASSES ESCROW, WHICH IS THE PRODUCT. Its order
 *        carries no escrow row, so confirmReceipt marks it delivered and loops
 *        over nothing; the platform fee lives ON the escrow row (#109, #271),
 *        so the platform earns nothing and has nothing to reconcile; and every
 *        dispute path acts on an escrow.
 *
 *        REFUSED RATHER THAN NOTED. "No screen calls it" is not "nobody can
 *        call it": actions/marketplace/index.ts does
 *        `export * from "./_payment_orders"`, so both are registered server
 *        actions reachable over the wire by any signed-in caller — the exact
 *        reasoning #374 applied to the unwired dispute resolver. An armed
 *        action that reserves stock and creates an order the platform cannot
 *        settle is not dead code.
 *
 *        NOT DELETED. The implementations stay whole for whoever finishes the
 *        feature, behind an env flag that is off by default — the pattern this
 *        codebase already uses for GDPR_PURGE_DELETE_AUTH, SEED_ALLOW_REMOTE
 *        and CLEANUP_ALLOW_REMOTE.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    OFFLINE_CHECKOUT_METHODS,
    OFFLINE_CHECKOUT_ENV,
    OFFLINE_CHECKOUT_ENABLED_VALUE,
    isOfflineCheckoutEnabled,
    offlineCheckoutRefusal,
} from '@/lib/offline-checkout';

const code = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));
const raw = (rel: string) => readFileSync(rel, 'utf-8');

const ORDERS = 'src/app/actions/marketplace/_payment_orders.ts';
const FLAG = 'src/lib/offline-checkout.ts';

const cart = [{
    productId: 'prod-1', productTitle: 'Ginger', quantity: 3, price: 1000, sellerId: 'seller-1',
}];

const originalFlag = process.env[OFFLINE_CHECKOUT_ENV];

beforeEach(() => {
    jest.clearAllMocks();
    delete process.env[OFFLINE_CHECKOUT_ENV];
    (global as any).mockRequireSession.mockResolvedValue({
        session: { user: { id: 'buyer-1', email: 'buyer@example.com', roles: [] } },
        error: null,
    });
});

afterEach(() => {
    if (originalFlag === undefined) delete process.env[OFFLINE_CHECKOUT_ENV];
    else process.env[OFFLINE_CHECKOUT_ENV] = originalFlag;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#379 — the flag', () => {
    it('IS OFF WHEN UNSET', () => {
        delete process.env[OFFLINE_CHECKOUT_ENV];

        expect(isOfflineCheckoutEnabled()).toBe(false);
    });

    it('AND OFF FOR EVERY TRUTHY VALUE THAT IS NOT THE WORD', () => {
        // A specific word, not a truthy value: a stray "1" or "true" left in an
        // environment must not enable a checkout the platform cannot settle.
        for (const v of ['1', 'true', 'yes', 'on', 'ENABLED', 'enabled ', '']) {
            process.env[OFFLINE_CHECKOUT_ENV] = v;
            expect({ v, on: isOfflineCheckoutEnabled() }).toEqual({ v, on: false });
        }
    });

    it('and on for exactly the word', () => {
        process.env[OFFLINE_CHECKOUT_ENV] = OFFLINE_CHECKOUT_ENABLED_VALUE;

        expect(isOfflineCheckoutEnabled()).toBe(true);
    });

    it('the two methods it governs are the two the creators write', () => {
        expect([...OFFLINE_CHECKOUT_METHODS]).toEqual(['bank_transfer', 'payment_on_delivery']);
        for (const m of OFFLINE_CHECKOUT_METHODS) {
            expect(code(ORDERS)).toContain(`paymentMethod: "${m}"`);
        }
    });

    it('each refusal names its own reason, because they are missing different halves', () => {
        const bt = offlineCheckoutRefusal('bank_transfer');
        const pod = offlineCheckoutRefusal('payment_on_delivery');

        expect(bt).not.toBe(pod);
        expect(bt).toMatch(/payment page/i);
        expect(pod).toMatch(/escrow/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#379 — both creators refuse, and refuse before touching anything', () => {
    async function bankTransfer() {
        const { createBankTransferOrderAction } = await import('@/app/actions/marketplace/_payment_orders');
        return createBankTransferOrderAction(cart as any, 'buyer@example.com', '08000000000', 0);
    }

    async function payOnDelivery() {
        const { createPaymentOnDeliveryOrderAction } = await import('@/app/actions/marketplace/_payment_orders');
        return createPaymentOnDeliveryOrderAction(cart as any, '08000000000', {
            recipientName: 'Ada Obi',
            recipientPhone: '08000000000',
            street: '1 Market Rd',
            city: 'Enugu',
            state: 'Enugu',
            lga: 'Enugu North',
        });
    }

    it('BANK TRANSFER REFUSES WITH THE FLAG OFF', async () => {
        const result: any = await bankTransfer();

        expect(result.success).toBe(false);
        expect(result.error).toBe(offlineCheckoutRefusal('bank_transfer'));
    });

    it('PAYMENT ON DELIVERY REFUSES WITH THE FLAG OFF', async () => {
        const result: any = await payOnDelivery();

        expect(result.success).toBe(false);
        expect(result.error).toBe(offlineCheckoutRefusal('payment_on_delivery'));
    });

    it('NEITHER READS A SESSION, A PRODUCT OR THE PLATFORM FEES FIRST', async () => {
        // The refusal is the first statement in the body. An action that
        // reserves stock must not do any of its work before deciding it is off.
        await bankTransfer();
        await payOnDelivery();

        expect((global as any).mockRequireSession).not.toHaveBeenCalled();
        expect((global as any).mockFirestoreGet).not.toHaveBeenCalled();
    });

    it('AND NOTHING IS WRITTEN — no order, no reservation', async () => {
        await bankTransfer();
        await payOnDelivery();

        expect((global as any).mockFirestoreSet).not.toHaveBeenCalled();
        expect((global as any).mockFirestoreTxSet).not.toHaveBeenCalled();
        expect((global as any).mockFirestoreBatchCommit).not.toHaveBeenCalled();
    });

    it('the refusal is a REFUSAL, not a success with no order behind it', async () => {
        // #102's shape: reporting success for work that did not happen is worse
        // than refusing.
        for (const result of [await bankTransfer(), await payOnDelivery()] as any[]) {
            expect(result.success).toBe(false);
            expect(String(result.error ?? '').length).toBeGreaterThan(20);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#379 — kept, not deleted', () => {
    it('BOTH ARE STILL EXPORTED SERVER ACTIONS', () => {
        const src = code(ORDERS);

        expect(src).toContain('export const createBankTransferOrderAction');
        expect(src).toContain('export const createPaymentOnDeliveryOrderAction');
    });

    it('and their implementations are intact, not stubbed out', () => {
        const src = code(ORDERS);

        // The halves that must survive for whoever finishes the feature: the
        // all-or-nothing reservation, the #272 bounds check, the order write.
        expect(src).toContain('decrementManyOrFail');
        expect(src).toContain('checkOrderAmountBounds');
        expect(src).toContain('paymentMethod: "bank_transfer"');
        expect(src).toContain('paymentMethod: "payment_on_delivery"');
    });

    it('THE REASON IS RECORDED WHERE SOMEBODY ENABLING IT WILL READ IT', () => {
        const flagFile = raw(FLAG);

        expect(flagFile).toContain('#379');
        expect(flagFile).toContain('BANK TRANSFER HAS NO SECOND HALF');
        expect(flagFile).toContain('PAYMENT ON DELIVERY BYPASSES ESCROW');
        // Measured on code, not prose — the file names both methods in its
        // header, and a raw sweep would count those.
        expect(code(FLAG)).not.toContain('BANK TRANSFER HAS NO SECOND HALF');
    });

    it('and both call sites say why, at the gate', () => {
        const src = raw(ORDERS);

        expect(src.match(/#379 RETIRED\./g) ?? []).toHaveLength(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#379 — the premise: no reader, and no escrow', () => {
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

    it('NOTHING READS pending_verification ON A MARKETPLACE ORDER', () => {
        /**
         * The whole reason bank transfer cannot be wired. The value is written
         * in one place and compared nowhere against an order — the readers that
         * do exist are Farm Nation's land listings, a different entity.
         */
        const writers = SRC.filter((f) => /paymentStatus:\s*"pending_verification"/.test(code(f)));
        expect(writers).toEqual([ORDERS]);

        const orderReaders = SRC.filter((f) => {
            const c = code(f);
            return /paymentStatus\s*===\s*["']pending_verification["']/.test(c)
                || /where\(\s*["']paymentStatus["']\s*,\s*["']==["']\s*,\s*["']pending_verification["']/.test(c);
        });
        expect(orderReaders).toEqual([]);

        // Not vacuous: the sweep does find the land readers of the same word on
        // a different field, so the regexes are looking in the right places.
        expect(SRC.filter((f) => /pending_verification/.test(code(f))).length)
            .toBeGreaterThan(5);
    });

    it('AND THE PAY-ON-DELIVERY ORDER HAS NO ESCROW ROW', () => {
        const src = code(ORDERS);
        const podAt = src.indexOf('_createPaymentOnDeliveryOrderAction');
        expect(podAt).toBeGreaterThan(-1);

        const pod = src.slice(podAt);
        expect(pod).not.toContain('ESCROW_TRANSACTIONS');
        // While the LIVE path creates one, which is the contrast.
        const live = src.slice(src.indexOf('_initializeOrderPaymentAction'), podAt);
        expect(live).toContain('ESCROW_TRANSACTIONS');
    });

    it('so confirming receipt on one would release nothing', () => {
        // The consequence, read off the code that already exists: the release
        // loop iterates the escrows of the order, of which there would be none.
        const buyer = code('src/app/actions/marketplace/_buyer.ts');

        expect(buyer).toMatch(/ESCROW_TRANSACTIONS\)\.where\("orderId", "==", orderId\)/);
    });

    it('and the platform fee lives on the escrow row, so there would be none', () => {
        const src = code(ORDERS);

        expect(src).toContain('platformFee: platformFee');
        // In the escrow write, not the order write.
        const escrowWrite = src.slice(src.indexOf('escrowRef.set('), src.indexOf('escrowRef.set(') + 900);
        expect(escrowWrite).toContain('platformFee');
    });

    it('the sweep is not vacuous', () => {
        expect(SRC.length).toBeGreaterThan(400);
    });
});
